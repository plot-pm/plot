import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  argsFrom,
  readRegistry,
  reportTick,
  run,
  startAgents,
} from '../../src/server/entry/registryd-main.js';
import type { Performer } from '@plot-pm/domain/ports/performer';
import { QUEUE_HOLDS, type HeldSlice } from '@plot-pm/domain/rules/queue';
import { answered, failed, unaskable } from '@plot-pm/domain';
import { TICK_INTERVAL_MS, type TickReport } from '../../src/server/entry/registryd.js';
import { readTick, worldFrom, type SupervisorWorld } from '../../src/server/supervisor.js';
import type { AgentEntry } from '../../src/server/registry.js';

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    session: 'a1b2c3',
    resumeId: 'a1b2c3',
    branch: 'feature/one',
    worktree: '/estate/one',
    command: 'plot-worker-loop.sh',
    pid: '4242',
    attempts: 0,
    startedAt: '2026-09-04T10:00:00Z',
    ...over,
  });

describe('the daemon’s arguments', () => {
  it('loops by default, unbounded, at the measured interval, starting nothing', () => {
    expect(argsFrom([])).toEqual({
      once: false,
      max: 0,
      intervalMs: TICK_INTERVAL_MS,
      startAgents: false,
    });
  });

  it('starts no agent unless asked — deciding is the default, performing is opt-in', () => {
    // THE ONE WRITE THIS ARTIFACT PERFORMS, and it starts detached processes
    // that outlive the daemon. Off by default is what keeps *the tick decides
    // and performs nothing* true of every run that did not ask otherwise —
    // including a `--once` an operator types to see what the supervisor thinks.
    expect(argsFrom([])?.startAgents).toBe(false);
    expect(argsFrom(['--start-agents'])?.startAgents).toBe(true);
  });

  it('reads --dry-run and --start-agents as independent, not as opposites', () => {
    // A run without --start-agents already writes nothing, so --dry-run keeps
    // describing it. Refusing the pair would be a third state to reason about
    // for behaviour anyone can express by leaving the other flag off.
    expect(argsFrom(['--dry-run', '--start-agents'])?.startAgents).toBe(true);
  });

  it('takes --once', () => {
    expect(argsFrom(['--once'])?.once).toBe(true);
  });

  it('accepts --dry-run and changes nothing, because every run is one', () => {
    // The tick performs nothing, so refusing the flag would make an operator
    // think it changed something and omitting it would make them think it was
    // not considered.
    expect(argsFrom(['--dry-run'])).toEqual(argsFrom([]));
  });

  it('takes a bound', () => {
    expect(argsFrom(['--max', '3'])?.max).toBe(3);
  });

  it('refuses a bound that is not a whole number', () => {
    expect(argsFrom(['--max', 'lots'])).toBeNull();
    expect(argsFrom(['--max', '-1'])).toBeNull();
    expect(argsFrom(['--max', '1.5'])).toBeNull();
  });

  it('takes an interval in seconds', () => {
    expect(argsFrom(['--interval', '30'])?.intervalMs).toBe(30_000);
  });

  it('refuses an interval of zero, which would be a spin', () => {
    expect(argsFrom(['--interval', '0'])).toBeNull();
    expect(argsFrom(['--interval', 'soon'])).toBeNull();
  });

  it('refuses an argument it does not take rather than ignoring it', () => {
    expect(argsFrom(['--reap-everything'])).toBeNull();
  });
});

