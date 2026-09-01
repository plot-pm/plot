import { describe, it, expect } from 'vitest';
import { classify, rowsFromPulse, whereToLook } from '../../src/server/fleet.js';
import { inMachineSection } from '../../src/app/lib/agent-rows/host-notes.js';
import { WorkerStateSchema, type AgentRow, type FleetReading } from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// A BROKEN AGENT NEEDS YOU. NO OTHER AGENT DOES.
//
// WAITING ON YOU is for what needs a PERSON'S DECISION — a PR, a branch, a plan,
// a release, a build. An agent has no business there while it works: an agent IS
// the worker, and WORKING is the section that says so while also saying who.
//
// **An agent appears here only when something is wrong with the agent**, and its
// presence is then itself the signal. That is what makes the exception worth
// having, and it is why the exception must stay rare — rarity being a property of
// the RULE rather than a hope. Only a problem state admits an agent:
//
//   | case                | state                | in WAITING ON YOU |
//   |---------------------|----------------------|-------------------|
//   | crashed             | `failed`, `ended`    | yes               |
//   | stopped unfinished  | `stalled`            | yes               |
//   | working             | `running`            | NO — WORKING      |
//   | stopped to ask      | `waiting`            | NO — WORKING      |
//   | done                | `finished`           | (a result, not a broken agent) |
//
// `waiting` IS THE ONE A NAIVE PREDICATE GETS WRONG, and the negatives below are
// this suite's point. `worker !== 'running'` passes every positive assertion here
// and sweeps in an agent that merely stopped to ask — which would say a person
// must decide when in fact an agent is mid-task, holding its worktree and its
// context, needing only an answer. Its question is its note, in WORKING.
//
// `compact context` — the plan's third broken case — IS NOT HERE AND CANNOT BE.
// An agent with a full context still reports `running`, because the condition is
// in the transcript, not the process. The registry reads `contextTokens` for it
// and it arrives ABSENT: this repo's `Worker command` forwards no `--session-id`,
// so the transcript join degrades. Inferring it from uptime or a token guess is
// what the plan's open point forbids until that forward is fixed.

const QUIET = 30;

/**
 * A worktree path that looks like the real thing — dispatch makes siblings of the
 * repo named for the branch, and the note is read by someone about to paste it.
 */
const WT = '/Users/j/Quatico/plot-wt-feature-x';

/**
 * `classify` with the broken-worker arguments spelled by NAME rather than by
 * position, and that is a safety property rather than a convenience.
 *
 * The parameter list this calls into is nineteen positional arguments long and
 * has been broken once by an insertion mid-list: a `boolean` slid into a
 * `string[]` slot, `undefined` into the one after it, and six tests failed on a
 * lock that had silently stopped arriving — with no complaint from the compiler.
 * Every spread-tuple caller in this suite is exposed to that, so this suite
 * builds its calls in one place. A future insertion breaks this helper, loudly
 * and once, instead of every case quietly.
 */
const classifyWorker = (over: {
  worker: string;
  exit?: string;
  dirty?: readonly string[];
  question?: string;
  worktree?: string;
  pr?: PrRecord | null;
}) => classify(
  'wip', 'eligible', 5, QUIET, over.pr ?? null, false, 0, 'approved',
  over.worker as never, over.exit ?? '', '4242', false,
  over.dirty ?? [], over.question ?? '', true, over.worktree ?? WT,
);

