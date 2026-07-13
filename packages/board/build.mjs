// Bundle the server + the built client into one self-contained artifact.
//
//   vite build   → dist/client/index.html   (single inlined HTML file)
//   node build.mjs → dist/board-server.mjs   (server with that HTML embedded)
//
// The artifact is then copied to skills/plot/scripts/board/board-server.mjs so
// the plot plugin ships a runnable, dependency-free board with no install step.
// This copy is what the release pipeline commits and CI diffs for freshness.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = path.join(here, 'dist/client/index.html');
if (!fs.existsSync(clientHtml)) {
  console.error('Missing dist/client/index.html — run `pnpm run build:client` first.');
  process.exit(1);
}

const distArtifact = path.join(here, 'dist/board-server.mjs');
const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: distArtifact,
  loader: { '.html': 'text' },
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.mkdirSync(path.dirname(shippedArtifact), { recursive: true });
fs.copyFileSync(distArtifact, shippedArtifact);
fs.chmodSync(shippedArtifact, 0o755);

const kb = (fs.statSync(shippedArtifact).size / 1024).toFixed(1);
console.log(`Built board-server.mjs (${kb} KB) → skills/plot/scripts/board/`);
