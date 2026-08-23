// `POST /api/reslice`: what it refuses, what it spawns, and what the prompt it
// hands the agent must contain.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the prompt file, the 202
// body — never against output a spawned command produces. The command these
// tests configure is `true`, which needs no budget at all. The measured failure
// this avoids: a 1 ms timeout that passed on macOS and lost on CI, and a
// teardown racing a detached child.
//
// **The precondition is READ THROUGH THE REAL PARSER once.** "A plan is
// sliceable when a wave holds more than one live branch" is a claim about the
// plan format, so one test runs `maxLiveWaveWidth` against real plan files
// rather than a stubbed width — the refusals are then asserted with the width
// injected, which is what keeps them raceless and independent of a plan estate.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  composeReslicePrompt,
  handleReslice,
  maxLiveWaveWidth,
  reslicePromptPath,
  resliceAvailability,
  type ResliceDeps,
  type ResliceRefusal,
} from '../../src/server/reslice.js';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  // Synchronous and unconditional. Nothing spawned here outlives the call —
  // `true` has exited by the time the 202 is written — so there is no child to
  // race and `maxRetries` is not being asked to win anything.
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A repo with a plan directory, and whatever plans a test wants in it. */
function repo(plans: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-reslice-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  for (const [name, body] of Object.entries(plans)) {
    fs.writeFileSync(path.join(dir, 'docs/plans', name), body, 'utf8');
  }
  return dir;
}

const SLUG = 'a-tangled-plan';

/**
 * A plan whose one wave holds SEVERAL branches — the shape reslice repairs. The
 * happy path needs a plan the locator can find, and one the real parser reads as
 * a multi-branch wave, so `maxLiveWaveWidth` on it returns > 1.
 */
