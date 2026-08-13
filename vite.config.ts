import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Кладе воркер MapLibre поруч зі зібраним бандлом.
 *
 * MapLibre будує шлях до воркера у рантаймі — `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)`. Після збірки `import.meta.url` вказує на наш бандл в /assets/,
 * тож воркер шукається там. Статично такий рядок бандлер не бачить і файл не копіює:
 * запит падає в SPA-фолбек, повертається index.html, і MapLibre лишається без воркера.
 * Зовні це виглядає як «мапа є, а маршрут не малюється» — геометрія обробляється
 * саме у воркері.
 */
function maplibreWorker(): Plugin {
  const require = createRequire(import.meta.url);
  // Воркер тягне за собою спільний чанк — без нього він не завантажиться.
  const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

  return {
    name: 'eplan:maplibre-worker',
    apply: 'build',
    async writeBundle(options) {
      // Через package.json, бо у пакета лише ESM-експорт і require('maplibre-gl') падає.
      const distDir = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
      const outDir = join(options.dir ?? 'dist/client', 'assets');
      await mkdir(outDir, { recursive: true });
      for (const file of files) {
        await copyFile(join(distDir, file), join(outDir, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), maplibreWorker()],
  build: {
    // Worker роздає зібраний фронтенд через binding ASSETS, див. wrangler.jsonc.
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // У dev фронтенд ходить у Worker, піднятий `wrangler dev` на 8787.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
