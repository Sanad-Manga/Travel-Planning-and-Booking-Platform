import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

/** ACC-07 review: a small in-memory fixed-window limiter for the two forgotten-password routes. */
export interface AuthRateLimitConfig {
  /** Requests allowed per IP and route inside one window. */
  limit: number;
  windowMs: number;
}

/** DI token so tests can provide small values. */
export const AUTH_RATE_LIMIT_CONFIG = Symbol('AUTH_RATE_LIMIT_CONFIG');
export const DEFAULT_AUTH_RATE_LIMIT: AuthRateLimitConfig = { limit: 10, windowMs: 15 * 60_000 };

/** Safety net: even if every key is still live, the map never holds more than this many entries. */
const MAX_ENTRIES = 50_000;
const PURGE_INTERVAL_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed window per key (route + IP). Per instance and in memory: it resets on restart and is not shared between
 * several server instances. Expired keys are purged at most once a minute, and the map is capped.
 */
@Injectable()
export class AuthRateLimiter {
  private readonly config: AuthRateLimitConfig;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextPurgeAt = 0;

  constructor(@Optional() @Inject(AUTH_RATE_LIMIT_CONFIG) config?: AuthRateLimitConfig) {
    this.config = config ?? DEFAULT_AUTH_RATE_LIMIT;
  }

  /** Counts one request. `now` is injectable for tests. */
  hit(route: string, ip: string, now = Date.now()): RateLimitResult {
    this.purge(now);
    const key = `${route}|${ip}`;
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.windows.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.config.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  /** Number of tracked keys (tests). */
  get size(): number {
    return this.windows.size;
  }

  private purge(now: number): void {
    if (now < this.nextPurgeAt && this.windows.size < MAX_ENTRIES) return;
    this.nextPurgeAt = now + PURGE_INTERVAL_MS;
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
    // Still too many live keys: drop the oldest ones (Map keeps insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size < MAX_ENTRIES) break;
      this.windows.delete(key);
    }
  }
}

const RATE_LIMIT_ROUTE = 'authRateLimitRoute';
/** Marks a handler with its own counter name, so the routes never share a count. */
export const AuthRateLimited = (route: string) => SetMetadata(RATE_LIMIT_ROUTE, route);

/**
 * Runs before the body is validated and before any lookup, so a 429 depends only on the IP and reveals nothing about
 * an email. The IP is `req.ip` (behind a proxy the app must have Express `trust proxy` configured for it to be the client).
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: AuthRateLimiter,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const route = this.reflector.get<string | undefined>(RATE_LIMIT_ROUTE, context.getHandler());
    if (!route) return true;
    const http = context.switchToHttp();
    const result = this.limiter.hit(route, http.getRequest<Request>().ip ?? 'unknown');
    if (result.allowed) return true;
    http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException({ message: 'Too many requests. Try again later.' }, 429);
  }
}
