import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * EACH if/else CHAIN REWRITTEN TO END THROUGH `endEntry` IS EXERCISED HERE AS A
 * REAL PROCESS. The argv-guard (`process.argv[1] === realpath(...)`) that
 * selects the block only fires when the file is actually run, so importing
 * `run`/`checkSlices`/etc. directly — as the existing unit tests for these
 * files do — never touches the branches this file asserts on.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Builds one entry file to a temp `.mjs`, returning its path. */
const bundleOf = async (dir: string, name: string, entry: string): Promise<string> => {
  const outfile = path.join(dir, name);
  await build({
    entryPoints: [path.join(here, '../../src/server/entry', entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return outfile;
};

let dir: string;
let transitionBundle: string;
let localChecksBundle: string;
let planForBranchBundle: string;
let reviewBypassBundle: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'plot-control-flow-entry-'));
  [transitionBundle, localChecksBundle, planForBranchBundle, reviewBypassBundle] = await Promise.all([
    bundleOf(dir, 'transition.mjs', 'transition.ts'),
    // `local-checks.ts`'s guard checks `path.basename(process.argv[1])` against
    // this literal name, since the gate bundle imports the same module under a
    // different entry point and shares its `import.meta.url`.
    bundleOf(dir, 'plot-local-checks.mjs', 'local-checks.ts'),
    bundleOf(dir, 'plan-for-branch.mjs', 'plan-for-branch.ts'),
    bundleOf(dir, 'review-bypass.mjs', 'review-bypass.ts'),
  ]);
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('plot-transition as a process', () => {
  it('--check-slices: exits 0 and writes nothing where every branch is named', () => {
    const waves = JSON.stringify({ waves: [{ name: 'Wave 1', branches: [{ branch: 'feature/x' }] }] });
    const result = spawnSync(process.execPath, [transitionBundle, '--check-slices', 'a-slug'], {
      input: waves,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('');
    expect(result.stderr.toString('utf8')).toBe('');
  });

  it('--check-slices: exits 1 and names the unnamed branch', () => {
    const waves = JSON.stringify({ waves: [{ name: '', branches: [{ branch: 'feature/orphan' }] }] });
    const result = spawnSync(process.execPath, [transitionBundle, '--check-slices', 'a-slug'], {
      input: waves,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString('utf8')).toContain('slice-unnamed');
    expect(result.stderr.toString('utf8')).toContain('feature/orphan');
  });

  it('--check-slices: exits 2 where the waves cannot be read', () => {
    const result = spawnSync(process.execPath, [transitionBundle, '--check-slices', 'a-slug'], {
      input: 'not json',
    });
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toBe(
      "plot-transition: cannot read the parser's waves[] — refusing rather than guessing.\n",
    );
  });

  it('--slices <file>: exits 2 with no stdout where the file cannot be read as waves', () => {
    const badSlices = path.join(dir, 'bad-slices.json');
    writeFileSync(badSlices, 'not json', 'utf8');
    const request = 'deliver\ta-slug\tapproved\tpr\t\t\t\t2026-09-02\t\t\t\t\n';
    const result = spawnSync(process.execPath, [transitionBundle, '--slices', badSlices], {
      input: request,
    });
    expect(result.status).toBe(2);
    expect(result.stdout.toString('utf8')).toBe('');
    expect(result.stderr.toString('utf8')).toBe(
      "plot-transition: cannot read the parser's waves[] from --slices — refusing rather than guessing.\n",
    );
  });

  it('falls through to run() and prints the transition answer with no --slices', () => {
    const request = 'deliver\ta-slug\tapproved\tpr\t\t\t\t2026-09-02\t\t\t\t\n';
    const result = spawnSync(process.execPath, [transitionBundle], { input: request });
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('Delivered\t2026-09-02\twrite\tno\n');
  });

  it('falls through to run() with a readable --slices file', () => {
    const goodSlices = path.join(dir, 'good-slices.json');
    writeFileSync(
      goodSlices,
      JSON.stringify({ waves: [{ name: 'Wave 1', branches: [{ branch: 'feature/x' }] }] }),
      'utf8',
    );
    const request = 'deliver\ta-slug\tapproved\tpr\t\t\t\t2026-09-02\t\t\t\t\n';
    const result = spawnSync(process.execPath, [transitionBundle, '--slices', goodSlices], {
      input: request,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('Delivered\t2026-09-02\twrite\tno\n');
  });
});

describe('plot-local-checks as a process', () => {
  it('no arguments: exits with the run\'s own code and prints no usage line', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'plot-local-checks-norepo-'));
    try {
      const result = spawnSync(process.execPath, [localChecksBundle], {
        cwd: notARepo,
      });
      expect(result.status).toBe(2);
      expect(result.stderr.toString('utf8')).toBe('plot-local-checks: not inside a git repository\n');
      expect(result.stderr.toString('utf8')).not.toContain('usage:');
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('--ci-suite-refusal: reads stdin and answers ok where the command runs no listed suite', () => {
    const result = spawnSync(
      process.execPath,
      [localChecksBundle, '--ci-suite-refusal'],
      { input: 'echo hello\n', cwd: here },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('');
  });

  it('--files <path> with an unreadable path: exits 2 (usage) with a stderr message, no usage line', () => {
    const result = spawnSync(
      process.execPath,
      [localChecksBundle, '--files', path.join(dir, 'does-not-exist.txt')],
      { cwd: here },
    );
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toContain('cannot read the file list');
    expect(result.stderr.toString('utf8')).not.toContain('usage:');
  });

  it('an unknown argument: exits 2 and prints the usage line', () => {
    const result = spawnSync(process.execPath, [localChecksBundle, '--bogus'], {
      cwd: here,
    });
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toBe(
      'plot-local-checks: unknown argument --bogus\nusage: plot-local-checks.mjs [--ci] [--files <path>]\n',
    );
  });
});

describe('plot-plan-for-branch as a process', () => {
  it('no branch argument: exits 2 and prints usage, nothing on stdout', () => {
    const result = spawnSync(process.execPath, [planForBranchBundle]);
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toBe('usage: plot-plan-for-branch.mjs <branch>\n');
    expect(result.stdout.toString('utf8')).toBe('');
  });

  it('a branch argument given, run() reports not-found outside a repository: exits 1', () => {
    const notARepo = mkdtempSync(path.join(tmpdir(), 'plot-plan-for-branch-norepo-'));
    try {
      const result = spawnSync(process.execPath, [planForBranchBundle, 'feature/x'], { cwd: notARepo });
      expect(result.status).toBe(1);
      expect(result.stdout.toString('utf8')).toBe('');
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe('plot-review-bypass as a process', () => {
  it('no --since argument: exits 2 and prints the exact usage line', () => {
    const result = spawnSync(process.execPath, [reviewBypassBundle]);
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toBe(
      "usage: plot-review-bypass.mjs --since <ISO date | ''> [--limit <n>]\n",
    );
    expect(result.stdout.toString('utf8')).toBe('');
  });

  it('a non-integer --limit: exits 2 with the same usage line', () => {
    const result = spawnSync(process.execPath, [reviewBypassBundle, '--since', '', '--limit', 'abc']);
    expect(result.status).toBe(2);
    expect(result.stderr.toString('utf8')).toBe(
      "usage: plot-review-bypass.mjs --since <ISO date | ''> [--limit <n>]\n",
    );
  });

  it('--since \'\': falls through to run(), asks the host nothing, exits 0', () => {
    const result = spawnSync(process.execPath, [reviewBypassBundle, '--since', ''], {
      env: { ...process.env, PLOT_REPO_ROOT: here },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.toString('utf8')).toBe(
      '  (not evaluated — no `Review required since` key is set, so no merge is held to the rule)\n',
    );
  });
});