describe('a broken agent appears in WAITING ON YOU', () => {
  it('puts a FAILED worker there, naming the exit it was observed to make', () => {
    // THE first required case. A non-zero status is the process saying it died —
    // the observation this arm has that `stalled` cannot get at any price.
    const r = classifyWorker({ worker: 'failed', exit: '127' });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('crashed');
    expect(r.note).toContain('127');
  });

  it('puts an ENDED worker there, and claims nothing about how it ended', () => {
    // `ended` IS the state that means *the status was not recorded*, so the note
    // may name neither a crash nor a clean stop: the record that would settle
    // which is precisely what is missing. Guessing either way is the one answer
    // that tells a reader to stop looking.
    const r = classifyWorker({ worker: 'ended' });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('not recorded');
  });

  it('puts a STALLED worker there, distinguishing it from a crash', () => {
    // THE second required case, and the distinction is the whole of it. The
    // reader does different things with *stopped without finishing* and
    // *crashed*, so the note may not be reachable from the other's wording.
    const r = classifyWorker({ worker: 'stalled', dirty: ['src/a.ts'] });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('without finishing');
    // NOT the crash sentence. A shared label over both states sends the reader
    // to a log to find out which arrived — the defect the split exists to end.
    expect(r.note).not.toContain('crashed');
  });

  it('says a stalled worker stopped WITHOUT ASKING, which is the abandonment', () => {
    // The half that earns the phrase, and it is not rhetorical. A worker that
    // stopped to ask is `waiting` and stays in WORKING; reaching this arm means
    // the scan found no marker, so nobody was asked anything. Without that
    // clause a reader cannot tell an abandonment from a question they missed.
    const r = classifyWorker({ worker: 'stalled', dirty: ['src/a.ts'] });
    expect(r.note).toContain('without asking');
  });

  it('names what a stalled worker left on the floor', () => {
    // Unchanged behaviour, asserted because this wave rewrote the sentence
    // around it: the files are what the resume-or-abandon decision is made on,
    // and a bare count reads the same for three scratch notes and three
    // half-finished modules.
    const r = classifyWorker({ worker: 'stalled', dirty: ['src/a.ts', 'src/b.ts'] });
    expect(r.note).toContain('src/a.ts');
    expect(r.note).toContain('src/b.ts');
  });

  it('reads as two different sentences across the two broken kinds', () => {
    // THE PAIRING, stated over the pair rather than inside either case. An
    // implementation that routed both to one note passes every membership
    // assertion above; this is what fails it.
    const crashed = classifyWorker({ worker: 'failed', exit: '1' });
    const stopped = classifyWorker({ worker: 'stalled', dirty: ['src/a.ts'] });
    expect(crashed.group).toBe(stopped.group);
    expect(crashed.note).not.toBe(stopped.note);
  });
});

describe('the note says what was observed, never what to do', () => {
  // EVIDENCE, NOT VERDICT — the estate's rule (Manifesto Principle 3: scripts
  // collect, humans conclude), and the notes broke it until 2026-08-20 with
  // *restart it* and *resume it*. Both were claims about the SCHEDULE that this
  // function cannot support: whether a crash is worth restarting depends on what
  // its log says and on what else is in flight, neither of which it can see. The
  // board restarts nothing in any case — relaunching is `/plot-dispatch`'s.
  //
  // ADVICE STILL EXISTS, in the surface whose declared job it is:
  // `AttentionItem` carries `action: 'restart it'` beside the `verdict` a
  // consumer branches on and the `evidence` it traces to. So *restart it* is
  // right there and wrong here, and this suite asserts only the note.
  it('drops the advice from all three broken notes', () => {
    for (const worker of ['failed', 'ended', 'stalled'] as const) {
      const r = classifyWorker({ worker, exit: worker === 'failed' ? '1' : '' });
      expect(r.note, `${worker} must not prescribe a restart`).not.toContain('restart it');
      expect(r.note, `${worker} must not prescribe a resume`).not.toContain('resume it');
    }
  });
});

describe('the row says where to look', () => {
  // A reader told an agent crashed and not told where its log is has been
  // INFORMED, NOT HELPED — they still have to find the worktree, which is the
  // errand the row existed to save them.
  it('names the log path and the worktree on every broken row', () => {
    for (const worker of ['failed', 'ended', 'stalled'] as const) {
      const r = classifyWorker({ worker, exit: worker === 'failed' ? '1' : '' });
      expect(r.note, `${worker} must name its log`).toContain(`${WT}/.plot-worker.log`);
      expect(r.note, `${worker} must name its worktree`).toContain(WT);
    }
  });

  it('names the LOG FILE, not merely the directory holding it', () => {
    // THE pairing for the assertion above, which a directory alone would pass by
    // being a prefix of the log path. The log is a DOTFILE, so a reader given
    // only the directory runs `ls`, sees nothing, and concludes there is no log.
    expect(whereToLook(WT)).toContain('.plot-worker.log');
  });

  it('omits the location rather than guessing when no worktree is known', () => {
    // "" IS A STATED ABSENCE. The path is true on this machine and meaningless
    // on any other, so a reader elsewhere gets the evidence and no location —
    // honest, where a reconstructed path names a directory that does not exist
    // where they are reading. The EVIDENCE survives; only the clause goes.
    const r = classifyWorker({ worker: 'failed', exit: '9', worktree: '' });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('crashed');
    expect(r.note).toContain('9');
    expect(r.note).not.toContain('log:');
    expect(whereToLook('')).toBe('');
  });

  it('does not double the separator on a worktree reported with a trailing slash', () => {
    // The path is composed for a person to PASTE, and the scan's spelling of a
    // worktree is not this function's to assume.
    expect(whereToLook(`${WT}/`)).toContain(`${WT}/.plot-worker.log`);
    expect(whereToLook(`${WT}/`)).not.toContain('//.plot-worker.log');
  });
});

