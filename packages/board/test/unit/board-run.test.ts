// A board role's run through the `agentRun` port: one run per role through the
// SDK path against the stand-in `claude`, the command runner's environment and
// bound, and the state file after the board stops.
//
// The SDK runs are real `query()` calls whose `claude` is
// `test/fixtures/fake-claude/claude`, put first on PATH. It logs the argv it
// was started with and the prompt it received, and hands back
// `FAKE_CLAUDE_OUTPUT`.
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { useSdkConnector, type BuildBoardOptions } from '../../src/server/board.js';
import { boardSdkConnector } from '../../src/server/sdk-runner.js';
import {
  boardRunsSettled,
  endHeldRuns,
  markBoardRun,
  readRunState,
  startBoardRun,
  STOPPED_RECORD,
  type BoardConfigReader,
} from '../../src/server/board-run.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const FAKE_CLAUDE_DIR = path.resolve(__dirname, '../fixtures/fake-claude');

const made: string[] = [];
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-run-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'));
  vi.stubEnv('HOME', path.join(dir, 'home'));
  vi.stubEnv('PATH', `${FAKE_CLAUDE_DIR}:${process.env.PATH ?? ''}`);
  vi.stubEnv('PLOT_AGENT_SETTINGS', '');
  vi.stubEnv('FAKE_CLAUDE_LOG', path.join(dir, 'argv.log'));
  vi.stubEnv('FAKE_CLAUDE_PROMPT_LOG', path.join(dir, 'prompt.log'));
  useSdkConnector(boardSdkConnector);
});

afterEach(async () => {
  await boardRunsSettled();
  vi.unstubAllEnvs();
  while (made.length) {
    const d = made.pop();
    if (d) rmTree(d);
  }
});

const opts = (): BuildBoardOptions => ({ repoRoot: dir, scriptsDir: SCRIPTS });

/** A config reader answering `keys`, and the fallback for every other key. */
const config =
  (keys: Record<string, string>): BoardConfigReader =>
  (_o, key, fallback) =>
    keys[key] ?? fallback;

/** Starts one run to its end and answers its state file and log. */
const ran = async (spec: {
  role: string;
  fragment: string;
  runner?: 'sdk' | 'command';
  agentModels?: string;
  boundSeconds?: number;
  tree?: string;
}): Promise<{ state: string; log: string }> => {
  const logFile = path.join(dir, `${spec.role}.log`);
  const statePath = path.join(dir, `${spec.role}.state`);
  fs.writeFileSync(logFile, '', 'utf8');
  markBoardRun(statePath, logFile);
  await startBoardRun(opts(), {
    role: spec.role,
    fragmentKey: 'Role command',
    readCfg: config({
      'Role command': spec.fragment,
      'Agent runner': spec.runner ?? 'sdk',
      'Agent models': spec.agentModels ?? '',
    }),
    tree: spec.tree ?? dir,
    prompt: 'Read the prompt file and follow it.',
    env: { PLOT_UNATTENDED: '1' },
    logFile,
    statePath,
    boundSeconds: spec.boundSeconds,
  });
  await boardRunsSettled();
  return { state: fs.readFileSync(statePath, 'utf8'), log: fs.readFileSync(logFile, 'utf8') };
};

const argvOfLastStart = (): string[] => {
  const lines = fs.readFileSync(path.join(dir, 'argv.log'), 'utf8').trim().split('\n');
  return (JSON.parse(lines[lines.length - 1]!) as { argv: string[] }).argv;
};

const lastPrompt = (): string => {
  const lines = fs.readFileSync(path.join(dir, 'prompt.log'), 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]!) as string;
};

const modelOf = (argv: string[]): string | undefined => {
  const at = argv.indexOf('--model');
  return at >= 0 ? argv[at + 1] : argv.find((a) => a.startsWith('--model='))?.slice('--model='.length);
};

describe('one run per role through the SDK path', () => {
  const written = ['idea', 'commission', 'reslice', 'story', 'brief', 'implement', 'interrogate'];
  const outcome = ['approve', 'deliver', 'auto-deliver'];

  for (const role of written) {
    it(`${role}: hands back the written path, on its fragment's model, with its own protocol`, async () => {
      fs.writeFileSync(path.join(dir, 'docs/plans/made.md'), '# made\n', 'utf8');
      vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ written: 'docs/plans/made.md', summary: `${role} wrote it` }));
      const got = await ran({ role, fragment: 'claude -p --model haiku' });
      assert.equal(got.state, '0', got.log);
      assert.equal(modelOf(argvOfLastStart()), 'haiku');
      assert.ok(!lastPrompt().includes('next: pushed'), 'a board role is told the worker protocol');
      assert.ok(lastPrompt().includes('{ written, summary }'));
    });
  }

  for (const role of outcome) {
    it(`${role}: hands back done as 0 and refused as 1 with the summary`, async () => {
      vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ outcome: 'done', summary: 'delivered' }));
      const done = await ran({ role, fragment: 'claude -p --model haiku' });
      assert.equal(done.state, '0', done.log);
      assert.ok(lastPrompt().includes('{ outcome, summary }'));
      assert.ok(!lastPrompt().includes('next: pushed'));

      vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ outcome: 'refused', summary: 'a branch is not merged' }));
      const refused = await ran({ role, fragment: 'claude -p --model haiku' });
      assert.equal(refused.state, '1');
      assert.match(refused.log, new RegExp(`the ${role} run refused: a branch is not merged`));
    });
  }
});

