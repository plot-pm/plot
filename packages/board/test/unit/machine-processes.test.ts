import { describe, it, expect } from 'vitest';
import { classify, machineProcesses, rowsFromPulse } from '../../src/server/fleet.js';
import { inMachineSection, machineNote, GROUPS } from '../../src/app/components/AgentList.js';
import {
  AgentRowSchema, WorkerStateSchema, type AgentRow, type FleetPulse,
} from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// AN AGENT IS THE MACHINE. IT IS NEVER THE THING YOU WAIT ON.
//
// WAITING ON A MACHINE answers *what am I waiting on?* — a build, a pipeline,
// something automated that nobody can hurry. An agent is not an answer to that:
// it is the thing doing the work, and WORKING says so while also saying *who*.
//
// The section admitted agents from 2026-08-18 to 2026-08-20, through two halves
// that this suite now asserts the absence of:
//
//   `machineProcesses` pushed an `origin: 'local'` entry for every `running`
//   worker, and `inMachineSection` admitted any row carrying a process at all.
//
// It was written for *"an agent watching its own CI"*, listed twice — once as an
// agent, once as a process. The sections do list different things, which is why
// the conclusion does not follow: that case is TWO SUBJECTS, NOT ONE SUBJECT
// TWICE. The agent belongs in WORKING; the PR whose checks are running belongs
// here and arrives on its own through `group`. Two rows, two subjects, each once.
//
// What the rule actually keyed on was a MECHANISM — *a process is running* — when
// the intent was a SITUATION. An agent is always a process, so it fired for every
// live worker. Measured on the live board 2026-08-20:
// `bug/one-component-renders-every-row` rendered in WORKING *and* in WAITING ON A
// MACHINE, five minutes apart on one screen, with **`pr: None`** — no CI, no
// check, nothing automated in sight.
//
// THE NEGATIVES ARE THE POINT OF THIS SUITE. `no worker state reaches the machine
// section` is asserted over the WHOLE `WorkerState` enum rather than over the two
// states that happen to occur today — that is what makes this a rule instead of a
// patch, and what fails if a ninth state is added without thinking about it.

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

describe('an agent is the machine, never the wait', () => {
  it('claims no process for a RUNNING worker — the entry this branch removed', () => {
    // THE assertion this branch exists for, and the exact inverse of what stood
    // here before. A live worker is an agent; WORKING names it, and names it
    // better because it says *who*. Nothing automated is pending, so there is
    // nothing to wait on.
    expect(machineProcesses('running', '20145', null)).toEqual([]);
  });

  it('claims no process for ANY worker state, over the whole enum', () => {
    // THE RULE, not the patch. Asserted over `WorkerStateSchema.options` rather
    // than over a hand-written list, so a ninth state cannot be added without
    // this failing — the two states that happen to occur today are not the
    // claim. A worker is never a machine you wait on, whatever it is doing.
    for (const state of WorkerStateSchema.options) {
      expect(machineProcesses(state, '20145', null)).toEqual([]);
      expect(machineProcesses(state, '', null)).toEqual([]);
    }
    // And eight is the enum's size — if it grows, the loop above covers the new
    // one, and this says so rather than letting a silent widening pass.
    expect(WorkerStateSchema.options).toHaveLength(8);
  });

  it('leaves the HOST entry untouched, whatever the worker is doing', () => {
    // The half that stays, and the one the section always had. `pending` on the
    // host is a machine working — a reader cannot act, and must wait out a run
    // page. The worker argument has no bearing on it in either direction.
    for (const state of WorkerStateSchema.options) {
      const procs = machineProcesses(state, '20145', pr({ checks: 'pending' }));
      expect(procs.map((p) => p.origin)).toEqual(['host']);
      expect(procs[0].evidence).toBe('CI is running for PR #244');
    }
  });

  it('reports the observation and never a forecast', () => {
    // GitHub publishes no finish time for a queued check, so none is named. A
    // countdown nobody can honour is the shape this repo removes rather than
    // adds. Asserting the positive alone would pass against a sentence that also
    // promised one, so each shape a forecast arrives in is named.
    const host = machineProcesses('elsewhere', '', pr({ checks: 'pending' }))[0].evidence;
    expect(host).toContain('CI is running');
    for (const forecast of ['will finish', 'remaining', 'minutes left', 'ETA', 'in about']) {
      expect(host).not.toContain(forecast);
    }
  });

  it('reads a conflicting PR through prState rather than through checks', () => {
    // Unchanged by this branch, and load-bearing. GitHub starts no workflow for
    // a branch that does not merge, so a conflicting PR reports an EMPTY rollup.
    // Reading `pr.checks` directly would call it `none` here; `prState` is the
    // one derivation, shared with the classifier, so the entry and the row's own
    // sentence cannot disagree.
    expect(machineProcesses('elsewhere', '', pr({ checks: 'none', mergeable: 'conflicting' })))
      .toEqual([]);
    expect(machineProcesses('elsewhere', '', pr({ checks: 'pending' }))).toHaveLength(1);
  });

  it('claims nothing where there is neither a worker nor a PR', () => {
    expect(machineProcesses('none', '', null)).toEqual([]);
  });
});