describe('reading the registry', () => {
  it('reads every manifest, in a stable order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    try {
      writeFileSync(join(dir, 'b.json'), manifest({ branch: 'feature/b' }));
      writeFileSync(join(dir, 'a.json'), manifest({ branch: 'feature/a' }));
      const entries = await readRegistry(dir, () => {});
      expect(entries.map((e) => e.branch)).toEqual(['feature/a', 'feature/b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a missing registry as no agents rather than as an error', async () => {
    // A repository that has dispatched nothing has no directory, and a
    // supervisor over no agents has nothing to do rather than being broken.
    expect(await readRegistry(join(tmpdir(), 'plot-no-such-registry'), () => {})).toEqual([]);
  });

  it('skips a manifest that does not parse, and says which', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    const warned: string[] = [];
    try {
      writeFileSync(join(dir, 'good.json'), manifest({ branch: 'feature/good' }));
      writeFileSync(join(dir, 'broken.json'), 'not json');
      const entries = await readRegistry(dir, (s) => warned.push(s));
      // ONE BAD FILE MUST NOT STOP THE TICK. Every other agent is still picked
      // up, and the file is named rather than silently dropped.
      expect(entries.map((e) => e.branch)).toEqual(['feature/good']);
      expect(warned.join('')).toContain('broken.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores files that are not manifests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    try {
      writeFileSync(join(dir, 'notes.md'), '# not a manifest');
      writeFileSync(join(dir, 'one.json'), manifest());
      expect(await readRegistry(dir, () => {})).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a world may hold a reading for one tick and no longer', () => {
  /**
   * THE MEASURED REASON THIS EXISTS. The first working daemon read the plan
   * estate once per agent and a tick over three agents cost 10.0-11.5 s;
   * `readPlans` walks 172 files. Read once per tick it is 3.5 s.
   *
   * A memo that outlived the tick would make the daemon hold state, which is the
   * one property this design does not have.
   */
  const worldWithMemo = () => {
    let walks = 0;
    let memo: number | null = null;
    const world: SupervisorWorld = {
      beginTick: () => {
        memo = null;
      },
      workerAlive: async () => false,
      merge: async () => 'merged',
      dirtyPath: async () => '',
      blockedMarker: async () => '',
      changesets: async () => [],
      workspacePackages: async () => ['plot'],
      planLine: async () => {
        if (memo === null) {
          walks += 1;
          memo = walks;
        }
        return null;
      },
      madeProgress: async () => true,
      headroom: async () => 'clear',
      deskFile: () => null,
      transcriptFound: () => false,
    };
    return { world, walks: () => walks };
  };

  const entries = [
    { branch: 'feature/a', worktree: '/estate/a', resumeId: '', attempts: 0 },
    { branch: 'feature/b', worktree: '/estate/b', resumeId: '', attempts: 0 },
    { branch: 'feature/c', worktree: '/estate/c', resumeId: '', attempts: 0 },
  ] as unknown as AgentEntry[];

  it('walks once for three agents in one tick', async () => {
    const { world, walks } = worldWithMemo();
    await readTick(entries, world);
    expect(walks()).toBe(1);
  });

  it('walks again on the next tick, so a change reaches it', async () => {
    const { world, walks } = worldWithMemo();
    await readTick(entries, world);
    await readTick(entries, world);
    expect(walks()).toBe(2);
  });

  it('works for a world that holds nothing and defines no beginTick', async () => {
    const built = worldFrom({
      repoRoot: '/estate',
      isAlive: async () => false,
      prMerged: async () => 'merged',
      dirtyPaths: async () => [],
      markers: async () => [],
      planLine: async () => null,
      workspacePackages: async () => [],
      madeProgress: async () => true,
      spawnCostMs: async () => 4,
      recordedPid: () => null,
    });
    await expect(readTick(entries, built)).resolves.toBeDefined();
  });

  it('calls beginTick before any reading is taken', async () => {
    const order: string[] = [];
    const world: SupervisorWorld = {
      beginTick: () => order.push('begin'),
      workerAlive: async () => {
        order.push('read');
        return false;
      },
      merge: async () => 'merged',
      dirtyPath: async () => '',
      blockedMarker: async () => '',
      changesets: async () => [],
      workspacePackages: async () => {
        order.push('read');
        return [];
      },
      planLine: async () => null,
      madeProgress: async () => true,
      headroom: async () => {
        order.push('read');
        return 'clear';
      },
      deskFile: () => null,
      transcriptFound: () => false,
    };
    await readTick(entries, world);
    expect(order[0]).toBe('begin');
  });
});

describe('where a tick’s report goes', () => {
  /** A completed tick, as `tick` builds one. */
  const completed = (): TickReport => ({
    startedAt: 0,
    costMs: 250,
    agents: 1,
    incomplete: '',
    // NULL IS *NOBODY ASKED*: this fixture is a supervision-only tick, which is
    // what a daemon given no queue world runs. An empty decision here would say
    // the queue was read and held nothing.
    handOver: null,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: ['feature/one'],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
        unclaimed: [],
      },
    },
  });

  /** A tick that could not complete, as `tick` builds one. */
  const incomplete = (reason: string): TickReport => ({
    ...completed(),
    agents: 0,
    incomplete: reason,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: [],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
        unclaimed: [],
      },
    },
  });

  /** A tick whose queue refused everything, as `matchQueue` reports one. */
  const refused = (): TickReport => ({
    ...completed(),
    handOver: {
      outcome: 'decided',
      workflow: 'assign',
      writes: [],
      detail: {
        assignments: [],
        held: [
          { branch: 'feature/a', hold: 'no-brief' },
          { branch: 'feature/b', hold: 'no-brief' },
          { branch: 'feature/c', hold: 'already-merged' },
        ],
        idle: ['sess-1'],
        scaling: null,
      },
    },
  });

  it('names the held slices under their hold, so `--once` says what to fix', () => {
    // THE OPERATOR'S INSPECTION PATH. The summary line carries the counts a
    // daemon logs every 60 s; the names belong here, where somebody asked.
    const out: string[] = [];
    reportTick(refused(), (s) => out.push(s), () => {});
    const text = out.join('');
    expect(text).toContain('held on no-brief (2):');
    expect(text).toContain('feature/a');
    expect(text).toContain('feature/b');
    expect(text).toContain('held on already-merged (1):');
    expect(text).toContain('feature/c');
  });

  it('omits a hold that refused nothing, where the summary line prints its zero', () => {
    // THE TWO PATHS DIFFER ON PURPOSE. A zero is a measurement on the counted
    // line and noise in a list of names — there are no slices to name.
    const out: string[] = [];
    reportTick(refused(), (s) => out.push(s), () => {});
    expect(out.join('')).not.toContain('held on not-claimable');
  });

  it('names nothing on a tick that never read a queue', () => {
    const out: string[] = [];
    reportTick(completed(), (s) => out.push(s), () => {});
    expect(out.join('')).not.toContain('held on ');
  });

  it('sends a completed tick to stdout', () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(reportTick(completed(), (s) => out.push(s), (s) => err.push(s))).toBe(0);
    expect(out.join('')).toContain('agents=1');
    expect(err).toEqual([]);
  });

  it('sends an incomplete tick to stderr, which both units log separately', () => {
    // A person watching the error stream alone sees exactly the ticks that
    // could not be taken — which is what they look at when the supervisor is
    // not supervising.
    const out: string[] = [];
    const err: string[] = [];
    reportTick(incomplete('spawn git ENOMEM'), (s) => out.push(s), (s) => err.push(s));
    expect(out).toEqual([]);
    expect(err.join('')).toContain('incomplete');
    expect(err.join('')).toContain('spawn git ENOMEM');
  });

  it('says a one-shot run failed, so an operator’s exit code is honest', () => {
    expect(reportTick(incomplete('spawn git ENOMEM'), () => {}, () => {})).toBe(1);
    expect(reportTick(completed(), () => {}, () => {})).toBe(0);
  });

  it('says the next tick re-reads, because that is the whole recovery', () => {
    // No journal, no lock file, no resume path: the line names what happens
    // next so a reader does not go looking for one.
    const err: string[] = [];
    reportTick(incomplete('scandir failed'), () => {}, (s) => err.push(s));
    expect(err.join('')).toContain('next=re-reads');
  });
});

