import { describe, it, expect } from 'vitest';
import type { Scripts } from '@plot-pm/domain';
import type { BuildBoardOptions } from '../../src/server/board.js';
import { readSupervisor } from '../../src/server/supervisor-reading.js';

/**
 * The tick age travels on the `summary:` line only. The prose above it prints
 * `last tick: <N>s ago`, and a loose match would read a value out of that
 * sentence.
 */

const opts = { repoRoot: '/nonexistent', scriptsDir: '/nonexistent' } as unknown as BuildBoardOptions;

const answering = (stdout: string, code = 0): Scripts =>
  ({ awaited: async () => ({ stdout, stderr: '', code }) }) as unknown as Scripts;

const RUNNING = 'supervisor: running (pid 3260) — com.plot-pm.registryd\n  last tick: 5s ago (evidence, not the verdict)\n';

describe('readSupervisor — the tick age', () => {
  it('reads tick_age off the summary line, not the prose', async () => {
    const run = await readSupervisor(
      opts,
      answering(`${RUNNING}summary: agents=0 supervisor=up install=running tick_age=90061\n`),
    );
    expect(run.tickAgeSeconds).toBe(90061);
    expect(run.install).toBe('running');
  });

  it('reads no summary field as absent, whatever the prose says', async () => {
    const run = await readSupervisor(opts, answering(`${RUNNING}summary: agents=0 supervisor=up install=running\n`));
    expect(run.tickAgeSeconds).toBeUndefined();
  });

  it('reads an empty or non-numeric value as absent, never as 0', async () => {
    for (const value of ['', 'abc', '-5', '1.5']) {
      const run = await readSupervisor(
        opts,
        answering(`summary: agents=0 supervisor=up install=running tick_age=${value}\n`),
      );
      expect(run.tickAgeSeconds).toBeUndefined();
    }
  });

  it('reads nothing when the run printed no summary line', async () => {
    const run = await readSupervisor(opts, answering('tick_age=90061\n', 1));
    expect(run.summarised).toBe(false);
    expect(run.tickAgeSeconds).toBeUndefined();
  });
});
