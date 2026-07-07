import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentor/schema': pkg('schema'),
      '@agentor/adapter-claude-code': pkg('adapter-claude-code'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
