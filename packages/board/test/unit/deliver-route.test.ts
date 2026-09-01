// `POST /api/deliver`: what it refuses, what it spawns, and what the prompt it
// hands the agent must contain.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the prompt file, the 202
// body — never against output a spawned command produces. The command these
// tests configure is `true`, which needs no budget at all. The measured failure
// this avoids: a 1 ms timeout that passed on macOS and lost on CI, and a
// teardown racing a detached child.
//
// **The precondition is READ THROUGH THE REAL PARSER for the answers a pulse is
// not needed for.** "A plan is deliverable when every non-deferred branch has
// merged" is a claim about the pulse, which these tests inject; but
// "already-delivered" and "not-found" are claims about the plan FILE's phase and
// its resolvability, so one test runs `deliverability` against real plan files
// to pin those. The merged/deliverable refusals are then asserted with the
// verdict injected, which keeps them raceless and independent of a pulse.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  composeDeliverPrompt,
  deliverability,
  deliverAvailability,
  deliverPromptPath,
  handleDeliver,
  type Deliverability,
  type DeliverDeps,
  type DeliverRefusal,
} from '../../src/server/deliver.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  // Synchronous and unconditional. Nothing spawned here outlives the call —
  // `true` has exited by the time the 202 is written — so there is no child to
  // race and `maxRetries` is not being asked to win anything.
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo with a plan directory, and whatever plans a test wants in it. */
function repo(plans: Record<string, string> = {}): string {
    // A NESTED DIR, the shape `implement-route.test.ts` established: a
  // spawning command writes its prompt, log and state to
  // `path.resolve(repoRoot, '..')`. With the repo AT the tmpdir root those
  // land in the shared temp directory, survive `rmSync(dir)`, and the next
  // run finds a file a refusal test asserts is absent. One level down puts
  // them inside the tree afterEach removes.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  for (const [name, body] of Object.entries(plans)) {
    fs.writeFileSync(path.join(dir, 'docs/plans', name), body, 'utf8');
  }
  return dir;
}

const SLUG = 'a-merged-plan';

/**
 * A plan the locator can find. Its phase and branches matter only to the
 * real-parser test; the handler tests inject the verdict, so the file's shape is
 * irrelevant to them — but it must EXIST for the happy path's `resolvePlanBySlug`
 * to name a real file in the prompt.
 */
function mergedPlan(dir: string): void {
  fs.writeFileSync(path.join(dir, 'docs/plans', `2026-08-21-${SLUG}.md`), [
    '# A merged plan', '', '## Status', '',
    '- **Phase:** Approved',
    '- **Type:** feature',
    '', '## Branches', '',
    '### Implementation',
    '- `feature/one` — the first branch',
    '', '## Changelog', '', '- a plan whose work has landed', '',
  ].join('\n'), 'utf8');
}

/** A request, with a body and the headers a same-origin POST carries. */
function request(body: unknown): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

/** A response that records rather than writes. */
function response(): { res: http.ServerResponse; got: Captured } {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
}

