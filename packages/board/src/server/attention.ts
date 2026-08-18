// `GET /api/attention` — what needs doing, and by whom.
//
// THE ONE THING THE READ PATH DOES NOT DO. `/api/fleet` is the most engineered
// part of this system and has earned that: a 5 s scan cache, a 60 s PR refresh
// with rate-limit backoff, a disk-persisted last-good pulse, staleness rendered
// honestly rather than hidden. Every fact this file needs is already in its
// rows — `state`, `group`, `note`, `pr`, `worker`, `localAhead`, `stuck`,
// `waitingOn`, `blockedBy`. What is missing is the VERDICT, and that absence is
// deliberate rather than accidental: a board for an eye that glances renders
// facts and lets a person conclude.
//
// Agents do not glance. Measured 2026-08-18: an operator ran a shell guard
// beside the board for an afternoon and it gathered nothing the board did not
// already have. The board's own rows read `worker running (pid 20145)`. The
// guard's entire value was three lines of judgement over that data — is this
// worker abandoned, waiting on an unanswered question, or working — and that
// judgement is what this file ports.
//
// SO THIS FILE ADDS NO FACTS, and that constraint is the design rather than a
// limitation of it. Every verdict below is a RENAMING of something already in
// the payload, and each entry carries an `evidence` string naming the field it
// was read from, so a caller can audit the list against `/api/fleet` without
// running anything. A verdict the board guessed is the defect this repo spent a
// day removing.
//
// IT REPORTS; IT DOES NOT ACT. Read-only and idempotent — it names candidates,
// it reserves nothing and starts nothing. `/api/dispatch` exists for spawning
// work and is same-origin locked precisely because it spawns processes. Keeping
// this endpoint read-only preserves the split this repo rests on, and leaves the
// seam where a person can disagree with a verdict. That seam earned its place:
// the prototype's judgement was wrong twice before it learned about questions.
import fs from 'node:fs';
import path from 'node:path';
import {
  type AgentRow,
  type Attention,
  type AttentionItem,
  type AttentionVerdict,
  type Claimable,
} from '../contract/index.js';
import { type BuildBoardOptions } from './board.js';
import { buildFleet } from './fleet.js';

/**
 * Where a branch's hand-off brief lives, by the convention `/plot-implement`
 * writes and every worker prompt reads: `.plot/briefs/<slug>.md`, where the
 * slug is the branch name after its last `/`.
 *
 * A CONVENTION PLOT ITSELF WRITES, not a guess about one — the same standing
 * this file's `idea/<slug>` handling has in `fleet.ts`. The path is reported
 * whether or not the file is there, because it is where a caller should LOOK
 * and where `/plot-implement` will put it; `briefExists` is what says which of
 * the two situations it is.
 */
function briefPath(branch: string): string {
  const slug = branch.split('/').pop() ?? branch;
  return path.join('.plot/briefs', `${slug}.md`);
}

/**
 * Does the brief exist? Answered by looking, and answered `false` on any error.
 *
 * FALSE IS THE COMMON CASE AND NOT AN ERROR. `plot-dispatch.sh` reports
 * `brief=missing` unconditionally and documents why: it cannot write a brief and
 * never will, because a brief is interpretation and `/plot-implement` owns it.
 * So most eligible branches have none, and the caller is told the path anyway.
 *
 * `existsSync` rather than a read: nothing here needs the contents, and the
 * question is exactly the one it answers. Wrapped because a repo root that has
 * gone away mid-request must not take the endpoint down with it.
 */
function briefExists(repoRoot: string, rel: string): boolean {
  try {
    return fs.existsSync(path.join(repoRoot, rel));
  } catch {
    return false;
  }
}

/**
 * One verdict, its evidence, and the single move that clears it.
 *
 * `list` travels WITH the verdict rather than being decided after it, so the
 * two cannot disagree — the same rule `waitingOnFor` follows in deriving from
 * `group` instead of re-deciding it. Exported for test: the negatives are the
 * half a naive implementation gets wrong, and they are assertions about which
 * list a reading names.
 */
export interface Reading {
  verdict: AttentionVerdict;
  action: string;
  evidence: string;
  /** Which list it belongs in — decided WITH the verdict, never after it. */
  list: 'needsAgent' | 'needsHuman' | 'waiting';
}

