// The card's claimed/eligible counts, end to end: a REAL git repo with a REAL
// pushed claim, scanned by the real plot-fleet-scan.sh, served by the built
// artifact. No stubs and no hand-built pulse objects anywhere in this file.
//
// That matters more here than in most suites. The bug being fixed was a card
// asking the plan file about facts that live in git refs, and every unit test
// of it necessarily hands the code a pulse someone typed. Only a repo where a
// claim is an actual empty `plot: claim <branch>` commit on an actual remote
// can show that the board reads the ref rather than the annotation — the two
// agree in a fixture and disagree in life.
//
// Everything is local: a bare repo on disk is the "remote". Nothing here
// touches a network or a git host.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, fetchBoard, git } from './helpers.mjs';

// Two branches in one wave: one claimed, one free. The plan file annotates
// NEITHER — exactly as real plans have it, since `/plot-dispatch` claims by
// pushing a ref and no command writes the annotation back.
const PLAN = `# The board asks git about work in flight

## Status
- **Phase:** Approved
- **Type:** bug

## Branches

### Fixes

- \`bug/board-claimed-from-git\` — the card reads claims from the pulse
- \`bug/dispatch-records-started\` — dispatch books what it started
`;

/**
 * A repo whose claims are real: a bare remote, a plan symlinked into active/,
 * and one branch taken by an empty `plot: claim` commit pushed to that remote.
 *
 * The claim's SHAPE is load-bearing and is why this is not a one-liner. The
 * scan counts a branch as claimed only when its commits beyond main are all
 * empty and titled `plot: claim …` — a branch merely pointing at main reads as
 * merged, because two branches at the same commit do not diverge and both
 * dispatchers would think they won.
 */
function makeClaimedRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-claimed-'));
  const repo = path.join(tmp, 'work');
  const remote = path.join(tmp, 'remote.git');
  fs.mkdirSync(repo, { recursive: true });

  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });
  const g = git(repo);
  g('init', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'Plot Test');
  g('config', 'commit.gpgsign', 'false');

  const plans = path.join(repo, 'docs/plans');
  fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
  const planName = '2026-08-16-board-reads-git.md';
  fs.writeFileSync(path.join(plans, planName), PLAN, 'utf8');
  fs.symlinkSync(path.join(plans, planName), path.join(plans, 'active', planName));

  g('add', '-A');
  g('commit', '-m', 'plan: board reads git');
  g('remote', 'add', 'origin', remote);
  g('push', '-u', 'origin', 'main');

  // THE CLAIM: an empty commit, titled the way plot-dispatch.sh titles it,
  // pushed as a ref. This — not any text in the plan — is what taking a branch
  // means, and what the card must learn to read.
  const claimed = 'bug/board-claimed-from-git';
  g('checkout', '-b', claimed);
  g('commit', '--allow-empty', '-m', `plot: claim ${claimed}`);
  g('push', 'origin', claimed);
  g('checkout', 'main');

  // The second branch is deliberately NOT pushed: unclaimed, and therefore
  // startable. One repo shows both halves of the answer.
  return { tmp, repo, planName, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

describe('board: a claimed branch is claimed on the card', () => {
  let fixture, server, card;

  before(async () => {
    fixture = makeClaimedRepo();
    server = await startServer(fixture.repo);
    // The pulse is warmed in the background at start-up, so the first board
    // response can legitimately precede it. Poll briefly rather than sleeping a
    // fixed amount — and if the counts never arrive, the assertions below fail
    // loudly instead of this helper hiding it.
    //
    // The loop waits for the SCAN to have landed, not merely for the field to
    // be defined. Breaking on `!== undefined` would accept a pulse that reached
    // the card before it knew about this plan's branches, and the suite would
    // then be asserting against a half-warmed cache — passing or failing on
    // timing rather than on behaviour.
    for (let i = 0; i < 40; i++) {
      const board = await fetchBoard(server.port);
      card = board.columns.flatMap((c) => c.cards).find((c) => c.slug === 'board-reads-git');
      const s = card?.waveSummary;
      if (s && (s.claimed ?? 0) + (s.eligible ?? 0) === s.branches) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(() => {
    server?.kill();
    fixture?.cleanup();
  });

  it('reports claimed: 1 for the branch whose claim ref was pushed', () => {
    // The headline. Before this change the count was read from a plan-file
    // annotation nobody writes, so it was 0 here — permanently, not merely
    // stale — while the Agents tab showed the same claim correctly.
    assert.ok(card, 'the plan should render as a card');
    assert.equal(card.waveSummary.claimed, 1);
  });

  it('reports the unclaimed branch of an eligible wave as ready to start', () => {
    // A number WaveSummary could not carry at all before, which is why the
    // previous plan had to leave "should Start work be disabled?" unanswered.
    assert.equal(card.waveSummary.eligible, 1);
  });

  it('carries the counts on a SINGLE-wave plan', () => {
    // The old `meta.waves.length > 1` guard would have withheld everything
    // above from this plan — and from most plans in this repo.
    assert.equal(card.waveSummary.waves, 1);
    assert.equal(card.waveSummary.branches, 2);
  });

  it('counts the claim even though the plan file annotates none', () => {
    // Proof that the number came from the ref and not from the file: the plan
    // on disk contains no claim annotation at all.
    const raw = fs.readFileSync(
      path.join(fixture.repo, 'docs/plans', fixture.planName), 'utf8',
    );
    assert.ok(!/claimed:/i.test(raw), 'fixture plan must carry no claim annotation');
    assert.equal(card.waveSummary.claimed, 1);
  });
});

describe('board: no pulse means no counts, never zero counts', () => {
  let tmp, server;

  before(async () => {
    // A plans directory with no git repo at all: the scan can say nothing. This
    // is the same condition as a cold cache, reached deterministically.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-nogit-'));
    const plans = path.join(tmp, 'docs/plans');
    fs.mkdirSync(path.join(plans, 'active'), { recursive: true });
    const name = '2026-08-16-board-reads-git.md';
    fs.writeFileSync(path.join(plans, name), PLAN, 'utf8');
    fs.symlinkSync(path.join(plans, name), path.join(plans, 'active', name));
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('omits claimed and eligible rather than reporting 0', async () => {
    // The distinction the whole change turns on. "I have not looked" must not
    // render as "nobody is working on this" — that indistinguishability is the
    // defect, and a card that says 0 here would have re-created it in a new
    // place.
    const board = await fetchBoard(server.port);
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.slug === 'board-reads-git');
    assert.ok(card, 'the plan should still render as a card without git');
    assert.equal(card.waveSummary.claimed, undefined);
    assert.equal(card.waveSummary.eligible, undefined);
    // Plan-derived shape survives: it never needed git.
    assert.equal(card.waveSummary.branches, 2);
  });
});
