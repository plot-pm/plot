import { describe, it, expect } from 'vitest';
import {
  FLEET_CONTROLS_DEFAULT,
  PlanMetaSchema, CardSchema, FleetBranchSchema, AgentRowSchema, AgentEntrySchema,
  FleetSchema, ServerInfoSchema,
  AgentStateSchema, WorkerActivitySchema,
} from '../../src/contract/schema';

describe('ServerInfoSchema — the branch the server serves', () => {
  it('carries the branch the server reported', () => {
    const info = ServerInfoSchema.parse({
      restartCommand: 'pnpm board', port: 7777, branch: 'feature/x',
    });
    expect(info.branch).toBe('feature/x');
  });

  it('defaults branch to "" for an older payload — absent is the same silence as detached', () => {
    // A page held open across a server upgrade gets a pulse with no `branch`
    // field. The honest default is empty, which the header renders as no
    // element — the SAME nothing a detached HEAD produces. Defaulting to a
    // placeholder like `unknown` would put a word on screen that reads as a
    // branch name.
    const info = ServerInfoSchema.parse({ restartCommand: '', port: 0 });
    expect(info.branch).toBe('');
  });
});

describe('AgentEntrySchema — liveness on the wire', () => {
  const base = {
    session: 'sess', branch: 'feature/x', worktree: '/wt',
    command: 'claude -p "go"', startedAt: '2026-08-22T10:00:00Z',
  };

  it('carries the pid and the pulse-refreshed state', () => {
    const e = AgentEntrySchema.parse({ ...base, pid: '4242', state: 'running' });
    expect(e.pid).toBe('4242');
    expect(e.state).toBe('running');
  });

  it('accepts each of the five states', () => {
    for (const state of ['running', 'finished', 'waiting', 'stalled', 'unknown']) {
      expect(AgentEntrySchema.parse({ ...base, state }).state).toBe(state);
    }
  });

  it('defaults pid to "" and state to "unknown" for an older payload', () => {
    // A reader may have the board's page open across a server upgrade. A pulse
    // from before these fields existed must still validate rather than blank the
    // page — and the honest default for a fact the old server never sent is
    // "no pid" and "cannot say".
    const e = AgentEntrySchema.parse(base);
    expect(e.pid).toBe('');
    expect(e.state).toBe('unknown');
  });

  it('rejects a state outside the five', () => {
    expect(() => AgentEntrySchema.parse({ ...base, state: 'ended' })).toThrow();
  });

  it('defaults session to "" — a synthesized worktree has no launch id', () => {
    // A worktree with no manifest is listed, but the session id is minted at
    // launch and it never had one. `session` was the one required field; a
    // synthesized entry needs it to default to the same "empty is real" value
    // `branch` already carries, or the schema would reject the very entry the
    // registry synthesizes to make the section truthful.
    const e = AgentEntrySchema.parse({ branch: 'feature/x', worktree: '/wt' });
    expect(e.session).toBe('');
  });

  it('carries previousPid and relaunches when a run was relaunched in place', () => {
    // A relaunch overwrites `pid` and records what it displaced: `previousPid`
    // is the corpse the row used to name, and `relaunches` is how many times
    // this worktree has been restarted — a branch restarted three times is
    // struggling, and nothing else on the board can say so.
    const e = AgentEntrySchema.parse({
      ...base, pid: '999', previousPid: '424242', relaunches: 3,
    });
    expect(e.previousPid).toBe('424242');
    expect(e.relaunches).toBe(3);
  });

  it('defaults previousPid to "" and relaunches to 0 — a first dispatch records neither', () => {
    // A manifest from a first dispatch (or an older server) carries neither
    // field. The honest default is "nothing was displaced" and "restarted zero
    // times", so an unrelaunched entry reads exactly as it did before.
    const e = AgentEntrySchema.parse(base);
    expect(e.previousPid).toBe('');
    expect(e.relaunches).toBe(0);
  });
});

