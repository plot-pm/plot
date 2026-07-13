import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const scriptsDir = path.join(repoRoot, 'skills/plot/scripts');

// Dev-server middleware that mirrors the production /api/board endpoint, so
// `pnpm dev` gives HMR on the React app plus live board data from this repo.
function boardApi() {
  return {
    name: 'plot-board-api',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/board', async (_req, res) => {
        try {
          const { buildBoard } = await server.ssrLoadModule('/src/server/board.ts');
          const board = buildBoard({ repoRoot, scriptsDir });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(board));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), viteSingleFile(), boardApi()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // Single self-contained index.html; keep the output byte-stable so the
    // committed artifact diffs cleanly in CI.
    reportCompressedSize: false,
  },
});
