import { describe, it, expect } from 'vitest';
import { classify, machineProcesses, rowsFromPulse } from '../../src/server/fleet.js';
import { inMachineSection, machineNote, GROUPS } from '../../src/app/components/AgentList.js';
import {
  AgentRowSchema, type AgentRow, type FleetPulse,
} from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// WAITING ON A MACHINE IS KEYED ON THE PROCESS, NEVER ON THE HOLDER.
//
// The section was filled from exactly one source — `pr.checks === 'pending'` on
// the git host — so it described a HOST fact only, while the board sat in the
// very repository a local run was happening in. Two measured cases fell through
// a rule keyed on who HOLDS the branch:
//
//   exit 0, branch pushed, PR open, checks pending, no worker alive
//     -> listed NOWHERE under a holder rule: no agent held it, and its checks
//        had not landed.
//
//   one live worker, PR open, checks pending
//     -> BOTH sections are true, and one `group` must pick one and be wrong
//        about the other.
//
// The fix is that the row stops being the entity: WORKING lists AGENTS and
// WAITING ON A MACHINE lists PROCESSES, and the same branch may appear in both
// because the entities differ. These tests assert the pair in both directions —
// the positives are what the change adds, and the negatives are the half a naive
// implementation gets wrong.

const QUIET = 30;

const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
  number: 244,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  mergeable: 'mergeable',
  failing_checks: [],
  ...over,
} as PrRecord);

const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-17-a-plan.md',
  wave: 'w', state: 'wip', group: 'quiet', ageMinutes: 10, note: '',
  ...over,
});

describe('a local run is a machine working', () => {
  it('lists a running worker as a LOCAL process', () => {
    // THE assertion this branch exists for. A worker process in a worktree is a
    // machine working in this very checkout, and until now the section could not
    // show it: its one source was the host.
    const procs = machineProcesses('running', '20145', null);
    expect(procs).toHaveLength(1);
    expect(procs[0].origin).toBe('local');
    expect(procs[0].pid).toBe('20145');
  });

  it('reports the observation and never a forecast', () => {
    // Nothing measures when a local run ends, so nothing may name one. The
    // sentence says what was SEEN; a remaining time would be the countdown
    // nobody can honour that this repo removes rather than adds.
    const local = machineProcesses('running', '20145', null)[0].evidence;
    expect(local).toContain('is running');
    expect(local).toContain('20145');
    // No forecast, in any of the shapes one arrives in. Asserting the positive
    // alone would pass against a sentence that also promised a finish time.
    for (const forecast of ['will finish', 'remaining', 'minutes left', 'ETA', 'in about']) {
      expect(local).not.toContain(forecast);
    }
    const host = machineProcesses('elsewhere', '', pr({ checks: 'pending' }))[0].evidence;
    expect(host).toContain('CI is running');
    for (const forecast of ['will finish', 'remaining', 'minutes left', 'ETA', 'in about']) {
      expect(host).not.toContain(forecast);
    }
  });

  it('names the pid so a reader can go look rather than take its word', () => {
    // The row's standing rule for a worker fact: report the evidence, not a
    // verdict about it. A pid is how *is this really running* gets answered.
    expect(machineProcesses('running', '20145', null)[0].evidence).toContain('pid 20145');
    // AND SAYS SO WITHOUT ONE. `plot-dispatch` writes a pid only where it
    // started the worker itself, so a `running` verdict can arrive without one
    // — printing `pid ` with nothing after it would read as a pid of zero.
    const noPid = machineProcesses('running', '', null)[0];
    expect(noPid.evidence).not.toContain('pid');
    expect(noPid.pid).toBe('');
  });

  it('claims no process for the seven states that are not one', () => {
    // The negatives, and they are most of the field's meaning. `finished`,
    // `failed` and `ended` are STOPPED; `waiting` and `stalled` describe a task
    // rather than a running program; `none` and `elsewhere` are stated unknowns
    // — `plot-dispatch` writes a pid only where it started the worker, so an
    // absent record licenses no claim either way. Listing any of them would put
    // *a machine is working* under a branch where none is.
    for (const state of
      ['finished', 'failed', 'ended', 'waiting', 'stalled', 'none', 'elsewhere'] as const) {
      expect(machineProcesses(state, '20145', null)).toEqual([]);
    }
  });

  it('reads a conflicting PR through prState rather than through checks', () => {
    // GitHub starts no workflow for a branch that does not merge, so a
    // conflicting PR reports an EMPTY rollup. Reading `pr.checks` directly would
    // call it `none` here and agree with nothing; `prState` is the one
    // derivation, shared with the classifier, so the entry and the row's own
    // sentence cannot disagree.
    expect(machineProcesses('elsewhere', '', pr({ checks: 'none', mergeable: 'conflicting' })))
      .toEqual([]);
    // And the ordinary pending case still lands.
    expect(machineProcesses('elsewhere', '', pr({ checks: 'pending' }))).toHaveLength(1);
  });

  it('lists both machines when both are working, local first', () => {
    // Two machines, two next moves: `ps` here, a run page there. Dropping either
    // because the other outranks it is the displacement this board keeps
    // undoing. Local leads because it is the one a reader can act on from where
    // they are sitting.
    const procs = machineProcesses('running', '20145', pr({ checks: 'pending' }));
    expect(procs.map((p) => p.origin)).toEqual(['local', 'host']);
  });
});