describe('the section is the group, and the group alone', () => {
  it('admits a row the SERVER grouped there', () => {
    // The section's one road in, and the rule it always had. A pending check on
    // the host is grouped `waiting-on-machine` by the classifier, and that is
    // what membership reads.
    expect(inMachineSection(row({ group: 'waiting-on-machine', processes: [] }))).toBe(true);
  });

  it('keeps a live agent OUT of it, whatever processes the row carries', () => {
    // The measured defect, asserted directly. A row can still carry entries —
    // the field is untouched and other things read it — and membership must not
    // consult them. Under the old `|| processesOf(row).length > 0` this was
    // `true`, and that is what rendered one branch in two sections.
    const r = row({
      group: 'working',
      processes: [{ origin: 'local', evidence: 'a worker process is running', pid: '20145' }],
    });
    expect(inMachineSection(r)).toBe(false);
  });

  it('keeps a row out on a HOST entry the server did not group there', () => {
    // Membership has ONE source. A row carrying a host entry whose group says
    // otherwise is a row the server placed elsewhere, and the client does not
    // second-guess it — that is the difference between reading `group` and
    // reading `processes` filtered to hosts.
    const r = row({
      group: 'working',
      processes: [{ origin: 'host', evidence: 'CI is running for PR #244', pid: '' }],
    });
    expect(inMachineSection(r)).toBe(false);
  });

  it('keeps every other group out of it', () => {
    for (const group of ['waiting-on-you', 'working', 'quiet', 'not-started', 'done'] as const) {
      expect(inMachineSection(row({ group, processes: [] }))).toBe(false);
    }
  });

  it('says what the MACHINE is doing where the row was grouped here', () => {
    // The section's sentence still comes from the entry rather than from the
    // row's own note, so the line reads about the check rather than about
    // whoever holds the branch.
    const r = row({
      group: 'waiting-on-machine',
      note: 'PR #244, CI running',
      processes: [{ origin: 'host', evidence: 'CI is running for PR #244', pid: '' }],
    });
    expect(machineNote(r)).toBe('CI is running for PR #244');
  });

  it('joins two processes rather than ranking them', () => {
    const r = row({
      processes: [
        { origin: 'host', evidence: 'CI is running for PR #244', pid: '' },
        { origin: 'host', evidence: 'CI is running for PR #245', pid: '' },
      ],
    });
    expect(machineNote(r)).toContain('CI is running for PR #244');
    expect(machineNote(r)).toContain('CI is running for PR #245');
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
    // nothing here measures. *a machine is working* is what was observed, and it
    // is the section's own rule now that nothing but a machine reaches it.
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

  it('a running worker with a pending check is in WORKING, and its PR is the wait', () => {
    // The brief's second required case, and the one the old rule was written
    // for. TWO SUBJECTS, NOT ONE SUBJECT TWICE: the agent is working — the
    // pending check must never EVICT it from WORKING — and the machine being
    // waited on is the PR's CI, which the row carries as a host entry.
    const r = rowFor(
      { branch: 'feature/watched', state: 'wip', deferred: false, claimed: '',
        worker: 'running', worker_pid: '20145' },
      new Map([['feature/watched', pr({ head: 'feature/watched', checks: 'pending' })]]),
    );
    // The AGENT: in WORKING, unevicted.
    expect(r.group).toBe('working');
    // The MACHINE: the host's check, and only the host's. No local entry.
    expect(r.processes.map((p) => p.origin)).toEqual(['host']);
    // AND THE AGENT IS NOT IN THE MACHINE SECTION. This is the assertion the
    // measured defect fails: the row rendered in both.
    expect(inMachineSection(r)).toBe(false);
  });

  it('a running worker with NO PR appears in WORKING only', () => {
    // The brief's first required case, and the exact shape the operator
    // measured: `worker: running`, `pr: None`. Nothing automated exists for this
    // branch, so nothing may claim a machine is working on it.
    const r = rowFor({
      branch: 'feature/local-only', state: 'wip', deferred: false, claimed: '',
      worker: 'running', worker_pid: '31337',
    });
    expect(r.group).toBe('working');
    expect(r.processes).toEqual([]);
    expect(inMachineSection(r)).toBe(false);
  });

  it('a STOPPED worker with a pending check is still listed', () => {
    // The brief's third required case, and the refutation of the objection
    // raised against this removal — *an agent that exited while its checks still
    // run would land nowhere.* It lands here by two paths that never consult a
    // worker: the classifier's `pending` arm sets the group, and the host half
    // pushes the entry. The local half was credited with a case it never
    // covered, since the worker here is `finished` and it pushed nothing.
    const r = rowFor(
      { branch: 'feature/exited', state: 'wip', deferred: false, claimed: '',
        worker: 'finished', worker_exit: '0' },
      new Map([['feature/exited', pr({ head: 'feature/exited', checks: 'pending' })]]),
    );
    expect(r.group).toBe('waiting-on-machine');
    expect(inMachineSection(r)).toBe(true);
    expect(r.processes.map((p) => p.origin)).toEqual(['host']);
  });

  it('no worker state of any kind reaches the machine section, end to end', () => {
    // THE RULE AT THE PULSE LEVEL, over the whole enum. The unit assertion above
    // proves `machineProcesses` writes nothing; this proves no worker state
    // reaches the section by ANY road through the real row builder — including
    // whatever `classify` decides about the branch on other grounds.
    for (const worker of WorkerStateSchema.options) {
      const r = rowFor({
        branch: 'feature/w', state: 'wip', deferred: false, claimed: '',
        worker, worker_pid: '20145',
      });
      expect(inMachineSection(r), `worker=${worker} must not reach the machine section`)
        .toBe(false);
      expect(r.processes, `worker=${worker} must claim no process`).toEqual([]);
    }
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

  it('still carries the host entry for a branch no worktree was read for', () => {
    // `processes` STILL CARRIES HOST ENTRIES — the brief's fifth required case.
    // A planless row is built from the PR map, so the worktree scan never
    // visited it (`worker: 'elsewhere'`), and its host check still belongs here.
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
    expect(inMachineSection(loose)).toBe(true);
  });

  it('leaves the CI grouping untouched — a pending check still groups here', () => {
    // The brief's sixth required case. `fleet.ts`'s `pr.checks === 'pending'`
    // arm is out of scope and is what the section now rests entirely on, so it
    // is asserted rather than assumed: if it moved, the section would empty and
    // every test above would still pass on the negatives alone.
    const r = classify('wip', 'eligible', 5, QUIET, pr({ checks: 'pending' }),
      false, 0, 'approved', 'finished', null, 7);
    expect(r.group).toBe('waiting-on-machine');
    expect(r.note).toContain('CI running');
  });

  it('leaves the classifier answering one placement, as its contract says', () => {
    // `classify` still returns a single group, and this change did not narrow
    // it: a live worker with a pending check is still WORKING, because the agent
    // is what the row is about.
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
    // Membership reads `group` alone since 2026-08-20, so the predicate no
    // longer touches the field at all — but the assertion stays, because what it
    // guards is *an old payload must not blank the board* and that is a property
    // of the predicate, not of its current implementation.
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
