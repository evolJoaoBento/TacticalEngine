import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig({
  ...viteConfig,
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: false,
  },
});
