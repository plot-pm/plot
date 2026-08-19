// Continuing an answered agent: a NEW run, prompted with the brief rather than
// the previous run's transcript.
//
// **The assertion this file exists for is a negative one** — that the prompt
// does NOT carry the transcript. It is the decision the plan's interrogation
// turned on, and it is the kind of decision that decays silently: a later
// change adding "just a bit of context for continuity" would break nothing, and
// the next six-figure-token prompt would be found by an operator rather than by
// CI. So it is asserted directly, from both ends — the composer refuses to
// include it, and no transcript-shaped source is even reachable from the route.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ANSWER_MAX,
  BODY_LIMIT,
  COMMIT_MAX,
  CONTINUATION_ENV,
  CONTINUATION_NAME,
  briefPathFor,
  composeContinuation,
  continueAvailability,
  landedCommits,
  readBrief,
} from '../../src/server/continue.js';

/** A composed prompt with every part present, for the assertions below. */
function prompt(over: Partial<Parameters<typeof composeContinuation>[0]> = {}) {
  return composeContinuation({
    branch: 'feature/continue-with-an-answer',
    briefPath: '.plot/briefs/continue-with-an-answer.md',
    briefText: '# Brief\n\nImplement wave Answer. Reuse the same-origin guard.',
    answer: 'Use the existing endpoint; do not add a second one.',
    question: 'PLOT-BLOCKED: should this reuse /api/dispatch or add a route?',
    landed: ['abc1234 board: serve the worker log', 'def5678 board: add the agent panel'],
    ...over,
  });
}