/**
 * Read one row's verdict, or null where the row needs nobody.
 *
 * NULL IS THE COMMON ANSWER, and deliberately: a fleet whose every row appears
 * in an attention list is a list nobody reads, which is the same
 * flags-everything-flags-nothing failure `stuck` avoids by staying null. A
 * running worker, a merged branch and a green PR mid-flight all return null
 * here — none of them needs a thing.
 *
 * THE ORDER IS LOAD-BEARING and it is the prototype's, ported verbatim:
 *
 *   alive → merged → open PR → worker verdict → unpushed
 *
 * Two of those orderings were learned the hard way and both must survive:
 *
 *  1. **A live worker outranks everything.** Its row needs nobody, and the
 *     board already decided this — `classify` sends it to `working`.
 *
 *  2. **An open PR outranks local mess.** Work that reached review has left the
 *     worker's hands, so leftover local edits there mean nothing. Ranking
 *     dirtiness first would call every branch under review `unfinished` and
 *     invite a resume into work already submitted.
 *
 * And within the worker verdicts, `waiting` outranks `stalled` for the reason
 * the scan itself ranks them that way: a worker that asked a question has
 * almost always left work uncommitted BESIDE the question, so ranking
 * dirtiness first files it under *resume it* and invites a restart into the
 * same wait. Measured happening twice to one branch, the second restart
 * re-running what the first had finished. Here that ordering is inherited
 * rather than re-implemented — `row.worker` is already the scan's single
 * answer, so only one of these arms can match.
 */
