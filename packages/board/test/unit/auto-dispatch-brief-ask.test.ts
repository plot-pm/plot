// AUTO-DISPATCH ASKS FOR THE BRIEF it skipped a plan for.
//
// The board claimed slices and never wrote briefs, so every dispatch needed an
// operator first. Measured 2026-09-12 across seven dispatches in one session:
// each reported `brief_asked=1 dispatched=0` on the first pass, and the claim
// followed 60-75 seconds later once a human's brief reached `origin/main`.
//
// IT NEVER RUNS A REAL BRIEF COMMAND. The configured command is a stub that
// records its arguments to a marker file, so no `claude -p` session starts and
// nothing is pushed. The detached spawn is settled for with a short wait — the
// idiom `auto-dispatch-spawn.test.ts` established, for its reason.
//
// THE FIXTURE STUBS `plot-config.sh` TOO, and that is what makes the unset arm
// free: `readConfig` shells to that script, so a fixture without it answers the
// fallback and the whole ask block does nothing. Every pre-existing test in
// `auto-dispatch-spawn.test.ts` is therefore unchanged and still passing — the
// new path is reachable only where a test deliberately configures a command.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { maybeAutoDispatch, firstBrieflessBranch } from '../../src/server/auto-dispatch.js';
import { briefAskPrompt } from '../../src/server/brief-ask.js';
import { FleetReadingSchema, type FleetReading } from '../../src/contract/schema.js';
import type { AgentEntry } from '../../src/server/registry.js';
import type { FleetSettings } from '../../src/server/fleet-settings.js';
import { rmTree } from '../helpers.mjs';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/**
 * A scratch repo with briefs on `origin/main`, a stub dispatcher, and — when a
 * command is given — a stub `plot-config.sh` answering the `Brief command` key
 * plus a stub brief writer that records the arguments it was handed.
 *
 * `briefCommand` is a shell FRAGMENT, exactly as the config key holds one, so
 * the fixture writes a real script and names it in the fragment.
 */
function fixture(
  briefBranches: string[] = [],
  opts: { briefCommand?: string } = {},
): {
  opts: { repoRoot: string; scriptsDir: string };
  runs: () => string[];
  asks: () => string[];
  askArgv: () => string[][];
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-repo-'));
  const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-scripts-'));
  made.push(repoRoot, scriptsDir);

  execSync('git init --initial-branch=main', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.email "test@test.local"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: 'ignore' });

  const briefsDir = path.join(repoRoot, '.plot/briefs');
  fs.mkdirSync(briefsDir, { recursive: true });
  for (const branch of briefBranches) {
    const slug = branch.split('/').pop() ?? branch;
    fs.writeFileSync(path.join(briefsDir, `${slug}.md`), `# Brief for ${branch}\n`);
  }
  if (briefBranches.length > 0) {
    execSync('git add .plot/briefs', { cwd: repoRoot, stdio: 'ignore' });
  }
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Test\n');
  execSync('git add README.md', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: repoRoot, stdio: 'ignore' });

  const marker = path.join(scriptsDir, 'dispatch-ran.txt');
  fs.writeFileSync(
    path.join(scriptsDir, 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );

  // ONE ARGUMENT PER LINE, NUL-free, so a test can assert the prompt arrived as
  // ONE argument rather than as several words. `"$*"` would join them and hide
  // exactly the defect the shape exists to prevent.
  const askMarker = path.join(scriptsDir, 'brief-asked.txt');
  const writer = path.join(scriptsDir, 'stub-brief-writer.sh');
  fs.writeFileSync(
    writer,
    `#!/usr/bin/env bash\n{ printf 'ARGC=%s\\n' "$#"; for a in "$@"; do printf 'ARG=%s\\n' "$a"; done; printf 'END\\n'; } >> ${JSON.stringify(askMarker)}\n`,
    { mode: 0o755 },
  );

  if (opts.briefCommand !== undefined) {
    const value = opts.briefCommand === '@writer' ? writer : opts.briefCommand;
    fs.writeFileSync(
      path.join(scriptsDir, 'plot-config.sh'),
      `#!/usr/bin/env bash\n` +
        `if [ "$2" = "Brief command" ]; then printf '%s\\n' ${JSON.stringify(value)}; ` +
        `else printf '%s\\n' "$3"; fi\n`,
      { mode: 0o755 },
    );
  }

  const lines = (f: string) =>
    fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];

  return {
    opts: { repoRoot, scriptsDir },
    runs: () => lines(marker),
    asks: () => lines(askMarker),
    // One inner array per invocation, holding that invocation's arguments.
    askArgv: () => {
      const out: string[][] = [];
      let cur: string[] | null = null;
      for (const line of lines(askMarker)) {
        if (line.startsWith('ARGC=')) cur = [];
        else if (line.startsWith('ARG=') && cur) cur.push(line.slice(4));
        else if (line === 'END' && cur) { out.push(cur); cur = null; }
      }
      return out;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until `want` invocations have been recorded, or gives up.
 *
 * A FIXED SLEEP IS A RACE BY CONSTRUCTION. The spawn is detached, so the marker
 * file is written whenever the OS schedules the child — and these tests run in
 * parallel, each forking `git` several times in its fixture. Measured
 * 2026-09-12: `settle(400)` passed alone and failed in the full file, which is
 * the flake shape rather than a defect.
 *
 * So the condition is POLLED to a generous ceiling: a test that expects a spawn
 * waits only as long as it takes, and one that expects none pays the floor once
 * and then proves the absence held.
 */
const settle = async (
  got: () => number,
  want: number,
  ceilingMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + ceilingMs;
  while (Date.now() < deadline && got() < want) await sleep(25);
  // A FLOOR FOR THE ZERO CASE. `want: 0` is satisfied immediately, so without
  // this an assertion of "nothing spawned" would be true before a spawn could
  // possibly have landed — and would pass against an implementation that did
  // spawn. The wait is what makes the absence evidence.
  if (want === 0) await sleep(400);
};

const slice = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred', boolean?]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state, ref_held]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: state === 'claimed' ? 'someone' : '',
    ref_held: ref_held ?? false,
  })),
});

