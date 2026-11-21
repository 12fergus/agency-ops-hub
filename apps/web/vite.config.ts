import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiPort = process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@agency-crm/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1', // dev server is never exposed on the LAN
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        // Keep the browser's Host (127.0.0.1:5173) so it matches the Origin header: the API's
        // CSRF check compares them. Vite's string shorthand would rewrite Host to :3000 → 403.
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
