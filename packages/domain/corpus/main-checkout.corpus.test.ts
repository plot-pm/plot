import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mainCheckoutOf, readsCoreWorktree } from '../src/rules/main-checkout.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * A RULE-VERSUS-SHELL COMPARISON: does `mainCheckoutOf` answer what
 * `plot-desk-root.sh`'s `plot_checkout_of_common` and `plot_repo_root` answer,
 * over a normal checkout, a linked desk and a submodule?
 *
 * The pair exists on purpose: `plot_repo_root` runs once per desk probe in
 * `plot-worker-state.sh`, the per-agent-per-pass case of
 * `docs/shell-and-domain.md`. Neither side is authoritative; on a
 * disagreement the branch stops.
 *
 * THE CORPUS IS CONSTRUCTED. CI's checkout is one clean worktree with no
 * submodule, so the three shapes are built in a temp root.
 *
 * The rule's readings are taken the way the adapters take them: the physical
 * common dir from `git rev-parse --path-format=absolute --git-common-dir`, and
 * `core.worktree` only where that dir is not `.git`.
 *
 * A KNOWN DIFFERENCE IS NOT IN THE CORPUS. For a non-`.git` common dir with no
 * `core.worktree` (a bare repository `/r/.bare`) the shell answers its parent
 * and the rule answers unread. The three shapes here never reach it.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const DESK_ROOT_LIB = `${ROOT}/skills/plot/scripts/plot-desk-root.sh`;

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const commit = (cwd: string): void => {
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
};

/** The environment a shell side runs in: no exported answer, so git is asked. */
const shellEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.PLOT_GIT_COMMON_DIR;
  delete env.PLOT_REPO_ROOT;
  return env;
};

/** One shell function's answer in `cwd`, or `unread` where it printed nothing or failed. */
const shell = (cwd: string, call: string): string => {
  const run = spawnSync('bash', ['-c', `source "$1" && ${call}`, 'corpus', DESK_ROOT_LIB], {
    cwd,
    encoding: 'utf8',
    env: shellEnv(),
  });
  const out = run.stdout.trim();
  return run.status === 0 && out !== '' ? out : 'unread';
};

/** The rule's answer in `cwd`, from the readings the adapters take. */
const rule = (cwd: string): { commonDir: string; checkout: string } => {
  const commonDir = realpathSync(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim());
  let coreWorktree: string | null = null;
  if (readsCoreWorktree(commonDir)) {
    const run = spawnSync('git', ['--git-dir', commonDir, 'config', '--get', 'core.worktree'], { encoding: 'utf8' });
    coreWorktree = run.status === 0 ? run.stdout.replace(/\n$/, '') : null;
  }
  const answer = mainCheckoutOf(commonDir, coreWorktree);
  return { commonDir, checkout: 'checkout' in answer ? answer.checkout : 'unread' };
};

let dir: string;
let shapes: Array<{ subject: string; cwd: string; expected: string }>;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'main-checkout-corpus-')));
  const main = join(dir, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  commit(main);
  const desk = join(main, '.worktrees', 'desk');
  git(main, 'worktree', 'add', '-q', '-b', 'slice', desk);

  const lib = join(dir, 'lib');
  mkdirSync(lib);
  git(lib, 'init', '-q', '-b', 'main');
  commit(lib);
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  git(workspace, 'init', '-q', '-b', 'main');
  git(workspace, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'app/web');
  const web = join(workspace, 'app', 'web');

  shapes = [
    { subject: 'normal checkout', cwd: main, expected: main },
    { subject: 'linked desk', cwd: desk, expected: main },
    { subject: 'submodule', cwd: web, expected: web },
  ];
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('mainCheckoutOf against plot-desk-root.sh', () => {
  it('agrees with plot_checkout_of_common and plot_repo_root on every shape', () => {
    const found: Disagreement[] = [];
    for (const { subject, cwd } of shapes) {
      const { commonDir, checkout } = rule(cwd);
      compareField(found, subject, 'checkout-of-common', checkout, shell(cwd, `plot_checkout_of_common "${commonDir}"`));
      compareField(found, subject, 'repo-root', checkout, shell(cwd, 'plot_repo_root'));
    }
    expect(found.map(report)).toEqual([]);
  });

  it('answers each shape its own checkout, so agreement is not vacuous', () => {
    expect(shapes.map(({ subject, cwd }) => [subject, rule(cwd).checkout])).toEqual(
      shapes.map(({ subject, expected }) => [subject, expected]),
    );
  });
});
