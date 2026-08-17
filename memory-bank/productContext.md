# Product Context — AI CoE Hub BFF

The Colt AI Hub serves as a central login workspace for corporate-approved AI services. To guarantee enterprise-level security, no tokens or sensitive user claims must ever be stored or parsed directly in the user's browser, as client-side memory is vulnerable to XSS and token interception.

The Next.js Backend-for-Frontend (BFF) acts as a security barrier, shielding the client-side SPA from auth mechanics while enforcing secure, stateful session lifecycles on the server.
