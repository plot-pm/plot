// The spec pass: a Design plan with an empty `## Spec` section is written when
// the switch, the command and the machine allow it, one run at a time, and
// every refusal is named. The fleet settles a finished run itself, opening the
// PR or deleting an empty branch, rather than leaving that to the agent.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FleetReading } from '@plot-pm/domain';
import { removeTree as rmTree } from '../rm-tree.mjs';
import { designPromptPath } from '../../src/shared/agent-log.js';
import {
  designBranch,
  designPrompt,
  designRunDir,
  designStatePath,
  designStatusLines,
  readDesignCandidatesWith,
  readDesignState,
  readDesignStatus,
  runAutoDesignPass,
  specRunningCount,
  type DesignCandidate,
  type DesignCandidatePorts,
  type DesignPassWorld,
  type DesignStateFile,
} from '../../src/shared/auto-design.js';
import { boardRunsSettled } from '../../src/shared/board-run.js';

const made: string[] = [];
afterEach(async () => {
  await boardRunsSettled();
  while (made.length) rmTree(made.pop()!);
});

const SPEC_EMPTY = 'Design:abc1234\n\n# P\n\n## Spec\n\n## Status\n\n- **State:** Design\n';
const SPEC_WRITTEN = 'Design:abc1234\n\n# P\n\n## Spec\n\nSome decided text.\n\n## Status\n\n- **State:** Design\n';

const pulse = { plans: [{ file: 'docs/plans/x-alpha.md', phase: 'design', tracer: false }] } as unknown as FleetReading;
const readings = { headroom: 'clear' as const, machineOverride: false, held: [], verifying: new Set<string>() };
const candidate: DesignCandidate = { slug: 'alpha', state: 'design', text: SPEC_EMPTY, planFile: 'docs/plans/x-alpha.md' };

interface WorldOptions {
  alive?: (pid: number) => boolean;
  unread?: Record<string, string>;
  specRef?: 'absent' | 'claim-only' | 'work' | 'unknown';
  prState?: { state: 'OPEN' | 'MERGED' | 'CLOSED'; number: number } | null | 'fail';
  prMerged?: 'merged' | 'not-merged' | 'fail';
  prCreateOk?: boolean;
  prCreateCalls?: { head: string; title: string; body: string; draft?: boolean }[];
  deleteRemoteCalls?: { branch: string; expectedTip: string }[];
  remoteSha?: string;
}

const world = (candidates: DesignCandidate[], options: WorldOptions = {}): DesignPassWorld => ({
  candidates: async () => ({
    plans: new Map(candidates.map((c) => [c.slug, c])),
    unread: new Map(Object.entries(options.unread ?? {})),
  }),
  alive: options.alive ?? ((pid: number) => pid === process.pid),
  refs: () => ({
    defaultBranch: async () => ({ ok: true, value: 'main' }),
    remoteHead: async () => ({
      ok: true,
      value: options.specRef === 'absent' || options.specRef === undefined ? 'absent' : options.specRef === 'unknown' ? 'unknown' : 'present',
    }),
    commitSubjects: async () =>
      options.specRef === 'work'
        ? { ok: true, value: [{ at: 1, subject: 'real work', tree: 't1', parentTree: 't0' }] }
        : { ok: true, value: [] },
    remoteSha: async () => ({ ok: true, value: options.remoteSha !== undefined ? { sha: options.remoteSha } : 'unknown' }),
  }),
  trees: () => ({
    addBranch: async (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, value: undefined };
    },
    commit: async () => ({ ok: true, value: undefined }),
    push: async () => ({ ok: true, value: undefined }),
    deleteRemoteBranch: async (branch, expectedTip) => {
      options.deleteRemoteCalls?.push({ branch, expectedTip });
      return { ok: true, value: undefined };
    },
  }),
  host: () => ({
    prState: async () => {
      if (options.prState === 'fail') return { ok: false, why: 'unaskable' };
      if (options.prState === undefined) return { ok: true, value: null };
      return { ok: true, value: options.prState };
    },
    prCreate: async (request) => {
      options.prCreateCalls?.push(request);
      return options.prCreateOk === false ? { ok: false, why: 'unaskable' } : { ok: true, value: '' };
    },
    prMerged: async () => {
      if (options.prMerged === 'fail' || options.prMerged === undefined) return { ok: false, why: 'unaskable' };
      return { ok: true, value: options.prMerged };
    },
  }),
});

