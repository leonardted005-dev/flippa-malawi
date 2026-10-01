/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fa/contracts'],
  env: {
    // Public base URL of the API, exposed to the browser at build time.
    NEXT_PUBLIC_API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
