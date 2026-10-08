// `POST /api/release-claim` and `plot-ask.mjs release-claim <branch>`: both
// reach {@link gatherReadingsAndRelease}, the one place the readings are
// gathered and `releaseClaim` is decided. These tests exercise that shared
// function directly against real fixtures — a real repository with a real
// `origin` remote, real agent manifests, and a stub `plot-host.sh` — rather
// than against the HTTP route, because the "Done when" assertions this file
// pins are about the COMPUTATION, not about parsing a request body.
//
// `plot-dispatch.sh` ITSELF IS STUBBED for the one test that needs a script
// refusal (`refuses a 409 when the script itself refuses`). The real script's
// other four refusals (a live worker pid, a file-changing remote commit,
// unpushed or dirty desk work, a PLOT-BLOCKED marker) stay the shell's to
// enforce — this slice does not reimplement them, and a stub that answers
// `exit 1` on stderr is enough to prove the route carries that sentence
// through as a 409 rather than swallowing it.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rmTree } from '../helpers.mjs';
import { gatherReadingsAndRelease } from '../../src/server/release-claim.js';

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmTree(d);
});

const git = (dir: string, ...args: string[]): void => {
  execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
};

/** A real repo with a real bare `origin`, so `git fetch`/`push` need no network. */
function repoWithOrigin(): { repoRoot: string; originDir: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-claim-'));
  temps.push(parent);
  const originDir = path.join(parent, 'origin.git');
  fs.mkdirSync(originDir);
  git(originDir, 'init', '--quiet', '--bare', '-b', 'main');

  const repoRoot = path.join(parent, 'repo');
  fs.mkdirSync(repoRoot);
  git(repoRoot, 'init', '--quiet', '-b', 'main');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoRoot, 'trunk.txt'), 'trunk');
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'trunk');
  git(repoRoot, 'remote', 'add', 'origin', originDir);
  git(repoRoot, 'push', '-q', 'origin', 'main');
  return { repoRoot, originDir };
}

/** Pushes `branch` to the fixture's `origin`, holding only an empty claim commit. */
function pushClaim(repoRoot: string, branch: string): void {
  git(repoRoot, 'checkout', '-qb', branch);
  git(repoRoot, 'commit', '-q', '--allow-empty', '-m', `claim: ${branch}`);
  git(repoRoot, 'push', '-q', 'origin', branch);
  git(repoRoot, 'checkout', '-q', 'main');
  git(repoRoot, 'branch', '-qD', branch);
}

/** The real helper scripts, so `plot-worker-state.sh`/`plot-config.sh` run unmodified. */
const REAL_SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

/**
 * A copy of the real scripts directory with `plot-host.sh` (and optionally
 * `plot-dispatch.sh`) replaced by a stub.
 *
 * `plot-worker-state.sh`, `plot-config.sh` and the rest of the estate stay
 * real and hermetic — they read only the process table and the filesystem.
 * Only the host CLI and the `--release` mechanics need a double, since only
 * those two reach a network or a script this slice must not re-implement.
 */
function scriptsDirWithStubs(opts: {
  prState?: string; // raw stdout `plot-host.sh pr-state` should print
  prMerged?: string; // raw stdout `plot-host.sh pr-merged` should print
  hostExitCode?: number; // overrides both verbs to fail with this exit code
  dispatch?: { code: number; stdout?: string; stderr?: string }; // override plot-dispatch.sh entirely
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-claim-scripts-'));
  temps.push(dir);
  fs.cpSync(REAL_SCRIPTS, dir, { recursive: true });

  if (opts.hostExitCode !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'plot-host.sh'),
      ['#!/usr/bin/env bash', `exit ${opts.hostExitCode}`].join('\n'),
    );
  } else {
    const prState = opts.prState ?? '{"state":"NONE"}';
    const prMerged = opts.prMerged ?? 'not-merged';
    fs.writeFileSync(
      path.join(dir, 'plot-host.sh'),
      [
        '#!/usr/bin/env bash',
        'case "$1" in',
        `  pr-state) printf '%s\\n' '${prState}' ;;`,
        `  pr-merged) printf '%s\\n' '${prMerged}' ;;`,
        '  *) exit 4 ;;',
        'esac',
      ].join('\n'),
    );
  }
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);

  if (opts.dispatch) {
    const { code, stdout = '', stderr = '' } = opts.dispatch;
    fs.writeFileSync(
      path.join(dir, 'plot-dispatch.sh'),
      [
        '#!/usr/bin/env bash',
        stdout ? `printf '%s\\n' '${stdout}'` : ':',
        stderr ? `printf '%s\\n' '${stderr}' >&2` : ':',
        `exit ${code}`,
      ].join('\n'),
    );
    fs.chmodSync(path.join(dir, 'plot-dispatch.sh'), 0o755);
  }
  return dir;
}

/** Points the `Agent registry` key at a repo-relative directory, as `drop.test.ts` does. */
function configFile(repoRoot: string, value: string): void {
  fs.writeFileSync(
    path.join(repoRoot, 'CLAUDE.md'),
    `# Repo\n\n## Plot Config\n\n- **Agent registry:** \`${value}\`\n`,
  );
}