const configScript = (autoDesign: string, command: string, bound = ''): string =>
  `#!/usr/bin/env bash\ncase "$2" in\n"Auto-design") echo ${autoDesign};;\n"Worker bound") printf '%s\\n' "${bound}" ;;\n"Design command") cat <<'EOF_CMD'\n${command}\nEOF_CMD\n;;\n*) printf '%s\\n' "\${3:-}";;\nesac\n`;

const fixture = (autoDesign: string, command: string, bound = '') => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autodes-'));
  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
  const scriptsDir = path.join(parent, 'scripts');
  fs.mkdirSync(scriptsDir);
  made.push(parent);
  fs.writeFileSync(path.join(scriptsDir, 'plot-config.sh'), configScript(autoDesign, command, bound), { mode: 0o755 });
  return { repoRoot, scriptsDir, marker: path.join(parent, 'ran.txt') };
};

const seed = (repoRoot: string, state: Partial<DesignStateFile>): void => {
  fs.mkdirSync(path.dirname(designStatePath(repoRoot)), { recursive: true });
  fs.writeFileSync(
    designStatePath(repoRoot),
    JSON.stringify({
      failures: {},
      failedAt: [],
      lastSuccessAt: 0,
      declined: {},
      answeredPr: {},
      restart: {},
      orphans: {},
      running: {},
      refusals: {},
      rows: [],
      ...state,
    }),
  );
};

