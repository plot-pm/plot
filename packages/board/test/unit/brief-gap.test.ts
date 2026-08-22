import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefState, rowsFromPulse } from '../../src/server/fleet.js';
import { briefGapNote, needsBrief } from '../../src/app/components/AgentList.js';
import {
  AgentRowSchema, ELIGIBLE_NOTE, type AgentRow, type FleetPulse,
} from '../../src/contract/schema.js';

/**
 * A NOT STARTED row distinguishes *ready* from *needs a brief*.
 *
 * The defect these cover was measured on the live board 2026-08-19: nine rows
 * reading *eligible — nobody has taken it*, and zero briefs between them. The
 * wave arithmetic was right — every one of those branches genuinely was next —
 * and every dispatch the phrase invited would have started an agent that reads
 * `.plot/briefs/<slug>.md`, a file that was not there.
 *
 * The fact existed already: `ClaimableSchema.briefExists` has answered it for
 * `/api/attention` since #236. It did not reach the ROW, because the two answers
 * are built by different code from one repo — so an agent asking the API was
 * told and a person reading the board was not.
 *
 * These tests run against the real filesystem rather than a mock of it. The
 * subject is whether *looking* is done correctly — and the third state
 * (`unknown`, for a directory that will not answer) is a distinction only a real
 * `EACCES` produces. A stubbed `existsSync` would assert the shape of the code
 * and not the behaviour that shape exists for.
 */

const QUIET = 30;
const BRANCH = 'bug/eligible-says-whether-it-can-start';
const SLUG = 'eligible-says-whether-it-can-start';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-'));
});

