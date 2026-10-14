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
  /** What origin holds for `idea/alpha-spec`, both at the scan and after a settlement's fetch. */
  specRef?: 'absent' | 'claim-only' | 'work' | 'unknown';
  /** The plan's text on the spec branch, at `tip`. */
  branchText?: string;
  /** The spec branch's tip sha. */
  tip?: string;
  /** The committer time of the spec branch's one work commit, epoch milliseconds. */
  workAt?: number;
  prState?: { state: 'OPEN' | 'MERGED' | 'CLOSED'; number: number } | null | 'fail';
  prMerged?: 'merged' | 'not-merged' | 'fail';
  prCreateOk?: boolean;
  prCreateCalls?: { head: string; title: string; body: string; draft?: boolean }[];
  deleteRemoteCalls?: { branch: string; expectedTip: string }[];
  addBranchCalls?: { dir: string; branch: string; start: string }[];
  removeCalls?: { dir: string; branch: string }[];
  /** Counts every host call by operation. */
  hostCalls?: string[];
}

const world = (candidates: DesignCandidate[], options: WorldOptions = {}): DesignPassWorld => {
  const specRef = options.specRef ?? 'absent';
  const tip = options.tip ?? 'tip0000';
  const present = specRef === 'claim-only' || specRef === 'work';
  return {
    candidates: async () => ({
      plans: new Map(candidates.map((c) => [c.slug, c])),
      unread: new Map(Object.entries(options.unread ?? {})),
    }),
    alive: options.alive ?? ((pid: number) => pid === process.pid),
    refs: () => ({
      defaultBranch: async () => ({ ok: true, value: 'main' }),
      remoteHead: async () => ({
        ok: true,
        value: specRef === 'unknown' ? 'unknown' : present ? 'present' : 'absent',
      }),
      fetchRemoteHead: async () => ({
        ok: true,
        value: specRef === 'unknown' ? 'unknown' : present ? 'present' : 'absent',
      }),
      resolve: async (ref) =>
        ref === `origin/${designBranch('alpha')}` && present ? { ok: true, value: tip } : { ok: false, why: 'missing' },
      commitSubjects: async () =>
        specRef === 'work'
          ? { ok: true, value: [{ at: options.workAt ?? 1, subject: 'real work', tree: 't1', parentTree: 't0' }] }
          : { ok: true, value: [] },
      showFile: async (ref) =>
        ref === tip && options.branchText !== undefined ? { ok: true, value: options.branchText } : { ok: false, why: 'missing' },
    }),
    trees: () => ({
      addBranch: async (dir, branch, start) => {
        options.addBranchCalls?.push({ dir, branch, start });
        // `git worktree add -B <branch> <dir> <start>` fails on a start point
        // that does not exist: `origin/main` always does, the spec branch only
        // where origin holds it.
        const exists = start === 'origin/main' || (start === `origin/${branch}` && present);
        if (!exists) return { ok: false, why: 'failed' };
        fs.mkdirSync(dir, { recursive: true });
        return { ok: true, value: undefined };
      },
      commit: async () => ({ ok: true, value: undefined }),
      push: async () => ({ ok: true, value: undefined }),
      deleteRemoteBranch: async (branch, expectedTip) => {
        options.deleteRemoteCalls?.push({ branch, expectedTip });
        return { ok: true, value: undefined };
      },
      removeWithBranch: async (dir, branch) => {
        options.removeCalls?.push({ dir, branch });
        return { ok: true, value: undefined };
      },
    }),
    host: () => ({
      prState: async () => {
        options.hostCalls?.push('prState');
        if (options.prState === 'fail') return { ok: false, why: 'unaskable' };
        if (options.prState === undefined) return { ok: true, value: null };
        return { ok: true, value: options.prState };
      },
      prCreate: async (request) => {
        options.hostCalls?.push('prCreate');
        options.prCreateCalls?.push(request);
        return options.prCreateOk === false ? { ok: false, why: 'unaskable' } : { ok: true, value: '' };
      },
      prMerged: async () => {
        options.hostCalls?.push('prMerged');
        if (options.prMerged === 'fail' || options.prMerged === undefined) return { ok: false, why: 'unaskable' };
        return { ok: true, value: options.prMerged };
      },
    }),
  };
};

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