const writeMark = (repoRoot: string, slug: string, mark: { commit: string; answeredPr?: number }): void => {
  const dir = path.join(repoRoot, '.plot', 'state', 'design', 'restart');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.1.json`), JSON.stringify(mark));
};

describe('designPrompt', () => {
  it('names the slug and plan file, and forbids a State edit and opening a PR', () => {
    const prompt = designPrompt('alpha', 'docs/plans/x-alpha.md');
    expect(prompt).toContain('alpha');
    expect(prompt).toContain('docs/plans/x-alpha.md');
    expect(prompt).toContain('Do not change any `State:` line');
    expect(prompt).toContain('Open no pull request');
  });
});

describe('runAutoDesignPass', () => {
  it('starts nothing while Auto-design is not true', async () => {
    const f = fixture('false', 'true');
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    const state = readDesignState(f.repoRoot)!;
    expect(state.refusals).toEqual({ alpha: 'off' });
  });

  it('starts nothing while no Design command is declared', async () => {
    const f = fixture('true', '');
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate]));
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'off' });
  });

  it('starts one run with the prompt naming the plan file, and claims the branch first', async () => {
    const f = fixture('true', '');
    const command = `sh -c 'printf "%s\\n" "$1" >> ${f.marker}' sh`;
    fs.writeFileSync(path.join(f.scriptsDir, 'plot-config.sh'), configScript('true', command), { mode: 0o755 });
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual(['alpha']);
    await boardRunsSettled();
    expect(fs.existsSync(designPromptPath(f.repoRoot, 'alpha'))).toBe(true);
  });

  it('starts no run while a verify run of the same plan is going', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoDesignPass(
      f,
      pulse,
      { ...readings, verifying: new Set(['alpha']) },
      1000,
      world([candidate], { specRef: 'absent' }),
    );
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'running' });
  });

  it('starts no run while a spec run of another plan is going', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { beta: { pid: process.pid, commit: 'c', startedAt: 1 } } });
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'running' });
  });

  it('names queue-unread while no queue tick has been read', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoDesignPass(
      f,
      pulse,
      { ...readings, held: null },
      1000,
      world([candidate], { specRef: 'absent' }),
    );
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'queue-unread' });
  });

  it('halts the fleet after three failed runs across plans', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { failedAt: [1, 2, 3] });
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'halted' });
  });

  it('declines a plan whose branch carries a closed PR above the answered one', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { specRef: 'absent', prState: { state: 'CLOSED', number: 5 } }),
    );
    expect(started).toEqual([]);
    const state = readDesignState(f.repoRoot)!;
    expect(state.refusals).toEqual({ alpha: 'declined' });
    expect(state.declined.alpha).toEqual({ commit: 'abc1234', pr: 5 });
  });

  it('starts a run whose declined PR number is at or below the already-answered one', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { answeredPr: { alpha: 5 } });
    const started = await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { specRef: 'absent', prState: { state: 'CLOSED', number: 5 } }),
    );
    expect(started).toEqual(['alpha']);
  });

  it('records ask-host rather than starting while the host cannot answer the decline question', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent', prState: 'fail' }));
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'ask-host' });
  });

  it('records ask-host and starts nothing while an open PR already exists for the branch', async () => {
    const f = fixture('true', 'true');
    const started = await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { specRef: 'absent', prState: { state: 'OPEN', number: 9 } }),
    );
    expect(started).toEqual([]);
    expect(readDesignState(f.repoRoot)?.refusals).toEqual({ alpha: 'ask-host' });
  });

  it('settles a finished run by opening a draft PR when the spec is written and none exists', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([{ ...candidate, text: SPEC_WRITTEN }], { alive: () => false, prCreateCalls }),
    );
    const state = readDesignState(f.repoRoot)!;
    expect(prCreateCalls).toEqual([
      { head: designBranch('alpha'), title: 'alpha: spec', body: 'Spec for alpha, written by the fleet.', draft: true },
    ]);
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.running).toEqual({});
  });

  it('settles a finished run as success with no prCreate call when a PR already exists', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([{ ...candidate, text: SPEC_WRITTEN }], {
        alive: () => false,
        prState: { state: 'OPEN', number: 3 },
        prCreateCalls,
      }),
    );
    expect(prCreateCalls).toEqual([]);
    expect(readDesignState(f.repoRoot)!.lastSuccessAt).toBe(1000);
  });

  it('records a failure and retries pr-not-opened on the next ready pass when prCreate fails', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([{ ...candidate, text: SPEC_WRITTEN }], { alive: () => false, prCreateOk: false }),
    );
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(1);
    expect(state.failedAt).toEqual([1000]);
  });

  it('deletes the remote branch when a finished run leaves the spec empty', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([{ ...candidate, text: SPEC_EMPTY }], { alive: () => false, prMerged: 'not-merged', remoteSha: 'deadbee', deleteRemoteCalls }),
    );
    expect(deleteRemoteCalls).toEqual([{ branch: designBranch('alpha'), expectedTip: 'deadbee' }]);
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
  });

  it('settles nothing for an ended run whose branch merge state the host cannot answer', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([{ ...candidate, text: SPEC_EMPTY }], { alive: () => false, prMerged: 'fail', deleteRemoteCalls }),
    );
    expect(deleteRemoteCalls).toEqual([]);
  });

  it('keeps a run whose plan cannot be read, to settle it on a later pass', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    await runAutoDesignPass(f, pulse, readings, 1000, world([], { alive: () => false, unread: { alpha: 'x' } }));
    expect(Object.keys(readDesignState(f.repoRoot)!.running)).toEqual(['alpha']);
  });

  it('passes Worker bound to the run, and a run ended on it counts as a failure', async () => {
    const f = fixture('true', 'sleep 30 #', '1');
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual(['alpha']);
    await boardRunsSettled();
    expect(readDesignState(f.repoRoot)!.running.alpha?.code).toBe(124);
    await runAutoDesignPass(f, pulse, readings, 2000, world([candidate], { alive: () => false }));
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
  }, 20_000);

  it('a third consecutive failure stops retrying, and the row names it', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, {
      failures: { alpha: { count: 2, lastAt: 500, reading: 'abc1234' } },
      failedAt: [100, 200],
      running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } },
    });
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1_000_000_000,
      world([{ ...candidate, text: SPEC_EMPTY }], { alive: () => false, prMerged: 'not-merged', remoteSha: 'd' }),
    );
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(3);
    expect(state.rows).toEqual([
      expect.objectContaining({ kind: 'spec', plan: 'alpha', stopped: true, restart: 'plot-design.mjs restart alpha' }),
    ]);
  });

  it('a restart mark bypasses declined and lets the plan start again', async () => {
    const f = fixture('false', 'true');
    seed(f.repoRoot, { declined: { alpha: { commit: 'abc1234', pr: 5 } } });
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234' });
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual(['alpha']);
    expect(readDesignState(f.repoRoot)!.restart).toEqual({ alpha: 'abc1234' });
  });

  it('folds a restart mark written mid-pass into the state, and removes only the file it read', async () => {
    const f = fixture('true', 'true');
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234', answeredPr: 7 });
    const markPath = path.join(f.repoRoot, '.plot', 'state', 'design', 'restart', 'alpha.1.json');
    expect(fs.existsSync(markPath)).toBe(true);
    await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(fs.existsSync(markPath)).toBe(false);
    expect(readDesignState(f.repoRoot)!.answeredPr).toEqual({ alpha: 7 });
  });
});

describe('specRunningCount', () => {
  it('counts a run whose agent pid is not recorded yet, and not an ended one', () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, {
      running: {
        starting: { pid: 0, commit: 'c', startedAt: 1000 },
        live: { pid: 7, commit: 'c', startedAt: 1 },
        ended: { pid: 7, commit: 'c', startedAt: 1, code: 0 },
      },
    });
    expect(specRunningCount(f.repoRoot, (pid) => pid === 7, 2000)).toBe(2);
    expect(specRunningCount(f.repoRoot, (pid) => pid === 7, 1000 + 6 * 60 * 1000)).toBe(1);
  });
});

describe('readDesignCandidatesWith', () => {
  const planText = (state: string, spec: string) => `# P\n\n## Spec\n\n${spec}\n## Status\n\n- **State:** ${state}\n`;
  const pulseOf = (files: Record<string, string>) =>
    ({ plans: Object.entries(files).map(([file, phase]) => ({ file, phase, tracer: false })) }) as unknown as FleetReading;
  const ports = (texts: Record<string, string>, asked: string[] = []): DesignCandidatePorts => ({
    refs: {
      defaultBranch: async () => ({ ok: true, value: 'main' }),
      showFile: async (ref, file) => {
        asked.push(`${ref}:${file}`);
        return file in texts ? { ok: true, value: texts[file]! } : { ok: false, why: 'missing' };
      },
    } as DesignCandidatePorts['refs'],
  });

  it('reads each Design plan at origin/<main>, and names an unread one', async () => {
    const asked: string[] = [];
    const answer = await readDesignCandidatesWith(
      ports({ 'docs/plans/2026-10-01-alpha.md': planText('Design', '') }, asked),
      pulseOf({ 'docs/plans/2026-10-01-alpha.md': 'design', 'docs/plans/2026-10-01-beta.md': 'design' }),
    );
    expect(asked.every((a) => a.startsWith('origin/main:'))).toBe(true);
    expect([...answer.plans.keys()]).toEqual(['alpha']);
    expect(answer.unread.get('beta')).toBe('the plan cannot be read at origin/main');
  });

  it('asks nothing when the default branch cannot be named', async () => {
    const answer = await readDesignCandidatesWith(
      { refs: { defaultBranch: async () => ({ ok: false, why: 'unaskable' }), showFile: async () => ({ ok: false, why: 'unaskable' }) } },
      pulseOf({ 'docs/plans/2026-10-01-alpha.md': 'design' }),
    );
    expect(answer.plans.size).toBe(0);
    expect(answer.unread.get('alpha')).toBe('the default branch cannot be named');
  });
});

describe('designStatusLines', () => {
  it('names the halt, the running plans, each refusal and each row', () => {
    const text = designStatusLines({
      halted: true,
      running: ['alpha'],
      refusals: { beta: 'starved' },
      rows: [
        {
          kind: 'spec',
          plan: 'gamma',
          reason: 'the spec run failed 1 time',
          log: '/l',
          restart: 'plot-design.mjs restart gamma',
          stopped: false,
          halted: true,
        },
      ],
    });
    expect(text).toBe(
      'spec runs: halted, 1 running, 1 refused\n' +
        '  alpha  running\n' +
        '  beta  refused: starved\n' +
        '  gamma  waiting on you: the spec run failed 1 time — plot-design.mjs restart gamma (log /l)\n',
    );
  });

  it('prints nothing where nothing was recorded, and names an unreadable state', () => {
    expect(designStatusLines({ halted: false, running: [], refusals: {}, rows: [] })).toBe('');
    expect(designStatusLines(null)).toBe('spec runs: the state file cannot be read\n');
    expect(readDesignStatus('/does/not/exist')).toEqual({ halted: false, running: [], refusals: {}, rows: [] });
  });
});