const pulse = (plans: Array<[string, string, ReturnType<typeof slice>[]]>): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, slices]) => ({ file, phase, slices })),
    summary: { plans: plans.length, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });

const on = (parallelAgents: number): FleetSettings =>
  ({ autoDispatch: true, parallelAgents, machineOverride: false });

const running = (branch: string): AgentEntry => ({
  session: `s-${branch}`, branch, worktree: `/wt/${branch}`, command: '',
  startedAt: '2026-08-23T00:00:00Z', pid: '1', previousPid: '', relaunches: 0, state: 'running',
});

/** One approved plan whose single eligible branch has no brief on origin/main. */
const brieflessPulse = () =>
  pulse([['2026-09-12-needs-a-brief.md', 'approved', [
    slice('W', 'eligible', [['feature/needs-a-brief', 'open']]),
  ]]]);

describe('maybeAutoDispatch — asking for the brief', () => {
  it('runs the Brief command for a plan it skipped as no-brief', async () => {
    // No brief for feature/needs-a-brief on origin/main, so the plan is
    // `no-brief` and the only thing between it and a worker is the file.
    const f = fixture([], { briefCommand: '@writer' });
    maybeAutoDispatch(f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 1);
    expect(f.askArgv()).toHaveLength(1);
  });

  it('THE PROMPT REACHES THE COMMAND AS ONE ARGUMENT', async () => {
    // The shape defect a working test would otherwise never notice: a plan slug
    // contains nothing that needs quoting, so interpolating the prompt into the
    // shell fragment would pass every other assertion here. The prompt is long
    // and carries backticks and spaces — as ONE argument it survives verbatim,
    // interpolated it becomes many words or a shell error.
    const f = fixture([], { briefCommand: '@writer' });
    const p = brieflessPulse();
    maybeAutoDispatch(f.opts, p, on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 1);

    const argv = f.askArgv();
    expect(argv).toHaveLength(1);
    expect(argv[0]).toHaveLength(1);
    // And it is the prompt the module composes, byte for byte.
    expect(argv[0]![0]).toBe(
      briefAskPrompt('needs-a-brief', 'feature/needs-a-brief', 'main'),
    );
    // The wording the shell's `brief_prompt()` uses, because both ask the same
    // thing of the same skill: /plot-implement, and commit-and-push because the
    // gate reads origin/<main>.
    expect(argv[0]![0]).toContain('/plot-implement needs-a-brief');
    expect(argv[0]![0]).toContain('.plot/briefs/needs-a-brief.md');
    expect(argv[0]![0]).toContain('origin/main');
  });

  it('THE PASS THAT ASKS CLAIMS NOTHING', async () => {
    // The brief has to reach origin/main before a claim can happen — the gate
    // reads git, not the filesystem. An implementation that spawned and then
    // dispatched the same branch would claim against a brief that is not there.
    const f = fixture([], { briefCommand: '@writer' });
    const next = maybeAutoDispatch(
      f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set(),
    );
    await settle(() => f.askArgv().length, 1);
    expect(f.askArgv()).toHaveLength(1);
    expect(f.runs()).toEqual([]);
    expect(next.size).toBe(0);
  });

  it('A SECOND PASS WITH AN ASK OUTSTANDING SPAWNS NOTHING', async () => {
    // Catches the 2026-09-11 double-brief: a dispatch timed out at 2 minutes
    // while `timeout 300` on the inner script outlived it, and re-running
    // produced two `claude -p` briefs for one slug. Asserted ACROSS two calls,
    // because the first call's behaviour is identical either way.
    const f = fixture([], { briefCommand: '@writer' });
    const p = brieflessPulse();
    const asked = new Set<string>();

    maybeAutoDispatch(f.opts, p, on(5), [], new Set(), undefined, asked);
    await settle(() => f.askArgv().length, 1);
    expect(f.askArgv()).toHaveLength(1);
    expect(asked.has('needs-a-brief')).toBe(true);

    // The same still-briefless pulse — the stub writer wrote no brief, exactly
    // as a real session that has not finished yet.
    maybeAutoDispatch(f.opts, p, on(5), [], new Set(), undefined, asked);
    await settle(() => f.askArgv().length, 2);
    expect(f.askArgv()).toHaveLength(1);
  });

  it('A SPENT BUDGET SPAWNS NOTHING, even with a no-brief plan eligible', async () => {
    // A brief writer is a `claude -p` process like any other, so asking while
    // the cap is spent starts work the operator capped.
    const f = fixture([], { briefCommand: '@writer' });
    maybeAutoDispatch(
      f.opts, brieflessPulse(), on(1), [running('feature/elsewhere')], new Set(),
      undefined, new Set(),
    );
    await settle(() => f.askArgv().length, 0);
    expect(f.askArgv()).toEqual([]);
  });

  it('an ask already outstanding is charged against the budget', async () => {
    // The asks themselves count, which is what stops N pulses from starting N
    // writers for N plans while none has landed. Cap 1, one ask outstanding for
    // another plan: the budget is spent before this plan is reached.
    const f = fixture([], { briefCommand: '@writer' });
    maybeAutoDispatch(
      f.opts, brieflessPulse(), on(1), [], new Set(), undefined, new Set(['some-other-plan']),
    );
    await settle(() => f.askArgv().length, 0);
    expect(f.askArgv()).toEqual([]);
  });

  it('AN UNSET Brief command SPAWNS NOTHING AND STILL LOGS THE SKIP', async () => {
    // Today's behaviour exactly: Principle 5, Plot hardcodes no agent tooling.
    // No `plot-config.sh` in the fixture, so `readConfig` answers the fallback.
    const f = fixture([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    maybeAutoDispatch(f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 0);
    expect(f.askArgv()).toEqual([]);
    const skips = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('nothing startable') && l.includes('no-brief'));
    expect(skips).toHaveLength(1);
    log.mockRestore();
  });

  it('`none` SPAWNS NOTHING AND STILL LOGS THE SKIP', async () => {
    // `none` is the repo's spelling for *asked, and we do this by hand*. Running
    // it would spawn `none: command not found` and log that as the reason a
    // brief does not exist.
    const f = fixture([], { briefCommand: 'none' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    maybeAutoDispatch(f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 0);
    expect(f.askArgv()).toEqual([]);
    const skips = log.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('nothing startable') && l.includes('no-brief'));
    expect(skips).toHaveLength(1);
    log.mockRestore();
  });

  it('the ask is reported, naming the plan', async () => {
    // An operator reading the console sees the fleet acting rather than idling.
    const f = fixture([], { briefCommand: '@writer' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    maybeAutoDispatch(f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 0);
    const said = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('asked the Brief command'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('needs-a-brief');
    expect(said[0]).toContain('claiming nothing this pass');
    log.mockRestore();
  });

  it('asks nothing for a plan skipped for any OTHER reason', async () => {
    // `ref-held` is somebody else's claim and `no-eligible-wave` asks for
    // nothing. A brief would not unblock either, and spawning one would spend an
    // agent on a plan that is not waiting for a brief.
    const f = fixture([], { briefCommand: '@writer' });
    const p = pulse([
      ['2026-09-12-held.md', 'approved', [slice('W', 'eligible', [['feature/held', 'open', true]])]],
      ['2026-09-12-nothing.md', 'approved', [slice('W', 'complete', [['feature/done', 'merged']])]],
    ]);
    maybeAutoDispatch(f.opts, p, on(5), [], new Set(), undefined, new Set());
    await settle(() => f.askArgv().length, 0);
    expect(f.askArgv()).toEqual([]);
  });

  it('a plan whose brief HAS landed is dispatched, not asked for', async () => {
    // The next pulse after an ask: the brief is on origin/main, so the plan is
    // no longer `no-brief` and the ordinary claim happens. The ask record still
    // holds the slug — it is not consulted on this path, and the restart clears
    // it — so this also proves a stale record cannot block a dispatch.
    const f = fixture(['feature/needs-a-brief'], { briefCommand: '@writer' });
    const next = maybeAutoDispatch(
      f.opts, brieflessPulse(), on(5), [], new Set(), undefined, new Set(['needs-a-brief']),
    );
    // Waits for the DISPATCH, which is what this test expects to happen — the
    // ask's absence is then asserted against a pass that demonstrably ran.
    await settle(() => f.runs().length, 1);
    expect(f.askArgv()).toEqual([]);
    expect(f.runs()).toEqual(['--max 1 needs-a-brief']);
    expect(next.has('feature/needs-a-brief')).toBe(true);
  });
});

describe('firstBrieflessBranch', () => {
  it('names the first briefless branch in the pulse order', () => {
    const p = pulse([['2026-09-12-two.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    // Both briefless: the first in the pulse's own order is named, which is the
    // one /plot-implement would reach first anyway.
    expect(firstBrieflessBranch(p, 'two', new Set(['feature/a', 'feature/b'])))
      .toBe('feature/a');
    // Only the second: the first is skipped rather than named blindly.
    expect(firstBrieflessBranch(p, 'two', new Set(['feature/b']))).toBe('feature/b');
  });

  it('answers undefined when the plan has no briefless branch', () => {
    // The guard for a caller that hands in a reason and a pulse that disagree.
    const p = pulse([['2026-09-12-one.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    expect(firstBrieflessBranch(p, 'one', new Set())).toBeUndefined();
    expect(firstBrieflessBranch(p, 'no-such-plan', new Set(['feature/a']))).toBeUndefined();
  });

  it('reads only eligible slices of approved plans', () => {
    // The planner's own filters, in the planner's order — a different order
    // would name a branch the skip was not about.
    const draft = pulse([['2026-09-12-draft.md', 'draft', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    expect(firstBrieflessBranch(draft, 'draft', new Set(['feature/a']))).toBeUndefined();
    const blocked = pulse([['2026-09-12-blocked.md', 'approved', [
      slice('W', 'blocked', [['feature/a', 'open']]),
    ]]]);
    expect(firstBrieflessBranch(blocked, 'blocked', new Set(['feature/a']))).toBeUndefined();
  });
});
