// `POST /api/commission`: what it refuses, what it spawns, and what the plan it
// produces must contain.
//
// **The KEY assertion runs a real parser.** "Commission design creates a plan
// in phase Design" is a claim a regex over the prompt cannot make: the phase is
// `design` only if the FIELD SYNTAX is one `plot-plan-meta.sh` normalises, so
// the prompt's instruction is lifted into a real plan file and handed to the
// real parser.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the prompt file, the 202
// body — never against output a spawned command produces. The command these
// tests configure is `true`, which needs no budget at all. The measured failure
// this avoids: a 1 ms timeout that passed on macOS and lost on CI, and a
// teardown racing a detached child.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  commissionAvailability,
  commissionPromptPath,
  composeCommissionPrompt,
  handleCommission,
  type CommissionDeps,
  type CommissionRefusal,
} from '../../src/server/commission.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-commission-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  for (const [name, body] of Object.entries(plans)) {
    fs.writeFileSync(path.join(dir, 'docs/plans', name), body, 'utf8');
  }
  return dir;
}

/**
 * The slug the happy-path tests commission, and a Draft plan file on disk for
 * it. The handler injects `phase` but NOT the file locator: `resolvePlanBySlug`
 * always runs, because the prompt it composes must name the real file the agent
 * will open. So the happy path needs a plan the locator can find, and this is
 * it — a minimal Draft named so `<plan dir>/*<slug>.md` matches.
 */
