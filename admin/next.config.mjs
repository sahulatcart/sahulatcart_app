/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  // Same-origin proxy → backend (runtime BACKEND_URL; avoids build-time NEXT_PUBLIC + CORS).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
