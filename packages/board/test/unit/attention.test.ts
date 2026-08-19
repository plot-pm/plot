// The verdicts `/api/attention` produces, tested where they are decided.
//
// ONE FIXTURE, EVERY STATE — the shape the worker-state tests already use, and
// for their reason. A worker in `failed`, in `waiting` and in `running` differs
// from its neighbours by exactly one field, so a fixture per case would let the
// cases drift apart and hide the thing under test: that ONE reading of one row
// sends it to one list. Every branch below comes out of the same pulse.
//
// DRIVEN THROUGH `rowsFromPulse`, not from hand-built rows. The claim this
// endpoint makes is that its verdicts trace to facts the scan already reports,
// and a hand-built `AgentRow` is precisely the thing that could assert a fact
// the scan never produces. Starting from a pulse means every input here is one
// `plot-fleet-scan.sh` can actually emit.
import { describe, it, expect } from 'vitest';
import { readingFor, isClaimable } from '../../src/server/attention.js';
import { rowsFromPulse } from '../../src/server/fleet.js';
import { AttentionSchema, type AgentRow, type FleetPulse } from '../../src/contract/schema.js';

const QUIET = 30;

/**
 * One pulse carrying one branch per worker state, all under an approved plan.
 *
 * `state: 'claimed'` throughout: a claim is what a dispatched branch holds, and
 * it is the state in which the worker question is asked at all. The ages are
 * inside the quiet window so nothing here reaches `quiet` for a reason
 * unrelated to its worker.
 */
const workerPulse = (): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: '2026-08-18-the-board-answers-agents.md',
    phase: 'approved',
    waves: [{
      name: 'Ask',
      verdict: 'eligible',
      branches: [
        { branch: 'feature/is-running', state: 'claimed', deferred: false, claimed: '',
          worker: 'running', worker_pid: '4242' },
        { branch: 'feature/has-failed', state: 'claimed', deferred: false, claimed: '',
          worker: 'failed', worker_exit: '1' },
        { branch: 'feature/has-ended', state: 'claimed', deferred: false, claimed: '',
          worker: 'ended' },
        { branch: 'feature/is-waiting', state: 'claimed', deferred: false, claimed: '',
          worker: 'waiting' },
        { branch: 'feature/is-stalled', state: 'claimed', deferred: false, claimed: '',
          worker: 'stalled', worker_dirty_paths: ['src/a.ts'] },
        { branch: 'feature/has-finished', state: 'claimed', deferred: false, claimed: '',
          worker: 'finished', worker_exit: '0' },
        { branch: 'feature/no-pid', state: 'claimed', deferred: false, claimed: '',
          worker: 'none' },
        { branch: 'feature/other-machine', state: 'claimed', deferred: false, claimed: '',
          worker: 'elsewhere' },
      ],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 8, claimed: 8, eligible: 0, blocked: 0, deferred: 0 },
} as never);

/** Every branch dated one minute ago — inside the quiet window, by design. */
const freshAges = (pulse: FleetPulse): Map<string, number | null> =>
  new Map(pulse.plans.flatMap((p) => p.waves.flatMap((w) => w.branches.map(
    (b) => [b.branch, 1] as [string, number | null],
  ))));

const rowsOf = (pulse: FleetPulse): Map<string, AgentRow> => {
  const rows = rowsFromPulse(pulse, freshAges(pulse), 'plot', QUIET);
  return new Map(rows.map((r) => [r.branch, r]));
};

describe('the scan\'s worker state reaches the row as a FIELD', () => {
  // The precondition for everything below, and a claim about the row contract
  // rather than about attention: before this, the eight states survived onto
  // the row only as PROSE inside `note`, and a consumer telling `waiting` from
  // `stalled` had to match sentences. Two of those states name OPPOSITE moves,
  // so a reworded note would have silently merged answer-it into resume-it.
  const rows = rowsOf(workerPulse());

  it('forwards each state verbatim, without re-deriving it', () => {
    expect(rows.get('feature/is-running')!.worker).toBe('running');
    expect(rows.get('feature/has-failed')!.worker).toBe('failed');
    expect(rows.get('feature/is-waiting')!.worker).toBe('waiting');
    expect(rows.get('feature/is-stalled')!.worker).toBe('stalled');
    expect(rows.get('feature/other-machine')!.worker).toBe('elsewhere');
  });

  it('leaves the group and note it already produced untouched', () => {
    // FORWARDED BESIDE, never instead of. The board renders the same rows it
    // did before; this field is an addition for a consumer that needs the
    // value, not a replacement for the sentence a person reads.
    expect(rows.get('feature/is-running')!.group).toBe('working');
    expect(rows.get('feature/is-running')!.note).toContain('pid 4242');
    // A waiting worker is an AGENT, so its row sits in WORKING beside the
    // running one — and its note still names the wait, so the `worker` field
    // above is an addition rather than the only place the fact survives. The
    // fixture supplies no marker text, which is the stated-unknown case.
    expect(rows.get('feature/is-waiting')!.group).toBe('working');
    expect(rows.get('feature/is-waiting')!.note).toContain('waiting on you');
  });
});

