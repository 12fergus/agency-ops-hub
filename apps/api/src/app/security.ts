import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_PREFIX } from '@agency-crm/shared';
import type { Config } from '../lib/config.js';
import { readSessionCookie, clearSessionCookie } from '../lib/cookies.js';
import { AppError, errorBody } from '../lib/errors.js';
import type { Actor } from '../modules/auth/authorize.js';
import { authenticate, type SessionPolicy } from '../modules/auth/service.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route is reachable without a session. Default: false (private). */
    public?: boolean;
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Strict CSP: the built SPA is same-origin scripts + styles only, no inline code. */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function sessionPolicy(config: Config): SessionPolicy {
  return {
    ttlMs: config.SESSION_TTL_HOURS * 3_600_000,
    idleMs: config.SESSION_IDLE_MINUTES * 60_000,
  };
}

export function cookieIsSecure(config: Config, req: FastifyRequest): boolean {
  if (config.COOKIE_SECURE === 'true') return true;
  if (config.COOKIE_SECURE === 'false') return false;
  return req.protocol === 'https';
}

/**
 * Same-origin check for state-changing requests (CSRF defence in depth on top of SameSite=Lax
 * and JSON-only bodies). The browser always sends Origin on cross-origin POST/PATCH/DELETE;
 * a missing Origin falls back to Referer; both missing → rejected.
 */
export function isAllowedOrigin(config: Config, req: FastifyRequest): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return false;
  let origin: URL;
  try {
    origin = new URL(source);
  } catch {
    return false;
  }
  if (config.TRUSTED_ORIGINS.includes(origin.origin)) return true;
  const host = req.headers.host;
  return !!host && origin.host === host && ['http:', 'https:'].includes(origin.protocol);
}

export function registerSecurity(app: FastifyInstance, config: Config): void {
  const policy = sessionPolicy(config);

  // JSON is the only accepted body type: form/text posts (the "simple requests" a malicious site
  // can send without a CORS preflight) get 415.
  app.removeContentTypeParser('text/plain');

  app.decorateRequest('actor', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!isApiRequest(req)) return;

    if (STATE_CHANGING.has(req.method) && !isAllowedOrigin(config, req)) {
      return reply
        .code(403)
        .send(errorBody('CSRF_ORIGIN', 'Cross-origin or origin-less request rejected'));
    }

    // Default-deny: every API route needs a session unless it opts out with config.public.
    if (req.routeOptions.config?.public) return;
    const token = readSessionCookie(req.headers.cookie);
    const auth = token ? authenticate(app.dbHandle.db, token, policy) : null;
    if (!auth) {
      if (token) reply.header('set-cookie', clearSessionCookie(cookieIsSecure(config, req)));
      return reply.code(401).send(errorBody('UNAUTHENTICATED', 'Authentication required'));
    }
    req.actor = auth.actor;
  });

  app.addHook('onSend', async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    if (isApiRequest(req)) reply.header('cache-control', 'no-store');
  });
}

/**
 * Decided on what the ROUTER sees, not the raw URL string: find-my-way percent-decodes paths, so
 * `/%61pi/v1/...` reaches API routes while `req.url` doesn't start with `/api/`.
 * - matched route → its registered pattern (always decoded);
 * - no match (404) → the percent-decoded path, so unknown API paths stay default-deny.
 */
export function isApiRequest(req: FastifyRequest): boolean {
  const pattern = req.routeOptions.url;
  if (pattern) return pattern.startsWith(`${API_PREFIX}/`) || pattern === API_PREFIX;
  const rawPath = req.url.split('?')[0] ?? '';
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return true; // undecodable path: treat as API (deny) rather than guess
  }
  return path.toLowerCase().startsWith(`${API_PREFIX}/`) || path.toLowerCase() === API_PREFIX;
}

/** For handlers on private routes: the actor is guaranteed by the onRequest hook. */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return req.actor;
}
