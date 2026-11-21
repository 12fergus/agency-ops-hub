import type { FastifyPluginAsync } from 'fastify';
import { setupSchema } from '@agency-crm/shared';
import { cookieIsSecure, sessionPolicy } from '../../app/security.js';
import { withTransaction } from '../../db/tx.js';
import { findUserByEmail } from '../../db/repositories/users.js';
import type { Config } from '../../lib/config.js';
import { readSessionCookie, serializeSessionCookie } from '../../lib/cookies.js';
import { AppError } from '../../lib/errors.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { parseInput } from '../../lib/validate.js';
import { startSession } from '../auth/service.js';
import { bootstrapFirstAdmin, toUserDto } from '../users/service.js';

const gone = () => new AppError(404, 'NOT_FOUND', 'Route not found');

/** First-run setup page API. Both routes are public but only do anything while no admin exists. */
export const setupRoutes: FastifyPluginAsync<{ config: Config }> = async (app, { config }) => {
  const policy = sessionPolicy(config);
  const attempts = new RateLimiter(10, 15 * 60_000);

  app.get('/setup/status', { config: { public: true } }, async () => {
    const needsSetup = app.firstRun.needsSetup();
    if (needsSetup) app.firstRun.ensureCode(); // make sure a code (and its file) exists
    return { data: { needsSetup } };
  });

  app.post('/setup', { config: { public: true } }, async (req, reply) => {
    if (!app.firstRun.needsSetup()) throw gone();
    const ipKey = `ip:${req.ip}`;
    const wait = attempts.retryAfter(ipKey);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      throw new AppError(429, 'RATE_LIMITED', 'Too many setup attempts. Try again later.');
    }
    attempts.hit(ipKey);

    const input = parseInput(setupSchema, req.body);
    if (!app.firstRun.verifyCode(input.code)) {
      throw new AppError(403, 'SETUP_CODE_INVALID', 'Invalid setup code');
    }

    // bootstrapFirstAdmin re-checks "no login-capable admin" — a second concurrent attempt fails.
    await bootstrapFirstAdmin(app.dbHandle.db, {
      email: input.email,
      displayName: input.displayName,
      password: input.password,
    });
    app.firstRun.clearCode();

    // Log the new admin straight in.
    const session = withTransaction(app.dbHandle.db, (tx) =>
      startSession(
        tx,
        findUserByEmail(tx, input.email)!,
        policy,
        readSessionCookie(req.headers.cookie),
        'auth.login',
      ),
    );
    reply.code(201).header(
      'set-cookie',
      serializeSessionCookie(session.token, {
        secure: cookieIsSecure(config, req),
        maxAgeSeconds: (Date.parse(session.expiresAt) - Date.now()) / 1000,
      }),
    );
    return { data: { user: toUserDto(session.user) } };
  });
};
