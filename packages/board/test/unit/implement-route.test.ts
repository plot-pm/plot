// `POST /api/implement`: what it refuses, what it spawns, and what its 202 says.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the 202 body, the log file
// it opens before spawning — never against output a spawned command produces.
// The command these tests configure is `true`, which needs no budget at all.
// The measured failure this avoids (see commission-route.test.ts): a 1 ms
// timeout that passed on macOS and lost on CI, and a teardown racing a detached
// child.
//
// **This route composes no prompt file.** Unlike `/api/idea` and
// `/api/commission`, `/plot-implement` takes only a slug and reads the plan
// itself — so there is no prompt to assert on, and the raceless observable is
// the log file the handler opens before it spawns.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  composeImplementPrompt,
  handleImplement,
  implementAvailability,
  implementLogPath,
  IMPLEMENT_COMMAND_KEY,
  type ImplementDeps,
  type ImplementRefusal,
} from '../../src/server/implement.js';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'an-approved-plan-offers-its-two-starts';

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

/** A repo root under a fresh tmpdir; the log lives beside it (its parent). */
function repo(): string {
  // A nested dir so `implementLogPath`'s `path.resolve(repoRoot, '..')` writes
  // inside the tmp tree the afterEach removes, not into the real tmpdir root.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A request, with a body and the headers a same-origin POST carries. */
function request(body: unknown, headers: http.IncomingHttpHeaders = {}): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = headers;
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
 * Run the handler with the command injectable.
 *
 * `Implement command: true` — a command that exists, succeeds and produces
 * nothing. The tests assert what the handler wrote BEFORE spawning, so the
 * command's behaviour is deliberately irrelevant and deliberately instant.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    host?: string;
    headers?: http.IncomingHttpHeaders;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: ImplementDeps = {
    config: (_o, key, fallback) =>
      key === IMPLEMENT_COMMAND_KEY ? (opts.command ?? 'true') : fallback,
  };
  await handleImplement(
    request(opts.body ?? { slug: SLUG }, opts.headers),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the action prepares an approved plan, and says so', () => {
  it('accepts a slug and answers 202 with the log it opened', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.slug, SLUG);
    // The log exists at 202 time — the property that makes this raceless. It is
    // opened before the spawn, so its presence is synchronous with the answer.
    const log = implementLogPath(dir, SLUG);
    assert.equal(got.body.log, log, 'the 202 names the log file it opened');
    assert.ok(fs.existsSync(log), 'the log file exists by the time the 202 is written');
  });

  it('carries the slug into a /plot-implement instruction, and nothing else', () => {
    // The runner is a `claude -p`-style agent; its argument is the prompt it
    // acts on. The prompt names /plot-implement and the slug, so the agent runs
    // the skill this route exists to run.
    const prompt = composeImplementPrompt(SLUG);
    assert.match(prompt, /\/plot-implement/);
    assert.match(prompt, new RegExp(SLUG));
  });
});

describe('an action that cannot work is not offered', () => {
  const refusal = (got: Captured): ImplementRefusal => got.body.reason as ImplementRefusal;

  it('refuses when no Implement command is configured, rather than doing nothing', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(got.status, 409);
    assert.equal(refusal(got), 'no-implement-command');
    // The refusal NAMES THE FIX. A board that accepted the click and silently
    // did nothing is this repo's recurring defect wearing a button.
    assert.match(String(got.body.detail), /Implement command/);
    // And it spawned nothing: no log was opened, because the refusal comes first.
    assert.ok(!fs.existsSync(implementLogPath(dir, SLUG)), 'nothing may be written on a refusal');
  });

  it('never runs the `none` sentinel as a command', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    // `none` is the repo's established "we do this by hand" answer. Running it
    // would spawn `none: command not found` and log that as the reason.
    assert.equal(refusal(got), 'no-implement-command');
    assert.ok(!fs.existsSync(implementLogPath(dir, SLUG)), 'nothing may be written for `none`');
  });

  it('refuses a cross-origin write before reading a body', async () => {
    const dir = repo();
    // A page from somewhere else must not start an agent on this machine. The
    // header the browser sets and page JS cannot forge is what this reads.
    const got = await post({
      repoRoot: dir,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(got.status, 403);
    assert.ok(!fs.existsSync(implementLogPath(dir, SLUG)), 'a cross-origin request spawns nothing');
  });

  it('rejects a body whose slug is missing or invalid', async () => {
    const dir = repo();
    for (const bad of [{ slug: '../../etc/passwd' }, { slug: '' }, { slug: 42 }, {}]) {
      const got = await post({ repoRoot: dir, body: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });

  it('is unavailable off localhost, where the repo is not', () => {
    // The capability flag answers the same localhost binding idea/commission/
    // deliver do, but is its own named export, so the day preparing a plan needs
    // a different precondition there is a seam for it.
    assert.equal(implementAvailability('0.0.0.0').available, false);
    assert.match(implementAvailability('0.0.0.0').reason, /not localhost/);
    assert.equal(implementAvailability('localhost').available, true);
    assert.equal(implementAvailability('127.0.0.1').available, true);
  });
});