describe('every other agent state stays out of WAITING ON YOU', () => {
  it('keeps a RUNNING worker in WORKING', () => {
    // The section answers *what needs my decision*. A running agent needs
    // nothing; it is the thing doing the work.
    const r = classifyWorker({ worker: 'running' });
    expect(r.group).toBe('working');
  });

  it('keeps a WAITING worker in WORKING, with its question as the note', () => {
    // THE NEGATIVE THAT MATTERS MOST, and the one `worker !== 'running'` gets
    // wrong. A worker that stopped to ask IS WORKING: its worktree is live, its
    // context is intact, and what unblocks it is an ANSWER rather than a
    // decision about whether it should continue existing. Moving it here would
    // say a person must decide when an agent is mid-task.
    const r = classifyWorker({ worker: 'waiting', question: 'which retry semantics?' });
    expect(r.group).toBe('working');
    // THE NOTE, NOT ONLY THE GROUP — and this is the half the group cannot
    // carry. Measured while mutating this arm shut: a `waiting` row that stops
    // being recognised as a worker does not leave WORKING, it falls through to
    // the commit clock and lands there again as *last commit 5 min ago*. Right
    // section, and the question gone — the agent's reason for needing a person
    // silently replaced by its branch's age. Asserting the group alone would
    // have called that correct.
    expect(r.note).toContain('which retry semantics?');
  });

  it('recognises a waiting worker AS a worker, not by its branch age', () => {
    // The pairing for the note assertion above, stated where age cannot help.
    // A branch whose last commit is ANCIENT is `quiet` by the clock — so if the
    // worker arm stops firing, this row leaves WORKING altogether. The question
    // is what keeps it there, which is the whole claim: *the agent is working*.
    const r = classify(
      'wip', 'eligible', 5000, QUIET, null, false, 0, 'approved',
      'waiting', '', '4242', false, [], 'which retry semantics?', true, WT,
    );
    expect(r.group).toBe('working');
    expect(r.note).toContain('which retry semantics?');
  });

  it('does not describe a waiting worker as broken', () => {
    // The pairing for the above: a row in the right section carrying the wrong
    // sentence is the same defect one layer in.
    const r = classifyWorker({ worker: 'waiting', question: 'which retry semantics?' });
    expect(r.note).not.toContain('crashed');
    expect(r.note).not.toContain('without finishing');
  });

  it('does not call a FINISHED worker broken', () => {
    // `finished` is a RESULT for a person to review — which is a decision, so
    // the row belongs to this section — but it is not a broken agent, and the
    // note may not read as one. Review and restart are opposite moves.
    const r = classifyWorker({ worker: 'finished', exit: '0' });
    expect(r.note).not.toContain('crashed');
    expect(r.note).not.toContain('without finishing');
  });

  it('leaves the two WORKING states with no location clause at all', () => {
    // WHERE TO LOOK IS THE BROKEN ROW'S CLAUSE, and its presence is part of the
    // signal. A running agent's row carrying a log path would read as an errand
    // — and an implementation that appended the clause unconditionally passes
    // every assertion in the section above.
    for (const worker of ['running', 'waiting'] as const) {
      const r = classifyWorker({ worker, question: 'q?' });
      expect(r.note, `${worker} must not be sent to a log`).not.toContain('log:');
    }
  });
});

