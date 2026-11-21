import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, signupSchema } from '@agency-crm/shared';
import { actorOf, cookieIsSecure, sessionPolicy } from '../../app/security.js';
import type { Config } from '../../lib/config.js';
import {
  clearSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
} from '../../lib/cookies.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { parseInput } from '../../lib/validate.js';
import { signup, toUserDto } from '../users/service.js';
import { login, logout } from './service.js';
import { findUserById } from '../../db/repositories/users.js';

const WINDOW_MS = 15 * 60_000;

export const authRoutes: FastifyPluginAsync<{ config: Config }> = async (app, { config }) => {
  const policy = sessionPolicy(config);
  // Per source IP (spraying many accounts) and per account (guessing one password).
  const byIp = new RateLimiter(30, WINDOW_MS);
  const byEmail = new RateLimiter(5, WINDOW_MS);

  app.post('/auth/login', { config: { public: true } }, async (req, reply) => {
    const input = parseInput(loginSchema, req.body);
    const ipKey = `ip:${req.ip}`;
    const emailKey = `email:${input.email}`;
    const wait = Math.max(byIp.retryAfter(ipKey), byEmail.retryAfter(emailKey));
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');
    }
    // Count BEFORE the (async) password check, so parallel attempts can't all slip under the limit.
    // A successful login resets the account counter.
    byIp.hit(ipKey);
    byEmail.hit(emailKey);

    const result = await login(
      app.dbHandle.db,
      { ...input, previousToken: readSessionCookie(req.headers.cookie) },
      policy,
    );
    byEmail.reset(emailKey);
    reply.header(
      'set-cookie',
      serializeSessionCookie(result.token, {
        secure: cookieIsSecure(config, req),
        maxAgeSeconds: (Date.parse(result.expiresAt) - Date.now()) / 1000,
      }),
    );
    return { data: { user: toUserDto(result.user) } };
  });

  // Self-signup: an employee with no client access; logged in immediately unless
  // SIGNUP_REQUIRES_APPROVAL=true (then pending until an admin approves).
  const signupByIp = new RateLimiter(5, 60 * 60_000);

  /** Public, no data: lets the login page decide whether/how to offer sign-up. */
  app.get('/auth/options', { config: { public: true } }, async () => ({
    data: {
      signupEnabled: config.SELF_SIGNUP,
      signupRequiresApproval: config.SIGNUP_REQUIRES_APPROVAL,
    },
  }));

  app.post('/auth/signup', { config: { public: true } }, async (req, reply) => {
    if (!config.SELF_SIGNUP) throw new AppError(404, 'NOT_FOUND', 'Route not found');
    const input = parseInput(signupSchema, req.body);
    const ipKey = `ip:${req.ip}`;
    const wait = signupByIp.retryAfter(ipKey);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      throw new AppError(429, 'RATE_LIMITED', 'Too many sign-up attempts. Try again later.');
    }
    signupByIp.hit(ipKey);

    const result = await signup(
      app.dbHandle.db,
      { ...input, previousToken: readSessionCookie(req.headers.cookie) },
      { requiresApproval: config.SIGNUP_REQUIRES_APPROVAL, session: policy },
    );
    if (result.status === 'pending') {
      reply.code(202);
      return { data: { status: 'pending' } };
    }
    reply.code(201).header(
      'set-cookie',
      serializeSessionCookie(result.session.token, {
        secure: cookieIsSecure(config, req),
        maxAgeSeconds: (Date.parse(result.session.expiresAt) - Date.now()) / 1000,
      }),
    );
    return { data: { status: 'active', user: toUserDto(result.session.user) } };
  });

  app.post('/auth/logout', async (req, reply) => {
    logout(app.dbHandle.db, actorOf(req));
    reply.header('set-cookie', clearSessionCookie(cookieIsSecure(config, req)));
    return { data: { ok: true } };
  });

  app.get('/auth/me', async (req) => {
    const user = findUserById(app.dbHandle.db, actorOf(req).id)!;
    return { data: { user: toUserDto(user) } };
  });
};