export function readingFor(row: AgentRow): Reading | null {
  // NOTHING TO SAY ABOUT FINISHED WORK. A merged branch is done however messy
  // the worktree it left behind, and the `done` group is the board's own
  // statement of that. Ahead of every other arm, because a merged branch can
  // still carry a stale worker record and local leftovers.
  if (row.state === 'merged' || row.group === 'done') return null;

  // A LIVE WORKER NEEDS NOBODY — *unless its PR is a person's errand*, and
  // that exception is the board's own, copied rather than invented.
  //
  // `classify` skips its PR arm for a running worker on exactly one condition:
  // `worker === 'running' && prAsksNobody(pr)`. A green or pending PR asks
  // nobody, so an agent that opened its PR and kept working stays in WORKING —
  // the defect measured 2026-08-17, where WORKING went empty while two agents
  // ran. But a CONFLICTING or FAILING PR is a person's errand even while an
  // agent is mid-run, and `classify` still sends those to `waiting-on-you`.
  //
  // So this returns early only where the row has no PR to speak for it. A
  // running worker WITH a PR falls through to the arm below, which answers from
  // `pr.state` and returns null for the two states that ask nobody — the same
  // partition `prAsksNobody` draws, reached from the value rather than by
  // importing the predicate.
  //
  // The alternative — returning null for every running worker — was written
  // first and is wrong in one direction that matters: it would drop a
  // conflicting PR out of `needsHuman` for as long as its agent kept running,
  // which is precisely the row a person most needs to see.
  if (row.worker === 'running' && !row.pr) return null;

  // AN OPEN PR OUTRANKS LOCAL MESS. Work that reached review has left the
  // worker's hands. This arm is above the worker verdicts for exactly that
  // reason, and it is the second thing the prototype learned.
  if (row.pr) {
    switch (row.pr.state) {
      case 'conflicts':
        return {
          verdict: 'conflict',
          action: 'rebase it',
          evidence: 'pr.state: conflicts',
          list: 'needsHuman',
        };
      case 'failing':
        return {
          verdict: 'ci-failing',
          action: 'look at the failing checks',
          evidence: 'pr.state: failing',
          list: 'needsHuman',
        };
      case 'none':
        // An EMPTY rollup on an open PR means no workflow ran, and the reason
        // is that a person has not approved the run — the fact `pr.state`
        // already separates from `pending`. Saying so beats implying green.
        return {
          verdict: 'ci-approval',
          action: 'approve the workflow run',
          evidence: 'pr.state: none',
          list: 'needsHuman',
        };
      case 'green':
        // GREEN AND NOT A DRAFT IS A REVIEW — unless an agent is still running
        // on the branch, in which case the PR is not finished being written.
        //
        // The `worker === 'running'` test is the same partition `classify`
        // draws with `prAsksNobody`: a green PR asks nobody, so a live worker
        // keeps the row in WORKING there and out of every list here. Asking it
        // at this arm rather than at the top is what lets `conflicts` and
        // `failing` above still reach a person mid-run.
        //
        // A draft is still its author's — the rule `prAsksNobody` states — so a
        // green draft asks nobody either, and falls through to the worker
        // verdicts below, where a `finished` worker may still ask for a look.
        if (!row.pr.draft && row.worker !== 'running') {
          return {
            verdict: 'review',
            action: 'review and merge it',
            evidence: 'pr.state: green',
            list: 'needsHuman',
          };
        }
        break;
      case 'pending':
        // A MACHINE IS THE BLOCKER. Nobody is waiting on a person, so this row
        // appears in no list at all — the same silence a running worker gets.
        return null;
      default:
        // `unknown` — the host cannot report a rollup (Bitbucket carries
        // none). NOT an errand: reporting "look at this" on every PR of every
        // Bitbucket repo would fill the list with rows nothing is wrong with.
        // The row falls through to its worker verdict, which is the better
        // answer where there is one.
        break;
    }
  }

  // THE WORKER VERDICTS — the scan's own eight states, renamed and nothing
  // more. `row.worker` is a single value, so at most one of these matches and
  // their order here cannot decide anything; the ordering that matters lives in
  // `plot-worker-state.sh`, where the marker is read before the dirty tree.
  switch (row.worker) {
    case 'waiting':
      // ITS OWN LIST, because the wrong move here DESTROYS work. Restarting a
      // worker that is holding the door open re-runs what it finished before it
      // asked. Uncommitted files look identical whether a worker walked away or
      // is waiting — only the marker in the tree separates them, and the scan
      // is what reads it.
      return {
        verdict: 'question',
        action: 'answer the question in its tree',
        evidence: 'worker: waiting',
        list: 'waiting',
      };
    case 'stalled':
      // A machine's errand, not a person's: work is on the floor with no PR
      // over it, and a worker put back on the branch is what clears it. NOT
      // `abandoned` — resuming and restarting are different moves, and one
      // label over both is what sent a restart into finished work.
      return {
        verdict: 'unfinished',
        action: 'resume it',
        evidence: 'worker: stalled',
        list: 'needsAgent',
      };
    case 'failed':
      return {
        verdict: 'abandoned',
        action: 'restart it',
        evidence: 'worker: failed',
        list: 'needsAgent',
      };
    case 'ended':
      // `failed` AND `ended` SHARE ONE VERDICT, and the merge is licensed by
      // the only test that matters: both mean a process stopped leaving nobody
      // working, and both take the same move. They stay separate STATES in the
      // scan because their notes differ — one names an exit code, the other
      // says the status was not recorded — and the evidence string preserves
      // which was seen.
      return {
        verdict: 'abandoned',
        action: 'restart it',
        evidence: 'worker: ended',
        list: 'needsAgent',
      };
    case 'finished':
      // A worker that exited 0 with no marker and nothing on the floor. Its
      // move is *review it* — the same verdict a green PR gets, reached by the
      // other road, and a row with both is answered by the PR arm above.
      return {
        verdict: 'review',
        action: 'review it',
        evidence: 'worker: finished',
        list: 'needsHuman',
      };
    case 'running':
      // A LIVE WORKER, reaching here only because it has a PR that asks nobody
      // — the fall-through the `green` arm above deliberately allows. Nothing
      // below it applies: `unpushed` in particular is finished work sitting
      // still, and an agent mid-run is the one case where commits not yet
      // pushed mean the opposite of that. Returning here rather than breaking
      // is what keeps that arm from claiming a live branch is stalled.
      return null;
    default:
      // `none` and `elsewhere` — UNKNOWN, NEVER "NOBODY". `plot-dispatch`
      // writes a pid only where it started the worker itself, so a
      // hand-started worker leaves none, and a branch claimed on another
      // machine leaves nowhere to look. Reading either as abandonment would
      // have reported all five of one session's hand-started agents dead.
      // Absent is not false, so neither produces a verdict.
      break;
  }

  // FINISHED WORK NOBODY ELSE CAN SEE — the last arm, below the PR and the
  // worker, because it is the weakest signal of the three and the one most
  // often true of a row already answered above.
  //
  // Read from `stuck.state` rather than from `localAhead` directly: the
  // stuck detector already decides when unpushed commits amount to being
  // unable to move, and asking `localAhead > 0` here would be a second,
  // simpler rule sitting beside it — which is how two rules drift. It is a
  // person's errand because pushing someone else's uncommitted judgement is
  // not a mechanical act.
  if (row.stuck?.state === 'unpushed') {
    return {
      verdict: 'unpushed',
      action: 'push it',
      evidence: 'stuck.state: unpushed',
      list: 'needsHuman',
    };
  }

  return null;
}

