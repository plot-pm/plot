import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `plot-ask.mjs metrics [--weeks N]`: the rows `deliveryMetrics` returns over
 * the plan files on `origin/main` and the PR index, read with no host call.
 */

/** Every process start through `node:child_process`, as one command line each. */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const wrap = <F extends (...a: never[]) => unknown>(fn: F): F => {
    const wrapped = ((...a: unknown[]) => {
      starts.lines.push([String(a[0]), ...(Array.isArray(a[1]) ? a[1].map(String) : [])].join(' '));
      return (fn as unknown as (...b: unknown[]) => unknown)(...a);
    }) as unknown as F;
    for (const key of Reflect.ownKeys(fn)) {
      if (key === 'length' || key === 'name') continue;
      Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)!);
    }
    return wrapped;
  };
  const counted = {
    ...real,
    spawn: wrap(real.spawn),
    spawnSync: wrap(real.spawnSync),
    execFile: wrap(real.execFile),
    execFileSync: wrap(real.execFileSync),
    exec: wrap(real.exec),
    execSync: wrap(real.execSync),
  };
  return { ...counted, default: counted };
});

import { execFileSync } from 'node:child_process';
import { PR_INDEX_VERSION } from '@plot-pm/domain';

import { run, metricsWeeksArg } from '../../src/server/entry/main.js';
import { removeTree } from '../rm-tree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

/** Tuesday of ISO week 2026-W48. */
const NOW = Date.parse('2026-11-24T10:00:00Z');

const ENV_KEYS = ['PLOT_REPO_ROOT', 'PLOT_SCRIPTS_DIR', 'PLOT_BOARD_MOCK', 'PLOT_PR_INDEX_HOME', 'PLOT_HOST', 'PATH'] as const;
const TOKEN_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'BB_TOKEN', 'BITBUCKET_TOKEN', 'BITBUCKET_API_TOKEN'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

let repo = '';
let indexHome = '';
let bin = '';
let hostMarker = '';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
};

const planText = (records: string[]): string =>
  ['# A plan', '', '## Status', '', '- **State:** Delivered', ...records, '', '## Slices', ''].join('\n');

const writeIndex = (version: number, mergedAt: readonly string[]): void => {
  const rows = mergedAt.map((at, i) => ({
    number: i + 1,
    head: `feature/f${i}`,
    state: 'MERGED',
    draft: false,
    checks: 'none',
    review: '',
    url: '',
    mergedAt: at,
  }));
  const store = { v: version, connector: 'github', watermark: null, complete: true, at: '2026-11-24T00:00:00Z', rows };
  fs.writeFileSync(path.join(indexHome, 'github.json'), `${JSON.stringify(store)}\n`);
};

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-metrics-')));
  indexHome = path.join(repo, '.index');
  bin = path.join(repo, '.bin');
  hostMarker = path.join(repo, '.host-called');
  fs.mkdirSync(indexHome);
  fs.mkdirSync(bin);
  for (const tool of ['gh', 'bb', 'curl']) {
    fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\necho ${tool} >> '${hostMarker}'\nexit 1\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), '.index/\n.bin/\n.host-called\n');
  fs.mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  const plans: Record<string, string[]> = {
    // Delivered on the Sunday ending 2026-W47, 4 days after approval.
    'docs/plans/2026-11-01-sunday.md': ['- **Approved:** 2026-11-18, jwloka, pr', '- **Delivered:** 2026-11-22'],
    // Delivered on the Monday starting 2026-W48, 2 days after approval.
    'docs/plans/2026-11-01-monday.md': ['- **Approved:** 2026-11-21, eins78, pr', '- **Delivered:** 2026-11-23'],
    // Delivered with no approval record.
    'docs/plans/2026-11-01-unapproved.md': ['- **Delivered:** 2026-11-24'],
    // Approved, with the template placeholder for the delivery.
    'docs/plans/2026-11-01-placeholder.md': ['- **Approved:** 2026-11-24, jwloka, pr', '- **Delivered:** <!-- YYYY-MM-DD -->'],
  };
  for (const [file, records] of Object.entries(plans)) fs.writeFileSync(path.join(repo, file), planText(records));
  git(repo, 'init', '--quiet', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'plans');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  // A plan only on the working tree is not on the default branch.
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-11-01-local.md'), planText(['- **Delivered:** 2026-11-24']));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(path.join(indexHome, 'github.json'), { force: true });
  starts.lines.length = 0;
});

afterAll(() => {
  if (repo) removeTree(repo);
});