describe('the prompt carries the brief, not the transcript', () => {
  // THE DECISION THE INTERROGATION TURNED ON. Everything else in this file is
  // ordinary coverage; this is the one that must not be quietly relaxed.
  it('contains the brief', () => {
    const p = prompt();
    assert.ok(p.includes('Implement wave Answer'), 'the brief text must be in the prompt');
    assert.ok(
      p.includes('.plot/briefs/continue-with-an-answer.md'),
      'the brief PATH must be named so the worker can re-read the whole of it',
    );
  });

  it('contains the answer', () => {
    assert.ok(prompt().includes('Use the existing endpoint; do not add a second one.'));
  });

  it('names what already landed, by subject', () => {
    const p = prompt();
    assert.ok(p.includes('abc1234 board: serve the worker log'));
    assert.ok(p.includes('def5678 board: add the agent panel'));
  });

  it('names the commits WITHOUT pasting their contents', () => {
    // The same context-filling mistake one layer down: a diff is as capable of
    // filling a context window as a transcript is.
    const p = prompt({
      landed: ['abc1234 board: serve the worker log'],
    });
    assert.ok(!p.includes('diff --git'), 'a prompt must never carry diffs');
    assert.ok(!/^[+-]{3} [ab]\//m.test(p), 'a prompt must never carry patch hunks');
  });

  it('does NOT embed the previous run’s transcript', () => {
    // The composer takes no transcript parameter at all, which is the strongest
    // form of this assertion: there is no argument through which one could
    // arrive. Asserted here as behaviour rather than as a type, because a later
    // change could add the parameter without any test noticing.
    const composed = composeContinuation as unknown as (i: Record<string, unknown>) => string;
    const p = composed({
      branch: 'feature/x',
      briefPath: '.plot/briefs/x.md',
      briefText: 'the brief',
      answer: 'the answer',
      question: 'the question',
      landed: [],
      // Offered, and must be ignored — a caller cannot smuggle one in.
      transcript: 'ASSISTANT: I have been running for an hour and here is all of it…',
    });
    assert.ok(
      !p.includes('ASSISTANT: I have been running for an hour'),
      'a transcript passed to the composer must not reach the prompt',
    );
  });

  it('stays small — the whole point of not carrying the transcript', () => {
    // A real brief is a few KB; a real transcript is six figures of TOKENS. The
    // bound is generous and still an order of magnitude below what it excludes,
    // so it fails on a regression that reintroduces bulk rather than on a
    // slightly longer brief.
    const p = prompt({ briefText: 'x'.repeat(8_000) });
    assert.ok(p.length < 32_000, `prompt was ${p.length} chars`);
  });
});

describe('the prompt names itself a continuation, never a reply', () => {
  it('tells the worker the previous agent has exited', () => {
    const p = prompt();
    assert.ok(/exited/i.test(p), 'the prompt must say the previous worker is gone');
    assert.ok(/NEW run/.test(p), 'the prompt must say this is a new run');
  });

  it('never promises a conversation', () => {
    const p = prompt().toLowerCase();
    // A worker told it is replying looks for a thread to rejoin and finds none.
    assert.ok(!/\breply to the (agent|worker)\b/.test(p));
    assert.ok(!/\bconversation to resume\b/.test(p) || /no conversation to resume/.test(p));
  });
});

describe('what already landed', () => {
  it('says so plainly when nothing has', () => {
    // An empty list is a REAL answer — a branch that has committed nothing —
    // and must not read as a failed lookup.
    const p = prompt({ landed: [] });
    assert.ok(p.includes('Nothing has been committed on this branch yet.'));
  });

  it('says the list is a tail when it was truncated', () => {
    const many = Array.from({ length: COMMIT_MAX }, (_, i) => `c${i} subject ${i}`);
    const p = prompt({ landed: many, truncated: true });
    assert.ok(
      /there are more before these/.test(p),
      'a truncated list must say it is one, or it reads as the whole history',
    );
  });

  it('does not claim truncation when the list is whole', () => {
    assert.ok(!/there are more before these/.test(prompt({ truncated: false })));
  });
});

describe('the stale marker is handed to the worker, deliberately', () => {
  // The decision is documented in handleContinue; this asserts the half of it
  // the prompt is responsible for. If the route ever starts deleting the marker
  // itself, this test should be deleted WITH the reasoning updated — not left
  // passing beside a second mechanism.
  it('tells the worker the marker is still there and is theirs to clear', () => {
    const p = prompt();
    assert.ok(/marker/i.test(p), 'the prompt must mention the marker');
    assert.ok(/still in this tree/i.test(p), 'it must say the marker still stands');
    assert.ok(/delete/i.test(p), 'it must say who clears it');
  });

  it('tells the worker how to ask a NEW question', () => {
    assert.ok(prompt().includes('PLOT-BLOCKED:'));
  });
});

describe('a brief that could not be read', () => {
  it('sends the worker to read it rather than starting silently', () => {
    const p = prompt({ briefText: '' });
    assert.ok(
      p.includes('could not be read'),
      'an absent brief must be stated, not silently omitted',
    );
    assert.ok(p.includes('.plot/briefs/continue-with-an-answer.md'));
  });
});

describe('where a brief lives', () => {
  for (const [branch, rel] of [
    ['feature/continue-with-an-answer', '.plot/briefs/continue-with-an-answer.md'],
    ['bug/a-blocked-branch-says-it-is-blocked', '.plot/briefs/a-blocked-branch-says-it-is-blocked.md'],
    // No slash at all: the branch IS the slug.
    ['spike', '.plot/briefs/spike.md'],
    // Nested prefixes take the LAST segment, matching /plot-implement.
    ['team/a/b', '.plot/briefs/b.md'],
  ] as const) {
    it(`${branch} → ${rel}`, () => {
      assert.equal(briefPathFor(branch), rel);
    });
  }
});

describe('reading a brief from the worktree', () => {
  it('returns "" for a brief that is not there, never throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-'));
    try {
      assert.equal(readBrief(dir, '.plot/briefs/absent.md'), '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the WORKTREE’s copy, which is the one that branch was given', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-brief-'));
    try {
      fs.mkdirSync(path.join(dir, '.plot/briefs'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.plot/briefs/x.md'), 'the worktree copy');
      assert.equal(readBrief(dir, '.plot/briefs/x.md'), 'the worktree copy');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what already landed, read from git', () => {
  /** A repo with a trunk and a branch holding two commits on top of it. */
  function repo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-landed-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-qm', 'trunk: the commit before the branch');
    git('checkout', '-qb', 'feature/x');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git('add', '.');
    git('commit', '-qm', 'board: the first thing that landed');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c');
    git('add', '.');
    git('commit', '-qm', 'board: the second thing that landed');
    return dir;
  }

  it('reports what the BRANCH added, not the trunk’s history', () => {
    const dir = repo();
    try {
      const landed = landedCommits(dir, 'main');
      assert.equal(landed.length, 2, 'only the branch’s own commits');
      assert.ok(landed[0].includes('the first thing that landed'));
      assert.ok(landed[1].includes('the second thing that landed'));
      assert.ok(
        !landed.some((l) => l.includes('the commit before the branch')),
        'the trunk’s commits are not this run’s work',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is oldest-first — the order the work happened in', () => {
    const dir = repo();
    try {
      const landed = landedCommits(dir, 'main');
      assert.ok(landed[0].includes('first'), 'a briefing reads forwards, not backwards');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the branch’s own history when main is unknown', () => {
    const dir = repo();
    try {
      const landed = landedCommits(dir, '');
      assert.ok(landed.length >= 2, 'over-reporting beats reporting nothing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns [] rather than throwing for a directory that is not a repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-notrepo-'));
    try {
      assert.deepEqual(landedCommits(dir, 'main'), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours its bound', () => {
    const dir = repo();
    try {
      assert.ok(landedCommits(dir, '', 1).length <= 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the continuation prompt is a file, never a shell word', () => {
  // The reason the whole design routes the answer through a file: `Worker
  // command` is a shell FRAGMENT run through `sh -c`, so an answer interpolated
  // into it would be shell source.
  it('is named beside the other .plot-worker records', () => {
    // So the marker search, which excludes `.plot-worker.*`, cannot mistake a
    // continuation prompt quoting the old question for a NEW question.
    assert.ok(
      CONTINUATION_NAME.startsWith('.plot-worker.'),
      'a prompt outside that prefix would be re-detected as an unanswered marker',
    );
  });

  it('travels to the worker in the environment', () => {
    assert.equal(CONTINUATION_ENV, 'PLOT_CONTINUATION');
    assert.ok(CONTINUATION_ENV.startsWith('PLOT_'), 'beside PLOT_BRANCH and PLOT_WORKTREE');
  });

  it('survives an answer that is shell metacharacters end to end', () => {
    // Composed, not executed — but the assertion is that composition does no
    // escaping and needs none, because nothing here reaches a shell.
    const nasty = '"; rm -rf ~; echo $(whoami) `id` \\\'';
    const p = prompt({ answer: nasty });
    assert.ok(p.includes(nasty), 'the answer reaches the worker verbatim');
  });
});

describe('the bounds', () => {
  it('leaves room for the answer inside the body limit', () => {
    // The failure this prevents: a body bound below the answer bound, where a
    // legal answer is rejected as a transport error naming no field.
    assert.ok(BODY_LIMIT > ANSWER_MAX, 'the body must hold an answer plus its framing');
  });

  it('bounds the answer at all', () => {
    assert.ok(ANSWER_MAX > 0 && ANSWER_MAX <= 64 * 1024);
  });
});

describe('continuing is a localhost capability', () => {
  // The same binding argument /api/dispatch documents: whoever reaches
  // localhost is sitting at the machine that owns the worktrees, and that IS
  // the permission.
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    it(`is available on ${host}`, () => {
      assert.equal(continueAvailability(host).available, true);
    });
  }

  for (const host of ['0.0.0.0', '192.168.1.10']) {
    it(`is refused on ${host}, with a reason that names it`, () => {
      const a = continueAvailability(host);
      assert.equal(a.available, false);
      assert.ok(a.reason.includes(host), 'the refusal must name the binding it is about');
      assert.ok(a.reason !== '', 'a control that cannot act must say why before it is clicked');
    });
  }
});
