// The record-lag line on the board fleetd serves: `servedRefs` answers names
// from the snapshot's ref listing, and the lag count also asks for the default
// branch's tree, which no listing holds.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { readRecordFindings } from '@plot-pm/domain/workflows/record-listing';
import { servedRefs } from '../../src/server/board.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A clone whose `origin/plot/state` is one commit ahead of `origin/main`. */
const cloneOneAhead = (): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-served-lag-')));
  roots.push(root);
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', repo);
  mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  writeFileSync(path.join(repo, 'docs/plans/2026-11-01-p.md'), '# P\n\n## Status\n\n- **State:** Approved\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'state');
  writeFileSync(path.join(repo, 'docs/plans/2026-11-01-p.md'), '# P\n\n## Status\n\n- **State:** Delivered\n');
  git(repo, 'commit', '-q', '-am', 'deliver');
  git(repo, 'push', '-q', 'origin', 'state:plot/state');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'fetch', '-q', 'origin');
  return repo;
};

/** The refs a snapshot lists: every ref and its object, as `for-each-ref` names them. */
const listedRefs = (repo: string): { ref: string; sha: string }[] =>
  git(repo, 'for-each-ref', '--format=%(refname) %(objectname)')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [ref, sha] = line.split(' ');
      return { ref: ref!, sha: sha! };
    });

describe('servedRefs and the record-lag line', () => {
  it('shows a state ref one commit ahead, with the sync PR and the conflict files', async () => {
    const repo = cloneOneAhead();
    const refs = servedRefs(refsGit({ repoRoot: repo, scriptDir: SCRIPT_DIR }), listedRefs(repo));
    const found = await readRecordFindings(refs, { stateBranch: 'plot/state', defaultBranch: 'main' }, 12, ['docs/plans/a.md']);
    expect(found.recordLag?.text).toBe('Records: 1 ahead of main · sync PR: #12 · forward merge conflicts in docs/plans/a.md');
  }, 60_000);

  it('answers a listed name and a ^{commit} name from the listing, and fails a name the listing lacks', async () => {
    const repo = cloneOneAhead();
    const sha = git(repo, 'rev-parse', 'refs/remotes/origin/main');
    const refs = servedRefs(refsGit({ repoRoot: repo, scriptDir: SCRIPT_DIR }), listedRefs(repo));
    expect(await refs.resolve('refs/remotes/origin/main^{commit}')).toEqual({ ok: true, value: sha });
    expect((await refs.resolve('refs/remotes/origin/absent')).ok).toBe(false);
    expect(await refs.resolve('refs/remotes/origin/main^{tree}')).toEqual({ ok: true, value: git(repo, 'rev-parse', 'origin/main^{tree}') });
  }, 60_000);
});