/**
 * Run the handler with everything injectable defaulted to a deliverable plan.
 *
 * `Idea command: true` — a command that exists, succeeds and produces nothing.
 * The tests assert what the handler wrote BEFORE spawning, so the command's
 * behaviour is deliberately irrelevant and deliberately instant. `check`
 * defaults to `deliverable`, so the happy path acts without reading a pulse.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    check?: (() => Deliverability);
    host?: string;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: DeliverDeps = {
    config: (_o, key, fallback) =>
      key === 'Idea command' ? (opts.command ?? 'true') : fallback,
    check: () => (opts.check ? opts.check() : { verdict: 'deliverable' }),
  };
  await handleDeliver(
    request(opts.body ?? { slug: SLUG }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the action delivers a fully-merged plan, and writes the prompt before it answers', () => {
  it('accepts a deliverable plan and writes the prompt before it answers', async () => {
    const dir = repo();
    mergedPlan(dir);
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.slug, SLUG);
    // The prompt exists at 202 time — the property that makes every assertion
    // below raceless.
    const prompt = fs.readFileSync(deliverPromptPath(dir, SLUG), 'utf8');
    assert.match(prompt, /deliver/i);
    // And it names the real file the locator resolved, not a slug it guessed.
    assert.match(prompt, new RegExp(`2026-08-21-${SLUG}\\.md`));
  });
});

describe('the prompt says verify-then-deliver, deliver-not-release, and move the symlink', () => {
  it('tells the agent to re-verify the merges before delivering, and STOP if a branch is open', () => {
    const prompt = composeDeliverPrompt({
      slug: SLUG,
      planFile: `/repo/docs/plans/2026-08-21-${SLUG}.md`,
    });
    // The board's bump is a measurement off a pulse that can be stale; the agent
    // re-checks the merges itself and stops rather than delivering unfinished work.
    assert.match(prompt, /verify/i);
    assert.match(prompt, /merged/i);
    assert.match(prompt, /STOP/);
  });

  it('tells the agent to deliver, never release', () => {
    const prompt = composeDeliverPrompt({ slug: 's', planFile: '/repo/docs/plans/2026-08-21-s.md' });
    assert.match(prompt, /Read the plan at \/repo\/docs\/plans\/2026-08-21-s\.md/);
    // Delivering is not releasing — cutting a version is a separate decision.
    assert.match(prompt, /never release/i);
    assert.match(prompt, /plot-release/);
  });

  it('tells the agent to move the index symlink with the phase flip', () => {
    const prompt = composeDeliverPrompt({ slug: 's', planFile: '/repo/docs/plans/s.md' });
    // A phase flip without the symlink move is the drift that fails the reconcile
    // gate — the prompt names the whole transition as one act.
    assert.match(prompt, /symlink/i);
    assert.match(prompt, /Delivered:/);
  });
});

describe('an action that cannot work is not offered', () => {
  const refusal = (got: Captured): DeliverRefusal => got.body.reason as DeliverRefusal;

  it('refuses when no Idea command is configured, rather than doing nothing', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(refusal(got), 'no-deliver-command');
    // The refusal NAMES THE FIX. A board that accepted the click and silently
    // did nothing is this repo's recurring defect wearing a button.
    assert.match(String(got.body.detail), /Idea command/);
    assert.ok(!fs.existsSync(deliverPromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('never runs the `none` sentinel as a command', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    // `none` is the repo's established "we do this by hand" answer. Running it
    // would spawn `none: command not found` and log that as the reason.
    assert.equal(refusal(got), 'no-deliver-command');
  });

  it('refuses a plan with an unmerged branch — #350\'s gate, not weakened', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, check: () => ({ verdict: 'not-merged' }) });
    assert.equal(refusal(got), 'not-deliverable');
    assert.match(String(got.body.detail), /not merged/);
    assert.ok(!fs.existsSync(deliverPromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('refuses an incomplete scan with its OWN reason, never `not-deliverable`', async () => {
    // Item 2. The two states need opposite responses — go finish the branch,
    // versus wait five seconds and ask again — so one refusal cannot carry both.
    // Asserted as a distinct reason string rather than a distinct message,
    // because a client switching on `reason` is what makes them actionable
    // separately.
    const dir = repo();
    const got = await post({ repoRoot: dir, check: () => ({ verdict: 'scan-incomplete' }) });
    assert.equal(refusal(got), 'scan-incomplete');
    assert.notEqual(refusal(got), 'not-deliverable');
    assert.ok(!fs.existsSync(deliverPromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('names the SCAN and not the branches when the scan is incomplete', async () => {
    // Item 3, and the reason this plan exists. On 2026-08-27 an operator was
    // told a plan had `a branch that is not merged` — about a plan whose two PRs
    // had merged the day before — and went looking for the branch. The message
    // must send them to the scan instead, and must NOT make the claim that
    // misdirected them.
    const dir = repo();
    const got = await post({ repoRoot: dir, check: () => ({ verdict: 'scan-incomplete' }) });
    const detail = String(got.body.detail);
    assert.match(detail, /scan/i, 'the message names the scan');
    // The exact phrase from the old refusal, which was the misdirection. Its
    // absence is the assertion — a reader must not be told a branch is unmerged
    // when nothing is known to be.
    assert.doesNotMatch(detail, /has a branch that is not merged/);
    assert.match(detail, /nothing is known to be unmerged/i);
  });

  it('refuses a plan already delivered — the decision was already made', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, check: () => ({ verdict: 'already-delivered' }) });
    assert.equal(refusal(got), 'already-delivered');
    assert.match(String(got.body.detail), /already delivered/);
    assert.ok(!fs.existsSync(deliverPromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('refuses a plan whose waves cannot be read', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, check: () => ({ verdict: 'not-found' }) });
    assert.equal(refusal(got), 'plan-unreadable');
    assert.ok(!fs.existsSync(deliverPromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('rejects a body whose slug is missing or invalid', async () => {
    const dir = repo();
    for (const bad of [{ slug: '../../etc/passwd' }, { slug: '' }, { slug: 42 }, {}]) {
      const got = await post({ repoRoot: dir, body: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });

  it('is unavailable off localhost, where the repo is not', () => {
    // The capability flag wraps `ideaAvailability` — delivering shares the idea
    // binding — but is its own named export, so the day it needs a different
    // precondition there is a seam for it.
    assert.equal(deliverAvailability('0.0.0.0').available, false);
    assert.match(deliverAvailability('0.0.0.0').reason, /not localhost/);
    assert.equal(deliverAvailability('localhost').available, true);
  });
});

describe('deliverability is read through the real plan parser for the pulse-free verdicts', () => {
  it('reads an already-delivered plan from its phase, and a missing slug as not-found', () => {
    // THE TWO VERDICTS A PULSE IS NOT NEEDED FOR, run against real plan files.
    // `already-delivered` is decided by the plan's own phase — a delivered plan
    // has every wave merged too, so the phase check must come first — and
    // `not-found` by whether the slug resolves at all.
    const dir = repo();
    const opts = { repoRoot: dir, scriptsDir: SCRIPTS };

    fs.writeFileSync(path.join(dir, 'docs/plans', '2026-08-21-shipped.md'), [
      '# Shipped', '', '## Status', '', '- **Phase:** delivered', '- **Type:** feature',
      '', '## Branches', '', '### Only', '- `feature/done` — the merged branch',
      '', '## Changelog', '', '- delivered already', '',
    ].join('\n'), 'utf8');
    assert.equal(deliverability(opts, 'shipped').verdict, 'already-delivered');

    // A released plan is past delivered — also answered `already-delivered`.
    fs.writeFileSync(path.join(dir, 'docs/plans', '2026-08-21-released.md'), [
      '# Released', '', '## Status', '', '- **Phase:** released', '- **Type:** feature',
      '', '## Branches', '', '### Only', '- `feature/done` — the merged branch',
      '', '## Changelog', '', '- released already', '',
    ].join('\n'), 'utf8');
    assert.equal(deliverability(opts, 'released').verdict, 'already-delivered');

    // A slug that resolves to no file is not-found, which the route refuses as
    // plan-unreadable.
    assert.equal(deliverability(opts, 'does-not-exist').verdict, 'not-found');

    // An Approved plan with NO PULSE is `scan-incomplete`, not `not-merged`.
    // Git has said nothing — and since 2026-08-27 "nothing said" is neither "all
    // merged" NOR "a branch is unmerged". A cold cache is the same absence as a
    // timed-out scan, and it earns the same answer: the board cannot say yet.
    //
    // This assertion read `not-merged` until that date, and inverting it is the
    // point of the change rather than a casualty of it. Claiming a branch had not
    // merged from an empty cache is what sent an operator looking for work that
    // did not exist. The sibling suite pins the same input at the function level
    // (`allSlicesMerged(m, null, true)` is `unknown`); leaving this line as it was
    // would have one input answered two ways in one run.
    mergedPlan(dir);
    assert.equal(deliverability(opts, SLUG).verdict, 'scan-incomplete');
  });
});

describe('the request names a plan; it does not carry one', () => {
  it('keeps request text out of the shell — only a slug and a file path travel', async () => {
    const dir = repo();
    mergedPlan(dir);
    // The prompt carries the content, and it reaches the agent as a FILE whose
    // path is the only thing passed as an argument. The slug is SLUG_RE-bounded,
    // so nothing a page supplies becomes a shell word.
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    const promptPath = deliverPromptPath(dir, SLUG);
    assert.equal(got.body.prompt, promptPath, 'the 202 names the prompt file, not any inline content');
    const prompt = fs.readFileSync(promptPath, 'utf8');
    assert.match(prompt, /plot-deliver/);
  });
});