describe('no row that is not an agent moves', () => {
  /** One plan, one wave, one branch — the real row builder, shaped per case. */
  const pulseWith = (branch: Record<string, unknown>): FleetReading => ({
    generated: new Date().toISOString(),
    root: '/repo',
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-20-every-section-has-one-subject.md',
      phase: 'approved',
      slices: [{ name: 'Surfaced', verdict: 'eligible', branches: [branch] }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
  } as never);

  const rowFor = (branch: Record<string, unknown>, prs?: Map<string, PrRecord>): AgentRow => {
    const pulse = pulseWith(branch);
    const ages = new Map<string, number | null>([[branch.branch as string, 1]]);
    return rowsFromPulse(pulse, ages, 'plot', QUIET, prs as never)
      .find((r) => r.branch === branch.branch)!;
  };

  const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 303,
    head: 'feature/x',
    state: 'OPEN',
    draft: false,
    checks: 'green',
    mergeable: 'mergeable',
    failing_checks: [],
    ...over,
  } as PrRecord);

  it('carries the worktree onto a broken row end to end', () => {
    // THE WIRING, through the real builder rather than the classifier alone. The
    // path travels on the pulse's `local_worktree`; a change that forwarded
    // nothing would leave every assertion in the section above passing on
    // arguments no caller supplies.
    const r = rowFor({
      branch: 'feature/crashed', state: 'wip', deferred: false, claimed: '',
      worker: 'failed', worker_exit: '127', local_worktree: WT,
    });
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain(`${WT}/.plot-worker.log`);
  });

  it('leaves a PR row where the PR puts it, worker or no worker', () => {
    // A CONFLICTING PR is a person's errand on its own grounds, and it outranks
    // a worker — the ordering this wave inherited and must not disturb. The note
    // is the PR's, not an agent's.
    const r = rowFor(
      { branch: 'feature/x', state: 'wip', deferred: false, claimed: '', worker: 'none' },
      new Map([['feature/x', pr({ mergeable: 'conflicting', checks: 'none' })]]),
    );
    expect(r.group).toBe('waiting-on-you');
    expect(r.note).toContain('conflicts');
    expect(r.note).not.toContain('crashed');
  });

  it('does not send an agentless branch to a log', () => {
    // `none` MEANS UNKNOWN, NEVER NOBODY — a hand-started worker leaves no pid,
    // and reading absence as a crash would report every one of them dead. The
    // location clause is the broken row's, so a row with no worker verdict must
    // not carry it whatever its worktree says.
    const r = rowFor({
      branch: 'feature/quiet', state: 'wip', deferred: false, claimed: '',
      worker: 'none', local_worktree: WT,
    });
    expect(r.note).not.toContain('log:');
    expect(r.note).not.toContain('crashed');
  });

  it('does not move a branch a worker never touched', () => {
    // `elsewhere` is *nowhere here to look*, which is not a broken agent. The
    // group is whatever the branch's own state earns.
    const r = rowFor({
      branch: 'feature/other-machine', state: 'claimed', deferred: false,
      claimed: 'someone', worker: 'elsewhere',
    });
    expect(r.note).not.toContain('crashed');
    expect(r.note).not.toContain('log:');
  });
});

describe("#300's rule still holds: no worker state reaches WAITING ON A MACHINE", () => {
  // THE REGRESSION GUARD ON THE WAVE BEFORE THIS ONE. The two sections now have
  // disjoint agent rules — WAITING ON YOU takes an agent only when it is broken,
  // WAITING ON A MACHINE never takes one at all — and a test should keep them
  // that way. Asserted from THIS side because this is the wave that gave agents a
  // reason to be routed anywhere at all: a future change that surfaced a broken
  // agent by pushing a process entry would re-create #300's duplicate exactly.
  const pulseWith = (branch: Record<string, unknown>): FleetReading => ({
    generated: new Date().toISOString(),
    root: '/repo',
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-20-every-section-has-one-subject.md',
      phase: 'approved',
      slices: [{ name: 'Surfaced', verdict: 'eligible', branches: [branch] }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
  } as never);

  it('holds over the whole enum, with a worktree present to be named', () => {
    // Over EVERY worker state rather than the three this wave routes, which is
    // what makes it a rule instead of a patch — and with `local_worktree` set,
    // since that is the field this wave newly reads and the one a careless
    // implementation might turn into a process entry.
    for (const worker of WorkerStateSchema.options) {
      const pulse = pulseWith({
        branch: 'feature/w', state: 'wip', deferred: false, claimed: '',
        worker, worker_pid: '20145', local_worktree: WT,
      });
      const r = rowsFromPulse(pulse, new Map([['feature/w', 1]]), 'plot', QUIET)
        .find((x) => x.branch === 'feature/w')!;
      expect(inMachineSection(r), `worker=${worker} must not reach the machine section`)
        .toBe(false);
      expect(r.processes, `worker=${worker} must claim no process`).toEqual([]);
    }
  });

  it('keeps the two sections disjoint for a broken agent specifically', () => {
    // The one row this wave newly places. It is in WAITING ON YOU and therefore
    // in no other section — the sections being disjoint by construction, since
    // `group` is a single value and `inMachineSection` reads only it.
    const pulse = pulseWith({
      branch: 'feature/crashed', state: 'wip', deferred: false, claimed: '',
      worker: 'failed', worker_exit: '127', local_worktree: WT,
    });
    const r = rowsFromPulse(pulse, new Map([['feature/crashed', 1]]), 'plot', QUIET)
      .find((x) => x.branch === 'feature/crashed')!;
    expect(r.group).toBe('waiting-on-you');
    expect(inMachineSection(r)).toBe(false);
  });
});