const ask = async (argv: string[]): Promise<{ code: number; lines: string[] }> => {
  process.env.PLOT_REPO_ROOT = repo;
  process.env.PLOT_SCRIPTS_DIR = REAL_SCRIPTS;
  process.env.PLOT_PR_INDEX_HOME = indexHome;
  process.env.PLOT_HOST = 'github';
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ''}`;
  delete process.env.PLOT_BOARD_MOCK;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  let out = '';
  const code = await run(argv, HERE, (s) => { out += s; });
  return { code, lines: out.trimEnd().split('\n') };
};

const row = (lines: string[], week: string): string[] => lines.find((l) => l.startsWith(week))?.split(/\s{2,}/) ?? [];

describe('plot-ask metrics', () => {
  it('prints 8 weeks by default, oldest first, ending with the current week', async () => {
    writeIndex(PR_INDEX_VERSION, []);
    const { code, lines } = await ask(['metrics']);
    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^week\s+merged\s+approved\s+delivered\s+released\s+lead-days\s+design-days\s+approvers$/);
    expect(lines.slice(1).map((l) => l.split(' ')[0])).toEqual([
      '2026-W41', '2026-W42', '2026-W43', '2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48',
    ]);
  });

  it('reads the plans on origin/main and puts the Sunday and the Monday deliveries in two weeks', async () => {
    writeIndex(PR_INDEX_VERSION, ['2026-11-22T23:00:00Z', '2026-11-23T01:00:00Z', '2026-11-24T09:00:00Z']);
    const { lines } = await ask(['metrics', '--weeks', '2']);
    expect(lines).toHaveLength(3);
    expect(row(lines, '2026-W47')).toEqual(['2026-W47', '1', '2', '1', '0', '4', '-', 'eins78=1 jwloka=1']);
    // The Monday delivery, the unapproved one and no local-only plan: 2 deliveries, one lead time.
    expect(row(lines, '2026-W48')).toEqual(['2026-W48', '2', '1', '2', '0', '2', '-', 'jwloka=1']);
    expect(lines.join('\n')).not.toContain('NaN');
  });

  it('covers N weeks ending now when N is longer than the history', async () => {
    writeIndex(PR_INDEX_VERSION, []);
    const { lines } = await ask(['metrics', '--weeks', '30']);
    expect(lines).toHaveLength(31);
    expect(lines[1]).toMatch(/^2026-W19\s+0\s+0\s+0\s+0\s+-\s+-\s+-$/);
  });

  it('prints merged 0 for a readable index with no merged rows in the week', async () => {
    writeIndex(PR_INDEX_VERSION, []);
    const { lines } = await ask(['metrics', '--weeks', '1']);
    expect(row(lines, '2026-W48')[1]).toBe('0');
  });

  it('prints merged unread in every week where the index is missing', async () => {
    const { code, lines } = await ask(['metrics', '--weeks', '3']);
    expect(code).toBe(0);
    expect(lines.slice(1).map((l) => l.split(/\s+/)[1])).toEqual(['unread', 'unread', 'unread']);
  });

  it('prints merged unread for an index one version behind', async () => {
    writeIndex(PR_INDEX_VERSION - 1, ['2026-11-24T09:00:00Z']);
    const { lines } = await ask(['metrics', '--weeks', '1']);
    expect(row(lines, '2026-W48')[1]).toBe('unread');
  });

  it('prints merged unread for an index at v: 7', async () => {
    writeIndex(7, ['2026-11-24T09:00:00Z']);
    const { lines } = await ask(['metrics', '--weeks', '1']);
    expect(row(lines, '2026-W48')[1]).toBe('unread');
  });

  it('makes no host call and sets no host token', async () => {
    writeIndex(PR_INDEX_VERSION, ['2026-11-24T09:00:00Z']);
    const tokensBefore = TOKEN_KEYS.map((k) => process.env[k]);
    await ask(['metrics']);
    expect(fs.existsSync(hostMarker)).toBe(false);
    expect(starts.lines.filter((l) => /(^|[\s/])(gh|bb|curl)(\s|$)/.test(l))).toEqual([]);
    expect(starts.lines.filter((l) => l.includes('plot-host.sh') && !/plot-host\.sh backend$/.test(l))).toEqual([]);
    expect(TOKEN_KEYS.map((k) => process.env[k])).toEqual(tokensBefore);
  });
});

describe('metricsWeeksArg', () => {
  it('defaults to 8 and refuses anything but --weeks with a positive whole number', () => {
    expect(metricsWeeksArg([])).toBe(8);
    expect(metricsWeeksArg(['--weeks', '12'])).toBe(12);
    for (const args of [['--weeks'], ['--weeks', '0'], ['--weeks', '-1'], ['--weeks', '2x'], ['12'], ['--weeks', '3', 'extra']]) {
      expect(metricsWeeksArg(args)).toBeNull();
    }
  });

  it('prints the usage line and exits 2 for a bad argument', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = vi.fn();
    expect(await run(['metrics', '--weeks', 'x'], HERE, out)).toBe(2);
    expect(err).toHaveBeenCalledWith('usage: plot-ask.mjs metrics [--weeks N]\n');
    expect(out).not.toHaveBeenCalled();
  });
});