describe('a worker in each state lands in the right list', () => {
  // The Definition of Done's central assertion, driven from the one fixture.
  const rows = rowsOf(workerPulse());
  const reading = (branch: string) => readingFor(rows.get(branch)!);

  it('sends a FAILED worker to needsAgent as abandoned', () => {
    const r = reading('feature/has-failed')!;
    expect(r.list).toBe('needsAgent');
    expect(r.verdict).toBe('abandoned');
    expect(r.action).toBe('restart it');
    expect(r.evidence).toBe('worker: failed');
  });

  it('sends an ENDED worker to needsAgent as abandoned too', () => {
    // Two states, one verdict — licensed by the only test that matters: both
    // mean a process stopped leaving nobody working, and both take the same
    // move. The EVIDENCE preserves which was seen, so the merge is auditable.
    const r = reading('feature/has-ended')!;
    expect(r.verdict).toBe('abandoned');
    expect(r.evidence).toBe('worker: ended');
  });

  it('sends a WAITING worker to its own list, never to needsAgent', () => {
    // THE VERDICT THE PROTOTYPE LEARNED THE HARD WAY. It restarted one branch
    // twice while its worker waited on an answer it had asked for; the second
    // restart re-ran work the first had finished. This assertion is that
    // regression, written down.
    const r = reading('feature/is-waiting')!;
    expect(r.list).toBe('waiting');
    expect(r.verdict).toBe('question');
    expect(r.evidence).toBe('worker: waiting');
    // The negative is the half that matters: a restart here DESTROYS work.
    expect(r.list).not.toBe('needsAgent');
    expect(r.verdict).not.toBe('abandoned');
  });

  it('keeps STALLED separate from abandoned — resume is not restart', () => {
    // Uncommitted work with no PR over it. A machine's errand like `abandoned`,
    // and a DIFFERENT one: resuming sends a worker back to work, restarting
    // starts it over. One label across both is what sent a restart into
    // finished work.
    const r = reading('feature/is-stalled')!;
    expect(r.list).toBe('needsAgent');
    expect(r.verdict).toBe('unfinished');
    expect(r.action).toBe('resume it');
    expect(r.verdict).not.toBe('abandoned');
  });

  it('sends a FINISHED worker to needsHuman for review', () => {
    const r = reading('feature/has-finished')!;
    expect(r.list).toBe('needsHuman');
    expect(r.verdict).toBe('review');
  });

  it('reports NOTHING for a running worker', () => {
    // A WORKING row needs nobody, and its absence from every list is the point:
    // a fleet whose every row appears somewhere is a list nobody reads.
    expect(reading('feature/is-running')).toBe(null);
  });

  it('reports nothing for none and elsewhere — absent is not abandoned', () => {
    // UNKNOWN, NEVER "NOBODY". `plot-dispatch` writes a pid only where it
    // started the worker itself, so a hand-started worker leaves `none`, and a
    // branch claimed on another machine leaves nowhere to look at all. Reading
    // either as abandonment would have reported all five of one session's
    // hand-started agents dead — and each report invites a restart on top of a
    // worker that is running fine.
    expect(reading('feature/no-pid')).toBe(null);
    expect(reading('feature/other-machine')).toBe(null);
  });
});

