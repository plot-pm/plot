import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shellContext } from '../src/adapters/scripts.js';
import { treesGit } from '../src/adapters/trees/trees-git.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE SEVENTH AND EIGHTH RULE-VERSUS-SHELL COMPARISONS: do `treesGit().quietSeconds`
 * and `treesGit().hasCommits` answer what `plot_worker_tree_quiet_seconds` and
 * `plot_worker_has_commits` answer, over a desk in every state the idle watch
 * meets?
 *
 * THE PAIR EXISTS ON PURPOSE. The idle watch asks both once per agent per pass
 * (`docs/shell-and-domain.md`), so the loop's JS entry duplicates the readings
 * and this holds the pair. NEITHER SIDE IS AUTHORITATIVE — on a disagreement
 * the branch stops, and adjusting either side to make this pass is the one move
 * forbidden.
 *
 * THE CORPUS IS BUILT: a desk's tree state is not in the repository, so each
 * state is constructed under a private directory with real git and real mtimes.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const STATE_LIB = `${ROOT}/skills/plot/scripts/plot-worker-state.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

let home = '';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
};

const ago = (path: string, seconds: number): void => {
  const at = new Date(Date.now() - seconds * 1000);
  utimesSync(path, at, at);
};

const write = (path: string, body = 'x\n'): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
};

/** A repo with one real commit of `seed.txt`. */
const repo = (name: string): string => {
  const wt = join(home, name);
  mkdirSync(wt, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', wt]);
  write(join(wt, 'seed.txt'));
  git(wt, 'add', 'seed.txt');
  git(wt, 'commit', '-q', '-m', 'seed');
  return wt;
};

/** `origin/main` pointing at the current HEAD, as a clone leaves it. */
const originAtHead = (wt: string): void => {
  git(wt, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
};

interface Case {
  name: string;
  build: () => string;
}

const cases: Case[] = [
  { name: 'missing-directory', build: () => join(home, 'no-such-desk') },
  {
    name: 'clean-tree',
    build: () => repo('clean-tree'),
  },
  {
    name: 'no-commit-nothing-dirty',
    build: () => {
      const wt = join(home, 'no-commit-nothing-dirty');
      mkdirSync(wt, { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main', wt]);
      return wt;
    },
  },
  {
    name: 'no-commit-fresh-file',
    build: () => {
      const wt = join(home, 'no-commit-fresh-file');
      mkdirSync(wt, { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main', wt]);
      write(join(wt, 'a.txt'));
      ago(join(wt, 'a.txt'), 30);
      return wt;
    },
  },
  {
    name: 'dirty-fresh-at-root',
    build: () => {
      const wt = repo('dirty-fresh-at-root');
      ago(join(wt, 'seed.txt'), 3600);
      write(join(wt, 'fresh.txt'));
      ago(join(wt, 'fresh.txt'), 7);
      return wt;
    },
  },
  {
    name: 'dirty-old-at-root',
    build: () => {
      const wt = repo('dirty-old-at-root');
      write(join(wt, 'old.txt'));
      ago(join(wt, 'old.txt'), 5000);
      return wt;
    },
  },
  {
    name: 'nested-untracked-file-fresh',
    build: () => {
      const wt = repo('nested-untracked-file-fresh');
      write(join(wt, 'brandnew', 'f.txt'));
      ago(join(wt, 'brandnew'), 2000);
      ago(join(wt, 'brandnew', 'f.txt'), 1);
      return wt;
    },
  },
  {
    name: 'nested-parent-newer-than-file',
    build: () => {
      const wt = repo('nested-parent-newer-than-file');
      write(join(wt, 'dir', 'f.txt'));
      ago(join(wt, 'dir', 'f.txt'), 4000);
      ago(join(wt, 'dir'), 12);
      return wt;
    },
  },
  {
    name: 'deleted-tracked-file',
    build: () => {
      const wt = repo('deleted-tracked-file');
      write(join(wt, 'sub', 'gone.txt'));
      git(wt, 'add', 'sub/gone.txt');
      git(wt, 'commit', '-q', '-m', 'add gone');
      rmSync(join(wt, 'sub', 'gone.txt'));
      ago(join(wt, 'sub'), 20);
      return wt;
    },
  },
  {
    name: 'rename-takes-the-new-name',
    build: () => {
      const wt = repo('rename-takes-the-new-name');
      git(wt, 'mv', 'seed.txt', 'renamed.txt');
      ago(join(wt, 'renamed.txt'), 15);
      return wt;
    },
  },
  {
    name: 'worker-record-at-root-ignored',
    build: () => {
      const wt = repo('worker-record-at-root-ignored');
      write(join(wt, '.plot-worker.log'));
      ago(join(wt, '.plot-worker.log'), 1);
      return wt;
    },
  },
  {
    name: 'editor-leftover-ignored',
    build: () => {
      const wt = repo('editor-leftover-ignored');
      write(join(wt, 'notes.swp'));
      ago(join(wt, 'notes.swp'), 1);
      return wt;
    },
  },
  {
    name: 'claim-commit-only-with-origin',
    build: () => {
      const wt = repo('claim-commit-only-with-origin');
      originAtHead(wt);
      git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim x');
      return wt;
    },
  },
  {
    name: 'real-commit-with-origin',
    build: () => {
      const wt = repo('real-commit-with-origin');
      originAtHead(wt);
      write(join(wt, 'work.txt'));
      git(wt, 'add', 'work.txt');
      git(wt, 'commit', '-q', '-m', 'work');
      return wt;
    },
  },
  {
    name: 'claim-then-real-commit',
    build: () => {
      const wt = repo('claim-then-real-commit');
      originAtHead(wt);
      git(wt, 'commit', '-q', '--allow-empty', '-m', 'plot: claim x');
      write(join(wt, 'work.txt'));
      git(wt, 'add', 'work.txt');
      git(wt, 'commit', '-q', '-m', 'work');
      return wt;
    },
  },
  { name: 'no-origin-ref', build: () => repo('no-origin-ref') },
  {
    name: 'origin-head-variant',
    build: () => {
      const wt = repo('origin-head-variant');
      git(wt, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
      git(wt, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
      write(join(wt, 'work.txt'));
      git(wt, 'add', 'work.txt');
      git(wt, 'commit', '-q', '-m', 'work');
      return wt;
    },
  },
];

const built = new Map<string, string>();

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'plot-tree-corpus-'));
  for (const one of cases) built.set(one.name, one.build());
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Both shell readings per case, from one bash process: `quiet<TAB>commits`. */
const shellVerdicts = (): { quiet: string; commits: string }[] => {
  const stdin = cases.map((one) => built.get(one.name)!).join('\n') + '\n';
  const script = `
    . ${JSON.stringify(STATE_LIB)}
    while IFS= read -r wt; do
      [ -n "$wt" ] || continue
      q=$(plot_worker_tree_quiet_seconds "$wt" 2>/dev/null)
      plot_worker_has_commits "$wt"; rc=$?
      case $rc in 0) c=yes ;; 1) c=no ;; *) c=unanswerable ;; esac
      printf '%s\\t%s\\n' "$q" "$c"
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [quiet = '', commits = ''] = line.split('\t');
      return { quiet, commits };
    });
};