afterEach(() => {
  // `chmod` back before removing: a directory the test made unreadable is one
  // `rmSync` cannot walk either, and a leaked 0o000 temp dir fails the NEXT
  // run rather than this one.
  const dir = path.join(root, '.plot/briefs');
  if (fs.existsSync(dir)) fs.chmodSync(dir, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

/** `.plot/briefs`, and a brief in it for `branch` when one is asked for. */
function writeBriefs(branch?: string) {
  const dir = path.join(root, '.plot/briefs');
  fs.mkdirSync(dir, { recursive: true });
  if (branch) {
    fs.writeFileSync(path.join(dir, `${branch.split('/').pop()}.md`), '# brief\n');
  }
  return dir;
}

/** One approved plan, one eligible wave, one open branch — the reported shape. */
const pulse = (branch = BRANCH): FleetPulse => ({
  plans: [{
    file: '2026-08-19-the-row-says-what-it-knows.md',
    phase: 'approved',
    waves: [{
      name: 'Saying it',
      verdict: 'eligible',
      branches: [{ branch, state: 'open', deferred: false, deferred_reason: '', claimed: '' }],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
} as unknown as FleetPulse);

const rowFor = (repoRoot: string, branch = BRANCH): AgentRow =>
  rowsFromPulse(
    pulse(branch), new Map(), 'plot', QUIET,
    null, '', null, Date.now(), null, null, null, null, null, repoRoot,
  ).find((r) => r.branch === branch)!;

describe('briefState answers three things, not two', () => {
  it('says `present` where the brief is there', () => {
    writeBriefs(BRANCH);
    expect(briefState(root, BRANCH)).toBe('present');
  });

  it('says `missing` where the directory answers and the file is absent', () => {
    writeBriefs();
    expect(briefState(root, BRANCH)).toBe('missing');
  });

  it('says `missing` where `.plot/briefs` does not exist at all', () => {
    // NOT `unknown`. A repo that has never had a brief written honestly has no
    // such directory, and every branch in it needs one — which is the answer
    // `/plot-implement` acts on. Only a directory that EXISTS and will not be
    // read is unanswerable.
    expect(briefState(root, BRANCH)).toBe('missing');
  });

  it('derives the path from the branch name after its last slash', () => {
    // The convention Plot itself writes — `/plot-implement` puts the file here
    // and the `Worker command` opens by reading it. A branch with no prefix
    // still answers, and a nested prefix uses only the last segment.
    writeBriefs();
    fs.writeFileSync(path.join(root, '.plot/briefs', 'bare.md'), 'x');
    expect(briefState(root, 'bare')).toBe('present');
    expect(briefState(root, 'wip/spike/bare')).toBe('present');
  });

  it('says `unknown` where `.plot/briefs` exists and cannot be read', () => {
    // THE THIRD ANSWER, and the reason this is not `existsSync` inline.
    // `attention.ts`'s boolean twin returns `false` on any error, which is
    // defensible for a caller handed a path either way. On a row it is not: *no
    // brief — write one first* is a claim about the repository, and made on an
    // `EACCES` it sends a person to write a file that may already be there.
    const dir = writeBriefs(BRANCH);
    fs.chmodSync(dir, 0o000);
    // Root ignores the permission bits, so the distinction this asserts cannot
    // be observed as that user. Skipping beats asserting the wrong answer.
    if (fs.existsSync(path.join(dir, `${SLUG}.md`))) return;
    expect(briefState(root, BRANCH)).toBe('unknown');
  });
});

describe('the row carries whether it can be started', () => {
  it('reads as ready where the brief exists', () => {
    writeBriefs(BRANCH);
    const row = rowFor(root);
    expect(row.brief).toBe('present');
    // The wave verdict is untouched: the branch IS next, which is what the
    // operator's original question established. The row simply no longer stops
    // there.
    expect(row.note).toBe(ELIGIBLE_NOTE);
    expect(row.waitingOn).toBe('click');
    expect(needsBrief(row)).toBe(false);
  });

  it('names the gap where the brief is absent', () => {
    writeBriefs();
    const row = rowFor(root);
    expect(row.brief).toBe('missing');
    expect(needsBrief(row)).toBe(true);
  });

  it('says `unknown` where nothing looked, and renders nothing for it', () => {
    // A caller passing no root has not looked — and a pulse from a server
    // predating the field validates to the same value, so the board renders
    // exactly as it did before. `unknown` is the DEFAULT for that reason:
    // `missing` would be a claim, and silence is not one.
    const row = rowsFromPulse(pulse(), new Map(), 'plot', QUIET)
      .find((r) => r.branch === BRANCH)!;
    expect(row.brief).toBe('unknown');
    expect(needsBrief(row)).toBe(false);
    expect(AgentRowSchema.parse({ ...row, brief: undefined }).brief).toBe('unknown');
  });

  it('asks about a branch whatever it is doing', () => {
    // ON EVERY ROW, not only the startable ones. Scoping the FIELD to
    // `not-started` would make a row's own history unreadable the moment it
    // moved; the renderer decides where saying so helps.
    writeBriefs();
    const claimed = rowsFromPulse(
      {
        ...pulse(),
        plans: [{
          ...pulse().plans[0],
          waves: [{
            name: 'Saying it',
            verdict: 'eligible',
            branches: [{
              branch: BRANCH, state: 'claimed', deferred: false,
              deferred_reason: '', claimed: 'claimed: someone',
            }],
          }],
        }],
      } as unknown as FleetPulse,
      new Map(), 'plot', QUIET,
      null, '', null, Date.now(), null, null, null, null, null, root,
    ).find((r) => r.branch === BRANCH)!;
    expect(claimed.brief).toBe('missing');
    // …and the renderer still says nothing, because this row's move is not
    // starting.
    expect(needsBrief(claimed)).toBe(false);
  });
});

describe('the phrasing blames the file, never a person', () => {
  const note = briefGapNote(BRANCH);

  it('names the missing document and what writes it', () => {
    expect(note).toContain(`.plot/briefs/${SLUG}.md`);
    expect(note).toContain('/plot-implement');
  });

  it('never says nobody took it, or anything else about a person', () => {
    // The sharper half of the reported defect. *nobody has taken it* supplies
    // the reason nobody has taken it as if it were an accident of attention —
    // an invitation with a missing actor, when what is missing is a FILE. A
    // worker takes a branch; `/plot-implement` writes a brief. Different jobs,
    // different things doing them.
    for (const blame of ['nobody', 'no one', 'anyone', 'unassigned', 'assignee', 'someone']) {
      expect(note.toLowerCase()).not.toContain(blame);
    }
  });

  it('does not invite a dispatch', () => {
    // It names what to RUN, and the thing it names is not the dispatcher. An
    // operator told *nobody has taken it* runs `/plot-dispatch` and starts an
    // agent onto a file that is not there; this one points at the command that
    // writes the file.
    expect(note).not.toMatch(/dispatch|start work/i);
  });

  it('uses the same slug the server derived', () => {
    // Agreement by construction, both following the convention Plot writes: the
    // branch name after its last `/`. A drift here would print a path the
    // server never checked.
    writeBriefs();
    expect(rowFor(root).brief).toBe('missing');
    expect(briefGapNote(BRANCH)).toContain(SLUG);
  });
});

describe('needsBrief reads the field, and only where starting is the move', () => {
  const row = (over: Partial<AgentRow>): AgentRow => ({
    ...rowsFromPulse(pulse(), new Map(), 'plot', QUIET)
      .find((r) => r.branch === BRANCH)!,
    ...over,
  });

  it('fires on a startable row with no brief', () => {
    expect(needsBrief(row({ brief: 'missing' }))).toBe(true);
  });

  it('stays silent on `unknown` — the board has nothing to tell the reader', () => {
    expect(needsBrief(row({ brief: 'unknown' }))).toBe(false);
  });

  it('stays silent on a blocked row, which has a wave to wait for first', () => {
    expect(needsBrief(row({ brief: 'missing', waitingOn: 'time' }))).toBe(false);
  });

  it('stays silent on a row a person must act on for another reason', () => {
    // A Draft plan's branch, or a shelved one. The brief is not what is holding
    // it, and saying so would spend the reader's attention on the wrong gap.
    expect(needsBrief(row({ brief: 'missing', waitingOn: 'you' }))).toBe(false);
  });

  it('stays silent once the branch has a ref', () => {
    expect(needsBrief(row({ brief: 'missing', state: 'claimed' }))).toBe(false);
  });
});