const writeMark = (repoRoot: string, slug: string, mark: { kind?: string; commit: string; answeredPr?: number }): void => {
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
      world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_WRITTEN, prCreateCalls }),
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
      world([candidate], {
        alive: () => false,
        specRef: 'work',
        branchText: SPEC_WRITTEN,
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
      world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_WRITTEN, prCreateOk: false }),
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
      world([{ ...candidate, text: SPEC_WRITTEN }], {
        alive: () => false,
        specRef: 'work',
        branchText: SPEC_EMPTY,
        tip: 'deadbee',
        prMerged: 'not-merged',
        deleteRemoteCalls,
      }),
    );
    expect(deleteRemoteCalls).toEqual([{ branch: designBranch('alpha'), expectedTip: 'deadbee' }]);
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
  });

  it('keeps an empty-spec ref whose merge state the host cannot answer, and counts the failure', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1 } } });
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_EMPTY, prMerged: 'fail', deleteRemoteCalls }),
    );
    expect(deleteRemoteCalls).toEqual([]);
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
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
      world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_EMPTY, prMerged: 'not-merged', tip: 'd' }),
    );
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(3);
    expect(state.rows).toEqual([
      expect.objectContaining({ kind: 'spec', plan: 'alpha', stopped: true, restart: 'plot-design.mjs restart alpha' }),
    ]);
  });

  it('a restart mark bypasses declined, starts one run and is consumed by that start', async () => {
    const f = fixture('false', 'true');
    seed(f.repoRoot, { declined: { alpha: { commit: 'abc1234', pr: 5 } } });
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234' });
    const started = await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual(['alpha']);
    const state = readDesignState(f.repoRoot)!;
    expect(state.restart).toEqual({});
    expect(state.declined).toEqual({});
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

describe('runAutoDesignPass: a restart starts one run (D36)', () => {
  it('with Auto-design off, a restart starts one run, the pass after starts none, nor after that run fails', async () => {
    const f = fixture('false', 'true');
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234' });
    expect(await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent' }))).toEqual(['alpha']);
    await boardRunsSettled();
    expect(readDesignState(f.repoRoot)!.restart).toEqual({});

    // The run ended with a claim and no commit: settled as `no-commit`, ref deleted.
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    expect(
      await runAutoDesignPass(
        f,
        pulse,
        readings,
        2000,
        world([candidate], { alive: () => false, specRef: 'claim-only', tip: 'c1aim00', deleteRemoteCalls }),
      ),
    ).toEqual([]);
    expect(deleteRemoteCalls).toEqual([{ branch: designBranch('alpha'), expectedTip: 'c1aim00' }]);
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);

    for (const at of [3000, 100_000, 1_000_000]) {
      expect(await runAutoDesignPass(f, pulse, readings, at, world([candidate], { specRef: 'absent' }))).toEqual([]);
      expect(readDesignState(f.repoRoot)!.refusals).toEqual({ alpha: 'off' });
    }
  });

  it('a start mark clears the plan\'s failure record and declined mark', async () => {
    const f = fixture('false', 'true');
    seed(f.repoRoot, {
      failures: { alpha: { count: 3, lastAt: 1, reading: 'abc1234' } },
      declined: { alpha: { commit: 'abc1234', pr: 4 } },
    });
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234', answeredPr: 4 });
    await runAutoDesignPass(f, pulse, { ...readings, held: null }, 1000, world([candidate], { specRef: 'absent' }));
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.declined).toEqual({});
    expect(state.restart).toEqual({ alpha: 'abc1234' });
    expect(state.refusals).toEqual({ alpha: 'queue-unread' });
  });

  it('a pr-opened mark folds as a success and restarts nothing', async () => {
    const f = fixture('false', 'true');
    seed(f.repoRoot, { failedAt: [1, 2, 3] });
    writeMark(f.repoRoot, 'alpha', { kind: 'pr-opened', commit: 'abc1234' });
    const started = await runAutoDesignPass(f, pulse, readings, 5000, world([candidate], { specRef: 'absent' }));
    expect(started).toEqual([]);
    const state = readDesignState(f.repoRoot)!;
    expect(state.lastSuccessAt).toBe(5000);
    expect(state.restart).toEqual({});
    expect(readDesignStatus(f.repoRoot)!.halted).toBe(false);
  });
});

describe('runAutoDesignPass: settlement reads the spec branch', () => {
  const ended = { running: { alpha: { pid: 99999999, commit: 'abc1234', startedAt: 1, planFile: 'docs/plans/x-alpha.md' } } };

  it('opens the PR for a spec written on the branch while the default branch still reads it empty', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, ended);
    const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_WRITTEN, prCreateCalls, deleteRemoteCalls }),
    );
    expect(prCreateCalls).toHaveLength(1);
    expect(deleteRemoteCalls).toEqual([]);
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.lastSuccessAt).toBe(1000);
  });

  it('settles a run whose plan left Design from the plan file its record names', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, ended);
    const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
    await runAutoDesignPass(f, pulse, readings, 1000, world([], { alive: () => false, specRef: 'work', branchText: SPEC_WRITTEN, prCreateCalls }));
    expect(prCreateCalls).toHaveLength(1);
  });

  it('a merged PR found on settlement is a success with no prCreate; a closed one gets a new PR', async () => {
    for (const [state, creates] of [['MERGED', 0], ['CLOSED', 1]] as const) {
      const f = fixture('true', 'true');
      seed(f.repoRoot, ended);
      const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
      await runAutoDesignPass(
        f,
        pulse,
        readings,
        1000,
        world([candidate], { alive: () => false, specRef: 'work', branchText: SPEC_WRITTEN, prState: { state, number: 2 }, prCreateCalls }),
      );
      expect(prCreateCalls).toHaveLength(creates);
      expect(readDesignState(f.repoRoot)!.lastSuccessAt).toBe(1000);
    }
  });

  it('claim-only fails no-commit and deletes the ref at the tip it read', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, ended);
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    const removeCalls: { dir: string; branch: string }[] = [];
    const hostCalls: string[] = [];
    await runAutoDesignPass(
      f,
      pulse,
      readings,
      1000,
      world([candidate], { alive: () => false, specRef: 'claim-only', tip: 'abcdef1', deleteRemoteCalls, removeCalls, hostCalls }),
    );
    expect(deleteRemoteCalls).toEqual([{ branch: designBranch('alpha'), expectedTip: 'abcdef1' }]);
    expect(removeCalls).toEqual([{ dir: designRunDir(f.repoRoot, 'alpha'), branch: designBranch('alpha') }]);
    expect(hostCalls).toEqual([]);
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures.alpha?.count).toBe(1);
    expect(state.running).toEqual({});
  });

  it('absent fails no-branch and deletes nothing', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, ended);
    const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
    const removeCalls: { dir: string; branch: string }[] = [];
    await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { alive: () => false, specRef: 'absent', deleteRemoteCalls, removeCalls }));
    expect(deleteRemoteCalls).toEqual([]);
    expect(removeCalls).toHaveLength(1);
    expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
  });

  it('unknown settles nothing: no failure, the record kept, the worktree kept, the next pass reads again', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, ended);
    const removeCalls: { dir: string; branch: string }[] = [];
    const hostCalls: string[] = [];
    await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { alive: () => false, specRef: 'unknown', removeCalls, hostCalls }));
    const state = readDesignState(f.repoRoot)!;
    expect(state.failures).toEqual({});
    expect(state.failedAt).toEqual([]);
    expect(Object.keys(state.running)).toEqual(['alpha']);
    expect(removeCalls).toEqual([]);
    expect(hostCalls).toEqual([]);
    expect(specRunningCount(f.repoRoot, () => false, 1000)).toBe(0);
  });
});

