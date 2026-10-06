// `POST /api/interrogate` and its read-back: the four refusals, the prompt, the
// running-state read after a board stop, a run on each runner, and a full run
// against a stub runner that records a round the way `/challenge-the-plan` does.
//
// Every refusal is asserted on state the handler writes before it answers.
// Every test that starts a run waits for it to record its end before cleanup.
import { afterEach, describe, it, vi } from 'vitest';
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
import { boardRunsSettled, endHeldRuns } from '../../src/server/board-run.js';
import { lastModel, settled, useFakeClaude } from './fake-claude.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'the-card-asks-the-jury';
const PLAN_NAME = `2026-09-26-${SLUG}.md`;

const made: string[] = [];
afterEach(async () => {
  await boardRunsSettled();
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
  runner?: string;
}): Promise<Captured> => {
  const { res, got } = response();
  const deps: InterrogateDeps = {
    config: (_o, key, fallback) =>
      key === INTERROGATE_COMMAND_KEY
        ? (opts.command ?? 'true')
        : key === 'Agent runner' && opts.runner
          ? opts.runner
          : fallback,
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
    // A live pid in the state file that is not this board's own.
    const dir = repo();
    draftPlan(dir);
    fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
    fs.writeFileSync(statePath(dir), `running ${process.ppid}`, 'utf8');
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 409);
    assert.equal(refusal(got), 'already-running');
    assert.ok(String(got.body.detail).length > 0, 'a refusal carries a sentence');
    assert.equal(fs.existsSync(interrogatePromptPath(dir, SLUG)), false);
  });

  it('answers 202 only once the log exists, and refuses a second POST at once', async () => {
    const dir = repo();
    draftPlan(dir);
    const first = await post({ repoRoot: dir, command: `sh -c 'sleep 1' _` });
    assert.equal(first.status, 202);
    assert.equal(fs.existsSync(interrogateLogPath(dir, SLUG)), true);
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'running');
    const second = await post({ repoRoot: dir, command: `sh -c 'sleep 1' _` });
    assert.equal(second.status, 409);
    assert.equal(refusal(second), 'already-running');
    await boardRunsSettled();
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'done');
  });

  it('answers 500 when the run cannot be recorded', async () => {
    const dir = repo();
    draftPlan(dir);
    // A directory where the state file goes: the route cannot clear it.
    fs.mkdirSync(statePath(dir), { recursive: true });
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 500);
    assert.match(String(got.body.error), /cannot open/);
  });

  it('accepts a panel after a board restart left a running marker behind', async () => {
    // A board that stopped mid-run leaves `running <its pid>`; that board is
    // gone, so the slug is not locked.
    const dir = repo();
    draftPlan(dir);
    fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
    fs.writeFileSync(statePath(dir), 'running 4194305', 'utf8');
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    await boardRunsSettled();
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
  // The skill the prompt's first line names, read from the plugin the runner loads.
  const skillNamedBy = (prompt: string): { name: string; body: string } => {
    const name = /^\/([a-z-]+) /.exec(prompt)?.[1] ?? '';
    const file = path.resolve(__dirname, '../../../../skills', name, 'SKILL.md');
    return { name, body: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
  };

  it('names a caller that supplies all four of /plot-panel\'s parameters', () => {
    const prompt = composeInterrogatePrompt('docs/plans/x.md');
    const { name, body } = skillNamedBy(prompt);
    assert.match(prompt, new RegExp(`^/${name} docs/plans/x\\.md$`, 'm'));
    assert.notEqual(name, 'plot-panel', 'the mechanism refuses unattended with only a subject');
    assert.ok(body, `no skills/${name}/SKILL.md`);

    // Subject: the skill takes the plan path as its argument.
    assert.match(body, /\$ARGUMENTS/);
    // It runs the panel unattended, and hands /plot-panel the four parameters.
    assert.match(body, /PLOT_UNATTENDED=1`?\*?\*?\s*→ the panel/);
    assert.match(body, /Hand `\/plot-panel` its four parameters — Subject, Lenses, Commitment, Rubric/);
    // Lenses, Commitment and Rubric: the skill holds each, not the board.
    assert.match(body, /#### The lenses/);
    assert.match(body, /Position: proceed \| amend \| reject/);
    assert.match(body, /The rubric is \*\*identical across lenses\*\*/);
  });

  it('holds no lens, commitment or rubric of its own', () => {
    const prompt = composeInterrogatePrompt('docs/plans/x.md');
    assert.doesNotMatch(prompt, /--lens|Position:|proceed|amend|rubric/i);
    assert.match(prompt, /approve\s+nothing/);
  });

  it('names the real plan file, relative to the repo', async () => {
    const dir = repo();
    draftPlan(dir);
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    const prompt = fs.readFileSync(interrogatePromptPath(dir, SLUG), 'utf8');
    assert.match(prompt, new RegExp(`^/challenge-the-plan docs/plans/${PLAN_NAME.replace(/\./g, '\\.')}$`, 'm'));

    // The route's own `agentRun.run().then()` keeps running after the 202
    // answers. Waiting it out to a terminal state, rather than returning with
    // it still in flight, is what keeps `afterEach`'s `rmTree(dir)` from
    // racing a write this same run is still making into that directory.
    // `unknown` is waited on too: right after the 202, the run's log file may
    // not exist yet, which reads as `unknown` rather than `running`.
    const deadline = Date.now() + 20_000;
    let state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    while ((state === 'running' || state === 'unknown') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    }
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
    fs.writeFileSync(statePath(dir), `running ${process.ppid}`, 'utf8');
    assert.equal(interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state, 'running');
    // 2^22 + 1 exceeds the pid range on macOS and Linux defaults.
    fs.writeFileSync(statePath(dir), 'running 4194305', 'utf8');
    const stopped = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG);
    assert.equal(stopped.state, 'failed');
    assert.match(stopped.message, /stopped without recording an exit code/);
  });

  it('records the board exit code for a run it still holds when it exits', async () => {
    const dir = repo();
    draftPlan(dir);
    const pidFile = path.join(dir, '..', 'panel.pid');
    const got = await post({ repoRoot: dir, command: `sh -c 'echo $$ > "${pidFile}"; exec sleep 30' _` });
    assert.equal(got.status, 202);
    endHeldRuns(143);
    assert.equal(fs.readFileSync(statePath(dir), 'utf8'), '143');
    const status = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG);
    assert.equal(status.state, 'failed');
    assert.match(status.message, /the board exited with code 143/);
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
    process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 'SIGKILL');
    await boardRunsSettled();
  });
});

describe('the panel on the SDK runner', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs on the model its fragment names, and reads a panel that exists as done', async () => {
    const dir = repo();
    draftPlan(dir);
    fs.writeFileSync(path.join(dir, 'panel.md'), '# panel\n', 'utf8');
    const argvLog = useFakeClaude(path.dirname(dir), { written: 'panel.md', summary: 'the panel sat' });
    const got = await post({ repoRoot: dir, command: 'claude -p --model haiku', runner: 'sdk' });
    assert.equal(got.status, 202);
    const status = await settled(() => interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG));
    assert.equal(status.state, 'done', status.message);
    assert.equal(lastModel(argvLog), 'haiku');
  });

  it('reads a panel path that does not exist as failed', async () => {
    const dir = repo();
    draftPlan(dir);
    useFakeClaude(path.dirname(dir), { written: 'panel.md', summary: '' });
    await post({ repoRoot: dir, command: 'claude -p', runner: 'sdk' });
    const status = await settled(() => interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG));
    assert.equal(status.state, 'failed');
    assert.match(status.message, /written path does not exist: 'panel.md'/);
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
    //
    // `agentRunCommand` sources the fragment file via `. "$1" "$2"`, where the
    // `.` builtin's OWN arguments after the file become the SOURCED script's
    // positional params — not the sourcing shell's. So inside the fragment
    // body (`<command> "$@"`), `$1` is the real prompt (the route's
    // `Read <promptPath> and follow it.`) and `$2` is empty; the fragment
    // scratch file's own path never appears as a positional param at all.
    // The command this test configures (`sh ${stub}`) therefore receives the
    // prompt as ITS `$1`, never the prompt FILE's content directly — so the
    // stub takes one more step than the file itself does: read the path out
    // of `$1`, then read THAT file's first line (`/challenge-the-plan
    // <planPath>`) for the plan.
    const seen = path.join(dir, '..', 'plan-as-the-runner-found-it.md');
    const stub = path.join(dir, '..', 'stub-panel.sh');
    fs.writeFileSync(stub, [
      '#!/bin/sh',
      'set -e',
      'prompt_file=$(printf "%s" "$1" | sed -n "s/^Read \\(.*\\) and follow it\\.$/\\1/p")',
      'test -n "$prompt_file" || { echo "no prompt path on the fragment argument" >&2; exit 1; }',
      'plan=$(sed -n "1s|^/[a-z-]* ||p" "$prompt_file")',
      'test -n "$plan" || { echo "no plan path on the prompt file\'s first line" >&2; exit 1; }',
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
    // cleanup below safe. Right after the 202, the run's own log file may not
    // exist yet — `agentRunCommand.run()` creates it on its first async tick,
    // not before the (unawaited) `run()` call returns — so `interrogateStatus`
    // can read `unknown` before it ever reads `running`. Waiting on BOTH is
    // what keeps this loop from exiting on that first, pre-log `unknown` read.
    const deadline = Date.now() + 20_000;
    let state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    while ((state === 'running' || state === 'unknown') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      state = interrogateStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG).state;
    }
    assert.equal(state, 'done', fs.existsSync(interrogateLogPath(dir, SLUG)) ? fs.readFileSync(interrogateLogPath(dir, SLUG), 'utf8') : '(no log file)');

    assert.equal(fs.readFileSync(seen, 'utf8'), before, 'the board wrote to the plan before the runner did');
    const after = fs.readFileSync(plan, 'utf8');
    assert.match(after, /^- \*\*Rounds:\*\* 3$/m, 'one round, recorded by the runner');
    assert.equal(after, before.replace('- **Rounds:** 2', '- **Rounds:** 3'),
      'the plan changed by exactly the runner\'s one line — no board-side counter');
  });
});
