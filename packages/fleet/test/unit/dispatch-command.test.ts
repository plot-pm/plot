import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scripts } from '@plot-pm/domain';
import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import { parseDispatchArgs, run, runDetached, type DispatchArgs } from '../../src/server/entry/dispatch-command.js';
import { actionReceiptPath } from '../../src/shared/action-receipt.js';
import { bodyBranch, nothingStartableDetail, startDispatch } from '../../src/shared/dispatch-command.js';
import { markBoardRun, writeState } from '../../src/shared/board-run.js';
import { IMPLEMENT_COMMAND_KEY, implementLogPath, implementStatePath } from '../../src/shared/implement-run.js';
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
  // Releases this process's hold, so its exit listener writes into no removed directory.
  writeState(implementStatePath(repo, SLUG), 0);
  rmTree(tmp);
});

/** Marks the implement as started by this process, as the launched process's `markBoardRun` does. */
const markStarted = (): void => {
  markBoardRun(implementStatePath(repo, SLUG), implementLogPath(repo, SLUG));
};

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
  it('returns once the state file holds the marker markBoardRun writes, before the process ends', async () => {
    const out: string[] = [];
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      // The launched process has taken the lock and is still running: it never exits.
      launch: () => {
        markStarted();
        return { pid: process.pid, exitCode: () => null };
      },
      startWaitMs: 2_000,
    }, (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('')).toContain(`implement started for ${SLUG}: pid ${process.pid}`);
  });

  it('reads a marker that records a start time beside the pid as started', async () => {
    // `running <pid> <startedAt>` is what `markBoardRun` writes; a reader that
    // compares the whole content with `running <pid>` never sees the start.
    fs.mkdirSync(path.dirname(implementStatePath(repo, SLUG)), { recursive: true });
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: () => {
        fs.writeFileSync(implementStatePath(repo, SLUG), `running ${process.pid} 1700000000000\n`);
        return { pid: process.pid, exitCode: () => null };
      },
      startWaitMs: 2_000,
    }, () => {});
    expect(code).toBe(0);
  });

  it('does not read a marker naming another pid as this launch started', async () => {
    const warned: string[] = [];
    const code = await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: () => {
        markStarted();
        return { pid: process.pid + 1, exitCode: () => null };
      },
      startWaitMs: 200,
    }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toMatch(/did not start/);
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
        markStarted();
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
      launch: () => ({ pid: 4242, exitCode: () => null }),
      startWaitMs: 100,
    }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toMatch(/did not start/);
  });

  it('names the live dispatch process in the timeout message, since it may still start the implement', async () => {
    const warned: string[] = [];
    await runDetached([SLUG], repo, SCRIPT_DIR, {
      launch: () => ({ pid: 4242, exitCode: () => null }),
      startWaitMs: 100,
    }, () => {}, (s) => warned.push(s));
    expect(warned.join('')).toContain('pid 4242');
    expect(warned.join('')).toMatch(/still running/);
  });
});

describe('startDispatch', () => {
  it('refuses a second dispatch of a slug whose implement still runs', async () => {
    const { scripts } = recordingScripts();
    const opts = { repoRoot: repo, scriptsDir: SCRIPT_DIR, scripts };
    const first = startDispatch({ opts, slug: SLUG, readCfg: configured('sleep 1'), startReading: () => ({ kind: 'no-reading' }) });
    expect(first.kind).toBe('started');
    const second = startDispatch({ opts, slug: SLUG, readCfg: configured('sleep 1'), startReading: () => ({ kind: 'no-reading' }) });
    expect(second).toMatchObject({ kind: 'refused', status: 409, reason: 'implement-running' });
    if (first.kind === 'started') await first.ended;
  });

  it('refuses a held reading before any spawn, script start or receipt', () => {
    const { scripts, starts } = recordingScripts();
    const opts = { repoRoot: repo, scriptsDir: SCRIPT_DIR, scripts };
    const reading = { kind: 'held', held: [{ branch: 'feature/a', state: 'waiting', waits_on: ['feature/x'] }] } as const;
    const out = startDispatch({ opts, slug: SLUG, readCfg: configured('touch spawned'), startReading: () => reading });
    expect(out).toMatchObject({ kind: 'refused', status: 409, reason: 'nothing-startable' });
    expect(out).toMatchObject({ detail: expect.stringContaining('feature/a waits for feature/x') });
    expect(starts).toHaveLength(0);
    expect(fs.existsSync(implementLogPath(repo, SLUG))).toBe(false);
    expect(fs.existsSync(actionReceiptPath(repo, 'dispatch'))).toBe(false);
  });

  it('still starts on no-reading and no-branch', async () => {
    for (const kind of ['no-reading', 'no-branch'] as const) {
      const { scripts } = recordingScripts();
      const out = startDispatch({ opts: { repoRoot: repo, scriptsDir: SCRIPT_DIR, scripts }, slug: SLUG, readCfg: configured('true'), startReading: () => ({ kind }) });
      expect(out.kind).toBe('started');
      if (out.kind === 'started') await out.ended;
    }
  });

  it('words a blocked branch with the missing-pull-request clause', () => {
    expect(nothingStartableDetail({ kind: 'held', held: [{ branch: 'b', state: 'blocked', waits_on: ['y'] }] })).toContain('b waits for y, which has no pull request');
  });
});