describe('runAutoDesignPass: the start point of the spec branch', () => {
  it('a new spec branches from origin/main', async () => {
    const f = fixture('true', 'true');
    const addBranchCalls: { dir: string; branch: string; start: string }[] = [];
    expect(await runAutoDesignPass(f, pulse, readings, 1000, world([candidate], { specRef: 'absent', addBranchCalls }))).toEqual([
      'alpha',
    ]);
    expect(addBranchCalls).toEqual([{ dir: designRunDir(f.repoRoot, 'alpha'), branch: designBranch('alpha'), start: 'origin/main' }]);
    await boardRunsSettled();
    expect(readDesignState(f.repoRoot)!.running.alpha?.code).toBe(0);
  });

  it('an open-pr retry branches from the spec branch on origin', async () => {
    const f = fixture('true', 'true');
    seed(f.repoRoot, { failures: { alpha: { count: 1, lastAt: 1, reading: 'abc1234' } }, failedAt: [1] });
    const addBranchCalls: { dir: string; branch: string; start: string }[] = [];
    expect(
      await runAutoDesignPass(f, pulse, readings, 1_000_000, world([candidate], { specRef: 'work', workAt: 999_000, addBranchCalls })),
    ).toEqual(['alpha']);
    expect(addBranchCalls.map((c) => c.start)).toEqual([`origin/${designBranch('alpha')}`]);
  });
});

