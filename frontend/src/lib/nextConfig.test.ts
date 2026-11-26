import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3001';

describe('next.config rewrites', () => {
  it('proxies /api and /uploads to the backend so cookies and images stay same-origin', async () => {
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toEqual([
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ]);
  });
});
