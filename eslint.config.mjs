import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // NOTE: eslint-config-next/typescript (type-aware linting via a full
  // TypeScript program) is intentionally NOT included here. It causes
  // "JavaScript heap out of memory" (exit 134) on our GitLab CI runner,
  // which has a tighter memory ceiling than local dev machines. Type
  // errors are still caught by the separate `pnpm exec tsc --noEmit` step
  // that runs immediately after `pnpm lint` in the same CI job — nothing
  // is lost, this just avoids doing type-aware analysis twice (once in
  // eslint's TS program, once in tsc) under memory pressure.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CI-only tool/cache directories (node, pnpm, gcloud installed under
    // CI_PROJECT_DIR by .gitlab-ci.yml's .ensure_pnpm/.ensure_gcloud) — these
    // sit inside the project root but are never our own source code. Without
    // this, eslint was scanning pnpm's own 300k+ line bundled corepack
    // artifacts under .cache/xdg/node/corepack/**.
    ".cache/**",
    ".tools/**",
    ".ci-work/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