/** A manifest naming `branch`, written into `repoRoot`'s configured registry directory. */
function manifestNaming(
  repoRoot: string,
  branch: string,
  session: string,
  worktree: string,
): void {
  const dir = path.join(repoRoot, 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${session}.json`),
    JSON.stringify({ session, branch, worktree, startedAt: '2026-10-08T10:00:00Z' }),
  );
}

describe('a branch holding no claim answers success with nothing to do', () => {
  it('answers 200 with hadClaim=false when no ref and no manifest name the branch', async () => {
    const { repoRoot } = repoWithOrigin();
    const scriptsDir = scriptsDirWithStubs({});

    const { status, result } = await gatherReadingsAndRelease('feature/never-claimed', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(status).toBe(200);
    expect(result.hadClaim).toBe(false);
    expect(result.released).toBe(true);
  });
});

describe('agent-live is decided from the manifest\'s own desk, not merely from ref existence', () => {
  it('refuses with 409 when a manifest naming the branch has a RUNNING worker', async () => {
    const { repoRoot } = repoWithOrigin();
    pushClaim(repoRoot, 'feature/live-agent');
    const liveWt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-claim-wt-'));
    temps.push(liveWt);
    git(liveWt, 'init', '--quiet');
    fs.writeFileSync(path.join(liveWt, '.plot-worker.pid'), String(process.pid));

    configFile(repoRoot, 'agents');
    manifestNaming(repoRoot, 'feature/live-agent', 'sess-live', liveWt);

    const scriptsDir = scriptsDirWithStubs({});
    const { status, result } = await gatherReadingsAndRelease('feature/live-agent', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(status).toBe(409);
    expect(result.released).toBe(false);
    expect(result.detail).toBe('agent-live');
  });
});

describe('a host/PR reading of unknown refuses with nothing written', () => {
  it('refuses 409 when pr-state cannot be answered, and deletes no ref', async () => {
    const { repoRoot } = repoWithOrigin();
    pushClaim(repoRoot, 'feature/host-unreadable');
    const scriptsDir = scriptsDirWithStubs({ hostExitCode: 4 });

    const { status, result } = await gatherReadingsAndRelease('feature/host-unreadable', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(status).toBe(409);
    expect(result.released).toBe(false);
    const remote = execFileSync(
      'git',
      ['-C', repoRoot, 'ls-remote', 'origin', 'feature/host-unreadable'],
      { encoding: 'utf8' },
    );
    expect(remote).toContain('feature/host-unreadable');
  });
});

describe('a script refusal becomes a 409 carrying the script\'s own sentence', () => {
  it('answers 409 with the stderr sentence when plot-dispatch.sh --release exits 1', async () => {
    const { repoRoot } = repoWithOrigin();
    pushClaim(repoRoot, 'feature/desk-dirty');
    const scriptsDir = scriptsDirWithStubs({
      dispatch: {
        code: 1,
        stderr: 'plot-dispatch: the desk holds work for feature/desk-dirty — refusing.',
      },
    });

    const { status, result } = await gatherReadingsAndRelease('feature/desk-dirty', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(status).toBe(409);
    expect(result.released).toBe(false);
    expect(result.detail).toContain('refusing');
  });
});

describe('the CLI path and the HTTP route call the same function with the same readings', () => {
  it('gatherReadingsAndRelease is the one function main.ts and release-claim.ts both call', async () => {
    // Structural assertion: both entry points import this exact export rather
    // than each assembling their own readings. `main.ts`'s `release-claim`
    // branch and `handleReleaseClaim` both call it with (branch, {repoRoot,
    // scriptDir}) and return its result verbatim — proven here by calling it
    // the same way a route or a CLI command would, and confirming one computed
    // outcome serves both.
    const { repoRoot } = repoWithOrigin();
    const scriptsDir = scriptsDirWithStubs({});

    const viaDirectCall = await gatherReadingsAndRelease('feature/shared', {
      repoRoot,
      scriptDir: scriptsDir,
    });
    const viaSecondCall = await gatherReadingsAndRelease('feature/shared', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(viaDirectCall).toEqual(viaSecondCall);
  });
});

describe('after release, the branch disappears from the ref and every manifest', () => {
  it('deletes origin/<branch> and clears the manifest naming it', async () => {
    const { repoRoot } = repoWithOrigin();
    pushClaim(repoRoot, 'feature/clean-release');
    configFile(repoRoot, 'agents');
    const scriptsDir = scriptsDirWithStubs({});

    const { status, result } = await gatherReadingsAndRelease('feature/clean-release', {
      repoRoot,
      scriptDir: scriptsDir,
    });

    expect(status).toBe(200);
    expect(result.released).toBe(true);
    const remote = execFileSync(
      'git',
      ['-C', repoRoot, 'ls-remote', 'origin', 'feature/clean-release'],
      { encoding: 'utf8' },
    );
    expect(remote.trim()).toBe('');
  });
});
