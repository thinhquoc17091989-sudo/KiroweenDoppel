import { defineConfig } from 'vite';
import { doppelDevApi } from './dev/api-plugin.mjs';

export default defineConfig({
  base: './',
  // doppelDevApi only adds dev-server middleware (/api/state, /api/run) for the local dev
  // console (dev/console.html) — it does nothing at build time and ships nothing to dist/.
  plugins: [doppelDevApi(process.cwd())],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
