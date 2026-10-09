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

/**
 * Builds a context whose `plot-config.sh` answers `configured` for every key,
 * and whose manifest registry sits wherever {@link manifestDir} names — which
 * may differ from `<repoRoot>/.plot/agents`, the hardcoded path `assignSlice`
 * used to write to regardless of `Agent registry`.
 */
const registryAt = (configured: string): { context: ShellContext; manifestDir: string } => {
  const root = mkdtempSync(join(tmpdir(), 'plot-performer-registry-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  writeFileSync(
    join(scriptDir, 'plot-config.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' '${configured}'\n`,
    { mode: 0o755 },
  );
  const manifestDir = configured.startsWith('/') ? configured : join(root, configured);
  mkdirSync(manifestDir, { recursive: true });
  return { context: { repoRoot: root, scriptDir }, manifestDir };
};

describe('performerShell.assignSlice', () => {
  // #1409 / #1420: `Agent registry` configured to an absolute path other than
  // `<repoRoot>/.plot/agents` is exactly this estate's own config. A writer
  // that ignores it writes the hand-over where the loop never reads it, and
  // the loop's manifest keeps `branch: ""` for the agent's whole run — the
  // blank-branch bug from #1409, reproduced here against the writer rather
  // than against `readPass`, which already reads `''` correctly.
  it('writes the branch into the manifest at the configured Agent registry, not the default', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'plot-performer-outside-registry-'));
    shells.push(outside);
    const { context } = registryAt(outside);
    mkdirSync(join(context.repoRoot, '.plot', 'agents'), { recursive: true });

    const session = 'sess-1';
    const manifestAtDefault = join(context.repoRoot, '.plot', 'agents', `${session}.json`);
    const manifestAtConfigured = join(outside, `${session}.json`);
    const manifest = { session, branch: '', slug: '', worktree: context.repoRoot };
    writeFileSync(manifestAtConfigured, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await performerShell(context).assignSlice(session, 'feature/x', 'a-plan');

    expect(result).toEqual({ ok: true, value: true });
    expect(JSON.parse(readFileSync(manifestAtConfigured, 'utf8')).branch).toBe('feature/x');
    // The default location must stay untouched — proof the write went where
    // `Agent registry` named rather than to the hardcoded path.
    expect(() => readFileSync(manifestAtDefault, 'utf8')).toThrow();
  });

  it('fails when no manifest exists at the configured registry, even if one exists at the default path', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'plot-performer-empty-registry-'));
    shells.push(outside);
    const { context } = registryAt(outside);

    const session = 'sess-2';
    mkdirSync(join(context.repoRoot, '.plot', 'agents'), { recursive: true });
    writeFileSync(
      join(context.repoRoot, '.plot', 'agents', `${session}.json`),
      `${JSON.stringify({ session, branch: '', slug: '', worktree: context.repoRoot }, null, 2)}\n`,
    );

    const result = await performerShell(context).assignSlice(session, 'feature/x', 'a-plan');

    expect(result).toEqual({ ok: false, why: 'failed' });
  });

  it('resolves a relative Agent registry value under the main checkout, as agentsFs does', async () => {
    const { context, manifestDir } = registryAt('var/agents');

    const session = 'sess-3';
    const manifest = { session, branch: '', slug: '', worktree: context.repoRoot };
    writeFileSync(join(manifestDir, `${session}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await performerShell(context).assignSlice(session, 'feature/y', 'a-plan');

    expect(result).toEqual({ ok: true, value: true });
    expect(JSON.parse(readFileSync(join(manifestDir, `${session}.json`), 'utf8')).branch).toBe(
      'feature/y',
    );
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