describe('runAutoDesignPass: a start that fails before its claim reaches origin', () => {
  const failingAt = (step: 'addBranch' | 'commit' | 'push', removeCalls: { dir: string; branch: string }[]): DesignPassWorld => {
    const base = world([candidate], { specRef: 'absent', removeCalls });
    return {
      ...base,
      trees: (o) => ({ ...base.trees(o), [step]: async () => ({ ok: false, why: 'failed' }) }),
    };
  };
  const SIX_MINUTES = 6 * 60 * 1000;

  it('a rejected claim push drops the run, records no failure, and a later pass deletes nothing of the other machine', async () => {
    const f = fixture('true', 'true');
    writeMark(f.repoRoot, 'alpha', { commit: 'abc1234' });
    const removeCalls: { dir: string; branch: string }[] = [];
    expect(await runAutoDesignPass(f, pulse, readings, 1000, failingAt('push', removeCalls))).toEqual(['alpha']);
    await boardRunsSettled();
    const after = readDesignState(f.repoRoot)!;
    expect(after.running).toEqual({});
    expect(after.failures).toEqual({});
    expect(after.failedAt).toEqual([]);
    expect(after.restart).toEqual({});
    expect(removeCalls).toEqual([{ dir: designRunDir(f.repoRoot, 'alpha'), branch: designBranch('alpha') }]);

    for (const specRef of ['claim-only', 'work'] as const) {
      const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
      const prCreateCalls: { head: string; title: string; body: string; draft?: boolean }[] = [];
      await runAutoDesignPass(
        f,
        pulse,
        readings,
        1000 + SIX_MINUTES,
        world([candidate], {
          alive: () => false,
          specRef,
          tip: 'other00',
          branchText: SPEC_EMPTY,
          prMerged: 'not-merged',
          deleteRemoteCalls,
          prCreateCalls,
        }),
      );
      expect(deleteRemoteCalls).toEqual([]);
      expect(prCreateCalls).toEqual([]);
      expect(readDesignState(f.repoRoot)!.failures).toEqual({});
      expect(readDesignState(f.repoRoot)!.failedAt).toEqual([]);
    }
  });

  // A failed `addBranch` or `commit` never reached origin, so no other machine
  // is involved: it is this machine's failure, and recording it puts the plan
  // under the retry backoff instead of a new attempt on every pass.
  for (const step of ['addBranch', 'commit'] as const) {
    it(`a failed ${step} drops the run, records one failure, and a later pass deletes nothing`, async () => {
      const f = fixture('true', 'true');
      const removeCalls: { dir: string; branch: string }[] = [];
      expect(await runAutoDesignPass(f, pulse, readings, 1000, failingAt(step, removeCalls))).toEqual(['alpha']);
      await boardRunsSettled();
      const after = readDesignState(f.repoRoot)!;
      expect(after.running).toEqual({});
      expect(after.failures).toEqual({ alpha: { reading: 'abc1234', count: 1, lastAt: 1000 } });
      expect(after.failedAt).toEqual([1000]);
      expect(removeCalls).toEqual([{ dir: designRunDir(f.repoRoot, 'alpha'), branch: designBranch('alpha') }]);

      const deleteRemoteCalls: { branch: string; expectedTip: string }[] = [];
      await runAutoDesignPass(
        f,
        pulse,
        readings,
        1000 + SIX_MINUTES,
        world([candidate], {
          alive: () => false,
          specRef: 'claim-only',
          tip: 'other00',
          deleteRemoteCalls,
        }),
      );
      expect(deleteRemoteCalls).toEqual([]);
      expect(readDesignState(f.repoRoot)!.failures.alpha?.count).toBe(1);
      expect(readDesignState(f.repoRoot)!.failedAt).toEqual([1000]);
    });
  }
});

