// fleetd installs the exit-only stage-directory installer: a first SIGTERM
// stays with `stopOnSignals` (finish the tick, then stop), and a leftover stage
// directory is still removed when the process ends.
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const LOADER = here('../../../domain/test/fixtures/ts-strip-loader.mjs');

describe('fleetd and the stage-directory registry', () => {
  it('installs the exit-only installer, never the signal one', () => {
    const source = readFileSync(here('../../src/server/entry/registryd-main.ts'), 'utf8');
    expect(source).toMatch(/\bremoveStageDirsOnExit\(\);/);
    expect(source).not.toMatch(/removeStageDirsOnSignal/);
  });

  it('a first SIGTERM finishes the graceful stop and does not exit 143, and the stage directory is gone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-fleetd-stage-'));
    const tmp = join(root, 'tmp');
    mkdirSync(tmp);
    const ready = join(root, 'ready');
    const source = [
      `const { stopOnSignals } = await import(${JSON.stringify(here('../../src/server/entry/registryd-main.ts'))});`,
      `const stage = await import(${JSON.stringify(here('../../../domain/src/adapters/stage-dirs.ts'))});`,
      'stage.removeStageDirsOnExit();',
      'stage.makeStageDir("plot-plan-store-ref-");',
      'const stop = stopOnSignals();',
      `(await import('node:fs')).writeFileSync(${JSON.stringify(ready)}, '');`,
      'setInterval(() => {}, 1000);',
      'await stop.requested;',
      'await new Promise((r) => setTimeout(r, 200));',
      'process.exitCode = 0;',
      'process.exit(0);',
    ].join('\n');
    const proc = spawn(process.execPath, ['--experimental-strip-types', '--import', LOADER, '--input-type=module', '-e', source], {
      env: { ...process.env, TMPDIR: tmp },
      stdio: 'ignore',
    });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      proc.once('exit', (code, signal) => resolve({ code, signal })),
    );
    try {
      const started = Date.now();
      while (!existsSync(ready) && Date.now() - started < 30_000) await new Promise((r) => setTimeout(r, 20));
      expect(existsSync(ready), 'the child never became ready').toBe(true);
      expect(readdirSync(tmp)).toHaveLength(1);
      proc.kill('SIGTERM');
      const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
      const result = await ended;
      clearTimeout(timer);
      expect(result, 'the first SIGTERM must reach the graceful stop, not exit 143').toEqual({ code: 0, signal: null });
      expect(readdirSync(tmp), 'the stage directory survived the exit').toEqual([]);
    } finally {
      proc.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
