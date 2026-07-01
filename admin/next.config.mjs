/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @app/shared is a workspace TS package compiled to dist; transpile if consumed as source later.
  transpilePackages: ['@app/shared'],
};

export default nextConfig;
