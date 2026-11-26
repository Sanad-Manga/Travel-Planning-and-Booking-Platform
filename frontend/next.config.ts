import type { NextConfig } from 'next';

/**
 * The backend sets httpOnly auth cookies, so the browser must talk to it from the SAME origin as the
 * pages. Every `/api/*` request is therefore proxied to the NestJS server (default http://localhost:3001).
 * Uploaded images (logos, photos) are served by the backend at `/uploads/*`, outside `/api`, so they need
 * their own rewrite; without it every image URL the API returns would 404 on the frontend origin.
 */
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backendUrl}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