describe('the dispatch entry with a named branch', () => {
  /** A pulse where wave 4 offers two startable branches and a claimed one. */
  const pulse = (): FleetReading =>
    FleetReadingSchema.parse({
      main: 'main', head: 'abc1234',
      plans: [{ file: `2026-11-02-${SLUG}.md`, phase: 'approved', slices: [{
        name: 'wave 4',
        verdict: 'eligible',
        branches: ['feature/bitbucket-cutover', 'feature/jira-cutover', 'feature/taken'].map((branch) => ({
          branch, state: branch === 'feature/taken' ? 'claimed' : 'open', waits_on: [], held: false, deferred: false, claimed: '', ref_held: false,
        })),
      }] }],
      summary: { plans: 1, waves: 1, branches: 3, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
    });
  /** An `Implement command` that writes the brief branch it was handed. */
  const briefed = (): { command: string; read: () => string } => {
    const file = path.join(tmp, 'brief-branch');
    return { command: `printf '%s' "$PLOT_BRIEF_BRANCH" > '${file}'; true`, read: () => fs.readFileSync(file, 'utf8') };
  };

  it('briefs the named branch and hands plot-dispatch.sh that branch alone', async () => {
    const { scripts, starts } = recordingScripts();
    const brief = briefed();
    const code = await run([SLUG, '--branch', 'feature/jira-cutover'], repo, SCRIPT_DIR, { scripts, readCfg: configured(brief.command), pulse });
    expect(code).toBe(0);
    expect(brief.read()).toBe('feature/jira-cutover');
    expect(starts.map((s) => s.args)).toEqual([['--max', '1', '--branch', 'feature/jira-cutover', SLUG]]);
  });

  it('briefs the first startable branch and passes no --branch where none is named', async () => {
    const { scripts, starts } = recordingScripts();
    const brief = briefed();
    const code = await run([SLUG], repo, SCRIPT_DIR, { scripts, readCfg: configured(brief.command), pulse });
    expect(code).toBe(0);
    expect(brief.read()).toBe('feature/bitbucket-cutover');
    expect(starts.map((s) => s.args)).toEqual([['--max', '1', SLUG]]);
  });

  it('refuses a claimed branch and a foreign branch by name, starting nothing and writing no receipt', async () => {
    for (const [branch, refusal] of [
      ['feature/taken', 'branch-not-startable: feature/taken is not startable: it is claimed'],
      ['feature/elsewhere', `branch-not-in-plan: feature/elsewhere is not a branch of plan ${SLUG}`],
    ] as const) {
      const { scripts, starts } = recordingScripts();
      const warned: string[] = [];
      const code = await run([SLUG, '--branch', branch], repo, SCRIPT_DIR, { scripts, readCfg: configured('true'), pulse }, () => {}, (s) => warned.push(s));
      expect(code).toBe(1);
      expect(warned.join('')).toContain(refusal);
      expect(starts).toHaveLength(0);
      expect(fs.existsSync(actionReceiptPath(repo, 'dispatch'))).toBe(false);
    }
  });

  it('refuses a named branch where there is no pulse to confirm it', async () => {
    const warned: string[] = [];
    const code = await run([SLUG, '--branch', 'feature/jira-cutover'], repo, SCRIPT_DIR, { readCfg: configured('true'), pulse: () => null }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toContain('no-pulse-reading');
  });

  it('forwards the named branch to the launched process', async () => {
    let launched: DispatchArgs | undefined;
    await runDetached(['--branch', 'feature/jira-cutover', SLUG], repo, SCRIPT_DIR, {
      launch: (args) => {
        launched = args;
        return { pid: 1, exitCode: () => 1 };
      },
    }, () => {}, () => {});
    expect(launched).toEqual({ slug: SLUG, branch: 'feature/jira-cutover' });
  });

  it('parses the flag in either position and refuses a missing or malformed value', () => {
    expect(parseDispatchArgs([SLUG, '--branch', 'feature/a'])).toEqual({ slug: SLUG, branch: 'feature/a' });
    expect(parseDispatchArgs(['--branch', 'feature/a', SLUG])).toEqual({ slug: SLUG, branch: 'feature/a' });
    expect(parseDispatchArgs([SLUG])).toEqual({ slug: SLUG });
    expect(parseDispatchArgs([SLUG, '--branch'])).toBeNull();
    expect(parseDispatchArgs([SLUG, '--branch', '--max'])).toBeNull();
    expect(parseDispatchArgs([SLUG, '--branch', 'feature/a', 'extra'])).toBeNull();
  });

  it('reads a request body\'s branch, and refuses a value that is not a branch name', () => {
    expect(bodyBranch({ slug: SLUG })).toEqual({});
    expect(bodyBranch({ slug: SLUG, branch: 'feature/a' })).toEqual({ branch: 'feature/a' });
    expect(bodyBranch({ slug: SLUG, branch: 7 })).toBeNull();
    expect(bodyBranch({ slug: SLUG, branch: '-x' })).toBeNull();
  });
});
