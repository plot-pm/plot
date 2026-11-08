import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { fixedAnswers, type ProcessRunner } from '../src/adapters/git-dirs/git-dirs.js';
import { hostShell } from '../src/adapters/host/host-shell.js';
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