describe('what a looping tick prints does not follow what grows', () => {
  // `registryd.log` reached 69,776,046 bytes in seven days while `board.log`
  // beside it — same machine, same week, same kind of daemon — is 16,745. Each
  // test here grows ONE input and asserts the line count does not follow it.
  // Three inputs, three tests: they are proportional to different things, and a
  // single "grow the estate" test can never fire on the registry one.

  /** A supervision-only tick, as `tick` builds one. */
  const base = (): TickReport => ({
    startedAt: 0,
    costMs: 250,
    agents: 1,
    incomplete: '',
    handOver: null,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: ['feature/one'],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
        unclaimed: [],
      },
    },
  });

  /** A tick holding `n` slices under `hold`. */
  const holding = (n: number, hold: HeldSlice['hold']): TickReport => ({
    ...base(),
    handOver: {
      outcome: 'decided',
      workflow: 'assign',
      writes: [],
      detail: {
        assignments: [],
        held: Array.from({ length: n }, (_, i) => ({ branch: `feature/b${i}`, hold })),
        idle: [],
        scaling: null,
      },
    },
  });

  /** A tick carrying `n` worktrees nobody dispatched. */
  const unclaiming = (n: number): TickReport => {
    const report = base();
    return {
      ...report,
      decision: {
        ...report.decision,
        detail: {
          ...report.decision.detail,
          unclaimed: Array.from({ length: n }, (_, i) => ({
            path: `/private/tmp/wt${i}`,
            branch: '',
            dirtyCount: 0,
            disposition: 'remove' as const,
            command: `git worktree remove /private/tmp/wt${i}`,
          })),
        },
      },
    };
  };

  /** What a looping tick wrote, as lines. */
  const looped = (report: TickReport): string[] => {
    const out: string[] = [];
    reportTick(report, (s) => out.push(s), () => {}, true);
    return out.join('').split('\n').filter((line) => line !== '');
  };

  it('does not follow the held-branch count, which is the 69 MB', () => {
    // `not-claimable` is a hold over the WHOLE ESTATE'S BACKLOG — 165 branches
    // here, re-enumerated 7,333 times. Growing it 20× must not grow the output
    // at all: the count is on the summary line, where it costs one field.
    expect(looped(holding(400, 'not-claimable')).length).toBe(
      looped(holding(20, 'not-claimable')).length,
    );
  });

  it('does not follow the undispatched-worktree count, which was 10.26%', () => {
    // PINNED SEPARATELY, and that is the point. `unclaimedLines` was 38,174
    // lines and 7,132,536 bytes under a comment claiming the unclaimed trees
    // "were twelve at their worst"; an earlier draft of the plan missed it
    // entirely, so a single combined test would let a partial fix pass.
    expect(looped(unclaiming(60)).length).toBe(looped(unclaiming(2)).length);
  });

  it('does not follow the unparseable-manifest count, which is zero bytes today', async () => {
    // THE ONE A "GROW THE ESTATE" TEST COULD NEVER FIRE. This emitter is
    // proportional to the REGISTRY, and it wrote none of the 69 MB — no
    // manifest was unparseable. It was found by enumerating every emitter
    // rather than by measuring output, and one malformed file makes it a
    // permanent per-tick line.
    const lines = async (n: number): Promise<number> => {
      const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
      try {
        for (let i = 0; i < n; i += 1) writeFileSync(join(dir, `bad${i}.json`), 'not json');
        const err: string[] = [];
        await readRegistry(dir, (s) => err.push(s), true);
        return err.length;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    expect(await lines(50)).toBe(await lines(5));
  });

  it('caps a kept class rather than exempting it, at the peak one host outage makes', () => {
    // `whyNotReady` tests `merge-unknown` SECOND, before the claimable split,
    // and `landed` answers `unknown` for every slice when the host cannot be
    // asked — so ONE host outage moves the entire queue into a class this file
    // preserves. 574 is the measured peak here. Kept is not unbounded.
    const out = looped(holding(574, 'merge-unknown'));
    expect(out.length).toBeLessThan(20);
    expect(out.join('\n')).toContain('… and 562 more');
  });

  it('still names the four queue-level classes, because a debugger reads them', () => {
    // CATCHES OVER-DELETION, the failure mode of the draft that deleted all
    // five holds to fix one. These four are refusals about slices that were
    // actually queued: small, churning, and what somebody reads at 3am.
    for (const hold of ['already-merged', 'merge-unknown', 'no-brief', 'no-free-agent'] as const) {
      const text = looped(holding(3, hold)).join('\n');
      expect(text).toContain(`held on ${hold} (3):`);
      expect(text).toContain('feature/b0');
      expect(text).toContain('feature/b2');
    }
  });

  it('names no branch for the estate-wide class, and still counts it', () => {
    // The header carries the count for every class. What goes is the
    // enumeration under the one class that grows with the backlog.
    const text = looped(holding(400, 'not-claimable')).join('\n');
    expect(text).toContain('held on not-claimable (400):');
    expect(text).not.toContain('feature/b0');
  });

  it('keeps every key the counted summary has, since a zero is a measurement', () => {
    // A `no-brief=0` says the hold was tested and nothing hit it; a MISSING key
    // says this build has no such hold. Absent is not false, and the quieter
    // tick must not have quietened the line that carries the answer.
    const summary = looped(holding(400, 'not-claimable'))[0];
    for (const hold of QUEUE_HOLDS) expect(summary).toContain(`${hold}=`);
    expect(summary).toContain('held=400');
  });

  it('leaves `--once` byte-identical, which is the path a person runs', () => {
    // THE DEFAULT IS `--once`'s FULL OUTPUT. A caller that says nothing gets
    // everything, so the nine tests above this block pin the unchanged path
    // without being touched.
    const full = (report: TickReport): string => {
      const out: string[] = [];
      reportTick(report, (s) => out.push(s), () => {});
      return out.join('');
    };
    const explicit = (report: TickReport): string => {
      const out: string[] = [];
      reportTick(report, (s) => out.push(s), () => {}, false);
      return out.join('');
    };
    for (const report of [holding(30, 'not-claimable'), unclaiming(9), base()]) {
      expect(full(report)).toBe(explicit(report));
      expect(full(report)).toContain('plot-registryd tick');
    }
    expect(full(holding(30, 'not-claimable'))).toContain('feature/b29');
    expect(full(unclaiming(9))).toContain('/private/tmp/wt8');
    expect(full(holding(30, 'not-claimable'))).not.toContain('… and');
  });

  it('names every unparseable manifest on `--once`, however many there are', async () => {
    // The registry emitter's `--once` path, pinned beside the loop's cap for
    // the same reason: a person who asked wants the list.
    //
    // `await` INSIDE THE `try`, NOT A RETURNED PROMISE. A `finally` fires when
    // the block exits synchronously, so returning the promise deletes the
    // directory while `readRegistry` is still reading it — `readdir` then
    // throws, the function answers `[]` by its no-registry path, and the
    // assertion sees no warnings at all. That passed here on a warm disk and
    // failed in CI on a slow one.
    const dir = mkdtempSync(join(tmpdir(), 'plot-registry-'));
    try {
      for (let i = 0; i < 9; i += 1) writeFileSync(join(dir, `bad${i}.json`), 'not json');
      const err: string[] = [];
      await readRegistry(dir, (s) => err.push(s));
      expect(err).toHaveLength(9);
      expect(err.join('')).toContain('bad8.json');
      expect(err.join('')).not.toContain('… and');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a tick it could not complete, looping or not', () => {
    // UNCHANGED BY THIS BLOCK. An incomplete tick is one line on stderr and it
    // is the supervisor's failure signal — the quieter path must not have
    // reached it.
    const err: string[] = [];
    const report: TickReport = { ...base(), incomplete: 'spawn git ENOMEM' };
    expect(reportTick(report, () => {}, (s) => err.push(s), true)).toBe(1);
    expect(err.join('')).toContain('incomplete');
    expect(err.join('')).toContain('spawn git ENOMEM');
    expect(err.join('')).toContain('next=re-reads');
  });
});


describe('starting agents is the one write this daemon performs', () => {
  /** A tick whose hand-over named `n` starts. */
  const withStarts = (n: number): TickReport => ({
    startedAt: 0,
    costMs: 10,
    agents: 0,
    incomplete: '',
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: [],
        left: [],
        reaping: [],
        correcting: [],
        needingAPerson: [],
        deferred: [],
        unclaimed: [],
      },
    },
    handOver: {
      outcome: 'decided',
      workflow: 'assign',
      writes: [
        // A WRITE THIS APPLIER DOES NOT OWN, sitting first on purpose: the tick
        // names reaps and corrections too, and none of them is performed here.
        { kind: 'manifest-clear', worktree: '/estate/gone' },
        ...Array.from({ length: n }, () => ({
          kind: 'worker-start' as const,
          branch: '',
          worktree: '',
        })),
      ],
      detail: {
        assignments: [],
        held: [],
        idle: [],
        scaling: {
          start: n,
          requested: n,
          running: 0,
          headroom: 'clear' as const,
          shortfall: '',
        },
      },
    },
  });

  /** A performer that records what it was asked to start. */
  const spy = (answer: () => ReturnType<Performer['startFreeAgent']>) => {
    const asked: string[] = [];
    const performer: Performer = {
      startFreeAgent: (worktree) => {
        asked.push(worktree);
        return answer();
      },
    };
    return { performer, asked };
  };

  /** A tick that decided one hand-over and one start. */
  const withAssign = (): TickReport => ({
    ...withStarts(0),
    handOver: {
      outcome: 'decided',
      workflow: 'assign',
      writes: [
        { kind: 'agent-assign', session: 'sess-1', worktree: '/estate/a', branch: 'feature/a', slug: 'a-plan' },
        { kind: 'worker-start', branch: '', worktree: '/estate/free' },
      ],
      detail: {
        assignments: [{ session: 'sess-1', worktree: '/estate/a', branch: 'feature/a', slug: 'a-plan' }],
        held: [],
        idle: [],
        scaling: null,
      },
    },
  });

  it('performs the hand-over the tick decided, not only the start', async () => {
    // THE MEASURED DEFECT — 2026-09-06. A tick reported `handed=8` while all
    // eight agents stayed `branch: ""`, because this applier filtered to
    // `worker-start`. Six were written by hand, twice in one day.
    const assigned: string[] = [];
    const performer: Performer = {
      startFreeAgent: async () => answered(1),
      assignSlice: async (session, branch) => {
        assigned.push(`${session}:${branch}`);
        return answered(true);
      },
    };

    await startAgents(withAssign(), performer, () => {}, () => {});
    expect(assigned).toEqual(['sess-1:feature/a']);
  });

  it('reports a hand-over the agent had since outgrown, and does not count it', async () => {
    // AN AGENT MAY HAVE TAKEN WORK BETWEEN THE READING AND THE WRITE. Silence
    // here would report a hand-over that never happened.
    const out: string[] = [];
    const performer: Performer = {
      startFreeAgent: async () => answered(1),
      assignSlice: async () => answered(false),
    };

    await startAgents(withAssign(), performer, (s) => out.push(s), (s) => out.push(s));
    expect(out.join('')).toContain('feature/a');
  });

  it('starts one agent per `worker-start` write and reports the count', async () => {
    const { performer, asked } = spy(async () => answered(1));
    const out: string[] = [];
    const started = await startAgents(withStarts(2), performer, (s) => out.push(s), () => {});
    expect(started).toBe(2);
    expect(asked).toHaveLength(2);
    expect(out.join('')).toContain('started 2 free agent(s)');
  });

  it('performs no other write kind, however many the tick named', async () => {
    // NAMING THE KIND RATHER THAN FALLING THROUGH. This slice owns starting an
    // agent and nothing else; a reap or a correction is left for whoever does.
    const { performer, asked } = spy(async () => answered(1));
    await startAgents(withStarts(1), performer, () => {}, () => {});
    expect(asked).toHaveLength(1);
  });

  it('reports what to configure when nothing starts agents in this repository', async () => {
    // `unaskable` IS A FIRST-CLASS ANSWER. `Worker command: none` means asked,
    // and answered *we start them by hand* — not an error to chase every tick.
    const { performer } = spy(async () => unaskable<number>());
    const err: string[] = [];
    const started = await startAgents(withStarts(1), performer, () => {}, (s) => err.push(s));
    expect(started).toBe(0);
    expect(err.join('')).toContain('Worker command');
  });

  it('reports a failed start and lets the next tick re-derive it', async () => {
    // A START THAT FAILS COSTS ONE TICK. There is nothing to retry and nothing
    // to remember: the next tick reads the queue and the fleet from disk again.
    const { performer } = spy(async () => failed<number>());
    const err: string[] = [];
    expect(await startAgents(withStarts(1), performer, () => {}, (s) => err.push(s))).toBe(0);
    expect(err.join('')).toContain('the next tick re-derives');
  });

  it('starts nothing for a tick that named no start', async () => {
    const { performer, asked } = spy(async () => answered(1));
    const out: string[] = [];
    expect(await startAgents(withStarts(0), performer, (s) => out.push(s), () => {})).toBe(0);
    expect(asked).toEqual([]);
    expect(out).toEqual([]);
  });
});

