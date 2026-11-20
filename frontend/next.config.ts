import type { NextConfig } from 'next';

/**
 * The backend sets httpOnly auth cookies, so the browser must talk to it from the SAME origin as the
 * pages. Every `/api/*` request is therefore proxied to the NestJS server (default http://localhost:3001).
 */
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
