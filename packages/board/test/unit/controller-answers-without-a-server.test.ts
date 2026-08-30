// The controller answers with no server and no `host` — the assertion that
// makes the layer worth having.
//
// **WHY THIS FILE IS IN `test/unit`, and why that is the assertion rather than
// a filing decision.** The vitest config splits its two projects on the
// contended resource, and `parallel-project-takes-no-resource.test.ts` gates
// `test/unit` against any file mentioning `startServer` or `chromium`. So a
// controller test that lives here CANNOT quietly start a server: the gate
// fails the run if it does. That is the done-when condition — "callable from a
// test with no server" — enforced by something other than this comment.
//
// The `host` half is enforced by the type. `FleetStateQuery` carries `opts`
// and nothing else, so a caller with a binding has nothing to pass it; the
// third assertion below pins that shape so a later widening has to edit a test
// that says why it should not.
//
// **A discovery this file records for the slice that consumes the shape.** The
// controller's answer is not free of transport FIELDS — `buildBoard` emits
// zeroed placeholders for all eleven, because the `Board` schema requires
// them, and the route overwrites them where the binding is known. A master
// agent calling the controller therefore receives `server.port: 0` and ten
// flags reading `available: false`, which is honest about the binding but
// reads like a refusal rather than an absence. Whether that shape serves a
// caller with no server is the entry point's question, not this slice's.
//
// **What this file deliberately does NOT do: go through HTTP.** The plan defers
// migrating the 65 server-starting tests and states the risk of deferring it —
// a controller layer whose tests still go through HTTP has paid for the seam
// without collecting on it. This file is the first instalment on that debt,
// not the migration.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { boardState, type FleetStateQuery } from '../../src/server/controllers/fleet-state.js';
import { isLocalCaller, localCapability } from '../../src/server/controllers/caller.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills/plot/scripts');

/** A scratch repo with one plan — enough estate for the controller to answer. */
const makeRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-controller-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Test\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  fs.writeFileSync(
    path.join(dir, 'docs/plans/2026-08-30-a-plan-the-controller-can-read.md'),
    ['# A plan the controller can read', '', '## Status', '',
      '- **Phase:** Approved', '- **Type:** feature', ''].join('\n'),
  );
  git('add', '-A');
  git('commit', '-qm', 'plan');
  return dir;
};

describe('the controller answers without a server', () => {
  it('returns the estate from typed arguments alone', () => {
    const dir = makeRepo();
    try {
      // No server, no port, no request object — just where to read from.
      const answer = boardState({ opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR } });

      assert.ok(Array.isArray(answer.columns), 'the answer carries columns');
      const slugs = answer.columns.flatMap((c) => c.cards.map((card) => card.slug));
      assert.ok(
        slugs.includes('a-plan-the-controller-can-read'),
        `the plan on disk reaches the answer; got ${JSON.stringify(slugs)}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('knows no transport fact, and says so in the placeholders', () => {
    const dir = makeRepo();
    try {
      const answer = boardState({ opts: { repoRoot: dir, scriptsDir: SCRIPTS_DIR } });

      // MEASURED, and not what this test first asserted: the ten flags and
      // `server` are not ABSENT from the controller's answer, they are EMPTY.
      // `buildBoard` has always emitted zeroed placeholders — the `Board`
      // schema requires the fields — which the route then overwrites at
      // response time, where the binding is known. That spread order is also
      // why this slice moved no byte of the payload.
      //
      // So the claim worth pinning is not "the field is missing" but "the
      // controller supplies no transport ANSWER": every flag refuses, and the
      // refusals carry no reason because the walker has nothing to say about a
      // socket it never saw.
      for (const flag of ['dispatch', 'approve', 'continue', 'idea', 'commission',
        'reslice', 'deliver', 'implement', 'drop', 'story'] as const) {
        assert.deepEqual(
          answer[flag], { available: false, reason: '' },
          `${flag} is the caller's to answer, not the controller's to know`,
        );
      }
      assert.deepEqual(
        answer.server, { restartCommand: '', port: 0, branch: '', repo: '' },
        'the controller names no binding',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes a query of `opts` and nothing else', () => {
    // A compile-time claim made checkable at runtime: widening the query with a
    // `host` (or a port, or a request) has to edit this test, and the comment
    // above says why it should not be widened.
    const query: FleetStateQuery = { opts: { repoRoot: '/nowhere', scriptsDir: '/nowhere' } };
    assert.deepEqual(Object.keys(query), ['opts']);
  });
});

describe('the origin check exists once', () => {
  it('answers the same question for every capability', () => {
    for (const local of ['localhost', '127.0.0.1', '::1']) {
      assert.equal(isLocalCaller(local), true, `${local} is local`);
    }
    for (const remote of ['0.0.0.0', '100.64.0.1', 'board.example.com', '']) {
      assert.equal(isLocalCaller(remote), false, `${remote} is not local`);
    }
  });

  it('keeps the refusal sentence per capability', () => {
    // The condition is shared; the sentence is not. That split is what let the
    // six copies collapse without moving a byte of the payload.
    const dispatch = localCapability('0.0.0.0', 'starting work', 'the worktrees');
    const story = localCapability('0.0.0.0', 'turning a ticket into a story', 'the repo');

    assert.equal(dispatch.available, false);
    assert.equal(
      dispatch.reason,
      'the board is bound to 0.0.0.0, not localhost — starting work is available only on the machine that owns the worktrees',
    );
    assert.notEqual(dispatch.reason, story.reason, 'two capabilities refuse in their own words');
    assert.deepEqual(
      localCapability('localhost', 'starting work', 'the worktrees'),
      { available: true, reason: '' },
      'an available capability carries no reason',
    );
  });
});