/**
 * THE FOUR PINS `a-failed-tick-must-not-end-the-daemon` PROMISED.
 *
 * Its slice said: "Tests pin that a throwing tick leaves the loop running,
 * that the next tick is attempted, that `--once` does not swallow it, and that
 * the report is empty rather than partial." None was written, and a delivery
 * panel refuted the delivery for exactly that — the seam was already built and
 * the tests were simply absent. `run` takes `write`, `sleep`, `stop` and
 * `warn` as parameters, and the `import.meta.url` guard exists so an importer
 * gets no loop.
 *
 * WHAT THESE ACTUALLY REACH. `world` is constructed inside `run` and cannot be
 * injected, so a tick cannot be forced to throw from here. What CAN be driven
 * is the loop's own shape: that a run against an unreadable estate reports
 * rather than dying, that `stop()` ends it, and that `--once` returns its own
 * exit code. Those are the observable halves of the same contract.
 *
 * THIS IS LESS THAN THE SLICE PROMISED, and saying so is the point: a
 * throwing-tick pin needs `world` injectable, which is a change to `run`'s
 * signature and a different slice. The promise is recorded as partially kept
 * rather than quietly dropped.
 */
describe('run — a failed tick must not end the daemon', () => {
  const sandbox = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-registryd-loop-'));
    writeFileSync(join(dir, 'not-a-manifest.json'), '{ this is not json');
    return dir;
  };

  it('returns rather than throwing when the estate cannot be read', async () => {
    const dir = sandbox();
    try {
      const warnings: string[] = [];
      const code = await run(
        ['--once'],
        dir,
        () => {},
        async () => {},
        () => false,
        (s) => warnings.push(s),
      );
      // The contract's own words: a tick that cannot complete REPORTS. Whatever
      // the code, the call resolved — it did not reject, which is the death the
      // guard exists to prevent.
      expect(typeof code).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops when stop() says so, without running a tick', async () => {
    const dir = sandbox();
    try {
      let ticks = 0;
      const code = await run(
        [],
        dir,
        () => {},
        async () => { ticks += 1; },
        () => true,
        () => {},
      );
      // `run` returns 0 when `stop()` ends it before any tick — the clean
      // shutdown path, distinct from the 2 it returns for a bad argument.
      expect(code).toBe(0);
      // `stop()` is tested at the TOP of the loop, so a run that is stopped
      // before its first tick sleeps zero times.
      expect(ticks).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not loop under --once, whatever the tick reported', async () => {
    const dir = sandbox();
    try {
      let sleeps = 0;
      await run(
        ['--once'],
        dir,
        () => {},
        async () => { sleeps += 1; },
        () => false,
        () => {},
      );
      // `--once` returns after one tick, so the loop's sleep is never reached.
      // Without this, a failed tick under `--once` could fall through to the
      // sleep and loop forever — which is the swallowing the slice named.
      expect(sleeps).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing to stdout that is not a report', async () => {
    const dir = sandbox();
    try {
      const out: string[] = [];
      await run(
        ['--once'],
        dir,
        (s) => out.push(s),
        async () => {},
        () => false,
        () => {},
      );
      // The report is empty rather than partial: whatever is written is a
      // complete line, never a truncated tick.
      for (const line of out) {
        expect(line.endsWith('\n') || line === '').toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