describe('PlanMetaSchema — waves', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('accepts the waves array emitted by plot-plan-meta.sh', () => {
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [
        { name: 'Tracer', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Implementation',
          branches: [{ branch: 'feature/b', deferred: true, claimed: '2026-08-14T10:22Z, s-3' }],
        },
      ],
    });
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.waves[0].name).toBe('Tracer');
    expect(parsed.waves[1].branches[0].deferred).toBe(true);
    expect(parsed.waves[1].branches[0].claimed).toBe('2026-08-14T10:22Z, s-3');
  });

  it('defaults waves to empty so pre-wave helper output still validates', () => {
    // The board must keep working against an older plot-plan-meta.sh that
    // emits no waves field at all.
    const parsed = PlanMetaSchema.parse({ ...base, branches: ['feature/a'] });
    expect(parsed.waves).toEqual([]);
  });

  it('keeps the flat branches list as the whole set, independent of waves', () => {
    // waves[] groups; branches[] remains the complete, sorted set that existing
    // consumers read. One must never be derived from the other at this layer.
    const parsed = PlanMetaSchema.parse({
      ...base,
      branches: ['feature/a', 'feature/b'],
      waves: [{ name: '', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(parsed.branches).toEqual(['feature/a', 'feature/b']);
  });
});

describe('PlanMetaSchema — the ceremony fields the board carries', () => {
  const base = { file: 'docs/plans/x.md', format: 'canonical', phase: 'approved' };

  it('carries `review`, whose one use is the `open`/`draft` split', () => {
    // `review` is read exactly once, by `planStatus`: `review === 'pr'` is the
    // channel that leaves a plan PR to observe. It reaches a reader — Done-when
    // 2's first branch — and that single internal use is the whole of its
    // contract. Nothing renders the word.
    expect(PlanMetaSchema.parse({ ...base, review: 'pr' }).review).toBe('pr');
    expect(PlanMetaSchema.parse({ ...base, review: 'in-session' }).review).toBe('in-session');
    // Defaulted so a pre-Plot-2 plan (no ceremony fields) still validates.
    expect(PlanMetaSchema.parse(base).review).toBe('NONE');
  });

  it('does NOT carry `impl` — a field declared and read nowhere is removed', () => {
    // The defect this wave settles. `plot-plan-meta.sh` still emits `impl`, but
    // the board read it nowhere, so it left `PlanMetaSchema` on 2026-08-26
    // rather than sit declared and unread — the very thing PR #452 warns board
    // adopters about. Zod strips the key the parser sends; the typed object has
    // no `impl` property. This test is the gate that keeps it gone: re-adding
    // the field to the schema without a consumer turns it green again.
    const parsed = PlanMetaSchema.parse({ ...base, impl: 'own-branches' }) as Record<string, unknown>;
    expect(parsed.impl).toBeUndefined();
    expect('impl' in parsed).toBe(false);
  });
});

describe('WaveSummarySchema — plan shape and git occupancy, kept apart', () => {
  const base = {
    slug: 'x', title: 'X', type: 'feature', phase: 'Development', path: 'docs/plans/x.md',
  } as const;

  it('is carried on the card as an optional field', () => {
    // Optional: pre-wave plans and older helper output must still produce a
    // valid card.
    const card = CardSchema.parse({
      ...base,
      waveSummary: { waves: 2, branches: 3, claimed: 1, eligible: 2, deferred: 0 },
    });
    expect(card.waveSummary?.claimed).toBe(1);
    expect(card.waveSummary?.eligible).toBe(2);
    const bare = CardSchema.parse({
      slug: 'y', title: 'Y', type: 'docs', phase: 'Design', path: 'docs/plans/y.md',
    });
    expect(bare.waveSummary).toBeUndefined();
  });

  it('accepts a summary with NO occupancy counts — absent is not zero', () => {
    // The contract's load-bearing case. A card built before the fleet scan
    // landed knows the plan's shape and knows nothing about claims; it must be
    // able to say so. Defaulting these to 0 at the boundary would re-create the
    // exact confusion this schema was changed to remove — a card asserting
    // "nobody is working on this" when it has not looked.
    const card = CardSchema.parse({
      ...base, waveSummary: { waves: 1, branches: 2, deferred: 0 },
    });
    expect(card.waveSummary?.claimed).toBeUndefined();
    expect(card.waveSummary?.eligible).toBeUndefined();
    // Shape survives without git: these come from the plan file and stay true
    // when the scan cannot run at all.
    expect(card.waveSummary?.branches).toBe(2);
  });
});

describe('CardSchema — pull requests', () => {
  const base = { slug: 'x', title: 'X', type: 'feature', path: 'docs/plans/x.md' };

  it('carries each PR as a number plus the host-supplied url', () => {
    const card = CardSchema.parse({
      ...base, phase: 'Testing',
      prs: [{ number: 113, url: 'https://example.test/pr/113' }],
    });
    expect(card.prs).toEqual([{ number: 113, url: 'https://example.test/pr/113' }]);
  });

  it('accepts a PR with no url — the board renders no link rather than guessing', () => {
    // The host adapter is the only thing that knows a PR's address. Where it
    // reports none (older CLI, PR data not fetched yet), the number stands
    // alone. A URL composed here would be wrong on GitHub Enterprise and on
    // every self-hosted Bitbucket.
    const card = CardSchema.parse({ ...base, phase: 'Development', prs: [{ number: 9 }] });
    expect(card.prs[0]).toEqual({ number: 9, url: '' });
  });

  it('defaults to no PRs, so a plan that names none is not a degraded card', () => {
    const card = CardSchema.parse({ ...base, phase: 'Design' });
    expect(card.prs).toEqual([]);
  });
});

describe('FleetBranchSchema — the worker', () => {
  const base = { branch: 'feature/x', state: 'claimed', deferred: false, claimed: '' };

  it('defaults an absent worker to `elsewhere` — could not look, not "nobody"', () => {
    // A pulse from a scan predating the field must still validate, and the
    // default has to be the value that licenses no claim about a worker either
    // way. `elsewhere` says *this machine has nowhere to look*, which is exactly
    // what a scan that reports nothing means. Defaulting to `none` would assert
    // a local absence the scan never observed.
    const b = FleetBranchSchema.parse(base);
    expect(b.worker).toBe('elsewhere');
    expect(b.worker_pid).toBe('');
    expect(b.worker_exit).toBe('');
    // Empty rather than absent: one absent-value shape for every consumer, and
    // nothing on the floor is exactly what a scan that could not look reports.
    expect(b.worker_dirty_paths).toEqual([]);
    // The activity cue defaults to "" for the same reason: a pulse that predates
    // the field made no CPU measurement, and "" is *no cue*, never a false idle.
    expect(b.worker_activity).toBe('');
  });

  it('carries the running-worker activity cue — `working` or `idle`', () => {
    // The secondary cue beside `worker: 'running'`. It says WHICH kind of
    // running — a child mid-work versus one whose clock is frozen — and the
    // schema carries both plus the "" that means *not measured*.
    for (const a of ['working', 'idle', ''] as const) {
      expect(FleetBranchSchema.parse({ ...base, worker_activity: a }).worker_activity).toBe(a);
    }
  });

  it('keeps the cue a cue — `idle` is NOT a sixth agent state', () => {
    // ITEM 6 OF THE PLAN, stated against the cue directly. The naive fix adds
    // `idle` as a sixth `AgentStateSchema` member; that would satisfy the
    // render test and quietly change what `isLiveState`/`isBrokenState`
    // classify. So this pins the enum at five AND asserts `idle` is not among
    // them — the cue lives in its own `WorkerActivitySchema`, an attribute of
    // `running`, never a peer state.
    expect(AgentStateSchema.options).toHaveLength(5);
    expect(AgentStateSchema.options).not.toContain('idle');
    expect(WorkerActivitySchema.options).toEqual(['working', 'idle', '']);
  });

  it('keeps all eight values, so no two of them can collapse', () => {
    // SIX PROCESS STATES AND TWO TASK STATES, and every pair that could be
    // folded together names a different next move. `failed` and `finished` are
    // *restart it* and *review it*; `waiting` and `stalled` are *answer it* and
    // *resume it*. One label over any pair sends the reader to a log to find
    // out which — the thing this enum exists to prevent.
    for (const w of ['running', 'finished', 'waiting', 'stalled',
                     'failed', 'ended', 'none', 'elsewhere']) {
      expect(FleetBranchSchema.parse({ ...base, worker: w }).worker).toBe(w);
    }
  });

  it('carries what a `stalled` worker left on the floor, by name', () => {
    // NAMES, NOT A COUNT. The row exists so a person can decide whether to
    // resume the branch, and "3 uncommitted files" does not support that
    // decision: three scratch notes and three half-finished modules read
    // identically.
    const b = FleetBranchSchema.parse({
      ...base, worker: 'stalled',
      worker_dirty_paths: ['src/feature.ts', 'test/feature.test.ts'],
    });
    expect(b.worker_dirty_paths).toEqual(['src/feature.ts', 'test/feature.test.ts']);
  });

  it('carries the pid as a STRING — an identifier to show, never arithmetic', () => {
    // And "" is the honest rendering of "no pid was recorded", which a number
    // has no room for: 0 is a real-looking pid, and `kill -0 0` succeeds.
    expect(FleetBranchSchema.parse({ ...base, worker_pid: '4242' }).worker_pid).toBe('4242');
  });
});

describe('AgentRowSchema.pr', () => {
  const row = (pr: unknown) => AgentRowSchema.parse({
    repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'One', state: 'wip',
    group: 'waiting-on-you', ageMinutes: 3, note: 'n', pr,
  });

  it('carries the PR condition as fields, not only as a number and a url', () => {
    const parsed = row({
      number: 42, url: 'https://host/pr/42', draft: true, state: 'conflicts',
    });
    expect(parsed.pr).toEqual({
      number: 42, url: 'https://host/pr/42', draft: true, state: 'conflicts',
      // Absent in the input, so `[]` — the older-pulse default. Empty is not a
      // seventh meaning: a consumer that finds it empty falls back to `state`.
      states: [],
    });
  });

  it('defaults an older pulse to unknown rather than to clean', () => {
    // A payload written before the field existed cannot claim a state. Absent
    // is not green, and it is not "not a draft that passes" either — `unknown`
    // is the honest reading, the same one Bitbucket gets.
    const parsed = row({ number: 42, url: '' });
    expect(parsed.pr!.state).toBe('unknown');
    expect(parsed.pr!.draft).toBe(false);
  });

  it('rejects a state outside the six', () => {
    // The enum is the contract. A seventh value — `draft`, most temptingly —
    // would rebuild the short-circuit that kept WAITING ON A MACHINE empty.
    expect(() => row({ number: 42, url: '', state: 'draft' })).toThrow();
    expect(() => row({ number: 42, url: '', state: 'merged' })).toThrow();
  });

  it('accepts each of the six states', () => {
    for (const s of ['green', 'pending', 'failing', 'none', 'conflicts', 'unknown']) {
      expect(row({ number: 1, url: '', state: s }).pr!.state).toBe(s);
    }
  });
});

describe('rounds — absent is not zero, on both sides of the contract', () => {
  const meta = { file: 'docs/plans/x.md', format: 'canonical', phase: 'draft' };
  const card = {
    slug: 'x', title: 'X', type: 'feature', phase: 'Discovery', path: 'docs/plans/x.md',
  } as const;

  it('carries a round the helper reported', () => {
    expect(PlanMetaSchema.parse({ ...meta, rounds: 2 }).rounds).toBe(2);
    expect(CardSchema.parse({ ...card, rounds: 2 }).rounds).toBe(2);
  });

  it('leaves rounds undefined when the helper omitted it — never 0', () => {
    // The distinction this field exists for. `plot-plan-meta.sh` omits the key
    // for a plan with no metadata block; a `.default(0)` here would silently
    // convert "nobody has looked" into "interrogated and found nothing", which
    // are opposite statements about the plan.
    expect(PlanMetaSchema.parse(meta).rounds).toBeUndefined();
    expect(CardSchema.parse(card).rounds).toBeUndefined();
  });

  it('keeps a recorded 0 distinguishable from an absent one', () => {
    // Both are legitimate and they are not the same answer: a block reporting
    // 0 means the skill ran, an absent key means it never did.
    expect(PlanMetaSchema.parse({ ...meta, rounds: 0 }).rounds).toBe(0);
    expect(CardSchema.parse({ ...card, rounds: 0 }).rounds).toBe(0);
  });
});

describe('FleetSchema — the two shared fleet controls', () => {
  // The minimum a Fleet needs, so the `fleetControls` field is what varies.
  const base = {
    generatedAt: '2026-08-22T00:00:00.000Z',
    ageSeconds: 1,
    ready: true,
    error: null,
    rows: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    prAgeSeconds: null,
    prError: null,
  } as const;

  it('carries the switch and the cap the server emitted', () => {
    const fleet = FleetSchema.parse({ ...base, fleetControls: { autoDispatch: true, parallelAgents: 5 } });
    expect(fleet.fleetControls.autoDispatch).toBe(true);
    expect(fleet.fleetControls.parallelAgents).toBe(5);
  });

  it('defaults to switch off / cap 3 for a payload predating this wave', () => {
    // The safe direction: a server that never heard of the controls reads as a
    // fleet that is NOT serving its queue, since wave 3 acts only while the
    // switch is on. Note the client CASTS this payload rather than parsing it,
    // so the server emitting the field unconditionally was the whole safety
    // argument — and it was not enough. A STUBBED payload never reaches the
    // server at all, and 278 tests took a TypeError on 2026-08-22 proving it.
    // The client now reads through `FLEET_CONTROLS_DEFAULT` as well; this
    // default is the contract's honesty AND the client's fallback.
    const fleet = FleetSchema.parse(base);
    expect(fleet.fleetControls.autoDispatch).toBe(false);
    expect(fleet.fleetControls.parallelAgents).toBe(3);
  });
});

/**
 * THE DEFAULT IS EXPORTED BECAUSE THE CLIENT CANNOT PARSE.
 *
 * `fleetControls` arrived as a required field with a Zod `.default()`, which
 * runs where the payload is PARSED — the server. `packages/board/src/app`
 * CASTS the fleet it fetches, so the default never ran there and
 * `fleet.fleetControls.autoDispatch` threw a TypeError on any payload written
 * before the field existed: a stubbed fixture, a cached response, a board
 * mid-upgrade.
 *
 * That took the whole Agents tab down rather than one control. Measured
 * 2026-08-22: 278 tests failed across 18 files, each waiting the full 10s for a
 * section a TypeError had prevented from rendering — 3073s, and in CI a
 * 15-minute step timeout that read as "the suite is too slow". It was one
 * missing default.
 *
 * These assert the two halves of the fix separately, because each passes
 * without the other: the constant EXISTS with the safe values, and the schema
 * USES it rather than repeating the literal.
 */
describe('FLEET_CONTROLS_DEFAULT — one default, read by both sides', () => {
  it('is off and 3: a fleet that dispatches nothing is the safe reading of silence', () => {
    // Not merely "some object": the VALUES are the claim. A default that
    // dispatched would turn an old payload into a running fleet.
    expect(FLEET_CONTROLS_DEFAULT).toEqual({ autoDispatch: false, parallelAgents: 3 });
  });

  it('is what the schema falls back to, so the two cannot drift', () => {
    // Parsing a payload with no `fleetControls` must produce exactly the
    // constant the client reads. A second literal in the schema would pass
    // every other test here and still let the two answers diverge.
    const parsed = FleetSchema.parse({
      generatedAt: '2026-08-22T00:00:00.000Z', ageSeconds: 1, ready: true, error: null,
      rows: [], summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(parsed.fleetControls).toEqual(FLEET_CONTROLS_DEFAULT);
  });
});
