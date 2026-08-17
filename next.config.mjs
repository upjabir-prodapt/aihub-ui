/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output compiles the server into a self-contained folder (.next/standalone)
  // which dramatically reduces the production Docker image size.
  output: 'standalone',
  // Disable poweredByHeader for security hardening
  poweredByHeader: false,
  // Hide the floating Next.js dev tools badge/indicator in local development
  devIndicators: false,
  typescript: {
    // Skip typechecking during next build to bypass legacy Vite file issues
    ignoreBuildErrors: true,
  },
  // In Next 16, outputFileTracingIncludes is at the root level
  outputFileTracingIncludes: {
    '/**/*': ['./node_modules/@swc/helpers/**/*'],
  }
};

export default nextConfig;
