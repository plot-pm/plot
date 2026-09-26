// `POST /api/interrogate` and its read-back: the four refusals, the prompt, the
// running-state read, and a full run against a stub runner that records a round
// the way `/plot-panel` does.
//
// Every refusal is asserted on state the handler writes before it answers. The
// one test that spawns a real command waits for the state file the exit
// listener writes before it reads anything, and before cleanup.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  INTERROGATE_COMMAND_KEY,
  composeInterrogatePrompt,
  handleInterrogate,
  interrogateAvailability,
  interrogateLogPath,
  interrogatePromptPath,
  interrogateStatus,
  type InterrogateDeps,
  type InterrogateRefusal,
} from '../../src/server/interrogate.js';
import { agentLogPath } from '../../src/server/agent-log.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'the-card-asks-the-jury';
const PLAN_NAME = `2026-09-26-${SLUG}.md`;

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/**
 * A repo nested one level down, so the prompt, log and state files — written
 * beside the repo — land inside the tree `afterEach` removes.
 */
const repo = (config = ''): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-interrogate-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `## Plot Config\n\n${config}\n`, 'utf8');
  return dir;
};

const draftPlan = (dir: string, rounds?: number): string => {
  const file = path.join(dir, 'docs/plans', PLAN_NAME);
  fs.writeFileSync(file, [
    '# The card asks the jury', '', '## Status', '',
    '- **State:** Draft',
    '- **Type:** feature',
    ...(rounds === undefined ? [] : [`- **Rounds:** ${rounds}`]),
    '', '## Changelog', '', '- a draft to interrogate', '',
  ].join('\n'), 'utf8');
  return file;
};

const request = (body: unknown): http.IncomingMessage => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
};

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

const response = (): { res: http.ServerResponse; got: Captured } => {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
};

/** Run the handler; `command` defaults to `true`, `phase` to `draft`. */
const post = async (opts: {
  repoRoot: string;
  body?: unknown;
  command?: string;
  phase?: () => string | null;
}): Promise<Captured> => {
  const { res, got } = response();
  const deps: InterrogateDeps = {
    config: (_o, key, fallback) =>
      key === INTERROGATE_COMMAND_KEY ? (opts.command ?? 'true') : fallback,
    phase: () => (opts.phase ? opts.phase() : 'draft'),
  };
  await handleInterrogate(
    request(opts.body ?? { slug: SLUG }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 },
    deps,
  );
  return got;
};

const refusal = (got: Captured): InterrogateRefusal => got.body.reason as InterrogateRefusal;

const statePath = (dir: string): string => agentLogPath(dir, 'interrogate', SLUG, 'state');

describe('the four refusals', () => {
  it('refuses with no key, and names the key', async () => {
    const dir = repo();
    draftPlan(dir);
    for (const command of ['', 'none']) {
      const got = await post({ repoRoot: dir, command });
      assert.equal(got.status, 409);
      assert.equal(refusal(got), 'no-interrogate-command');
      assert.match(String(got.body.detail), /Interrogate command/);
    }
    assert.equal(fs.existsSync(interrogatePromptPath(dir, SLUG)), false, 'nothing is written on a refusal');
  });

  it('refuses a plan past Draft, and one whose phase cannot be read', async () => {
    const dir = repo();
    draftPlan(dir);
    for (const phase of ['approved', 'delivered', 'released']) {
      const got = await post({ repoRoot: dir, phase: () => phase });
      assert.equal(got.status, 409);
      assert.equal(refusal(got), 'not-a-draft');
      assert.match(String(got.body.detail), new RegExp(phase));
    }
    const unreadable = await post({ repoRoot: dir, phase: () => null });
    assert.equal(refusal(unreadable), 'plan-unreadable');
  });

  it('refuses a second panel while the first is running', async () => {
    // A live pid in the state file: this test's own process.
    const dir = repo();
    draftPlan(dir);
    fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
    fs.writeFileSync(statePath(dir), `running ${process.pid}`, 'utf8');
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 409);
    assert.equal(refusal(got), 'already-running');
    assert.ok(String(got.body.detail).length > 0, 'a refusal carries a sentence');
    assert.equal(fs.existsSync(interrogatePromptPath(dir, SLUG)), false);
  });

  it('answers the binding off localhost, and names the key when it is absent', () => {
    const configured = repo(`- **${INTERROGATE_COMMAND_KEY}:** true`);
    const bare = repo();
    const opts = (repoRoot: string) => ({ repoRoot, scriptsDir: SCRIPTS });

    assert.deepEqual(interrogateAvailability('localhost', opts(configured)), { available: true, reason: '' });

    const absent = interrogateAvailability('localhost', opts(bare));
    assert.equal(absent.available, false);
    assert.match(absent.reason, /Interrogate command/);

    const remote = interrogateAvailability('0.0.0.0', opts(configured));
    assert.equal(remote.available, false);
    assert.ok(remote.reason.length > 0, 'the binding refusal carries a sentence');
  });
});

