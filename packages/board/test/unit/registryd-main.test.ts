import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { refusedSlicesFixture } from '@plot-pm/domain/adapters';
import { join } from 'node:path';

import {
  accountRate,
  argsFrom,
  sweepTempIfDue,
  startFreshAgents,
  mergeMemoOver,
  escalationWorldForRepo,
  notifierFor,
  notifyEscalations,
  queueWorldForRepo,
  readRegistry,
  reportTick,
  run,
  spendForTick,
  startAgents,
  worldForRepo,
  writeSupervisionReport,
} from '../../src/server/entry/registryd-main.js';
import { escalationMemory, readEscalations } from '../../src/server/escalations.js';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import type { MergedAnswer } from '@plot-pm/domain/ports/host';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { PortResult } from '@plot-pm/domain';
import { whyNotReady } from '@plot-pm/domain/rules/queue';
import { readQueue, type QueueWorld, type HandOverWorld } from '../../src/server/queue-reading.js';
import type { Performer } from '@plot-pm/domain/ports/performer';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';
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
      sweepTemp: false,
    });
  });

  it('sweeps no temp path unless asked', () => {
    expect(argsFrom([])?.sweepTemp).toBe(false);
    expect(argsFrom(['--once'])?.sweepTemp).toBe(false);
    expect(argsFrom(['--sweep-temp'])?.sweepTemp).toBe(true);
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
          { branch: 'feature/a', hold: 'no-brief', waitsOn: [], waitHeld: '', assignedTo: '' },
          { branch: 'feature/b', hold: 'no-brief', waitsOn: [], waitHeld: '', assignedTo: '' },
          { branch: 'feature/c', hold: 'already-merged', waitsOn: [], waitHeld: '', assignedTo: '' },
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

  it('names the prerequisite and why it held, under `held on waits`', () => {
    // THE EXACT FORM IS GREPPED. A reader acting on this line needs the
    // prerequisite's name and whether it is unmerged or unreachable — the
    // branch alone, as every other hold prints it, says neither.
    const held: TickReport = {
      ...completed(),
      handOver: {
        outcome: 'decided',
        workflow: 'assign',
        writes: [],
        detail: {
          assignments: [],
          held: [
            {
              branch: 'bug/the-queue-reads-the-merge-subject',
              hold: 'waits',
              waitsOn: ['bug/the-merge-subject-is-one-rule'],
              waitHeld: 'unmerged',
              assignedTo: '',
            },
          ],
          idle: [],
          scaling: null,
        },
      },
    };
    const out: string[] = [];
    reportTick(held, (s) => out.push(s), () => {});
    const text = out.join('');
    expect(text).toContain('held on waits (1):');
    expect(text).toContain(
      '    bug/the-queue-reads-the-merge-subject — waits on bug/the-merge-subject-is-one-rule (unmerged)',
    );
  });

  it('joins several still-held prerequisites with a comma, one `waitHeld` word', () => {
    // ONE WORD IS ENOUGH: `prerequisiteAnswer` answers `unmerged` or
    // `unreachable` from the single flag `listingWhole`, so it reads the same
    // for every prerequisite on the branch.
    const held: TickReport = {
      ...completed(),
      handOver: {
        outcome: 'decided',
        workflow: 'assign',
        writes: [],
        detail: {
          assignments: [],
          held: [
            {
              branch: 'bug/a-slice-waits-on-every-branch-it-names',
              hold: 'waits',
              waitsOn: ['bug/prereq-a', 'bug/prereq-b'],
              waitHeld: 'unmerged',
              assignedTo: '',
            },
          ],
          idle: [],
          scaling: null,
        },
      },
    };
    const out: string[] = [];
    reportTick(held, (s) => out.push(s), () => {});
    const text = out.join('');
    expect(text).toContain(
      '    bug/a-slice-waits-on-every-branch-it-names — waits on bug/prereq-a, bug/prereq-b (unmerged)',
    );
  });

  it('names the agent a live manifest holds this branch for, under `held on assigned`', () => {
    const held: TickReport = {
      ...completed(),
      handOver: {
        outcome: 'decided',
        workflow: 'assign',
        writes: [],
        detail: {
          assignments: [],
          held: [
            { branch: 'bug/x', hold: 'assigned', waitsOn: [], waitHeld: '', assignedTo: 'sess-1' },
          ],
          idle: [],
          scaling: null,
        },
      },
    };
    const out: string[] = [];
    reportTick(held, (s) => out.push(s), () => {});
    const text = out.join('');
    expect(text).toContain('held on assigned (1):');
    expect(text).toContain('    bug/x: assigned to sess-1');
  });

  it('names an orphaned claim and its release command, and reports the count', () => {
    const held: TickReport = {
      ...completed(),
      handOver: {
        outcome: 'decided',
        workflow: 'assign',
        writes: [],
        detail: {
          assignments: [],
          held: [],
          idle: [],
          scaling: null,
          orphanedClaims: ['bug/stale-claim'],
        },
      },
    };
    const out: string[] = [];
    reportTick(held, (s) => out.push(s), () => {});
    const text = out.join('');
    expect(text).toContain('orphaned-claims=1');
    expect(text).toContain(
      '  bug/stale-claim: claim with no agent — plot-dispatch.sh --release bug/stale-claim',
    );
  });

  it('prints `orphaned-claims=0` once asked, rather than omitting the field', () => {
    const held: TickReport = {
      ...completed(),
      handOver: {
        outcome: 'decided',
        workflow: 'assign',
        writes: [],
        detail: { assignments: [], held: [], idle: [], scaling: null, orphanedClaims: [] },
      },
    };
    const out: string[] = [];
    reportTick(held, (s) => out.push(s), () => {});
    expect(out.join('')).toContain('orphaned-claims=0');
  });

  it('omits `orphaned-claims=` when nobody asked', () => {
    // NULL IS *NOBODY ASKED*, the rule every other queue field follows: a tick
    // run without this reading must not claim the estate has zero orphans.
    const out: string[] = [];
    reportTick(refused(), (s) => out.push(s), () => {});
    expect(out.join('')).not.toContain('orphaned-claims=');
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
        held: Array.from({ length: n }, (_, i) => ({
          branch: `feature/b${i}`,
          hold,
          waitsOn: [],
          waitHeld: '' as const,
          assignedTo: '',
        })),
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

  it('still names every queue-level class, because a debugger reads them', () => {
    // CATCHES OVER-DELETION, the failure mode of the draft that deleted all
    // five holds to fix one. Each of these is a refusal about a slice that was
    // actually queued: small, churning, and what somebody reads at 3am.
    //
    // `prior-unknown` IS NAMED FOR THAT REASON AND NOT BY DEFAULT. It is the
    // hold an operator is waiting on a branch for, and under HTTP 429 the slice
    // they waited for appeared only as a count (#1094) — because the word was
    // `not-claimable`, the one class below that is counted and never named.
    for (const hold of [
      'already-merged',
      'merge-unknown',
      'no-brief',
      'slice-unnamed',
      'prior-unknown',
      'no-free-agent',
    ] as const) {
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

  /**
   * A hand-over world whose fresh readings always clear the check — a fresh
   * tick, an absent ref and no landing — so a test asserting on the
   * PERFORMER's behaviour is not also asserting on the hand-over check.
   */
  const handOverReady: HandOverWorld = {
    remoteHead: async () => 'absent',
    queuedHasLanded: async () => 'not-landed',
    now: () => 0,
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

    await startAgents(withAssign(), performer, handOverReady, () => {}, () => {});
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

    await startAgents(withAssign(), performer, handOverReady, (s) => out.push(s), (s) => out.push(s));
    expect(out.join('')).toContain('feature/a');
  });

  it('starts one agent per `worker-start` write and reports the count', async () => {
    const { performer, asked } = spy(async () => answered(1));
    const out: string[] = [];
    const started = await startAgents(withStarts(2), performer, handOverReady, (s) => out.push(s), () => {});
    expect(started).toBe(2);
    expect(asked).toHaveLength(2);
    expect(out.join('')).toContain('started 2 free agent(s)');
  });

  it('performs no other write kind, however many the tick named', async () => {
    // NAMING THE KIND RATHER THAN FALLING THROUGH. This slice owns starting an
    // agent and nothing else; a reap or a correction is left for whoever does.
    const { performer, asked } = spy(async () => answered(1));
    await startAgents(withStarts(1), performer, handOverReady, () => {}, () => {});
    expect(asked).toHaveLength(1);
  });

  it('reports what to configure when nothing starts agents in this repository', async () => {
    // `unaskable` IS A FIRST-CLASS ANSWER. `Worker command: none` means asked,
    // and answered *we start them by hand* — not an error to chase every tick.
    const { performer } = spy(async () => unaskable<number>());
    const err: string[] = [];
    const started = await startAgents(withStarts(1), performer, handOverReady, () => {}, (s) => err.push(s));
    expect(started).toBe(0);
    expect(err.join('')).toContain('Worker command');
    // A command that is not the loop answers `unaskable` too (#1124), so the
    // line names the value to set rather than only the key.
    expect(err.join('')).toContain('`PLOT_UNATTENDED=1 plot-worker-loop.sh`');
  });

  it('reports a failed start and lets the next tick re-derive it', async () => {
    // A START THAT FAILS COSTS ONE TICK. There is nothing to retry and nothing
    // to remember: the next tick reads the queue and the fleet from disk again.
    const { performer } = spy(async () => failed<number>());
    const err: string[] = [];
    expect(await startAgents(withStarts(1), performer, handOverReady, () => {}, (s) => err.push(s))).toBe(0);
    expect(err.join('')).toContain('the next tick re-derives');
  });

  it('starts nothing for a tick that named no start', async () => {
    const { performer, asked } = spy(async () => answered(1));
    const out: string[] = [];
    expect(await startAgents(withStarts(0), performer, handOverReady, (s) => out.push(s), () => {})).toBe(0);
    expect(asked).toEqual([]);
    expect(out).toEqual([]);
  });

  it('withholds a hand-over whose branch merged after the reading, and asks no further question', async () => {
    // THE MEASURED DEFECT THIS SLICE CLOSES — #1149. The fresh readings say
    // the branch landed, so `assignSlice` is never called.
    const assigned: string[] = [];
    const performer: Performer = {
      startFreeAgent: async () => answered(1),
      assignSlice: async (session, branch) => {
        assigned.push(`${session}:${branch}`);
        return answered(true);
      },
    };
    const world: HandOverWorld = {
      remoteHead: async () => 'absent',
      queuedHasLanded: async () => 'landed',
      now: () => 0,
    };
    const out: string[] = [];
    await startAgents(withAssign(), performer, world, (s) => out.push(s), () => {});
    expect(assigned).toEqual([]);
    expect(out.join('')).toContain('feature/a: not handed — landed');
  });

  it('withholds a hand-over from a reading over five minutes old, asking neither fresh reading', async () => {
    const assigned: string[] = [];
    const performer: Performer = {
      startFreeAgent: async () => answered(1),
      assignSlice: async (session, branch) => {
        assigned.push(`${session}:${branch}`);
        return answered(true);
      },
    };
    const asked: string[] = [];
    const world: HandOverWorld = {
      remoteHead: async (branch) => {
        asked.push(`remoteHead:${branch}`);
        return 'absent';
      },
      queuedHasLanded: async (branch) => {
        asked.push(`queuedHasLanded:${branch}`);
        return 'not-landed';
      },
      now: () => 301_000,
    };
    const out: string[] = [];
    const report = { ...withAssign(), startedAt: 0 };
    await startAgents(report, performer, world, (s) => out.push(s), () => {});
    expect(assigned).toEqual([]);
    expect(out.join('')).toContain('feature/a: not handed — stale');
    expect(asked).toEqual([]);
  });

  it('still hands over a slice that passes the check', async () => {
    const assigned: string[] = [];
    const performer: Performer = {
      startFreeAgent: async () => answered(1),
      assignSlice: async (session, branch) => {
        assigned.push(`${session}:${branch}`);
        return answered(true);
      },
    };
    const out: string[] = [];
    await startAgents(withAssign(), performer, handOverReady, (s) => out.push(s), () => {});
    expect(assigned).toEqual(['sess-1:feature/a']);
    expect(out.join('')).toContain('feature/a: handed to sess-1');
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

/**
 * THE REPORT THE DAEMON WRITES — the one channel to the board.
 *
 * Before this the tick computed a `SupervisionCause` per desk and printed it to
 * stdout, and `/api/fleet` carried no cause at all: measured 2026-09-27, 31,240
 * bytes over 22 rows. These assert the PRODUCER half — that the file says what
 * the tick decided, that a `leave` row survives into it though the log drops it,
 * and that a write nobody can perform costs a field rather than a tick.
 */
describe('the supervision report', () => {
  const judged = (
    rows: readonly { branch: string; verdict: string; cause: string }[],
    startedAt = 1_700_000_000_000,
  ): TickReport => ({
    startedAt,
    costMs: 250,
    agents: rows.length,
    incomplete: '',
    handOver: null,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [],
      detail: {
        agents: rows.map((r) => ({
          branch: r.branch,
          worktree: `/estate/${r.branch}`,
          boundedOut: false,
          supervision: {
            verdict: r.verdict, cause: r.cause, branch: r.branch,
            worktree: `/estate/${r.branch}`, session: 's1', failures: [],
            correction: '', resume: 'available', nextAttempts: 1,
          },
        })),
        left: [], reaping: [], correcting: [], needingAPerson: [], deferred: [],
        unclaimed: [],
      },
    },
  } as never);

  /** A store that records what it was handed and reaches nothing. */
  const recorder = () => {
    const written: unknown[] = [];
    return {
      written,
      store: {
        location: async () => ({ ok: true, value: '/fake/supervision.json' }),
        read: async () => ({ ok: true, value: null }),
        write: async (report: unknown) => {
          written.push(report);
          return { ok: true, value: undefined };
        },
      } as never,
    };
  };

  it('writes the verdict and cause the tick decided, with the tick’s clock', async () => {
    const { written, store } = recorder();
    const warnings: string[] = [];
    await writeSupervisionReport(
      judged([{ branch: 'bug/a', verdict: 'defer', cause: 'no-headroom' }]),
      store,
      (s) => warnings.push(s),
    );
    expect(warnings).toEqual([]);
    expect(written).toEqual([{
      v: 1,
      at: 1_700_000_000_000,
      rows: [{ branch: 'bug/a', worktree: '/estate/bug/a', verdict: 'defer', cause: 'no-headroom' }],
    }]);
  });

  /**
   * `reportTick` DROPS `leave` AND THIS MUST NOT. A log of a quiet estate should
   * be quiet; a reader asking what a desk owes needs the opposite, because an
   * absent row has to mean only *the tick did not judge this desk*. Filtering the
   * live ones out here would give that absence a second meaning.
   */
  it('keeps a live worker’s row, which the log filters out', async () => {
    const { written, store } = recorder();
    await writeSupervisionReport(
      judged([
        { branch: 'bug/live', verdict: 'leave', cause: 'worker-alive' },
        { branch: 'bug/deferred', verdict: 'defer', cause: 'no-headroom' },
      ]),
      store,
      () => {},
    );
    const rows = (written[0] as { rows: { branch: string }[] }).rows;
    expect(rows.map((r) => r.branch)).toEqual(['bug/live', 'bug/deferred']);
  });

  /**
   * AN INCOMPLETE TICK JUDGED NOTHING, AND THE ROWS SAY SO. Such a tick carries
   * an empty decision by contract, so the report is empty with a CURRENT clock —
   * *the supervisor ran and placed no desk*. Leaving the previous tick's file in
   * place would let a report the estate has moved past keep answering.
   */
  it('writes an empty report for a tick that could not complete', async () => {
    const { written, store } = recorder();
    const report = judged([]);
    await writeSupervisionReport({ ...report, incomplete: 'git would not fork' }, store, () => {});
    expect(written[0]).toEqual({ v: 1, at: 1_700_000_000_000, rows: [] });
  });

  it('names a failed write on the warning stream and does not throw', async () => {
    const warnings: string[] = [];
    await writeSupervisionReport(
      judged([{ branch: 'bug/a', verdict: 'defer', cause: 'no-headroom' }]),
      { location: async () => ({ ok: false }), read: async () => ({ ok: false }),
        write: async () => ({ ok: false }) } as never,
      (s) => warnings.push(s),
    );
    // A FAILED WRITE COSTS A FIELD, NEVER A TICK. The daemon's job is to
    // supervise; a read-only filesystem must not end its loop.
    expect(warnings.join('')).toContain('could not write the supervision report');
  });

  it('survives a store that throws', async () => {
    const warnings: string[] = [];
    await expect(writeSupervisionReport(
      judged([{ branch: 'bug/a', verdict: 'defer', cause: 'no-headroom' }]),
      { location: async () => ({ ok: false }), read: async () => ({ ok: false }),
        write: async () => { throw new Error('EROFS'); } } as never,
      (s) => warnings.push(s),
    )).resolves.toBeUndefined();
    expect(warnings.join('')).toContain('EROFS');
  });
});

describe('the tick reads the account rate from the spend record', () => {
  /** A scripts adapter whose `plot-host.sh spend-rate` says `answer`. */
  const saying = (answer: HostAnswer): Pick<Scripts, 'hostSaid'> & { asked: string[][] } => {
    const asked: string[][] = [];
    return {
      asked,
      hostSaid: async (args) => {
        asked.push([...args]);
        return answer;
      },
    };
  };
  const record = (perHour: unknown) =>
    saying({ answer: 'answered', stdout: JSON.stringify({ connector: 'bitbucket', perHour, basis: 'actual' }) });

  it('reads perHour from a saturated stub record through spend-rate', async () => {
    const scripts = record(2825.4);
    expect(await accountRate(scripts)).toBe(2825.4);
    expect(scripts.asked).toEqual([['spend-rate']]);
  });

  it('reads no evidence as null, never as zero', async () => {
    // A window with no span, a failed call, an unaskable host and a torn line.
    expect(await accountRate(record(null))).toBeNull();
    expect(await accountRate(saying({ answer: 'failed', said: 'no such file' }))).toBeNull();
    expect(await accountRate(saying({ answer: 'unaskable', said: 'no host' }))).toBeNull();
    expect(await accountRate(saying({ answer: 'answered', stdout: '{"perHour":' }))).toBeNull();
  });

  it('prices its own share at this tick\'s calls over the interval', async () => {
    // Two host calls a tick at 60 s is the 120/hr ceiling the plan measured.
    expect(await spendForTick(record(2825), 2, TICK_INTERVAL_MS)).toEqual({
      accountPerHour: 2825,
      minePerHour: 120,
    });
    expect((await spendForTick(record(null), 0, TICK_INTERVAL_MS)).minePerHour).toBe(0);
  });
});

describe('the worlds count the host calls a tick makes', () => {
  it('adds one per host call, answered or not, across both worlds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-tally-'));
    try {
      // A HOST THAT ANSWERS `merged` to one question and fails the other: a
      // refused call spent quota too, so both count.
      writeFileSync(
        join(dir, 'plot-host.sh'),
        '#!/usr/bin/env bash\n[ "$1" = pr-merged ] && { echo merged; exit 0; }\nexit 1\n',
      );
      const tally = { calls: 0 };
      const world = worldForRepo(dir, dir, tally);
      const queue = queueWorldForRepo(dir, dir, tally);
      await world.merge('feature/a');
      await queue.mergedBranches();
      await queue.sliceHasMerged('feature/b');
      expect(tally.calls).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a desk with no branch asks the host nothing', () => {
  // A STUB HOST THAT LOGS every call, so a guard placed after the call fails
  // here even though it returns the right word.
  const stubbed = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-not-asked-'));
    const log = join(dir, 'calls.log');
    writeFileSync(
      join(dir, 'plot-host.sh'),
      `#!/usr/bin/env bash\necho "$*" >> '${log}'\n${body}\n`,
    );
    chmodSync(join(dir, 'plot-host.sh'), 0o755);
    const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
    return { dir, calls };
  };

  it('answers not-asked for an empty branch, calls no host and spends nothing', async () => {
    const { dir, calls } = stubbed('echo merged; exit 0');
    try {
      const tally = { calls: 0 };
      const world = worldForRepo(dir, dir, tally);
      expect(await world.merge('')).toBe('not-asked');
      expect(calls()).toEqual([]);
      expect(tally.calls).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the three answers a named branch gets, each spending one call', async () => {
    const cases = [
      ['echo merged; exit 0', 'merged'],
      ['echo not-merged; exit 0', 'not-merged'],
      ['exit 1', 'unreachable'],
    ] as const;
    for (const [body, expected] of cases) {
      const { dir, calls } = stubbed(body);
      try {
        const tally = { calls: 0 };
        const world = worldForRepo(dir, dir, tally);
        expect(await world.merge('feature/a')).toBe(expected);
        expect(calls()).toHaveLength(1);
        expect(tally.calls).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('a tick asks the host about a branch once', () => {
  // A STUB HOST THAT COUNTS. The duplicate this guards against has no visible
  // effect on a tick's decision — only on its cost — so a test that checks the
  // decision alone passes with the duplicate still present.
  const countingHost = (answer: () => PortResult<MergedAnswer>) => {
    const asked: string[] = [];
    return {
      asked,
      prMerged: async (branch: string) => {
        asked.push(branch);
        return answer();
      },
    };
  };

  // The adapters these worlds build reach nothing until one is called, so a
  // path that holds no repository is enough for the members under test.
  const worlds = (host: ReturnType<typeof countingHost>) => {
    const root = mkdtempSync(join(tmpdir(), 'plot-merge-memo-'));
    const merges = mergeMemoOver(host);
    return {
      root,
      world: worldForRepo(root, root, { calls: 0 }, merges),
      queue: queueWorldForRepo(root, root, { calls: 0 }, merges),
    };
  };

  it('asks once for a branch the supervisor and the queue both read', async () => {
    const host = countingHost(() => answered('not-merged'));
    const { root, world, queue } = worlds(host);
    try {
      world.beginTick?.();
      // CONCURRENT, AS `readAgent` ASKS: the memo holds the Promise, so a
      // second reader arriving before the first answer shares the call.
      await Promise.all([world.merge('feature/busy'), world.merge('feature/busy')]);
      await queue.sliceHasMerged('feature/busy');
      await queue.queuedHasLanded('feature/busy');
      expect(host.asked).toEqual(['feature/busy']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks again in the next tick, because beginTick clears the memo', async () => {
    // A MEMO THAT NEVER CLEARS passes a one-tick test and freezes merge state
    // for the life of the daemon.
    const host = countingHost(() => answered('not-merged'));
    const { root, world, queue } = worlds(host);
    try {
      for (let tick = 0; tick < 2; tick += 1) {
        world.beginTick?.();
        await world.merge('feature/busy');
        await queue.sliceHasMerged('feature/busy');
      }
      expect(host.asked).toEqual(['feature/busy', 'feature/busy']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('asks separately about different branches', async () => {
    const host = countingHost(() => answered('merged'));
    const { root, world, queue } = worlds(host);
    try {
      world.beginTick?.();
      await world.merge('feature/one');
      await queue.queuedHasLanded('feature/two');
      expect(host.asked.sort()).toEqual(['feature/one', 'feature/two']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps each consumer’s silence word when the host call fails', async () => {
    // A MEMO OF BOOLEANS would pass every count above and read an outage as
    // *not merged* here. The memo holds the raw answer, and each consumer
    // derives its own word from it.
    const host = countingHost(() => failed());
    const { root, world, queue } = worlds(host);
    try {
      world.beginTick?.();
      expect(await world.merge('feature/busy')).toBe('unreachable');
      expect(await queue.sliceHasMerged('feature/busy')).toBe(false);
      expect(await queue.queuedHasLanded('feature/busy')).toBe('unknown');
      expect(host.asked).toEqual(['feature/busy']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('holds a slice whose merge state is unreadable, through the memo', async () => {
    const host = countingHost(() => failed());
    const { root, world, queue } = worlds(host);
    try {
      world.beginTick?.();
      const stub: QueueWorld = {
        plans: async () => [
          {
            file: 'docs/plans/2026-09-29-a-plan.md',
            phase: 'approved',
            slices: [{ name: 'A named slice', branches: [{ branch: 'feature/one', deferred: false, waitsOn: [] }] }],
          } as never,
        ],
        claimedBranches: async () => new Set<string>(),
        mergedBranches: async () => ({ merged: new Set<string>(), whole: false, kind: 'failed' as const, failed: true }),
        prIndexRows: async () => [],
        viewLanded: async () => 'unknown',
        briefPresent: async () => true,
        sliceHasMerged: queue.sliceHasMerged,
        subjectProven: async () => null,
        queuedHasLanded: queue.queuedHasLanded,
        workerAlive: async () => true,
        blocked: async () => false,
        refused: async () => false,
        remoteHead: async () => 'absent',
        commitSubjects: async () => ({ ok: true, value: [] }),
        now: () => 0,
        defaultBranch: async () => 'main',
      };
      const { slices } = await readQueue([], stub);
      expect(slices.map((slice) => whyNotReady(slice))).toEqual(['merge-unknown']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the queue world asks a known PR by number when the listing fails (#1140)', () => {
  // A STUB HOST SHAPED LIKE THE MEASURED OUTAGE: the merged listing refuses
  // with HTTP 429, while a lookup by number answers.
  const outage = (listing: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-by-number-'));
    const log = join(dir, 'calls.log');
    writeFileSync(
      join(dir, 'plot-host.sh'),
      [
        '#!/usr/bin/env bash',
        `echo "$*" >> '${log}'`,
        'case "$1" in',
        '  backend) echo bitbucket ;;',
        `  pr-list) ${listing} ;;`,
        '  pr-state) [ "$2" = 12 ] && { echo \'{"number":12,"state":"MERGED","draft":false,"url":"","mergeCommit":"abc"}\'; exit 0; }',
        '            echo "HTTP 429 Rate limit for this resource has been exceeded" >&2; exit 5 ;;',
        'esac',
      ].join('\n') + '\n',
    );
    chmodSync(join(dir, 'plot-host.sh'), 0o755);
    const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
    return { dir, calls };
  };
  const refused = 'echo "HTTP 429 Rate limit for this resource has been exceeded" >&2; exit 5';
  const row = { number: 12, head: 'feature/one', state: 'OPEN', draft: false, checks: 'none', review: '', url: '' };
  const index = (connectors: string[]): PrIndexStore => ({
    location: async () => answered(''),
    read: async (connector) => {
      connectors.push(connector);
      return answered({ v: 3, connector, watermark: null, complete: false, at: '', rows: [row] });
    },
    write: async () => answered(undefined),
  });

  it('reads a refused listing as not whole, and the view by number as landed', async () => {
    const { dir, calls } = outage(refused);
    try {
      const tally = { calls: 0 };
      const connectors: string[] = [];
      const queue = queueWorldForRepo(dir, dir, tally, undefined, index(connectors));
      // A FAILED REQUEST NAMES ITS OWN REFUSAL, so the tick line can print
      // `unaskable(throttled)` rather than leaving an operator to infer a rate
      // limit from a count of held slices (#1094).
      //
      // `throttled` IS THE STUB'S EXIT 5, WHICH IS #1094'S OWN CASE: a spent
      // quota behind an HTTP 429. It is not `failed`, and the two recover
      // differently — a quota returns at its reset, an auth error never does.
      expect(await queue.mergedBranches()).toEqual({
        merged: new Set(),
        whole: false,
        kind: 'throttled',
        failed: true,
      });
      expect(await queue.prIndexRows()).toEqual([row]);
      expect(connectors).toEqual(['bitbucket']);
      expect(await queue.viewLanded(12)).toBe('landed');
      expect(await queue.viewLanded(13)).toBe('unknown');
      expect(calls().filter((c) => c.startsWith('pr-'))).toEqual(['pr-list --state merged --limit 500', 'pr-state 12', 'pr-state 13']);
      expect(tally.calls).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the rows of a partial listing and reads it as not whole', async () => {
    const { dir } = outage(`echo '{"number":3,"head":"feature/a","state":"MERGED"}'; echo "pr-list: state open refused" >&2; exit 7`);
    try {
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, index([]));
      // `failed: false` IS WHAT SEPARATES THIS FROM THE CASE ABOVE. The
      // listing ANSWERED — its row is here — and left a refusal behind, so the
      // tick line reads `partial(<kind>)` and not `unaskable`.
      expect(await queue.mergedBranches()).toEqual({
        merged: new Set(['feature/a']),
        whole: false,
        kind: 'failed',
        failed: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a whole listing as whole', async () => {
    const { dir } = outage(`echo '{"number":3,"head":"feature/a","state":"MERGED"}'`);
    try {
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, index([]));
      expect(await queue.mergedBranches()).toEqual({
        merged: new Set(['feature/a']),
        whole: true,
        kind: null,
        failed: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('offers the slice behind a merged one through the real join', async () => {
    const { dir } = outage(refused);
    try {
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, index([]));
      const { slices } = await readQueue([], {
        ...queue,
        plans: async () => [
          {
            file: 'docs/plans/2026-10-01-a-plan.md',
            phase: 'approved',
            slices: [
              { name: 'First slice', branches: [{ branch: 'feature/one', deferred: false, waitsOn: [] }] },
              { name: 'Second slice', branches: [{ branch: 'feature/two', deferred: false, waitsOn: [] }] },
            ],
          } as never,
        ],
        claimedBranches: async () => new Set<string>(),
        briefPresent: async () => true,
        queuedHasLanded: async () => 'not-landed',
      });
      expect(slices.map((slice) => [slice.branch, whyNotReady(slice)])).toEqual([['feature/two', null]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads no index where the backend cannot be named', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'registryd-no-backend-'));
    try {
      writeFileSync(join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\nexit 3\n');
      const connectors: string[] = [];
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, index(connectors));
      expect(await queue.prIndexRows()).toEqual([]);
      expect(connectors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads no rows from a missing store', async () => {
    const { dir } = outage(refused);
    try {
      const empty: PrIndexStore = { ...index([]), read: async () => answered(null) };
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, empty);
      expect(await queue.prIndexRows()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the hourly temp sweep', () => {
  const HOUR = 60 * 60 * 1000;
  const sweepOver = (lastAt: number | null, result = answered('temp-summary: swept=1 removed=1')) => {
    const calls: number[] = [];
    return {
      calls,
      port: {
        lastAt: async () => lastAt,
        sweep: async () => { calls.push(1); return result; },
      },
    };
  };

  it('runs when no sweep has run', async () => {
    const s = sweepOver(null);
    const out: string[] = [];
    expect(await sweepTempIfDue(s.port, 10 * HOUR, (x) => out.push(x), () => {})).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(out.join('')).toMatch(/temp-summary: swept=1/);
  });

  it('runs at most once an hour', async () => {
    const now = 10 * HOUR;
    const recent = sweepOver(now - HOUR + 1);
    expect(await sweepTempIfDue(recent.port, now, () => {}, () => {})).toBe(false);
    expect(recent.calls).toHaveLength(0);
    const due = sweepOver(now - HOUR);
    expect(await sweepTempIfDue(due.port, now, () => {}, () => {})).toBe(true);
    expect(due.calls).toHaveLength(1);
  });

  it('reports a failed sweep on stderr and does not throw', async () => {
    const s = sweepOver(null, failed());
    const err: string[] = [];
    expect(await sweepTempIfDue(s.port, 0, () => {}, (x) => err.push(x))).toBe(true);
    expect(err.join('')).toMatch(/temp sweep did not run/);
  });
});

describe('notifierFor — the Notifier an empty Notify command answers unaskable', () => {
  it('answers unaskable for an empty value, same as a tracker nobody declared', async () => {
    expect(await notifierFor('').notify('x')).toEqual({ ok: false, why: 'unaskable' });
    expect(await notifierFor('   ').notify('x')).toEqual({ ok: false, why: 'unaskable' });
  });
});

describe('notifyEscalations — applies the tick\'s notify writes, once each', () => {
  const notifyTick = (worktree: string, rung: 'notified-1' | 'notified-2' | 'notified-3'): TickReport => ({
    startedAt: 0,
    costMs: 1,
    agents: 1,
    incomplete: '',
    handOver: null,
    decision: {
      outcome: 'decided',
      workflow: 'supervise',
      writes: [
        { kind: 'notify', worktree, askedAt: '2020-01-01T00:00:00.000Z', rung, message: 'hi' },
      ],
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

  const dirs: string[] = [];
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-notify-escalations-'));
    dirs.push(dir);
    return dir;
  };

  it('records sent on a successful send', async () => {
    const root = repo();
    const sent: string[] = [];
    const notifier: Notifier = { notify: async (m) => { sent.push(m); return { ok: true }; } };
    await notifyEscalations(notifyTick('/estate/a', 'notified-1'), root, async () => notifier, escalationMemory(), () => {}, () => {});
    expect(sent).toEqual(['hi']);
    const records = readEscalations(root);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ worktree: '/estate/a', rung: 'notified-1', status: 'sent' });
  });

  it('records unaskable without sending, when no Notify command is configured', async () => {
    const root = repo();
    const notifier: Notifier = { notify: async () => ({ ok: false, why: 'unaskable' }) };
    await notifyEscalations(notifyTick('/estate/a', 'notified-1'), root, async () => notifier, escalationMemory(), () => {}, () => {});
    expect(readEscalations(root)[0]).toMatchObject({ status: 'unaskable' });
  });

  it('records failed with the exit code on a broken command', async () => {
    const root = repo();
    const notifier: Notifier = { notify: async () => ({ ok: false, why: 'failed', code: 7 }) };
    await notifyEscalations(notifyTick('/estate/a', 'notified-1'), root, async () => notifier, escalationMemory(), () => {}, () => {});
    expect(readEscalations(root)[0]).toMatchObject({ status: 'failed 7' });
  });

  it('sends every notify write concurrently, so the slowest send bounds the pass', async () => {
    const root = repo();
    let inFlight = 0;
    let peak = 0;
    const notifier: Notifier = {
      notify: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return { ok: true };
      },
    };
    const report = notifyTick('/estate/a', 'notified-1');
    const writes = ['/estate/a', '/estate/b', '/estate/c'].map((worktree) => ({
      kind: 'notify' as const,
      worktree,
      askedAt: '2020-01-01T00:00:00.000Z',
      rung: 'notified-1' as const,
      message: worktree,
    }));
    await notifyEscalations(
      { ...report, decision: { ...report.decision, writes } },
      root,
      async () => notifier,
      escalationMemory(),
      () => {},
      () => {},
    );
    expect(peak).toBe(3);
    expect(readEscalations(root)).toHaveLength(3);
  });

  it('asks for the notifier only where the tick holds a notify write', async () => {
    const root = repo();
    let asked = 0;
    const report = notifyTick('/estate/a', 'notified-1');
    await notifyEscalations(
      { ...report, decision: { ...report.decision, writes: [] } },
      root,
      async () => {
        asked += 1;
        return { notify: async () => ({ ok: true }) };
      },
      escalationMemory(),
      () => {},
      () => {},
    );
    expect(asked).toBe(0);
  });

  it('holds a rung in memory and reports once where the record cannot be appended', async () => {
    const root = repo();
    // `.plot/state` IS A FILE, so `mkdirSync` and the append both throw.
    mkdirSync(join(root, '.plot'));
    writeFileSync(join(root, '.plot', 'state'), '');
    const memory = escalationMemory();
    const warned: string[] = [];
    const notifier: Notifier = { notify: async () => ({ ok: true }) };
    await notifyEscalations(notifyTick('/estate/a', 'notified-1'), root, async () => notifier, memory, () => {}, (s) => warned.push(s));
    await notifyEscalations(notifyTick('/estate/b', 'notified-1'), root, async () => notifier, memory, () => {}, (s) => warned.push(s));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/could not append/);
    const world = escalationWorldForRepo(root, '/nonexistent', memory);
    expect([...(await world.recordedRungs('/estate/a', '2020-01-01T00:00:00.000Z'))]).toEqual(['notified-1']);
  });

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
});

describe('startFreshAgents', () => {
  const desk = {
    path: '/estate/.worktrees/feature-x',
    branch: 'feature/x',
    isMain: false,
    prunable: false,
    registered: false,
    planNamed: true,
    plan: '2026-10-05-a-plan',
    dirtyCount: 0,
  };
  const report = (trees: readonly (typeof desk)[]) =>
    ({ incomplete: '', trees }) as unknown as Parameters<typeof startFreshAgents>[0];
  const spentDeskFile = (_worktree: string, name: string): string | null =>
    name === '.plot-worker.ending.json'
      ? JSON.stringify({ reason: 'corrections-spent', actor: 'agent', branch: 'feature/x', detail: '' })
      : null;

  const deps = (calls: string[]) => ({
    deskFile: spentDeskFile,
    record: { rowsFor: async () => ({ ok: true as const, value: [] }) },
    budget: 2,
    ports: {
      record: { append: async () => ({ ok: true as const, value: undefined }) },
      desk: { sealDeclaration: async () => ({ ok: true as const, value: undefined }) },
      now: () => new Date('2026-10-05T12:00:00.000Z'),
      start: async (input: { branch: string; beforeStart: () => Promise<boolean> }) => {
        calls.push(input.branch);
        return { kind: 'started' as const, pid: '9', previousPid: '', prompt: '', log: '' };
      },
    },
  });

  it('starts nothing and reads no desk where the tick named no candidate', async () => {
    const calls: string[] = [];
    const applied = await startFreshAgents(report([{ ...desk, registered: true }]), deps(calls), () => {}, () => {});
    expect(applied).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('starts a fresh session for a spent desk and reports it on the log', async () => {
    const calls: string[] = [];
    const out: string[] = [];
    const applied = await startFreshAgents(report([desk]), deps(calls), (s) => out.push(s), () => {});
    expect(calls).toEqual(['feature/x']);
    expect(applied.map((a) => a.outcome)).toEqual(['started']);
    expect(out.join('')).toContain('fresh-agent feature/x: started');
  });

  it('reports a refusal on the error stream', async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    const refusing = deps(calls);
    refusing.ports.start = async () =>
      ({ kind: 'refused', status: 409, reason: 'no-manifest', detail: 'no manifest names it' }) as never;
    await startFreshAgents(report([desk]), refusing, () => {}, (s) => errors.push(s));
    expect(errors.join('')).toContain('continue refused (no-manifest)');
  });

  it('reports a step that throws and does not rethrow', async () => {
    const errors: string[] = [];
    const broken = deps([]);
    broken.record = {
      rowsFor: async () => {
        throw new Error('the record exploded');
      },
    } as never;
    const applied = await startFreshAgents(report([desk]), broken, () => {}, (s) => errors.push(s));
    expect(applied).toEqual([]);
    expect(errors.join('')).toContain('the fresh-agent step failed: the record exploded');
  });

  it('treats a tick that carries no trees as having no candidates', async () => {
    const calls: string[] = [];
    const applied = await startFreshAgents(
      { incomplete: '' } as unknown as Parameters<typeof startFreshAgents>[0],
      deps(calls),
      () => {},
      () => {},
    );
    expect(applied).toEqual([]);
  });
});

describe('queueWorldForRepo — the refused reading', () => {
  it('reads the record the worker loop writes, under the common git dir', async () => {
    // THE WRITER RESOLVES `--git-common-dir`; a reader at the checkout's own
    // `.plot/state/` never sees the line, and the slice is handed out again.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'plot-refused-reader-')));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      mkdirSync(join(dir, '.git', '.plot', 'state'), { recursive: true });
      writeFileSync(join(dir, '.git', '.plot', 'state', 'refused-slices.tsv'), 'bug/held\n');
      const queue = queueWorldForRepo(dir, dir, { calls: 0 });
      expect(await queue.refused('bug/held')).toBe(true);
      expect(await queue.refused('bug/free')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks the refused-slice record it is given, by branch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-refused-reader-'));
    try {
      const queue = queueWorldForRepo(dir, dir, { calls: 0 }, undefined, undefined, refusedSlicesFixture(['bug/held']));
      expect(await queue.refused('bug/held')).toBe(true);
      expect(await queue.refused('bug/free')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
