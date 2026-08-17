# Active Context — AI CoE Hub BFF

The workspace has been fully re-scaffolded the traditional way using `pnpm create next-app` with pnpm package manager and Next.js 16/react 19. All old Vite and Nginx files were purged for a clean start, while original client-side SPA source was checked out cleanly from Git.

## Key Active Decisions:
1. **Next.js 16 App Router (with pnpm)**: Built the clean scaffold of the Next.js BFF server.
2. **Ignored SSR for client-side SPA**: Dynamically loaded the main client React SPA using `dynamic` with `{ ssr: false }` inside `app/page.tsx`, avoiding any server-side compilation crashes caused by browser globals like `localStorage`.
3. **Pnpm 11 Naming & Built Dependency Solutions**: Configured root-level `onlyBuiltDependencies` for `protobufjs` to make builds seamless and non-interactive.