const SLUG = 'the-menu-fits-the-kind';
function draftPlan(dir: string): void {
  fs.writeFileSync(path.join(dir, 'docs/plans', `2026-08-20-${SLUG}.md`), [
    '# The menu fits the kind', '', '## Status', '',
    '- **Phase:** Draft',
    '- **Type:** feature',
    '', '## Changelog', '', '- a draft to commission', '',
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
 * Run the handler with everything injectable defaulted to a Draft plan.
 *
 * `Idea command: true` — a command that exists, succeeds and produces nothing.
 * The tests assert what the handler wrote BEFORE spawning, so the command's
 * behaviour is deliberately irrelevant and deliberately instant. `phase`
 * defaults to `draft`, so the happy path needs no plan file on disk.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    phase?: (() => string | null);
    host?: string;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: CommissionDeps = {
    config: (_o, key, fallback) =>
      key === 'Idea command' ? (opts.command ?? 'true') : fallback,
    phase: () => (opts.phase ? opts.phase() : 'draft'),
  };
  await handleCommission(
    request(opts.body ?? { slug: 'the-menu-fits-the-kind' }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the action moves a Draft into Design, and says so', () => {
  it('accepts a Draft and writes the prompt before it answers', async () => {
    const dir = repo();
    draftPlan(dir);
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.slug, SLUG);
    // The prompt exists at 202 time — the property that makes every assertion
    // below raceless.
    const prompt = fs.readFileSync(commissionPromptPath(dir, SLUG), 'utf8');
    assert.match(prompt, /Design/);
    // And it names the real file the locator resolved, not a slug it guessed.
    assert.match(prompt, new RegExp(`2026-08-20-${SLUG}\\.md`));
  });
});

describe('the prompt records a phase the parser reads as Design', () => {
  it('a plan built from the prompt is read back as phase design', () => {
    // THE KEY TEST — "Commission design creates a plan in phase Design", and it
    // is a PARSE, not a string match. The prompt asks for `- **Phase:** Design`;
    // that line is lifted into a real plan file with a `## Spec` section and
    // handed to the real parser, so this fails if the field syntax drifts to
    // anything `plot-plan-meta.sh` does not normalise to `design`.
    const prompt = composeCommissionPrompt({
      slug: 'the-menu-fits-the-kind',
      planFile: '/repo/docs/plans/2026-08-20-the-menu-fits-the-kind.md',
    });

    const dir = repo();
    const plan = path.join(dir, 'docs/plans/2026-08-20-commissioned.md');
    fs.writeFileSync(plan, [
      '# Commissioned', '', '## Status', '',
      '- **Phase:** Design',
      '- **Type:** feature',
      '', '## Spec', '', '_To be filled in during Design._',
      '', '## Changelog', '', '- a plan commissioned into design', '',
    ].join('\n'), 'utf8');

    const out = execFileSync('bash', [path.join(SCRIPTS, 'plot-plan-meta.sh'), plan], {
      encoding: 'utf8',
    });
    const meta = JSON.parse(out.trim()) as { phase: string };
    assert.equal(meta.phase, 'design', 'the parser must read the phase back as design');

    // And the prompt actually asks for that exact field, so the plan above is
    // built the way the prompt instructs rather than the way this test wishes.
    assert.match(prompt, /- \*\*Phase:\*\* Design/);
  });

  it('asks for an empty spec section and leaves the distinction to the plan', () => {
    const prompt = composeCommissionPrompt({
      slug: 's', planFile: '/repo/docs/plans/s.md',
    });
    // The spec is EMPTY by design — a heading and a placeholder, not a drafted
    // spec — and whether it becomes a spec, spike or tracer bullet is the plan's
    // call. The prompt must say so, and must NOT enumerate three variants as
    // work to build here.
    assert.match(prompt, /empty spec section/i);
    assert.match(prompt, /## Spec/);
    assert.match(prompt, /filled in during Design/);
    assert.match(prompt, /spike/);
    assert.match(prompt, /tracer/);
    // The distinction is named only to be DEFERRED — "not one to settle here" —
    // never as three prompts to author.
    assert.doesNotMatch(prompt, /build (a|the) (spec|spike|tracer)/i);
  });

  it('tells the agent to read the existing Draft and write nothing to a tracker', () => {
    const prompt = composeCommissionPrompt({
      slug: 's', planFile: '/repo/docs/plans/2026-08-20-s.md',
    });
    assert.match(prompt, /Read the existing Draft plan at \/repo\/docs\/plans\/2026-08-20-s\.md/);
    assert.match(prompt, /write nothing to any tracker/i);
    for (const write of ['gh issue comment', 'gh issue close', 'gh issue edit', '--add-label']) {
      assert.ok(!prompt.includes(write), `the prompt must not ask for \`${write}\``);
    }
  });
});

describe('an action that cannot work is not offered', () => {
  const refusal = (got: Captured): CommissionRefusal => got.body.reason as CommissionRefusal;

  it('refuses when no Idea command is configured, rather than doing nothing', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(refusal(got), 'no-idea-command');
    // The refusal NAMES THE FIX. A board that accepted the click and silently
    // did nothing is this repo's recurring defect wearing a button.
    assert.match(String(got.body.detail), /Idea command/);
    assert.ok(!fs.existsSync(commissionPromptPath(dir, 'the-menu-fits-the-kind')), 'nothing may be written');
  });

  it('never runs the `none` sentinel as a command', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    // `none` is the repo's established "we do this by hand" answer. Running it
    // would spawn `none: command not found` and log that as the reason.
    assert.equal(refusal(got), 'no-idea-command');
  });

  it('refuses a plan that is not a Draft, and names the phase it found', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, phase: () => 'approved' });
    // Commissioning design is a decision ABOUT a Draft, exactly as Approve is; a
    // plan past Draft is answered differently, and the refusal says which phase
    // it is so the reader is not left guessing.
    assert.equal(refusal(got), 'not-a-draft');
    assert.match(String(got.body.detail), /approved/);
    assert.ok(!fs.existsSync(commissionPromptPath(dir, 'the-menu-fits-the-kind')), 'nothing may be written');
  });

  it('refuses a plan whose phase cannot be read', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, phase: () => null });
    // A null phase is a plan that could not be found or parsed; spawning an
    // agent against it would be a write against an unknown plan.
    assert.equal(refusal(got), 'plan-unreadable');
    assert.ok(!fs.existsSync(commissionPromptPath(dir, 'the-menu-fits-the-kind')), 'nothing may be written');
  });

  it('rejects a body whose slug is missing or invalid', async () => {
    const dir = repo();
    for (const bad of [{ slug: '../../etc/passwd' }, { slug: '' }, { slug: 42 }, {}]) {
      const got = await post({ repoRoot: dir, body: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });

  it('is unavailable off localhost, where the repo is not', () => {
    // The capability flag wraps `ideaAvailability` — commissioning shares the
    // idea binding — but is its own named export, so the day it needs a
    // different precondition there is a seam for it.
    assert.equal(commissionAvailability('0.0.0.0').available, false);
    assert.match(commissionAvailability('0.0.0.0').reason, /not localhost/);
    assert.equal(commissionAvailability('localhost').available, true);
  });
});

describe('the request names a plan; it does not carry one', () => {
  it('keeps request text out of the shell — only a slug and a file path travel', async () => {
    const dir = repo();
    draftPlan(dir);
    // The prompt carries the content, and it reaches the agent as a FILE whose
    // path is the only thing passed as an argument. The slug is SLUG_RE-bounded,
    // so nothing a page supplies becomes a shell word. What is synchronously
    // observable: the prompt file holds the composed prompt, and the command
    // configured is the harmless `true`.
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    const promptPath = commissionPromptPath(dir, SLUG);
    assert.equal(got.body.prompt, promptPath, 'the 202 names the prompt file, not any inline content');
    const prompt = fs.readFileSync(promptPath, 'utf8');
    assert.match(prompt, /## Spec/);
  });
});