describe('runAutoDesignPass: host reads', () => {
  it('N passes with Auto-design off and a work ref make no host call', async () => {
    const f = fixture('false', 'true');
    const hostCalls: string[] = [];
    for (const at of [1000, 1_000_000_000, 2_000_000_000]) {
      await runAutoDesignPass(f, pulse, readings, at, world([candidate], { specRef: 'work', workAt: 1, hostCalls }));
    }
    expect(hostCalls).toEqual([]);
  });

  it('a plan refused stopped, halted, waiting or no-free-agent with an absent ref causes no host call', async () => {
    const cases: { state: Partial<DesignStateFile>; readings?: typeof readings; now: number }[] = [
      { state: { failures: { alpha: { count: 3, lastAt: 1, reading: 'abc1234' } } }, now: 1_000_000_000 },
      { state: { failedAt: [1, 2, 3] }, now: 1000 },
      { state: { failures: { alpha: { count: 1, lastAt: 900, reading: 'abc1234' } } }, now: 1000 },
      { state: {}, readings: { ...readings, headroom: 'starved' as never }, now: 1000 },
      { state: {}, readings: { ...readings, held: [{ hold: 'no-free-agent' } as never] }, now: 1000 },
    ];
    for (const c of cases) {
      const f = fixture('true', 'true');
      seed(f.repoRoot, c.state);
      const hostCalls: string[] = [];
      expect(await runAutoDesignPass(f, pulse, c.readings ?? readings, c.now, world([candidate], { specRef: 'absent', hostCalls }))).toEqual([]);
      expect(hostCalls).toEqual([]);
    }
  });

  it('a young work ref with no record is not read as an orphan', async () => {
    const f = fixture('true', 'true');
    const hostCalls: string[] = [];
    await runAutoDesignPass(f, pulse, readings, 1_000_000, world([candidate], { specRef: 'work', workAt: 999_000, hostCalls }));
    expect(hostCalls).toEqual([]);
    expect(readDesignState(f.repoRoot)!.orphans).toEqual({});
  });

  it('an orphan work ref older than Worker bound is read once per tip and shows a no-pr row', async () => {
    const f = fixture('true', 'true');
    const now = 100_000_000;
    const hostCalls: string[] = [];
    await runAutoDesignPass(f, pulse, readings, now, world([candidate], { specRef: 'work', workAt: 1, tip: 'aaa', hostCalls }));
    expect(hostCalls).toEqual(['prState']);
    let state = readDesignState(f.repoRoot)!;
    expect(state.orphans).toEqual({ alpha: { tip: 'aaa', hasPr: false } });
    expect(state.rows).toEqual([expect.objectContaining({ plan: 'alpha', reason: 'the spec branch has no pull request' })]);

    await runAutoDesignPass(f, pulse, readings, now + 60_000, world([candidate], { specRef: 'work', workAt: 1, tip: 'aaa', hostCalls }));
    expect(hostCalls).toEqual(['prState']);

    await runAutoDesignPass(f, pulse, readings, now + 120_000, world([candidate], { specRef: 'work', workAt: 1, tip: 'bbb', hostCalls }));
    expect(hostCalls).toEqual(['prState', 'prState']);

    await runAutoDesignPass(f, pulse, readings, now + 180_000, world([candidate], { specRef: 'absent', hostCalls }));
    state = readDesignState(f.repoRoot)!;
    expect(state.orphans).toEqual({});
  });

  it('a closed or merged PR on an orphan ref is a pull request, not none', async () => {
    for (const prState of [{ state: 'CLOSED' as const, number: 3 }, { state: 'MERGED' as const, number: 3 }]) {
      const f = fixture('true', 'true');
      await runAutoDesignPass(f, pulse, readings, 100_000_000, world([candidate], { specRef: 'work', workAt: 1, tip: 'aaa', prState }));
      const state = readDesignState(f.repoRoot)!;
      expect(state.orphans).toEqual({ alpha: { tip: 'aaa', hasPr: true } });
      expect(state.rows).toEqual([]);
    }
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
