import { defineConfig } from 'drizzle-kit';

// Used only to GENERATE migration SQL from src/db/schema.ts (`pnpm db:generate`).
// Applying migrations is done by `pnpm db:migrate`, never by `drizzle-kit push`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