describe('the section lists processes, and the row lists agents', () => {
  it('puts a row with a local process in WAITING ON A MACHINE', () => {
    // A live worker's own row belongs in WORKING — it is an agent — and its
    // PROCESS belongs here. The section reaches it through `processes`, not
    // through `group`, which is what lets both be true at once.
    const r = row({
      group: 'working',
      processes: [{ origin: 'local', evidence: 'a worker process is running', pid: '20145' }],
    });
    expect(inMachineSection(r)).toBe(true);
  });

  it('leaves a HOST-side pending check landing there exactly as before', () => {
    // This change WIDENS the section; it replaces nothing. A row whose `group`
    // is `waiting-on-machine` reaches it whether or not any process is listed —
    // the first clause of the predicate is the old rule verbatim, so a pulse
    // from a scan predating `processes` renders unchanged.
    expect(inMachineSection(row({ group: 'waiting-on-machine', processes: [] }))).toBe(true);
  });

  it('keeps every other row out of it', () => {
    // The negative, and it is what stops the section becoming a second copy of
    // the board. A row with no process and a group of its own is listed once.
    for (const group of ['waiting-on-you', 'working', 'quiet', 'not-started', 'done'] as const) {
      expect(inMachineSection(row({ group, processes: [] }))).toBe(false);
    }
  });

  it('says what the PROCESS is doing, not what its agent is', () => {
    // THE WHOLE DEFENCE OF LISTING A BRANCH TWICE. A live worker's `note` is
    // *worker running (pid 20145)* — a true statement about an AGENT, and the
    // WORKING row already makes it. Repeating it here would put one line in two
    // sections and prove the duplication complaint right.
    const r = row({
      group: 'working',
      note: 'worker running (pid 20145)',
      processes: [{
        origin: 'local',
        evidence: 'a worker process is running in a local worktree (pid 20145)',
        pid: '20145',
      }],
    });
    expect(machineNote(r)).toBe('a worker process is running in a local worktree (pid 20145)');
    expect(machineNote(r)).not.toBe(r.note);
  });

  it('joins two processes rather than ranking them', () => {
    const r = row({
      processes: [
        { origin: 'local', evidence: 'a worker process is running', pid: '20145' },
        { origin: 'host', evidence: 'CI is running for PR #244', pid: '' },
      ],
    });
    expect(machineNote(r)).toContain('a worker process is running');
    expect(machineNote(r)).toContain('CI is running for PR #244');
  });

  it('falls back to the row note where no process was reported', () => {
    // A `pending` check from a pulse that predates `processes` reaches the
    // section through `group` with an empty list. Its note already reads *PR
    // #244, CI running* — this sentence by the other road — so the fallback
    // changes nothing that renders and keeps an older payload from going blank.
    const r = row({ group: 'waiting-on-machine', note: 'PR #244, CI running', processes: [] });
    expect(machineNote(r)).toBe('PR #244, CI running');
  });

  it('withdraws the forecast from the section hint', () => {
    // The empty-section hint said *CI will finish* — a prediction of an outcome
    // nothing here measures, and a claim about the one source the section used
    // to have. The section lists processes now, and CI is one kind.
    const machine = GROUPS.find((g) => g.key === 'waiting-on-machine')!;
    expect(machine.hint).not.toContain('will finish');
    expect(machine.hint).toContain('a machine is working');
  });
});

