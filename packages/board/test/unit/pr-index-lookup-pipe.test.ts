import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE DONE-WHEN CRITERION ITSELF: a built entry bundle, run as a real
 * process over a real OS pipe, writing more than 1 MB to stdout before it
 * exits. `process.exit` does not wait for a queued write that size to drain;
 * `endEntry` does. This is the test that fails on `origin/main` and passes
 * here.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

describe('plot-pr-index-lookup as a process', () => {
  it('writes a full megabyte-plus answer through a real pipe and exits 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plot-pr-index-lookup-pipe-'));
    try {
      const bundle = path.join(dir, 'pr-index-lookup.mjs');
      await build({
        entryPoints: [path.join(here, '../../src/server/entry/pr-index-lookup.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: bundle,
        logLevel: 'silent',
      });

      // With no store at this PLOT_PR_INDEX_HOME, every query answers the
      // fixed 10-byte line `-\task\t-\t-\t-\n`. 110,000 queries is just over
      // 1 MB (1,100,000 bytes) of real stdout, well past the 64 KB pipe
      // buffer that truncates under a bare process.exit.
      const QUERIES = 110_000;
      const LINE = '-\task\t-\t-\t-\n';
      const input = '-\t-\n'.repeat(QUERIES);
      const expectedOut = LINE.repeat(QUERIES);
      expect(Buffer.byteLength(expectedOut)).toBeGreaterThan(1024 * 1024);

      const result = spawnSync(process.execPath, [bundle, 'github'], {
        input,
        cwd: dir,
        env: { ...process.env, PLOT_PR_INDEX_HOME: dir },
        maxBuffer: 16 * 1024 * 1024,
      });

      expect(result.status).toBe(0);
      expect(result.stdout.length).toBe(Buffer.byteLength(expectedOut));
      expect(result.stdout.toString('utf8')).toBe(expectedOut);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