function tangledPlan(dir: string): void {
  fs.writeFileSync(path.join(dir, 'docs/plans', `2026-08-21-${SLUG}.md`), [
    '# A tangled plan', '', '## Status', '',
    '- **Phase:** Approved',
    '- **Type:** feature',
    '', '## Branches', '',
    '### Implementation',
    '- `feature/one` — the first branch',
    '- `feature/two` — the second branch',
    '- `feature/three` — the third branch',
    '', '## Changelog', '', '- a plan with a tangled wave', '',
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
 * Run the handler with everything injectable defaulted to a sliceable plan.
 *
 * `Idea command: true` — a command that exists, succeeds and produces nothing.
 * The tests assert what the handler wrote BEFORE spawning, so the command's
 * behaviour is deliberately irrelevant and deliberately instant. `width`
 * defaults to 3, so the happy path is sliceable without reading a file.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    width?: (() => number | null);
    host?: string;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: ResliceDeps = {
    config: (_o, key, fallback) =>
      key === 'Idea command' ? (opts.command ?? 'true') : fallback,
    width: () => (opts.width ? opts.width() : 3),
  };
  await handleReslice(
    request(opts.body ?? { slug: SLUG }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the action slices a tangled wave, and writes the prompt before it answers', () => {
  it('accepts a sliceable plan and writes the prompt before it answers', async () => {
    const dir = repo();
    tangledPlan(dir);
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.slug, SLUG);
    // The prompt exists at 202 time — the property that makes every assertion
    // below raceless.
    const prompt = fs.readFileSync(reslicePromptPath(dir, SLUG), 'utf8');
    assert.match(prompt, /reslice/i);
    // And it names the real file the locator resolved, not a slug it guessed.
    assert.match(prompt, new RegExp(`2026-08-21-${SLUG}\\.md`));
  });
});

describe('the prompt says slice, ask before writing, and never build', () => {
  it('asks the agent to slice one wave per branch and CONFIRM the order first', () => {
    const prompt = composeReslicePrompt({
      slug: SLUG,
      planFile: `/repo/docs/plans/2026-08-21-${SLUG}.md`,
    });
    // The order is the judgement a person owns — the prompt must ask before it
    // writes, and must tell an unattended run to STOP rather than guess.
    assert.match(prompt, /one wave per branch/i);
    assert.match(prompt, /confirm the order before writing/i);
    assert.match(prompt, /unattended/i);
    assert.match(prompt, /STOP/);
  });

  it('rewrites only `## Branches`, keeps branch names, and leaves a complete wave alone', () => {
    const prompt = composeReslicePrompt({ slug: 's', planFile: '/repo/docs/plans/s.md' });
    assert.match(prompt, /## Branches/);
    // Only the `### ` headings change; the branch lines stay byte-identical
    // because PRs and claim refs point at their names.
    assert.match(prompt, /byte-identical/i);
    assert.match(prompt, /`### ` headings/);
    // A wave whose work has landed is history and must be left untouched.
    assert.match(prompt, /complete/i);
  });

  it('tells the agent to slice, never build — merge nothing, dispatch nothing', () => {
    const prompt = composeReslicePrompt({ slug: 's', planFile: '/repo/docs/plans/2026-08-21-s.md' });
    assert.match(prompt, /Read the plan at \/repo\/docs\/plans\/2026-08-21-s\.md/);
    assert.match(prompt, /Merge nothing, dispatch nothing/i);
    // It must not ask for a rename — a rename breaks every claim ref.
    assert.doesNotMatch(prompt, /rename (the |a )?branch/i);
  });
});

describe('an action that cannot work is not offered', () => {
  const refusal = (got: Captured): ResliceRefusal => got.body.reason as ResliceRefusal;

  it('refuses when no Idea command is configured, rather than doing nothing', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(refusal(got), 'no-idea-command');
    // The refusal NAMES THE FIX. A board that accepted the click and silently
    // did nothing is this repo's recurring defect wearing a button.
    assert.match(String(got.body.detail), /Idea command/);
    assert.ok(!fs.existsSync(reslicePromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('never runs the `none` sentinel as a command', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    // `none` is the repo's established "we do this by hand" answer. Running it
    // would spawn `none: command not found` and log that as the reason.
    assert.equal(refusal(got), 'no-idea-command');
  });

  it('refuses a plan with no tangled wave — a complete wave offers nothing', async () => {
    const dir = repo();
    // A width of 1 is a plan whose waves each hold one live branch — the model's
    // own shape, with nothing to slice. A `complete` wave whose work has landed
    // reads the same way here: the detector already suppressed it, so the row
    // never offered this control, and reaching the route means there is nothing
    // to do.
    const got = await post({ repoRoot: dir, width: () => 1 });
    assert.equal(refusal(got), 'nothing-to-slice');
    assert.match(String(got.body.detail), /more than one live branch/);
    assert.ok(!fs.existsSync(reslicePromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('refuses a plan whose waves cannot be read', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, width: () => null });
    // A null width is a plan that could not be found or parsed; spawning an
    // agent against it would be a write against an unknown plan.
    assert.equal(refusal(got), 'plan-unreadable');
    assert.ok(!fs.existsSync(reslicePromptPath(dir, SLUG)), 'nothing may be written');
  });

  it('rejects a body whose slug is missing or invalid', async () => {
    const dir = repo();
    for (const bad of [{ slug: '../../etc/passwd' }, { slug: '' }, { slug: 42 }, {}]) {
      const got = await post({ repoRoot: dir, body: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });

  it('is unavailable off localhost, where the repo is not', () => {
    // The capability flag wraps `ideaAvailability` — reslicing shares the idea
    // binding — but is its own named export, so the day it needs a different
    // precondition there is a seam for it.
    assert.equal(resliceAvailability('0.0.0.0').available, false);
    assert.match(resliceAvailability('0.0.0.0').reason, /not localhost/);
    assert.equal(resliceAvailability('localhost').available, true);
  });
});

describe('sliceability is read through the real plan parser', () => {
  it('counts a multi-branch wave as sliceable and a single-branch plan as not', () => {
    // THE PRECONDITION, run against real plan files rather than a stub — the one
    // claim a regex could not make, because "more than one live branch in a
    // wave" is a fact about the parsed plan format.
    const dir = repo();
    tangledPlan(dir);
    const opts = { repoRoot: dir, scriptsDir: SCRIPTS };
    assert.equal(maxLiveWaveWidth(opts, SLUG), 3, 'a 3-branch wave is width 3');

    fs.writeFileSync(path.join(dir, 'docs/plans', '2026-08-21-lonely.md'), [
      '# Lonely', '', '## Status', '', '- **Phase:** Approved', '- **Type:** feature',
      '', '## Branches', '', '### Only', '- `feature/alone` — the one branch',
      '', '## Changelog', '', '- one wave, one branch', '',
    ].join('\n'), 'utf8');
    assert.equal(maxLiveWaveWidth(opts, 'lonely'), 1, 'a one-branch wave is width 1');

    // A deferred branch does not count toward the tangle: a wave with one live
    // branch and one deferred is already the one-branch wave the model wants.
    fs.writeFileSync(path.join(dir, 'docs/plans', '2026-08-21-mixed.md'), [
      '# Mixed', '', '## Status', '', '- **Phase:** Approved', '- **Type:** feature',
      '', '## Branches', '', '### Wave',
      '- `feature/live` — the live branch',
      '- `feature/gone` — set down <!-- deferred: not needed -->',
      '', '## Changelog', '', '- one live, one deferred', '',
    ].join('\n'), 'utf8');
    assert.equal(maxLiveWaveWidth(opts, 'mixed'), 1, 'a deferred branch does not count');

    // A slug that resolves to no file is null, which the route refuses.
    assert.equal(maxLiveWaveWidth(opts, 'does-not-exist'), null);
  });
});

describe('the request names a plan; it does not carry one', () => {
  it('keeps request text out of the shell — only a slug and a file path travel', async () => {
    const dir = repo();
    tangledPlan(dir);
    // The prompt carries the content, and it reaches the agent as a FILE whose
    // path is the only thing passed as an argument. The slug is SLUG_RE-bounded,
    // so nothing a page supplies becomes a shell word.
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    const promptPath = reslicePromptPath(dir, SLUG);
    assert.equal(got.body.prompt, promptPath, 'the 202 names the prompt file, not any inline content');
    const prompt = fs.readFileSync(promptPath, 'utf8');
    assert.match(prompt, /## Branches/);
  });
});
