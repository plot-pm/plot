import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE DONE-WHEN CRITERION: `plot-ask.mjs fleet` must end within a stated
 * bound after its last output byte. A bare `process.exitCode = code` passed
 * this file's answer at 2.3 s and did not exit until 17.6 s — the board
 * controller's background work (`maybeAutoDispatch`, `maybeAutoDeliver`)
 * starts further child processes that `exitCode` cannot close out from under.
 *
 * Measured on this fix, over a mock estate (`PLOT_BOARD_MOCK=1`, so the run
 * is deterministic and needs no live repository state): the gap between the
 * last stdout byte and process exit is 4-9 ms, five runs, both with and
 * without a mock estate. 2 seconds is a bound with two orders of magnitude of
 * headroom over that measurement and far short of the 15+ second gap the
 * regression produced.
 */

const BOUND_MS = 2000;

const here = path.dirname(fileURLToPath(import.meta.url));

describe('plot-ask fleet as a process', () => {
  it('exits within 2s of its last stdout byte', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plot-ask-fleet-bound-'));
    try {
      const bundle = path.join(dir, 'plot-ask.mjs');
      await build({
        entryPoints: [path.join(here, '../../src/server/entry/main.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: bundle,
        logLevel: 'silent',
      });

      const result = await new Promise<{
        lastByteAt: number;
        exitAt: number;
        bytes: number;
        code: number | null;
        stderr: string;
      }>((resolve, reject) => {
        const start = Date.now();
        const repoRoot = path.join(here, '../../../..');
        const child = spawn(process.execPath, [bundle, 'fleet'], {
          env: {
            ...process.env,
            PLOT_BOARD_MOCK: '1',
            PLOT_REPO_ROOT: repoRoot,
            PLOT_SCRIPTS_DIR: path.join(repoRoot, 'skills/plot/scripts'),
          },
        });
        let lastByteAt = start;
        let bytes = 0;
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          lastByteAt = Date.now();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          resolve({ lastByteAt, exitAt: Date.now(), bytes, code, stderr });
        });
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.bytes, result.stderr).toBeGreaterThan(0);
      expect(result.exitAt - result.lastByteAt).toBeLessThan(BOUND_MS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
