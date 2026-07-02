/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  // API proxy is a runtime route handler (app/api/[...path]/route.ts), NOT a rewrite —
  // next.config rewrites bake at build time, which loses the runtime BACKEND_URL.
};

export default nextConfig;