describe('an open PR outranks local mess', () => {
  // The second verdict the prototype learned the hard way: work that reached
  // review has left the worker's hands, so leftover local state there means
  // nothing. Ranking the worker first would call every branch under review
  // `unfinished` and invite a resume into work already submitted.
  const withPr = (checks: string, mergeable = 'mergeable', draft = false) => {
    const pulse = workerPulse();
    const prs = new Map([['feature/is-stalled', {
      number: 207, url: '', draft, state: 'OPEN', checks, mergeable, failing_checks: [],
    }]] as never);
    const rows = rowsFromPulse(pulse, freshAges(pulse), 'plot', QUIET, prs as never);
    return readingFor(rows.find((r) => r.branch === 'feature/is-stalled')!);
  };

  it('reports the PR\'s errand, not the stalled worker beneath it', () => {
    const r = withPr('none')!;
    expect(r.verdict).toBe('ci-approval');
    expect(r.evidence).toBe('pr.state: none');
    // The load-bearing negative. The branch IS stalled — same fixture, same
    // worker state — and the PR is what decides.
    expect(r.verdict).not.toBe('unfinished');
  });

  it('names a conflict as a conflict rather than as missing checks', () => {
    // GitHub starts no workflow for a PR that does not merge, so a conflicting
    // PR ALWAYS also reports an empty rollup. Answering `ci-approval` here
    // would name the symptom and withhold the cause — and the two want
    // opposite things: a click versus a rebase.
    const r = withPr('none', 'conflicting')!;
    expect(r.verdict).toBe('conflict');
    expect(r.action).toBe('rebase it');
  });

  it('reports nothing while a machine is the blocker', () => {
    // `pending` is genuinely queued or running. Nobody is waiting on a person,
    // so the row appears in no list — the same silence a live worker gets.
    expect(withPr('pending')).toBe(null);
  });

  it('sends a green PR to review, and lets a green DRAFT fall through', () => {
    expect(withPr('green')!.verdict).toBe('review');
    // A draft is still its author's — the rule `prAsksNobody` states — so it
    // does not become a reviewer's errand. The row falls through to its worker
    // verdict, which here is the stalled one underneath.
    expect(withPr('green', 'mergeable', true)!.verdict).toBe('unfinished');
  });

  it('falls through on an UNKNOWN rollup rather than inventing an errand', () => {
    // Bitbucket carries no rollup. Reporting "look at this" on every PR of
    // every Bitbucket repo would fill the list with rows nothing is wrong with.
    expect(withPr('unknown')!.verdict).toBe('unfinished');
  });
});

describe('a live worker does not hide its PR\'s errand', () => {
  // The exception the board itself draws, copied rather than invented.
  // `classify` skips its PR arm for a running worker on ONE condition —
  // `worker === 'running' && prAsksNobody(pr)` — so a green or pending PR keeps
  // the row in WORKING, and a conflicting or failing one still reaches a
  // person. Reading "a running worker needs nobody" as unconditional drops the
  // row a person most needs to see, for as long as its agent keeps running.
  const runningWith = (checks: string, mergeable = 'mergeable', draft = false) => {
    const pulse = workerPulse();
    const prs = new Map([['feature/is-running', {
      number: 212, url: '', draft, state: 'OPEN', checks, mergeable, failing_checks: [],
    }]] as never);
    const rows = rowsFromPulse(pulse, freshAges(pulse), 'plot', QUIET, prs as never);
    return readingFor(rows.find((r) => r.branch === 'feature/is-running')!);
  };

  it('reports a conflicting PR even while the agent runs', () => {
    // A conflict wants a rebase whoever is at the keyboard. This is the
    // assertion that a blanket early return would fail.
    const r = runningWith('none', 'conflicting')!;
    expect(r.verdict).toBe('conflict');
    expect(r.list).toBe('needsHuman');
  });

  it('reports failing checks even while the agent runs', () => {
    expect(runningWith('failing')!.verdict).toBe('ci-failing');
  });

  it('stays silent on a GREEN PR under a live worker', () => {
    // The other half, and the defect measured 2026-08-17: an agent that opened
    // its PR and kept working was pulled out of WORKING by a PR asking nobody,
    // and WORKING went empty while two agents ran. A green PR asks nobody.
    expect(runningWith('green')).toBe(null);
  });

  it('stays silent on a pending PR under a live worker', () => {
    expect(runningWith('pending')).toBe(null);
  });

  it('stays silent on a green DRAFT under a live worker', () => {
    // Falls past the PR arm — a draft is still its author's — and then past the
    // worker verdicts, where `running` returns rather than breaking. The return
    // is what stops the `unpushed` arm below from claiming a live branch is
    // finished work sitting still.
    expect(runningWith('green', 'mergeable', true)).toBe(null);
  });
});

