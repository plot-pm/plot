import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { performerShell } from '../src/adapters/performer/performer-shell.js';
import { performDecision } from '../src/adapters/performer/perform-fs.js';
import type { ShellContext } from '../src/adapters/scripts.js';
import type { Write } from '../src/workflows/decision.js';

/**
 * `startFreeAgent` against a stub `plot-dispatch.sh`.
 *
 * Only the script is replaced: the adapter, `runProcess`, the pipe and the exit
 * code are production's. Each stub prints a footer the real script documents.
 */

const shells: string[] = [];

/** Builds a context whose `plot-dispatch.sh` is the given script body. */
const dispatchThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-performer-mock-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-dispatch.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of shells) rmSync(dir, { recursive: true, force: true });
});

describe('performerShell.startFreeAgent', () => {
  it('answers the count the summary line reports', async () => {
    const context = dispatchThat(
      "echo 'summary: agents=1 requested=1 running=0 headroom=clear worker=configured'",
    );
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: true, value: 1 });
  });

  it('answers unaskable when the Worker command is not the loop', async () => {
    // #1124: the script refuses with exit 1 and `worker=no-loop`. That is a
    // configuration a person must change, so the supervisor reports it as an
    // absence rather than as a failure to retry.
    const context = dispatchThat(
      "echo 'summary: agents=0 requested=1 running=0 headroom=clear worker=no-loop'; exit 1",
    );
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: false, why: 'unaskable' });
  });

  it('answers failed on any other non-zero exit', async () => {
    const context = dispatchThat('echo broken >&2; exit 1');
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('perform-fs skips the agent-loop write kinds on purpose', () => {
  const LOOP_KINDS: readonly Write['kind'][] = [
    'desk-reset',
    'assignment-clear',
    'prompt-run',
    'correction-count',
    'declaration',
    'slice-spend',
    'loop-end',
    'worker-finding',
    'build-finding',
  ];

  it('skips every new kind rather than throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-perform-fs-'));
    shells.push(root);
    const writes = LOOP_KINDS.map(
      (kind) => ({ kind }) as unknown as Write,
    );
    const report = performDecision({ root }, { outcome: 'decided', workflow: 'agent-loop', writes, detail: null });
    expect(report.written).toEqual([]);
    expect(report.skipped).toEqual(LOOP_KINDS);
  });

  it('still throws on a kind it does not name', () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-perform-fs-'));
    shells.push(root);
    const writes = [{ kind: 'not-a-real-kind' } as unknown as Write];
    expect(() =>
      performDecision({ root }, { outcome: 'decided', workflow: 'agent-loop', writes, detail: null }),
    ).toThrow(/unrecognised write kind/);
  });
});
