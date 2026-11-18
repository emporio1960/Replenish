import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves a project site from /<repository-name>/.
// The repository is called "Replenish", so that is the default base path.
// Override it for other hosts, for example: BASE_PATH=/ npm run build
const base = process.env.BASE_PATH ?? '/Replenish/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