describe('claimable is the same predicate the Start button uses', () => {
  const openPulse = (): FleetPulse => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-18-the-board-answers-agents.md',
      phase: 'approved',
      waves: [
        { name: 'Ask', verdict: 'eligible', branches: [
          { branch: 'feature/nobody-took-it', state: 'open', deferred: false, claimed: '' },
        ] },
        { name: 'Act', verdict: 'blocked', branches: [
          { branch: 'feature/blocked-by-ask', state: 'open', deferred: false, claimed: '' },
        ] },
      ],
    }],
    summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
  } as never);

  const rows = rowsOf(openPulse());

  it('names an eligible branch', () => {
    expect(isClaimable(rows.get('feature/nobody-took-it')!)).toBe(true);
  });

  it('refuses a branch an earlier wave is holding back', () => {
    // The half a naive implementation gets wrong, and the half that matters:
    // `plot-dispatch.sh` REFUSES a blocked branch, so naming it here would
    // invite an action the tool declines.
    expect(isClaimable(rows.get('feature/blocked-by-ask')!)).toBe(false);
  });

  it('never names a claimed branch, however its worker is doing', () => {
    // Offering to start a branch that already has one invites a
    // double-dispatch. Every branch in the worker fixture is claimed.
    for (const row of rowsOf(workerPulse()).values()) {
      expect(isClaimable(row)).toBe(false);
    }
  });

  it('produces no verdict for a claimable row — the lists do not overlap', () => {
    // A branch nobody has taken has no worker and no PR by construction, so it
    // cannot also be abandoned or waiting. Asserted rather than assumed.
    expect(readingFor(rows.get('feature/nobody-took-it')!)).toBe(null);
  });
});

describe('unpushed commits are read from the stuck detector, not counted again', () => {
  // `localAhead > 0` was the simpler test and is deliberately not the one used.
  // The stuck detector already decides when unpushed commits amount to being
  // unable to move; a second, simpler rule beside it is how two rules drift.
  const aheadPulse = (worker: string) => ({
    main: 'main',
    head: 'abc1234',
    plans: [{
      file: '2026-08-18-the-board-answers-agents.md',
      phase: 'approved',
      waves: [{ name: 'Ask', verdict: 'eligible', branches: [
        { branch: 'feature/never-pushed', state: 'wip', deferred: false, claimed: '',
          worker, local_ahead: 3 },
      ] }],
    }],
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
  } as never as FleetPulse);

  it('reports commits nobody else can see as a person\'s errand', () => {
    const rows = rowsOf(aheadPulse('none'));
    const r = readingFor(rows.get('feature/never-pushed')!)!;
    expect(r.verdict).toBe('unpushed');
    expect(r.evidence).toBe('stuck.state: unpushed');
    // A person's, not a machine's: pushing someone else's uncommitted
    // judgement is not a mechanical act.
    expect(r.list).toBe('needsHuman');
  });

  it('says nothing about a branch whose agent is still running', () => {
    // The one case where commits not yet pushed mean the OPPOSITE of finished
    // work sitting still. `running` returns from the worker switch rather than
    // breaking, which is what keeps this arm from being reached.
    const rows = rowsOf(aheadPulse('running'));
    expect(readingFor(rows.get('feature/never-pushed')!)).toBe(null);
  });
});

describe('finished work is nobody\'s errand', () => {
  it('reports nothing for a merged branch, whatever its worktree holds', () => {
    const pulse = {
      main: 'main',
      head: 'abc1234',
      plans: [{
        file: '2026-08-18-the-board-answers-agents.md',
        phase: 'approved',
        waves: [{ name: 'Honesty', verdict: 'complete', branches: [
          // A stale worker record and local leftovers on a branch that LANDED.
          { branch: 'feature/it-landed', state: 'merged', deferred: false, claimed: '',
            worker: 'failed', local_ahead: 3 },
        ] }],
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    } as never as FleetPulse;
    const rows = rowsOf(pulse);
    expect(readingFor(rows.get('feature/it-landed')!)).toBe(null);
  });
});

describe('the payload validates against its own contract', () => {
  it('accepts four empty lists with ready false — a cold cache', () => {
    // The shape the endpoint serves before any scan has landed, asserted
    // against the schema so the two cannot drift.
    const parsed = AttentionSchema.parse({
      generatedAt: new Date(0).toISOString(),
      ready: false,
      ageSeconds: null,
      readRef: null,
      error: null,
      needsAgent: [], needsHuman: [], waiting: [], claimable: [],
    });
    expect(parsed.ready).toBe(false);
    // NULL RATHER THAN 0. A zero age would assert a read that just happened,
    // which is the confident-absent-value shape this contract refuses.
    expect(parsed.ageSeconds).toBe(null);
  });

  it('refuses a verdict it does not know', () => {
    // The gate behind the rule that every verdict traces to a scan fact: a new
    // one cannot be added by a caller, only by the enum.
    expect(() => AttentionSchema.parse({
      generatedAt: new Date(0).toISOString(),
      ready: true,
      needsAgent: [{ branch: 'x', verdict: 'probably-fine', action: 'shrug', evidence: 'vibes' }],
    })).toThrow();
  });
});