/**
 * Is this row work nobody has taken?
 *
 * THE SAME PREDICATE THE START BUTTON USES — `waitingOn === 'click' && state
 * === 'open'` — and deliberately the same one rather than a second rule that
 * agrees today. `isStartable` lives in the client bundle, which the server
 * cannot import (it would pull React into the artifact), so the expression is
 * repeated; what is NOT repeated is the derivation. Both read `waitingOn`, the
 * field the server computes once in `waitingOnFor`, so a change there moves the
 * button and this list together.
 *
 * `waitingOn: 'click'` already implies `state: 'open'` server-side. The second
 * test costs nothing and documents that a row with a ref is not a row to start.
 */
export function isClaimable(row: AgentRow): boolean {
  return row.waitingOn === 'click' && row.state === 'open';
}

/**
 * What needs attention right now, from one cached scan.
 *
 * NO SCAN OF ITS OWN. This reads `buildFleet`, which reads a cache a timer
 * refreshes — the same rule `/api/fleet` follows and for the same reason: a
 * 1.05 s synchronous scan on a single-threaded server blocks everything else.
 * Building on `buildFleet` rather than on the raw pulse is also what keeps this
 * endpoint honest about its inputs: the rows it reads are the rows a caller can
 * fetch and check the verdicts against.
 */
export function buildAttention(opts: BuildBoardOptions): Attention {
  const fleet = buildFleet(opts);

  const needsAgent: AttentionItem[] = [];
  const needsHuman: AttentionItem[] = [];
  const waiting: AttentionItem[] = [];
  const claimable: Claimable[] = [];

  for (const row of fleet.rows) {
    if (isClaimable(row)) {
      const brief = briefPath(row.branch);
      claimable.push({
        branch: row.branch,
        plan: row.planFile,
        wave: row.wave,
        brief,
        briefExists: briefExists(opts.repoRoot, brief),
        waitingDays: row.waitingDays,
      });
      // A branch nobody has taken cannot also be abandoned or waiting: it has
      // no worker and no PR by construction, so `readingFor` would answer null
      // anyway. `continue` states that rather than relying on it.
      continue;
    }

    const reading = readingFor(row);
    if (!reading) continue;

    const item: AttentionItem = {
      branch: row.branch,
      verdict: reading.verdict,
      action: reading.action,
      evidence: reading.evidence,
      pr: row.pr?.number ?? null,
      planFile: row.planFile,
      // The board's own sentence, verbatim. The fuller context behind the
      // verdict, and free — it is already on the row. Never parsed, by anyone:
      // `verdict` is the value a caller branches on.
      note: row.note,
    };

    if (reading.list === 'needsAgent') needsAgent.push(item);
    else if (reading.list === 'waiting') waiting.push(item);
    else needsHuman.push(item);
  }

  return {
    generatedAt: new Date().toISOString(),
    // A COLD CACHE IS NOT AN EMPTY FLEET, and without this field they are the
    // same four empty lists. They are opposite facts: *nothing to do* invites a
    // caller to stop, *nothing has been read yet* invites it to wait and ask
    // again. A caller that cannot tell them apart concludes the first and the
    // fleet sits still.
    //
    // `fleet.ready` verbatim — one scan, one answer about whether it landed.
    ready: fleet.ready,
    // Null rather than 0 before the first scan, by the rule `readRefAge`
    // already states: 0 would assert a read that just happened.
    ageSeconds: fleet.ready ? fleet.ageSeconds : null,
    // WHICH WORLD these verdicts are about. A verdict is a stronger claim than
    // a fact and needs the provenance at least as much — *restart this branch*
    // is advice, and advice about a world three pushes old is worse than none.
    readRef: fleet.readRef,
    error: fleet.error,
    needsAgent,
    needsHuman,
    waiting,
    claimable,
  };
}