const trees = () => treesGit(shellContext(ROOT));

const ruleQuiet = async (wt: string): Promise<string> => {
  const answer = await trees().quietSeconds(wt);
  if (!answer.ok) return 'failed';
  return answer.value === null ? 'unreadable' : String(answer.value);
};

const ruleCommits = async (wt: string): Promise<string> => {
  const answer = await trees().hasCommits(wt);
  return answer.ok ? answer.value : 'failed';
};

describe('treesGit().quietSeconds and hasCommits agree with the shell', () => {
  it('reads a corpus worth comparing', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
    expect(shellVerdicts().length).toBe(cases.length);
  });

  it('exercises every word each reading can answer', () => {
    const shell = shellVerdicts();
    expect(shell.some((one) => one.quiet === 'unreadable')).toBe(true);
    expect(shell.some((one) => one.quiet !== 'unreadable')).toBe(true);
    for (const word of ['yes', 'no', 'unanswerable']) {
      expect(shell.some((one) => one.commits === word)).toBe(true);
    }
  });

  it('answers what the shell answers on every case, within clock tolerance', async () => {
    const shell = shellVerdicts();
    const found: Disagreement[] = [];
    for (let i = 0; i < cases.length; i += 1) {
      const wt = built.get(cases[i].name)!;
      const quiet = await ruleQuiet(wt);
      if (quiet === 'unreadable' || shell[i].quiet === 'unreadable') {
        compareField(found, cases[i].name, 'tree-quiet', quiet, shell[i].quiet);
      } else if (Math.abs(Number(quiet) - Number(shell[i].quiet)) > 5) {
        compareField(found, cases[i].name, 'tree-quiet', quiet, shell[i].quiet);
      }
      compareField(found, cases[i].name, 'has-commits', await ruleCommits(wt), shell[i].commits);
    }
    expect(found.map(report)).toEqual([]);
  });
});
