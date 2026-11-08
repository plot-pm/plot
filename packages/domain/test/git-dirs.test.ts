import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { fixedAnswers, givenGitDirs, withFixedEnv, type ProcessRunner } from '../src/adapters/git-dirs/git-dirs.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
import { processesShell } from '../src/adapters/processes/processes-shell.js';
import { scriptsShell } from '../src/adapters/scripts/scripts-shell.js';
import { readerLockIndexDir } from '../src/adapters/reader-lock/reader-lock-file.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { runProcess, type ScriptRun } from '../src/adapters/run-script.js';

const ran = (code: number, stdout = ''): ScriptRun => ({ code, stdout, stderr: '' });

/** A runner that answers the given runs in order, then repeats the last. */
const runnerOf = (...runs: ScriptRun[]): ProcessRunner & ReturnType<typeof vi.fn> => {
  let n = 0;
  return vi.fn(async () => runs[Math.min(n++, runs.length - 1)] as ScriptRun);
};

const dirs: string[] = [];

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fixedAnswers', () => {
  it('starts no process for a second commonDir call in the same directory', async () => {
    const run = runnerOf(ran(0, '.git\n'));
    const answers = fixedAnswers(run);

    const first = await answers.commonDir('/repo');
    const second = await answers.commonDir('/repo');

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('git', ['rev-parse', '--git-common-dir'], { cwd: '/repo' });
    expect(second).toBe(first);
  });

  it('asks again in another directory', async () => {
    const run = runnerOf(ran(0, '.git\n'));
    const answers = fixedAnswers(run);

    await answers.commonDir('/repo');
    await answers.commonDir('/other');

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('asks again after a failed read, and holds the answer that follows', async () => {
    const run = runnerOf(ran(128), ran(0, '.git\n'));
    const answers = fixedAnswers(run);

    expect((await answers.commonDir('/repo')).code).toBe(128);
    expect((await answers.commonDir('/repo')).stdout).toBe('.git\n');
    await answers.commonDir('/repo');

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not hold an empty answer', async () => {
    const run = runnerOf(ran(0, ''));
    const answers = fixedAnswers(run);

    await answers.toplevel('/repo');
    await answers.toplevel('/repo');

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares one process between concurrent first calls', async () => {
    const run = runnerOf(ran(0, '/repo\n'));
    const answers = fixedAnswers(run);

    const [a, b] = await Promise.all([answers.toplevel('/repo'), answers.toplevel('/repo')]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('asks again from a fresh instance', async () => {
    const run = runnerOf(ran(0, '/repo\n'));

    await fixedAnswers(run).toplevel('/repo');
    await fixedAnswers(run).toplevel('/repo');

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('holds toplevel, gitDirs and absoluteCommonDir each once per directory', async () => {
    const run = runnerOf(ran(0, '/x\n'));
    const answers = fixedAnswers(run);

    for (let i = 0; i < 2; i += 1) {
      await answers.toplevel('/repo');
      await answers.gitDirs('/repo');
      await answers.absoluteCommonDir('desk', '/repo');
    }

    expect(run.mock.calls).toEqual([
      ['git', ['rev-parse', '--show-toplevel'], { cwd: '/repo' }],
      ['git', ['rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], { cwd: '/repo' }],
      ['git', ['-C', 'desk', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: '/repo' }],
    ]);
  });

  it('holds a backend refusal (exit 4): the second call starts nothing and returns the same refusal', async () => {
    const run = runnerOf(ran(4));
    const answers = fixedAnswers(run);

    const first = await answers.backend('/s/plot-host.sh', '/repo');
    const second = await answers.backend('/s/plot-host.sh', '/repo');

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('bash', ['/s/plot-host.sh', 'backend'], { cwd: '/repo' });
    expect(second).toBe(first);
    expect(second.code).toBe(4);
  });

  it('asks the backend again after any other failure', async () => {
    const run = runnerOf(ran(1), ran(0, 'github\n'));
    const answers = fixedAnswers(run);

    await answers.backend('/s/plot-host.sh', '/repo');
    await answers.backend('/s/plot-host.sh', '/repo');
    await answers.backend('/s/plot-host.sh', '/repo');

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('asks the backend again under another PLOT_HOST', async () => {
    const run = runnerOf(ran(0, 'github\n'));
    const answers = fixedAnswers(run);

    await answers.backend('/s/plot-host.sh', '/repo');
    vi.stubEnv('PLOT_HOST', 'bitbucket');
    await answers.backend('/s/plot-host.sh', '/repo');
    await answers.backend('/s/plot-host.sh', '/repo');

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('the adapters read through the held answers', () => {
  /** A real `plot-host.sh` that appends a line to `asked` on each `backend`. */
  const countingHost = (word: string): { repoRoot: string; scriptDir: string; asked: () => number } => {
    const root = tempDir('plot-git-dirs-host-');
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir);
    const log = join(root, 'asked');
    writeFileSync(log, '');
    const file = join(scriptDir, 'plot-host.sh');
    writeFileSync(file, `#!/usr/bin/env bash\n[ "$1" = backend ] && { echo x >> '${log}'; echo ${word}; exit 0; }\nexit 1\n`);
    chmodSync(file, 0o755);
    writeFileSync(join(scriptDir, 'plot-review-writer.mjs'), "console.log('plot-review[bot]');\n");
    return {
      repoRoot: root,
      scriptDir,
      asked: () => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').length,
    };
  };

  it('hostShell: backend and reviewWriter start plot-host.sh backend once across two adapter instances', async () => {
    const ctx = countingHost('github');
    const answers = fixedAnswers();

    expect(await hostShell(ctx, answers).backend()).toEqual({ ok: true, value: 'github' });
    expect(await hostShell(ctx, answers).backend()).toEqual({ ok: true, value: 'github' });
    expect(await hostShell(ctx, answers).reviewWriter()).toEqual({ ok: true, value: 'plot-review[bot]' });

    expect(ctx.asked()).toBe(1);
  });

  it('hostShell: a fresh set of answers asks again', async () => {
    const ctx = countingHost('bitbucket');

    await hostShell(ctx, fixedAnswers()).backend();
    await hostShell(ctx, fixedAnswers()).backend();

    expect(ctx.asked()).toBe(2);
  });

  it('hostShell: a held refusal still names the word the script printed', async () => {
    const root = tempDir('plot-git-dirs-refuse-');
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir);
    const file = join(scriptDir, 'plot-host.sh');
    writeFileSync(file, "#!/usr/bin/env bash\necho 'cannot drive quokka' >&2; exit 4\n");
    chmodSync(file, 0o755);
    const answers = fixedAnswers();

    await hostShell({ repoRoot: root, scriptDir }, answers).backend();
    const host = hostShell({ repoRoot: root, scriptDir }, answers);

    expect(await host.backend()).toEqual({ ok: false, why: 'unaskable' });
    expect(host.lastRefusal()).toEqual({ kind: 'failed', said: 'cannot drive quokka' });
  });

  /** A counting runner over the real `runProcess`. */
  const countingRunner = (): { run: ProcessRunner; calls: string[][] } => {
    const calls: string[][] = [];
    return {
      calls,
      run: (command, args, options) => {
        calls.push([command, ...args]);
        return runProcess(command, args, options);
      },
    };
  };

  const gitRepo = (): string => {
    const repo = tempDir('plot-git-dirs-repo-');
    execFileSync('git', ['init', '--quiet', repo]);
    return repo;
  };

  it('refsGit: repoRoot and linkedWorktree start git once across two adapter instances', async () => {
    const repo = gitRepo();
    const { run, calls } = countingRunner();
    const answers = fixedAnswers(run);
    const ctx = { repoRoot: repo, scriptDir: join(repo, 'scripts') };

    const first = await refsGit(ctx, answers).repoRoot();
    const second = await refsGit(ctx, answers).repoRoot();
    expect(await refsGit(ctx, answers).linkedWorktree()).toEqual({ ok: true, value: false });
    expect(await refsGit(ctx, answers).linkedWorktree()).toEqual({ ok: true, value: false });

    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('readerLockFile: two instances in one checkout start git rev-parse once and name the same directory', async () => {
    const repo = gitRepo();
    const { run, calls } = countingRunner();
    const answers = fixedAnswers(run);

    const first = await readerLockIndexDir({ cwd: repo, answers, env: {} });
    const second = await readerLockIndexDir({ cwd: repo, answers, env: {} });

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(calls).toEqual([['git', 'rev-parse', '--git-common-dir']]);
  });
});

describe('withFixedEnv', () => {
  const fixed = { PLOT_REPO_ROOT: '/repo', PLOT_GIT_COMMON_DIR: '/repo/.git' };

  it('adds both variables where neither the caller nor the process sets them', () => {
    expect(withFixedEnv(fixed, undefined, {})).toEqual(fixed);
  });

  it('keeps a value the caller gives, a blank one included', () => {
    expect(withFixedEnv(fixed, { PLOT_GIT_COMMON_DIR: '', X: '1' }, {})).toEqual({ PLOT_REPO_ROOT: '/repo', PLOT_GIT_COMMON_DIR: '', X: '1' });
  });

  it('keeps a non-empty value the process carries, and fills a blank one', () => {
    expect(withFixedEnv(fixed, undefined, { PLOT_REPO_ROOT: '/elsewhere', PLOT_GIT_COMMON_DIR: '' })).toEqual({ PLOT_GIT_COMMON_DIR: '/repo/.git' });
  });

  it('adds nothing for an answer that is not held', () => {
    expect(withFixedEnv({}, undefined, {})).toEqual({});
  });
});

describe('a script started by an adapter receives the fixed variables', () => {
  /** A git repository whose `skills/plot/scripts` holds stubs that print the two variables. */
  const repoWithStubs = (): { repoRoot: string; scriptDir: string; top: string; common: string } => {
    const repo = tempDir('plot-git-dirs-env-');
    execFileSync('git', ['init', '--quiet', repo]);
    const scriptDir = join(repo, 'skills', 'plot', 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    const said = 'printf "%s|%s" "${PLOT_REPO_ROOT:-}" "${PLOT_GIT_COMMON_DIR:-}"';
    for (const name of ['plot-env.sh', 'plot-dispatch.sh', 'plot-config.sh']) writeFileSync(join(scriptDir, name), `${said}\n`);
    writeFileSync(join(scriptDir, 'plot-host.sh'), `[ "$1" = account ] && { ${said}; echo; exit 0; }\nexit 1\n`);
    writeFileSync(
      join(scriptDir, 'plot-worker-state.sh'),
      'plot_worker_state() { printf \'none\\t%s\\t%s\\t\\n\' "${PLOT_REPO_ROOT:-}" "${PLOT_GIT_COMMON_DIR:-}"; }\n',
    );
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();
    return { repoRoot: repo, scriptDir, top, common: join(repo, '.git') };
  };

  const unset = (): void => {
    vi.stubEnv('PLOT_REPO_ROOT', '');
    vi.stubEnv('PLOT_GIT_COMMON_DIR', '');
  };

  it('scriptsShell: awaited, config, configSync and sourced pass PLOT_REPO_ROOT and PLOT_GIT_COMMON_DIR', async () => {
    unset();
    const ctx = repoWithStubs();
    const scripts = scriptsShell(ctx, fixedAnswers());
    const expected = `${ctx.top}|${ctx.common}`;

    expect((await scripts.awaited('plot-env.sh', [])).stdout).toBe(expected);
    expect(await scripts.config('Any', '')).toEqual({ ok: true, value: expected });
    expect(scripts.configSync('Any', '')).toEqual({ ok: true, value: expected });
    expect(scripts.sourced('plot-env.sh', '. "$1"', [])).toEqual({ ok: true, value: expected });
  });

  it('scriptsShell: a value the caller passes wins', async () => {
    unset();
    const ctx = repoWithStubs();

    const run = await scriptsShell(ctx, fixedAnswers()).awaited('plot-env.sh', [], { env: { PLOT_GIT_COMMON_DIR: '/given' } });

    expect(run.stdout).toBe(`${ctx.top}|/given`);
  });

  it('scriptsShell: a value this process already carries wins', async () => {
    unset();
    vi.stubEnv('PLOT_REPO_ROOT', '/inherited');
    const ctx = repoWithStubs();

    const run = await scriptsShell(ctx, fixedAnswers()).awaited('plot-env.sh', []);

    expect(run.stdout).toBe(`/inherited|${ctx.common}`);
  });

  it('scriptsShell: plot-dispatch.sh, which launches agents, receives neither variable', async () => {
    unset();
    const ctx = repoWithStubs();

    const run = await scriptsShell(ctx, fixedAnswers()).awaited('plot-dispatch.sh', []);

    expect(run.stdout).toBe('|');
  });

  it('hostShell: plot-host.sh receives both variables', async () => {
    unset();
    const ctx = repoWithStubs();

    expect(await hostShell(ctx, fixedAnswers()).account()).toEqual({ ok: true, value: `${ctx.top}|${ctx.common}` });
  });

  it('processesShell: the sourced plot-worker-state.sh reads both variables', async () => {
    unset();
    const ctx = repoWithStubs();

    const reading = await processesShell(ctx, fixedAnswers()).workerState(ctx.repoRoot, false);

    expect(reading).toEqual({ ok: true, value: { state: 'none', pid: ctx.top, exitCode: ctx.common, activity: '' } });
  });

  it('starts git for the variables once across adapters that share the answers', async () => {
    unset();
    const ctx = repoWithStubs();
    const calls: string[][] = [];
    const answers = fixedAnswers((command, args, options) => {
      calls.push([command, ...args]);
      return runProcess(command, args, options);
    });

    await scriptsShell(ctx, answers).awaited('plot-env.sh', []);
    await scriptsShell(ctx, answers).config('Any', '');
    await hostShell(ctx, answers).account();

    expect(calls).toEqual([
      ['git', 'rev-parse', '--show-toplevel'],
      ['git', 'rev-parse', '--git-common-dir'],
    ]);
  });
});

describe('givenGitDirs: the environment answers for the same repository only', () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  /** A repository with one commit and one linked worktree, and git's own answers for both. */
  const repoWithDesk = () => {
    const repo = tempDir('plot-given-repo-');
    git(repo, 'init', '--quiet');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'one');
    mkdirSync(join(repo, 'sub'));
    const desk = join(repo, '.worktrees', 'desk');
    git(repo, 'worktree', 'add', '--quiet', '-b', 'desk', desk);
    return { repo, desk, common: git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir') };
  };

  it('answers what git answers in the main checkout, a subdirectory and a linked worktree', () => {
    const { repo, desk } = repoWithDesk();
    for (const dir of [repo, join(repo, 'sub'), desk]) {
      expect(givenGitDirs(dir, { PLOT_REPO_ROOT: repo })).toEqual({
        toplevel: git(dir, 'rev-parse', '--show-toplevel'),
        gitDir: git(dir, 'rev-parse', '--absolute-git-dir'),
        commonDir: git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
      });
    }
  });

  it('reads PLOT_GIT_COMMON_DIR before PLOT_REPO_ROOT', () => {
    const { desk, common } = repoWithDesk();
    expect(givenGitDirs(desk, { PLOT_GIT_COMMON_DIR: common, PLOT_REPO_ROOT: '/nonexistent' })?.commonDir).toBe(common);
  });

  it('answers nothing for another repository, a missing value, a value that is no directory, or no value', () => {
    const { repo } = repoWithDesk();
    const other = tempDir('plot-given-other-');
    git(other, 'init', '--quiet');
    expect(givenGitDirs(other, { PLOT_REPO_ROOT: repo })).toBeUndefined();
    expect(givenGitDirs(repo, { PLOT_REPO_ROOT: other })).toBeUndefined();
    expect(givenGitDirs(repo, { PLOT_REPO_ROOT: '/nonexistent' })).toBeUndefined();
    expect(givenGitDirs(repo, { PLOT_GIT_COMMON_DIR: join(repo, 'sub', '.keep') })).toBeUndefined();
    expect(givenGitDirs(repo, {})).toBeUndefined();
    expect(givenGitDirs(join(repo, 'missing'), { PLOT_REPO_ROOT: repo })).toBeUndefined();
  });

  it('answers nothing for a directory in no repository', () => {
    const { repo } = repoWithDesk();
    expect(givenGitDirs(tempDir('plot-given-none-'), { PLOT_REPO_ROOT: repo })).toBeUndefined();
  });

  it('answers nothing for a .git file that names another repository', () => {
    const { repo } = repoWithDesk();
    const fake = tempDir('plot-given-fake-');
    writeFileSync(join(fake, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
    expect(givenGitDirs(fake, { PLOT_REPO_ROOT: repo })).toBeUndefined();
    const unreadable = tempDir('plot-given-dir-');
    mkdirSync(join(unreadable, '.git', 'x'), { recursive: true });
    expect(givenGitDirs(unreadable, { PLOT_REPO_ROOT: repo })).toBeUndefined();
  });

  it('fixedAnswers: an environment naming the repository starts no git process and holds the answers', async () => {
    const { repo, desk, common } = repoWithDesk();
    const run = runnerOf(ran(0, 'asked\n'));
    const answers = fixedAnswers(run, { PLOT_GIT_COMMON_DIR: common });

    expect((await answers.commonDir(desk)).stdout).toBe(`${common}\n`);
    expect((await answers.toplevel(desk)).stdout).toBe(`${git(desk, 'rev-parse', '--show-toplevel')}\n`);
    expect((await answers.gitDirs(desk)).stdout).toBe(`${git(desk, 'rev-parse', '--absolute-git-dir')}\n${common}\n`);
    expect((await answers.absoluteCommonDir('.worktrees/desk', repo)).stdout).toBe(`${common}\n`);
    expect(await answers.commonDir(desk)).toBe(await answers.commonDir(desk));
    expect(answers.heldScriptEnv(desk)).toEqual({ PLOT_REPO_ROOT: git(desk, 'rev-parse', '--show-toplevel'), PLOT_GIT_COMMON_DIR: common });
    expect(run).not.toHaveBeenCalled();
  });

  it('fixedAnswers: an environment naming another repository asks git', async () => {
    const { repo } = repoWithDesk();
    const run = runnerOf(ran(0, '.git\n'));
    const answers = fixedAnswers(run, { PLOT_REPO_ROOT: tempDir('plot-given-elsewhere-') });

    expect((await answers.commonDir(repo)).stdout).toBe('.git\n');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
