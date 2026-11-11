import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('performerShell.assignSlice', () => {
  /** A repository holding one free agent's manifest, with the given fields. */
  const withManifest = (fields: Record<string, unknown>): { context: ShellContext; file: string } => {
    const root = mkdtempSync(join(tmpdir(), 'plot-performer-assign-'));
    shells.push(root);
    mkdirSync(join(root, '.plot/agents'), { recursive: true });
    const file = join(root, '.plot/agents/s1.json');
    writeFileSync(file, JSON.stringify({ session: 's1', branch: '', ...fields }));
    return { context: { repoRoot: root, scriptDir: join(root, 'scripts') }, file };
  };
  const read = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

  it('records a sprint slice\'s base beside its branch', async () => {
    const { context, file } = withManifest({});
    const answer = await performerShell(context).assignSlice('s1', 'feature/x', 'a-plan', 'sprint/s');
    expect(answer).toEqual({ ok: true, value: true });
    expect(read(file)).toMatchObject({ branch: 'feature/x', slug: 'a-plan', base: 'sprint/s' });
  });

  it('removes a base an earlier slice left when the new slice is on the default branch', async () => {
    const { context, file } = withManifest({ base: 'sprint/old' });
    await performerShell(context).assignSlice('s1', 'feature/y', 'b-plan');
    expect(read(file)).not.toHaveProperty('base');
    expect(read(file)).toMatchObject({ branch: 'feature/y', slug: 'b-plan' });
  });
});
