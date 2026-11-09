import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { shellContext } from '../src/adapters/scripts.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';
import { bundlePathsOf, deskDirtFilter } from '../src/rules/desk-dirt-filter.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * A RULE-VERSUS-SHELL COMPARISON: does `deskDirtFilter` keep what
 * `plot-worker-state.sh`'s `plot_worker_dirty_filter` keeps, and does
 * `treesGit.dirtyPaths` answer what `plot_worker_dirty` answers?
 *
 * THE PAIR EXISTS ON PURPOSE. The shell reads a desk's dirt once per desk per
 * pass in `plot-dispatch.sh`, `plot-fleetctl.sh` and the worker loop, so it
 * keeps its copy (`docs/shell-and-domain.md`). NEITHER SIDE IS AUTHORITATIVE:
 * on a disagreement the branch stops.
 *
 * THREE CORPORA. A constructed porcelain corpus, each text filtered with no
 * worktree and with a worktree whose `build.mjs` declares two bundles. Every
 * worktree of this estate, where one `git status` per desk is written to a file
 * and both sides filter that same text, so a desk that changes during the run
 * cannot make the sides differ. And constructed git desks, where the adapter's
 * whole reading — its own `git status` and the desk's own `build.mjs` — is
 * compared with `plot_worker_dirty`.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const base = realpathSync(mkdtempSync(join(tmpdir(), 'plot-desk-dirt-filter-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** A `build.mjs` declaring two bundles on single lines and one across lines. */
const BUILD = [
  "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');",
  "const shippedAsk = path.join(here, '../../skills/plot/scripts/board/plot-ask.mjs');",
  'const shippedLong = path.join(',
  "  here, '../../skills/plot/scripts/board/plot-long.mjs',",
  ');',
  '',
].join('\n');

/** Each porcelain text, with a name a failure can be read by. */
const PORCELAIN: Array<[name: string, text: string]> = [
  ['clean', ''],
  ['plain', ' M src/a.ts\n?? new.ts\nA  added.ts\nD  gone.ts'],
  ['records', '?? .plot-worker.log\n?? .plot-worker.pid.startedAt\n?? sub/.plot-worker.exit\n M x.plot-worker.ts'],
  ['leftovers', '?? a.tmp\n?? a.tmp12\n?? b.swp\n?? c.orig\n?? d.rej\n?? e.bak\n?? f.bak.ts\n?? tmp1'],
  [
    'scratch',
    [
      '?? .playwright-mcp/',
      '?? .playwright-mcp/shot.png',
      '?? .plot/agents/a.json',
      '?? .plot/state',
      '?? .plot/',
      '?? .omc/state/s.json',
      '?? pkg/.plot/state/p.json',
      '?? .plot/statements.md',
      '?? .omc/stateful.ts',
    ].join('\n'),
  ],
  ['correction-root', '?? PLOT-CORRECTION.md'],
  ['correction-other', 'A  PLOT-CORRECTION.md\n M PLOT-CORRECTION.md\n?? docs/PLOT-CORRECTION.md\n?? PLOT-CORRECTION.md.bak'],
  ['renames', 'R  old.ts -> new.ts\nR  a.ts -> b.ts.orig\nR  .plot-worker.log -> kept.ts\nC  x.ts -> y.ts'],
  ['quoted', '?? "with space.ts"\n?? "tab\\there.ts"\n M "\\303\\244.ts"\n?? "a.swp"'],
  [
    'bundles',
    [
      ' M skills/plot/scripts/board/board-server.mjs',
      'M  skills/plot/scripts/board/plot-ask.mjs',
      ' M skills/plot/scripts/board/plot-long.mjs',
      ' M skills/plot/scripts/board/README.md',
      'R  x.mjs -> skills/plot/scripts/board/board-server.mjs',
      '?? skills/plot/scripts/board/',
    ].join('\n'),
  ],
  ['short-lines', ' M a\n?? b'],
];

/** One subject: a porcelain file, and the worktree the shell is handed, or none. */
interface Case {
  name: string;
  file: string;
  worktree: string;
  bundlePaths: readonly string[];
}

/**
 * Every case's output from the SHIPPED shell filter, in one bash process under
 * `LC_ALL=C`. One line per case on stdin: the porcelain file, a tab, the
 * worktree. Each case's output ends with a NUL so an empty answer is one too.
 */
const shellFiltered = (all: readonly Case[]): string[][] => {
  const script = `
    . ${JSON.stringify(STATE_LIB)}
    while IFS="$(printf '\\t')" read -r file wt; do
      plot_worker_dirty_filter "$(cat "$file")" "$wt"
      printf '\\0'
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: all.map((one) => `${one.file}\t${one.worktree}`).join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  return out
    .split('\0')
    .slice(0, all.length)
    .map((one) => (one === '' ? [] : one.replace(/\n$/, '').split('\n')));
};

const buildDesk = join(base, 'build-desk');
mkdirSync(join(buildDesk, 'packages', 'board'), { recursive: true });
writeFileSync(join(buildDesk, 'packages', 'board', 'build.mjs'), BUILD);

const constructed: Case[] = PORCELAIN.flatMap(([name, text], i) => {
  const file = join(base, `porcelain-${i}.txt`);
  writeFileSync(file, text);
  return [
    { name: `${name}/no-worktree`, file, worktree: '', bundlePaths: [] },
    { name: `${name}/build-desk`, file, worktree: buildDesk, bundlePaths: bundlePathsOf(BUILD) },
  ];
});

/** Every worktree of this estate, one `git status --porcelain` each, written to a file. */
const estateWorktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((line) => line.startsWith('worktree '))
  .map((line) => line.slice('worktree '.length))
  .filter((path) => existsSync(path));

const estate: Case[] = estateWorktrees.map((worktree, i) => {
  const file = join(base, `estate-${i}.txt`);
  let status = '';
  try {
    status = execFileSync('git', ['--no-optional-locks', '-C', worktree, 'status', '--porcelain'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    status = '';
  }
  writeFileSync(file, status);
  const build = join(worktree, 'packages', 'board', 'build.mjs');
  const bundlePaths = existsSync(build) ? bundlePathsOf(readFileSync(build, 'utf8')) : [];
  return { name: worktree.replace(/^.*\//, ''), file, worktree, bundlePaths };
});

const compareAll = (all: readonly Case[]): Disagreement[] => {
  const shell = shellFiltered(all);
  const found: Disagreement[] = [];
  all.forEach((one, i) => {
    const rule = deskDirtFilter(readFileSync(one.file, 'utf8'), one.bundlePaths);
    compareField(found, one.name, 'dirty', JSON.stringify(rule), JSON.stringify(shell[i]));
  });
  return found;
};

describe('deskDirtFilter agrees with plot-worker-state.sh plot_worker_dirty_filter', () => {
  it('reads a constructed corpus worth comparing', () => {
    expect(constructed.length).toBe(PORCELAIN.length * 2);
    expect(bundlePathsOf(BUILD)).toEqual([
      'skills/plot/scripts/board/board-server.mjs',
      'skills/plot/scripts/board/plot-ask.mjs',
    ]);
  });

  it('keeps what the shell keeps on every constructed porcelain text', () => {
    expect(compareAll(constructed).map(report)).toEqual([]);
  });

  it('keeps what the shell keeps on every worktree of this estate', () => {
    expect(estate.length).toBeGreaterThan(0);
    expect(compareAll(estate).map(report)).toEqual([]);
  });

  it('pins the answers both sides must give, so agreement is not a shared mistake', () => {
    const shell = shellFiltered(constructed);
    const answer = (name: string): [string[], string[]] => {
      const i = constructed.findIndex((one) => one.name === name);
      const one = constructed[i]!;
      return [deskDirtFilter(readFileSync(one.file, 'utf8'), one.bundlePaths), shell[i] ?? []];
    };
    const both = (list: string[]): [string[], string[]] => [list, list];
    expect(answer('correction-root/no-worktree')).toEqual(both([]));
    expect(answer('renames/no-worktree')).toEqual(both(['old.ts -> new.ts', 'x.ts -> y.ts']));
    expect(answer('bundles/build-desk')).toEqual(
      both([
        'skills/plot/scripts/board/plot-long.mjs',
        'skills/plot/scripts/board/README.md',
        'x.mjs -> skills/plot/scripts/board/board-server.mjs',
        'skills/plot/scripts/board/',
      ]),
    );
    expect(answer('bundles/no-worktree')[0]).toHaveLength(6);
  });
});

/** Runs git in a constructed desk. */
const git = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

/** A git desk whose own `build.mjs` declares `ownBundle`, with each file in `dirty` written after the first commit. */
const gitDesk = (name: string, build: string | null, dirty: Record<string, string>): string => {
  const desk = join(base, name);
  mkdirSync(desk);
  git(desk, ['init', '--quiet', '--initial-branch=main']);
  git(desk, ['config', 'user.email', 'test@example.com']);
  git(desk, ['config', 'user.name', 'Test']);
  const tracked = ['out/own.mjs', 'skills/plot/scripts/board/board-server.mjs', 'src/a.ts'];
  for (const path of tracked) {
    mkdirSync(join(desk, path, '..'), { recursive: true });
    writeFileSync(join(desk, path), 'one\n');
  }
  if (build !== null) {
    mkdirSync(join(desk, 'packages', 'board'), { recursive: true });
    writeFileSync(join(desk, 'packages', 'board', 'build.mjs'), build);
  }
  git(desk, ['add', '-A']);
  git(desk, ['commit', '--quiet', '-m', 'first']);
  for (const [path, text] of Object.entries(dirty)) {
    mkdirSync(join(desk, path, '..'), { recursive: true });
    writeFileSync(join(desk, path), text);
  }
  return desk;
};

describe('treesGit.dirtyPaths agrees with plot-worker-state.sh plot_worker_dirty', () => {
  const changed = {
    'out/own.mjs': 'two\n',
    'skills/plot/scripts/board/board-server.mjs': 'two\n',
    'src/a.ts': 'two\n',
    '.plot-worker.log': 'log\n',
    'PLOT-CORRECTION.md': 'fix\n',
    'notes.md.orig': 'x\n',
  };
  const desks = [
    gitDesk('desk-own-bundle', "const shippedOwn = path.join(here, '../../out/own.mjs');\n", changed),
    gitDesk('desk-main-build', BUILD, changed),
    gitDesk('desk-no-build', null, changed),
    gitDesk('desk-clean', BUILD, {}),
  ];
  const trees = treesGit(shellContext(ROOT));

  /** `plot_worker_dirty` per desk, in one bash process. */
  const shellDirty = (): string[][] => {
    const script = `
      . ${JSON.stringify(STATE_LIB)}
      for wt in "$@"; do plot_worker_dirty "$wt"; printf '\\0'; done
    `;
    const out = execFileSync('bash', ['-c', script, 'bash', ...desks], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 60_000,
    });
    return out
      .split('\0')
      .slice(0, desks.length)
      .map((one) => (one === '' ? [] : one.replace(/\n$/, '').split('\n')));
  };

  it('answers what the shell answers on every constructed desk, each with its own build.mjs', async () => {
    const shell = shellDirty();
    const found: Disagreement[] = [];
    for (const [i, desk] of desks.entries()) {
      const answer = await trees.dirtyPaths(desk);
      const adapter = answer.ok ? [...answer.value] : ['(failed)'];
      compareField(found, desk.replace(/^.*\//, ''), 'dirty', JSON.stringify(adapter), JSON.stringify(shell[i]));
    }
    expect(found.map(report)).toEqual([]);
    expect(shell[0]).toEqual(['skills/plot/scripts/board/board-server.mjs', 'src/a.ts']);
    expect(shell[1]).toEqual(['out/own.mjs', 'src/a.ts']);
    expect(shell[3]).toEqual([]);
  });
});
