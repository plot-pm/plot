import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { removeTree } from '../rm-tree.mjs';

/**
 * `plot-ask.mjs spike <slug>`: one answer line and an exit code per reading of
 * a plan's `Spike approved:` record, read through the real plan store.
 */

const { run } = await import('../../src/server/entry/main.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const made: string[] = [];
const savedEnv = {
  root: process.env.PLOT_REPO_ROOT,
  scripts: process.env.PLOT_SCRIPTS_DIR,
  mock: process.env.PLOT_BOARD_MOCK,
};
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  vi.restoreAllMocks();
  restore('PLOT_REPO_ROOT', savedEnv.root);
  restore('PLOT_SCRIPTS_DIR', savedEnv.scripts);
  restore('PLOT_BOARD_MOCK', savedEnv.mock);
  for (const dir of made.splice(0)) removeTree(dir);
});

const planText = (record: string | null): string => [
  '# The spike plan',
  '',
  '## Status',
  '',
  '- **State:** Design',
  '- **Review:** pr',
  ...(record === null ? [] : [`- **Spike approved:** ${record}`]),
  '',
  '## Slices',
  '',
  '### The spike',
  '',
  '- `feature/the-spike` <!-- spike --> — the risky part',
  '',
  '### The rest',
  '',
  '- `feature/the-rest` — everything else',
  '',
].join('\n');

/** A repository holding one plan file with the given body, and the env pointing at it. */
const repoWith = (body: string | Buffer): string => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-spike-'));
  made.push(repoRoot);
  fs.mkdirSync(path.join(repoRoot, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs/plans/2026-11-21-the-spike-plan.md'), body);
  process.env.PLOT_REPO_ROOT = repoRoot;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  delete process.env.PLOT_BOARD_MOCK;
  return repoRoot;
};

const ask = async (argv: string[]): Promise<{ code: number; out: string }> => {
  let out = '';
  const code = await run(argv, HERE, (s) => { out += s; });
  return { code, out };
};

describe('plot-ask spike', () => {
  it('answers licensed with the branch and the record date, exit 0', async () => {
    repoWith(planText('2026-11-20, jwloka, pr, feature/the-spike'));
    expect(await ask(['spike', 'the-spike-plan'])).toEqual({ code: 0, out: 'licensed feature/the-spike 2026-11-20\n' });
  });

  it('answers unlicensed with the reason verbatim and the record date, exit 1', async () => {
    repoWith(planText('2026-11-19, jwloka, pr, feature/the-old-name'));
    expect(await ask(['spike', 'the-spike-plan'])).toEqual({ code: 1, out: 'unlicensed spike-branch-renamed 2026-11-19\n' });
  });

  it('answers spike-record-absent with - as the date, exit 1', async () => {
    repoWith(planText(null));
    expect(await ask(['spike', 'the-spike-plan'])).toEqual({ code: 1, out: 'unlicensed spike-record-absent -\n' });
  });

  it('answers unaskable for a file that does not read as a plan, exit 2', async () => {
    repoWith(Buffer.from([0x00, 0x01, 0x02, 0x0a]));
    expect(await ask(['spike', 'the-spike-plan'])).toEqual({ code: 2, out: 'unaskable plan-unreadable\n' });
  });

  it('answers unaskable for a slug with no plan file, exit 2', async () => {
    repoWith(planText(null));
    expect(await ask(['spike', 'no-such-plan'])).toEqual({ code: 2, out: 'unaskable plan-not-found\n' });
  });

  it('reads the plan file the caller names instead of the plan directory\'s', async () => {
    const root = repoWith(planText(null));
    const scratch = path.join(root, 'scratch.md');
    fs.writeFileSync(scratch, planText('2026-11-18, jwloka, pr, feature/the-spike'));
    expect(await ask(['spike', 'the-spike-plan', scratch])).toEqual({ code: 0, out: 'licensed feature/the-spike 2026-11-18\n' });
  });

  it.each([
    ['no slug', ['spike']],
    ['a slug with a slash', ['spike', '../x']],
    ['an extra argument', ['spike', 'a', 'b', 'c']],
  ])('exits 2 with the usage line for %s', async (_name, argv) => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { code, out } = await ask(argv);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs spike <slug> [<plan-file>]\n');
  });
});
