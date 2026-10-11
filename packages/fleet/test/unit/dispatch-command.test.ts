import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scripts } from '@plot-pm/domain';
import { run, runDetached } from '../../src/server/entry/dispatch-command.js';
import { actionReceiptPath } from '../../src/shared/action-receipt.js';
import { startDispatch } from '../../src/shared/dispatch-command.js';
import { IMPLEMENT_COMMAND_KEY, implementStatePath } from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The dispatch controller with no board: a stub `Implement command` and an
// injected `Scripts` port stand in for the agent and for `plot-dispatch.sh`.
// Every observation is a value the controller records at the moment it acts —
// whether the receipt file exists when `Scripts.start` is called — never output
// a spawned process produces.

const SLUG = 'a-plan-the-fleet-dispatches';

let tmp: string;
let repo: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-command-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
});

afterEach(() => {
  rmTree(tmp);
});

/** A config reader answering the `Implement command` key and nothing else. */
const configured =
  (command: string) =>
  (_opts: unknown, key: string, fallback: string): string =>
    key === IMPLEMENT_COMMAND_KEY ? command : fallback;

interface Started {
  script: string;
  args: readonly string[];
  receiptPresent: boolean;
}

/** A `Scripts` port that records each start and whether the receipt existed at that moment. */
const recordingScripts = (): { scripts: Scripts; starts: Started[] } => {
  const starts: Started[] = [];
  const scripts = {
    start: (script: string, args: readonly string[]) => {
      starts.push({ script, args, receiptPresent: fs.existsSync(actionReceiptPath(repo, 'dispatch')) });
      return { pid: 1, started: true };
    },
  } as unknown as Scripts;
  return { scripts, starts };
};

const SCRIPT_DIR = path.resolve(__dirname, '../../../../skills/plot/scripts');

describe('the dispatch entry', () => {
  it('writes the receipt before plot-dispatch.sh starts, once the implement exits 0', async () => {
    const { scripts, starts } = recordingScripts();
    const out: string[] = [];
    const code = await run([SLUG], repo, SCRIPT_DIR, { scripts, readCfg: configured('true'), pulse: () => null }, (s) => out.push(s));
    expect(code).toBe(0);
    expect(starts).toHaveLength(1);
    expect(starts[0].args).toEqual(['--max', '1', SLUG]);
    expect(starts[0].receiptPresent).toBe(true);
    expect(out.join('')).toContain(`dispatch started for ${SLUG}`);
  });

  it('writes no receipt and starts nothing when the implement exits 1', async () => {
    const { scripts, starts } = recordingScripts();
    const warned: string[] = [];
    const code = await run([SLUG], repo, SCRIPT_DIR, { scripts, readCfg: configured('false'), pulse: () => null }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(starts).toHaveLength(0);
    expect(fs.existsSync(actionReceiptPath(repo, 'dispatch'))).toBe(false);
    expect(warned.join('')).toMatch(/implement exited 1/);
  });

  it('refuses with no-implement-command where the key is absent, writing no receipt', async () => {
    const { scripts, starts } = recordingScripts();
    const warned: string[] = [];
    const code = await run([SLUG], repo, SCRIPT_DIR, { scripts, readCfg: configured(''), pulse: () => null }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toContain('no-implement-command');
    expect(starts).toHaveLength(0);
    expect(fs.existsSync(actionReceiptPath(repo, 'dispatch'))).toBe(false);
  });

  it('exits 2 with the usage line for a missing or malformed slug', async () => {
    const warned: string[] = [];
    expect(await run([], repo, SCRIPT_DIR, {}, () => {}, (s) => warned.push(s))).toBe(2);
    expect(await run(['../etc'], repo, SCRIPT_DIR, {}, () => {}, (s) => warned.push(s))).toBe(2);
    expect(warned.join('')).toContain('usage: plot-dispatch-command.mjs <plan-slug>');
  });
});

describe('the detached dispatch entry', () => {
  it('returns once the state file reads running <pid>, before the process ends', async () => {
    const out: string[] = [];
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      // The launched process has taken the lock and is still running: it never exits.
      launch: () => {
        fs.writeFileSync(implementStatePath(repo, SLUG), `running ${process.pid}`);
        return { pid: process.pid, exitCode: () => null };
      },
    }, (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('')).toContain(`implement started for ${SLUG}: pid ${process.pid}`);
  });

  it('reports the launch log and its code where the process exits before it started', async () => {
    const warned: string[] = [];
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: (_slug, _root, launchLog) => {
        fs.writeFileSync(launchLog, 'plot-dispatch-command: implement-running: already\n');
        return { pid: 1, exitCode: () => 1 };
      },
    }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toContain('implement-running');
  });

  it('names the launch log by the launching process\'s pid where no launch id is given', async () => {
    let launchLog = '';
    await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: (_slug, _root, log) => {
        launchLog = log;
        return { pid: 1, exitCode: () => 1 };
      },
    }, () => {}, () => {});
    expect(path.basename(launchLog)).toContain(`.launch.${process.pid}.`);
  });

  it('gives each launch its own log, so a launch that loses the lock leaves the winner\'s log whole', async () => {
    const logs: string[] = [];
    const winner = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launchId: 'first',
      launch: (_slug, _root, launchLog) => {
        logs.push(launchLog);
        fs.writeFileSync(launchLog, 'the winner wrote this\n');
        fs.writeFileSync(implementStatePath(repo, SLUG), `running ${process.pid}`);
        return { pid: process.pid, exitCode: () => null };
      },
    }, () => {});
    expect(winner).toBe(0);
    const warned: string[] = [];
    const loser = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launchId: 'second',
      launch: (_slug, _root, launchLog) => {
        logs.push(launchLog);
        fs.writeFileSync(launchLog, 'plot-dispatch-command: implement-running: already\n');
        return { pid: 1, exitCode: () => 1 };
      },
    }, () => {}, (s) => warned.push(s));
    expect(loser).toBe(1);
    expect(warned.join('')).toContain('implement-running');
    expect(logs[0]).not.toBe(logs[1]);
    expect(fs.readFileSync(logs[0], 'utf8')).toBe('the winner wrote this\n');
    expect(fs.existsSync(logs[1])).toBe(false);
  });

  it('gives up where the implement never starts within the wait', async () => {
    const warned: string[] = [];
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: () => ({ pid: 1, exitCode: () => null }),
      startWaitMs: 100,
    }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toMatch(/did not start/);
  });
});

describe('startDispatch', () => {
  it('refuses a second dispatch of a slug whose implement still runs', async () => {
    const { scripts } = recordingScripts();
    const opts = { repoRoot: repo, scriptsDir: SCRIPT_DIR, scripts };
    const first = startDispatch({ opts, slug: SLUG, readCfg: configured('sleep 1'), briefBranch: () => null });
    expect(first.kind).toBe('started');
    const second = startDispatch({ opts, slug: SLUG, readCfg: configured('sleep 1'), briefBranch: () => null });
    expect(second).toMatchObject({ kind: 'refused', status: 409, reason: 'implement-running' });
    if (first.kind === 'started') await first.ended;
  });
});