describe('the prompt', () => {
  it('asks for /plot-panel on the plan path and chooses no lenses', () => {
    const prompt = composeInterrogatePrompt('docs/plans/x.md');
    assert.match(prompt, /^\/plot-panel docs\/plans\/x\.md$/m);
    assert.doesNotMatch(prompt, /--lens/);
    assert.match(prompt, /approve nothing/);
  });

  it('names the real plan file, relative to the repo', async () => {
    const dir = repo();
    draftPlan(dir);
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    const prompt = fs.readFileSync(interrogatePromptPath(dir, SLUG), 'utf8');
    assert.match(prompt, new RegExp(`/plot-panel docs/plans/${PLAN_NAME.replace(/\./g, '\\.')}`));
  });
});

describe('the read-back', () => {
  it('reads unknown with no state, done on 0, failed on a non-zero code', () => {
    const dir = repo();
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'unknown');
    fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
    fs.writeFileSync(statePath(dir), '0', 'utf8');
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'done');
    fs.writeFileSync(interrogateLogPath(dir, SLUG), 'the panel refused\n', 'utf8');
    fs.writeFileSync(statePath(dir), '2', 'utf8');
    const failed = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG);
    assert.equal(failed.state, 'failed');
    assert.match(failed.message, /the panel refused/);
  });

  it('reads a running state whose process is gone as failed, not running forever', () => {
    // A board restarted mid-run never records the exit code.
    const dir = repo();
    fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
    fs.writeFileSync(statePath(dir), `running ${process.pid}`, 'utf8');
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'running');
    // 2^22 + 1 exceeds the pid range on macOS and Linux defaults.
    fs.writeFileSync(statePath(dir), 'running 4194305', 'utf8');
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'failed');
  });
});

describe('a run records one round, and the board writes none', () => {
  it('runs the command; Rounds: rises by one; the board wrote nothing to the plan', async () => {
    const dir = repo();
    const plan = draftPlan(dir, 2);
    const before = fs.readFileSync(plan, 'utf8');

    // The stub runner does what the skill does to the plan: it copies the file
    // as it found it (so the test can see whether the board touched it first),
    // then increments `Rounds:`.
    const seen = path.join(dir, '..', 'plan-as-the-runner-found-it.md');
    const stub = path.join(dir, '..', 'stub-panel.sh');
    fs.writeFileSync(stub, [
      '#!/bin/sh',
      'set -e',
      'plan=$(sed -n "1s|^/plot-panel ||p" "$PLOT_INTERROGATE_PROMPT")',
      `cp "$plan" "${seen}"`,
      'n=$(sed -n "s/^- \\*\\*Rounds:\\*\\* \\([0-9]*\\)$/\\1/p" "$plan")',
      'sed "s/^- \\*\\*Rounds:\\*\\* [0-9]*$/- **Rounds:** $((n + 1))/" "$plan" > "$plan.tmp"',
      'mv "$plan.tmp" "$plan"',
      '',
    ].join('\n'), 'utf8');
    fs.chmodSync(stub, 0o755);

    const got = await post({ repoRoot: dir, command: `sh ${stub}` });
    assert.equal(got.status, 202);

    // Wait for the exit listener's state file, which is also what makes the
    // cleanup below safe.
    const deadline = Date.now() + 20_000;
    let state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    while (state === 'running' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    }
    assert.equal(state, 'done', fs.readFileSync(interrogateLogPath(dir, SLUG), 'utf8'));

    assert.equal(fs.readFileSync(seen, 'utf8'), before, 'the board wrote to the plan before the runner did');
    const after = fs.readFileSync(plan, 'utf8');
    assert.match(after, /^- \*\*Rounds:\*\* 3$/m, 'one round, recorded by the runner');
    assert.equal(after, before.replace('- **Rounds:** 2', '- **Rounds:** 3'),
      'the plan changed by exactly the runner\'s one line — no board-side counter');
  });
});
