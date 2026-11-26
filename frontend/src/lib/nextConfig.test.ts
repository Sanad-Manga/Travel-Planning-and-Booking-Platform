import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

describe('next.config rewrites', () => {
  it('proxies /api and /uploads to the backend so cookies and images stay same-origin', async () => {
    const rewrites = await nextConfig.rewrites!();
    expect(rewrites).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
      { source: '/uploads/:path*', destination: 'http://localhost:3001/uploads/:path*' },
    ]);
  });
});
