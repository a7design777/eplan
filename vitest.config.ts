import { defineConfig } from 'vitest/config';

// Розрахункове ядро — чисті функції без Workers-API, тому звичайного node-середовища
// достатньо і тести бігають на порядок швидше за workers-pool.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