describe('the two entities, on the rows a pulse produces', () => {
  /**
   * One plan, one wave, one branch — shaped per case.
   *
   * `phase: 'approved'` throughout: a terminal phase outranks everything the
   * `open` arm could say, and this suite is about branches that exist.
   */
  const pulseWith = (branch: Record<string, unknown>): FleetPulse => ({
    generated: new Date().toISOString(),
    root: '/repo',
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-17-working-shows-the-agent.md',
      phase: 'approved',
      waves: [{ name: 'Machine', verdict: 'eligible', branches: [branch] }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
  } as never);

  const rowFor = (branch: Record<string, unknown>, prs?: Map<string, PrRecord>): AgentRow => {
    const pulse = pulseWith(branch);
    const ages = new Map<string, number | null>([[branch.branch as string, 1]]);
    return rowsFromPulse(pulse, ages, 'plot', QUIET, prs as never)
      .find((r) => r.branch === branch.branch)!;
  };

  it('an agent watching its own CI appears in BOTH sections', () => {
    // Measured 2026-08-18, and the case a one-row rule must file in one section
    // while both are true. A pending check must never EVICT a live agent from
    // WORKING — the entities differ, and were only ever one row.
    const r = rowFor(
      { branch: 'feature/watched', state: 'wip', deferred: false, claimed: '',
        worker: 'running', worker_pid: '20145' },
      new Map([['feature/watched', pr({ head: 'feature/watched', checks: 'pending' })]]),
    );
    // The AGENT entry: still in WORKING, unevicted.
    expect(r.group).toBe('working');
    // The PROCESS entries: its own run, and the host's.
    expect(r.processes.map((p) => p.origin)).toEqual(['local', 'host']);
    // So the section holds it too — two entries, one branch, two questions.
    expect(inMachineSection(r)).toBe(true);
    // AND EACH NAMES ITS BRANCH, so two lines never read as one repeated.
    expect(r.branch).toBe('feature/watched');
  });

  it('a branch whose agent exited while its checks run is not homeless', () => {
    // Measured while merging `bug/one-worker-state-not-two`: exit 0, branch
    // pushed, PR open, CI still running. Not WORKING — no agent held it — and
    // not WAITING ON YOU, because the checks had not landed.
    const r = rowFor(
      { branch: 'feature/exited', state: 'wip', deferred: false, claimed: '',
        worker: 'finished', worker_exit: '0' },
      new Map([['feature/exited', pr({ head: 'feature/exited', checks: 'pending' })]]),
    );
    expect(r.group).toBe('waiting-on-machine');
    expect(inMachineSection(r)).toBe(true);
    // ITS PROCESS IS THE HOST'S AND ONLY THE HOST'S. The agent is gone, so no
    // local entry may be claimed — the row must not imply a worker still runs
    // here.
    expect(r.processes.map((p) => p.origin)).toEqual(['host']);
  });

  it('a live worker with no CI is an agent and a local process', () => {
    // The case the section's own name always described and could never show: a
    // machine working in this checkout, with nothing pending on the host.
    const r = rowFor({
      branch: 'feature/local-only', state: 'wip', deferred: false, claimed: '',
      worker: 'running', worker_pid: '31337',
    });
    expect(r.group).toBe('working');
    expect(r.processes.map((p) => p.origin)).toEqual(['local']);
    expect(inMachineSection(r)).toBe(true);
  });

  it('a stopped worker with no PR claims no machine at all', () => {
    // The negative that keeps the section honest. A `finished` worker and no
    // check is nothing running anywhere, and the row belongs to a person.
    const r = rowFor({
      branch: 'feature/done-nothing-pending', state: 'wip', deferred: false, claimed: '',
      worker: 'finished', worker_exit: '0',
    });
    expect(r.processes).toEqual([]);
    expect(inMachineSection(r)).toBe(false);
  });

  it('claims no local process for a branch no worktree was read for', () => {
    // A PLANLESS row is built from the PR map, so the worktree scan never
    // visited it — `worker: 'elsewhere'` says exactly that. Its host check still
    // belongs in the section; a local entry would be an observation this machine
    // never made, the same rule `localDirty: false` follows one entity along.
    const rows = rowsFromPulse(
      pulseWith({ branch: 'feature/planned', state: 'wip', deferred: false, claimed: '',
        worker: 'none' }),
      new Map([['feature/planned', 1]]),
      'plot', QUIET,
      new Map([['bug/loose', pr({ head: 'bug/loose', checks: 'pending' })]]) as never,
    );
    const loose = rows.find((x) => x.branch === 'bug/loose')!;
    expect(loose.worker).toBe('elsewhere');
    expect(loose.processes.map((p) => p.origin)).toEqual(['host']);
  });

  it('leaves the classifier answering one placement, as its contract says', () => {
    // `classify` still returns a single group, and this change did not widen it.
    // The second entity travels on the ROW, beside the placement — folding
    // process liveness into `group` is what made the both-sections case a coin
    // toss, and re-folding it later would rebuild that.
    const r = classify('wip', 'eligible', 5, QUIET, pr({ checks: 'pending' }),
      false, 0, 'approved', 'running', null, 7);
    expect(r.group).toBe('working');
    expect(Object.keys(r).sort()).toEqual(['group', 'note', 'verdict']);
  });
});

describe('a payload with no processes field at all', () => {
  // THE CLIENT IS SERVED BY A SERVER IT DOES NOT VERSION WITH. The page is a
  // built artifact a reader may have open across a restart, and `/api/fleet`
  // answers from whichever server is running — so a row can arrive without the
  // field even though the schema defaults it to `[]`: the default applies where
  // the payload is PARSED, and the client renders what it was handed.
  //
  // Reading `.length` off an absent array takes the WHOLE BOARD down, which is a
  // far worse answer to a missing convenience field than an empty list is.
  const legacy = { group: 'working', note: 'worker running (pid 1)' } as unknown as AgentRow;

  it('does not crash the section predicate', () => {
    expect(inMachineSection(legacy)).toBe(false);
  });

  it('falls back to the row note, exactly as the board read before the field', () => {
    expect(machineNote(legacy)).toBe('worker running (pid 1)');
  });

  it('still admits a host-side pending check through the group', () => {
    const pending = { group: 'waiting-on-machine', note: 'PR #9, CI running' } as unknown as AgentRow;
    expect(inMachineSection(pending)).toBe(true);
    expect(machineNote(pending)).toBe('PR #9, CI running');
  });
});
