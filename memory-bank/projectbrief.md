# Project Brief — AI CoE Hub BFF

Centralized single-container Backend-for-Frontend (BFF) built on Next.js 15/16 App Router. This server acts as both the static file host for the corporate-approved AI tools single-page application (SPA) and the stateful Node.js orchestrator managing security and sessions.

## Core Requirements:
- Stateful regional Firestore Native session tracking.
- KMS Envelope data encryption key (DEK) caching.
- Entra ID confidential OIDC code exchange flow.
- Anti-CSRF double-submit protection.
- Reverse-proxy endpoint to intercept, strip, and inject verified claims before calling Apigee.
- Zero client-side storage of confidential tokens.
