import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scripts } from '@plot-pm/domain';
import { run } from '../../src/server/entry/dispatch-command.js';
import { actionReceiptPath } from '../../src/shared/action-receipt.js';
import { startDispatch } from '../../src/shared/dispatch-command.js';
import { IMPLEMENT_COMMAND_KEY } from '../../src/shared/implement-run.js';
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