describe('the model a board role runs on', () => {
  it('is the fragment --model with no Agent models entry, and the entry where one names the role', async () => {
    fs.writeFileSync(path.join(dir, 'docs/plans/made.md'), '# made\n', 'utf8');
    vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ written: 'docs/plans/made.md', summary: '' }));
    await ran({ role: 'idea', fragment: 'claude -p --model sonnet' });
    assert.equal(modelOf(argvOfLastStart()), 'sonnet');
    await ran({ role: 'idea', fragment: 'claude -p --model sonnet', agentModels: 'idea = opus' });
    assert.equal(modelOf(argvOfLastStart()), 'opus');
  });
});

describe('a written path the route cannot trust is a failed run', () => {
  for (const [written, reason] of [
    ['docs/plans/missing.md', /written path does not exist: 'docs\/plans\/missing.md'/],
    ['../../etc/passwd', /written path was refused: .*resolves outside the repository/],
    ['/etc/passwd', /written path was refused: .*resolves outside the repository/],
    ['', /ended with no written hand-back|ended with no hand-back/],
  ] as const) {
    it(`refuses '${written}'`, async () => {
      vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ written, summary: '' }));
      const got = await ran({ role: 'idea', fragment: 'claude -p' });
      assert.equal(got.state, '1');
      assert.match(got.log, reason);
    });
  }

  it('resolves the path against the tree the role ran in, not the repository root', async () => {
    const tree = path.join(dir, 'idea-tree');
    fs.mkdirSync(path.join(tree, 'docs/plans'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'docs/plans/in-tree.md'), '# in tree\n', 'utf8');
    vi.stubEnv('FAKE_CLAUDE_OUTPUT', JSON.stringify({ written: 'docs/plans/in-tree.md', summary: '' }));
    assert.equal((await ran({ role: 'idea', fragment: 'claude -p', tree })).state, '0');
    assert.equal(fs.existsSync(path.join(dir, 'docs/plans/in-tree.md')), false);
  });
});

describe('the command runner', () => {
  it('runs a board role with the background gate set', async () => {
    const got = await ran({
      role: 'idea',
      runner: 'command',
      fragment: `sh -c 'printf "bg=%s\\n" "$CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"' _`,
    });
    assert.equal(got.state, '0', got.log);
    assert.match(got.log, /bg=1/);
  });

  it('records a non-zero exit as the run not starting, naming the status', async () => {
    const got = await ran({ role: 'idea', runner: 'command', fragment: 'sh -c "exit 3" _' });
    assert.equal(got.state, '1');
    assert.match(got.log, /the idea run did not start: the command exited with status 3/);
  });

  it('records 124 for a run ended on its bound', async () => {
    const got = await ran({ role: 'implement', runner: 'command', fragment: "sh -c 'sleep 30' _", boundSeconds: 1 });
    assert.equal(got.state, '124');
    assert.match(got.log, /the implement run was ended at its time bound/);
  });
});

describe('a process without the SDK connector', () => {
  it('refuses a role on the SDK runner, naming why', async () => {
    useSdkConnector(undefined);
    const got = await ran({ role: 'brief', fragment: 'claude -p' });
    assert.equal(got.state, '1');
    assert.match(got.log, /does not carry the SDK runner/);
  });
});

describe('the state file after the board stops', () => {
  it('writes the board exit code into every run it still holds', async () => {
    const logFile = path.join(dir, 'held.log');
    const statePath = path.join(dir, 'held.state');
    const pidFile = path.join(dir, 'held.pid');
    fs.writeFileSync(logFile, '', 'utf8');
    markBoardRun(statePath, logFile);
    assert.equal(readRunState(statePath, logFile).state, 'running');
    await startBoardRun(opts(), {
      role: 'idea',
      fragmentKey: 'Role command',
      readCfg: config({ 'Role command': `sh -c 'echo $$ > "${pidFile}"; exec sleep 30' _`, 'Agent runner': 'command' }),
      tree: dir,
      prompt: 'p',
      env: {},
      logFile,
      statePath,
    });

    endHeldRuns(143);
    assert.equal(fs.readFileSync(statePath, 'utf8'), '143');
    assert.match(fs.readFileSync(logFile, 'utf8'), /the board exited with code 143 before the run ended/);
    assert.equal(readRunState(statePath, logFile).state, 'failed');

    // The real exit listener of the adapter ends the child with the process;
    // here the process lives on, so the test ends it by the pid it recorded.
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
    process.kill(Number(fs.readFileSync(pidFile, 'utf8').trim()), 'SIGKILL');
    await boardRunsSettled();
  });

  it('reads a running marker whose board is gone as failed, not running forever', () => {
    const logFile = path.join(dir, 'gone.log');
    const statePath = path.join(dir, 'gone.state');
    fs.writeFileSync(logFile, '', 'utf8');
    // A live process that is not this one reads running.
    fs.writeFileSync(statePath, `running ${process.ppid}`, 'utf8');
    assert.equal(readRunState(statePath, logFile).state, 'running');
    // 2^22 + 1 exceeds the pid range on macOS and Linux defaults.
    fs.writeFileSync(statePath, 'running 4194305', 'utf8');
    assert.deepEqual(readRunState(statePath, logFile), { state: 'failed', recorded: STOPPED_RECORD });
    // This board's own pid on a run it does not hold: a marker from before a
    // restart that reused the pid.
    fs.writeFileSync(statePath, `running ${process.pid}`, 'utf8');
    assert.equal(readRunState(statePath, logFile).state, 'failed');
  });
});
