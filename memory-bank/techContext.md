# Tech Context — AI CoE Hub BFF

Unified technology stack supporting NextJS single container deployments:

- **Framework**: Next.js 16 App Router.
- **Package Manager**: pnpm 11.22.0.
- **Database**: Firestore Native Mode.
- **Crypto & Secrets**: Node native `crypto`, GCP KMS API, and Google Cloud Secret Manager API.
- **Proxy**: HTTP fetch forwards to Apigee endpoints.
- **Runtime**: Node.js 20-alpine running as Next.js standalone server on port 8080.
