import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sprintScopeRef } from '../src/adapters/sprint-scope-ref.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { answered } from '../src/port-result.js';
import type { Scripts } from '../src/ports/scripts.js';

/**
 * `sprintScopeRef` against a REAL repository, to prove the one property a
 * fixture cannot: that it reads `origin/<default>` as git last fetched it,
 * never the working tree a local checkout happens to hold.
 */
const git = (cwd: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd, stdio: 'ignore' });
};

/** Answers `Sprint directory` with a fixed value; nothing else is asked. */
const scriptsConfig = (sprintDirectory: string): Scripts =>
  ({
    config: async () => answered(sprintDirectory),
  }) as unknown as Scripts;

const SPRINT = [
  '# Sprint: Reviewing slice PRs',
  '',
  '## Status',
  '',
  '- **State:** Active',
  '- **Start:** 2026-10-29',
  '- **End:** 2026-11-05',
  '- **Release:** 2.30.0',
  '',
  '## Sprint Goal',
  '',
  '**fleetd reviews every slice PR it can.**',
  '',
  '### Must Have',
  '',
  '- [ ] [a-plan](../plans/2026-10-01-a-plan.md) — in scope',
  '',
].join('\n');

/** The dated sprint file the active link points at, as `plot-sprint-state.sh` names it. */
const DATED = 'docs/sprints/2026-10-29-the-sprint.md';

/**
 * Builds a repository whose `origin/main` holds the given sprint layout.
 *
 * @param prefix - the temp directory's name prefix.
 * @param files - regular files to write, by repository path.
 * @param links - symlinks to create, by repository path, each with its target.
 * @returns the repository's path.
 */
const repoWith = (
  prefix: string,
  files: Readonly<Record<string, string>>,
  links: Readonly<Record<string, string>>,
): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'core.symlinks', 'true']);
  fs.mkdirSync(path.join(dir, 'docs/sprints/active'), { recursive: true });
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
  for (const [link, target] of Object.entries(links)) fs.symlinkSync(target, path.join(dir, link));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--allow-empty', '-m', 'first']);
  git(dir, ['remote', 'add', 'origin', dir]);
  git(dir, ['fetch', '--quiet', 'origin']);
  return dir;
};

/** Reads the scope of a repository at `origin/main`. */
const scopeOf = (dir: string) =>
  sprintScopeRef(refsGit({ repoRoot: dir, scriptDir: path.join(dir, 'scripts') }), scriptsConfig('docs/sprints'), 'origin/main');

let repo = '';

beforeAll(() => {
  // The layout `plot-sprint-state.sh` writes: `active/<slug>.md -> ../<dated>.md`.
  repo = repoWith('plot-sprint-scope-ref-', { [DATED]: SPRINT }, {
    'docs/sprints/active/the-sprint.md': '../2026-10-29-the-sprint.md',
  });
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

const refs = () => refsGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

describe('sprintScopeRef — reads the committed ref, never the working tree', () => {
  it('reads the sprint an active symlink points at, with the slug of the link', async () => {
    const scope = await sprintScopeRef(refs(), scriptsConfig('docs/sprints'), 'origin/main');
    expect(scope.read).toBe('scope');
    if (scope.read !== 'scope') return;
    expect(scope.slugs).toEqual(['a-plan']);
    expect(scope.sprint.slug).toBe('the-sprint');
  });

  it('keeps answering from origin/main after a local commit removes the sprint', async () => {
    // The local commit removes the active link; origin/main is not re-fetched,
    // so the read follows the ref and still finds the sprint.
    fs.rmSync(path.join(repo, 'docs/sprints/active/the-sprint.md'));
    git(repo, ['add', '-A']);
    git(repo, ['commit', '--quiet', '-m', 'remove sprint locally, not yet fetched']);
    try {
      const scope = await sprintScopeRef(refs(), scriptsConfig('docs/sprints'), 'origin/main');
      expect(scope).toEqual({ read: 'scope', sprint: expect.anything(), slugs: ['a-plan'], branches: [] });
    } finally {
      git(repo, ['reset', '--hard', '--quiet', 'origin/main']);
    }
  });

  it('never reads a working-tree edit that was not committed at all', async () => {
    const filePath = path.join(repo, DATED);
    const committed = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, SPRINT.replace('a-plan', 'a-decoy-plan'));
    try {
      const scope = await sprintScopeRef(refs(), scriptsConfig('docs/sprints'), 'origin/main');
      expect(scope.read).toBe('scope');
      if (scope.read !== 'scope') return;
      expect(scope.slugs).toEqual(['a-plan']);
      expect(scope.slugs).not.toContain('a-decoy-plan');
    } finally {
      fs.writeFileSync(filePath, committed);
    }
  });

  it('answers none with no-active-sprint for an empty active/ directory', async () => {
    const empty = repoWith('plot-sprint-scope-ref-empty-', {}, {});
    try {
      expect(await scopeOf(empty)).toEqual({ read: 'none', why: 'no-active-sprint' });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('answers none with multiple-active-sprints for two links under active/', async () => {
    const two = repoWith(
      'plot-sprint-scope-ref-multi-',
      { 'docs/sprints/2026-10-29-one.md': SPRINT, 'docs/sprints/2026-10-29-two.md': SPRINT },
      { 'docs/sprints/active/one.md': '../2026-10-29-one.md', 'docs/sprints/active/two.md': '../2026-10-29-two.md' },
    );
    try {
      expect(await scopeOf(two)).toEqual({ read: 'none', why: 'multiple-active-sprints' });
    } finally {
      fs.rmSync(two, { recursive: true, force: true });
    }
  });

  it('answers none with sprint-link-escapes for a link outside the sprint directory', async () => {
    const escaping = repoWith(
      'plot-sprint-scope-ref-escape-',
      { 'docs/elsewhere.md': SPRINT },
      { 'docs/sprints/active/the-sprint.md': '../../elsewhere.md' },
    );
    try {
      expect(await scopeOf(escaping)).toEqual({ read: 'none', why: 'sprint-link-escapes' });
    } finally {
      fs.rmSync(escaping, { recursive: true, force: true });
    }
  });

  it('answers none with sprint-link-missing for a link whose target is not committed', async () => {
    const dangling = repoWith('plot-sprint-scope-ref-dangling-', {}, {
      'docs/sprints/active/the-sprint.md': '../2026-10-29-the-sprint.md',
    });
    try {
      expect(await scopeOf(dangling)).toEqual({ read: 'none', why: 'sprint-link-missing' });
    } finally {
      fs.rmSync(dangling, { recursive: true, force: true });
    }
  });
});
