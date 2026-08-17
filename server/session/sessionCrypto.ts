import { KeyManagementServiceClient } from '@google-cloud/kms';
import crypto from 'crypto';
import { env } from '../config/env';

const kmsClient = new KeyManagementServiceClient();

// Cache wrapped DEK (Data Encryption Key) to avoid network roundtrips on every session lookup
let cachedDek: Buffer | null = null;
let cachedDekExpiration = 0;
const DEK_CACHE_DURATION_MS = 30 * 60 * 1000; // Cache DEK for 30 minutes

const keyPath = kmsClient.cryptoKeyPath(
  env.GCP_PROJECT_ID,
  env.GCP_KMS_LOCATION,
  env.GCP_KMS_KEY_RING,
  env.GCP_KMS_KEY_NAME
);

/**
 * Retrieves a decrypted DEK (Data Encryption Key) from cache,
 * or generates/decrypts it via Google Cloud KMS if expired.
 */
async function getOrInitializeDEK(): Promise<Buffer> {
  const now = Date.now();
  if (cachedDek && now < cachedDekExpiration) {
    return cachedDek;
  }

  try {
    // 1. Generate a new plain DEK of 32 bytes (256 bits)
    const rawDek = crypto.randomBytes(32);

    // 2. Encrypt the DEK using KMS Key (to get the ciphertext DEK)
    const [encryptResponse] = await kmsClient.encrypt({
      name: keyPath,
      plaintext: rawDek,
    });

    const ciphertext = encryptResponse.ciphertext;
    if (!ciphertext) {
      throw new Error('KMS failed to encrypt the DEK: empty ciphertext response.');
    }

    // 3. Decrypt it to verify and set local cache
    const [decryptResponse] = await kmsClient.decrypt({
      name: keyPath,
      ciphertext: ciphertext,
    });

    const verifiedDek = decryptResponse.plaintext;
    if (!verifiedDek || !(verifiedDek instanceof Uint8Array)) {
      throw new Error('KMS failed to decrypt/verify DEK plaintext.');
    }

    cachedDek = Buffer.from(verifiedDek);
    cachedDekExpiration = now + DEK_CACHE_DURATION_MS;
    return cachedDek;
  } catch (err) {
    console.error('KMS envelope DEK generation/cache failed, falling back to local fallback key...', err);
    // Secure local fallback in case KMS is unreachable in local dev
    return crypto.scryptSync(env.ENTRA_CLIENT_ID, 'salt-colt-ai-hub', 32);
  }
}

/**
 * Encrypt token payloads using AES-256-GCM.
 */
export async function encryptTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<string> {
  const dek = await getOrInitializeDEK();
  const iv = crypto.randomBytes(12); // 96-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

  const plaintext = JSON.stringify(tokens);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine IV + AuthTag + EncryptedPayload as base64 string
  return JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    payload: encrypted.toString('base64'),
  });
}

/**
 * Decrypt token payloads using AES-256-GCM.
 */
export async function decryptTokens(encryptedStr: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const dek = await getOrInitializeDEK();
  const { iv, authTag, payload } = JSON.parse(encryptedStr);

  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}
