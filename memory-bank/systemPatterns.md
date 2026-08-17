# System Patterns — AI CoE Hub BFF

Modular architecture detailing clear separation of duties:

## Server BFF (Node.js runtime under `/server`)
- **`server/config/env.ts`**: Unified env settings and static defaults.
- **`server/secrets/gcpSecretManager.ts`**: Dynamic secrets loader with caching.
- **`server/session/sessionStore.ts`**: SHA-256 session hash key indexes inside Native mode Firestore, idle timeout (60m), absolute timeout (8h), locking transaction leases (stampede prevention), and rotational grace windows.
- **`server/session/sessionCrypto.ts`**: KMS DEK-encrypted sessions cached in memory.
- **`server/security/csrf.ts`**: Double-submit token check + origin matching.
- **`server/entra/oidcClient.ts`**: Redirect builders, exchange and refresh routines.

## Frontend (Vite Client SPA restored under `/src`)
- Wrapped completely by a Next.js client component `app/page.tsx` loaded via `next/dynamic` with `ssr: false` (to bypass localStorage reference errors).
