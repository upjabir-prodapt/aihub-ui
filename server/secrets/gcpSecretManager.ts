import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { env } from '../config/env';

const client = new SecretManagerServiceClient();
const cache: Record<string, { value: string; fetchedAt: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export async function getSecret(secretName: string): Promise<string> {
  const now = Date.now();
  if (cache[secretName] && now - cache[secretName].fetchedAt < CACHE_TTL_MS) {
    return cache[secretName].value;
  }

  try {
    const name = `projects/${env.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new Error(`Secret ${secretName} has no payload`);
    }

    cache[secretName] = { value: payload, fetchedAt: now };
    return payload;
  } catch (err) {
    console.error(`Error retrieving secret ${secretName} from Secret Manager:`, err);
    throw err;
  }
}
