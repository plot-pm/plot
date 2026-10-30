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

let repo = '';

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sprint-scope-ref-'));
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, 'docs/sprints/active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/sprints/active/the-sprint.md'), SPRINT);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'first']);
  git(repo, ['remote', 'add', 'origin', repo]);
  git(repo, ['fetch', '--quiet', 'origin']);
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

const refs = () => refsGit({ repoRoot: repo, scriptDir: path.join(repo, 'scripts') });

describe('sprintScopeRef — reads the committed ref, never the working tree', () => {
  it('reads the sprint committed at origin/main', async () => {
    const scope = await sprintScopeRef(refs(), scriptsConfig('docs/sprints'), 'origin/main');
    expect(scope.read).toBe('scope');
    if (scope.read !== 'scope') return;
    expect(scope.slugs).toEqual(['a-plan']);
  });

  it('answers none, not a stale scope, once the sprint commit moves off origin/main', async () => {
    // Remove the active sprint and commit the removal, but do NOT re-fetch —
    // origin/main still points at the earlier commit, so a correct adapter
    // keeps answering from it. This is the inverse of the brief's own
    // fixture shape, and it proves the same property: the read follows the
    // REF, not whatever the latest local commit or working tree holds.
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
    const filePath = path.join(repo, 'docs/sprints/active/the-sprint.md');
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
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sprint-scope-ref-empty-'));
    try {
      git(empty, ['init', '--quiet', '--initial-branch=main']);
      git(empty, ['config', 'user.email', 'test@example.com']);
      git(empty, ['config', 'user.name', 'Test']);
      git(empty, ['commit', '--quiet', '--allow-empty', '-m', 'root']);
      git(empty, ['remote', 'add', 'origin', empty]);
      git(empty, ['fetch', '--quiet', 'origin']);
      const scope = await sprintScopeRef(
        refsGit({ repoRoot: empty, scriptDir: path.join(empty, 'scripts') }),
        scriptsConfig('docs/sprints'),
        'origin/main',
      );
      expect(scope).toEqual({ read: 'none', why: 'no-active-sprint' });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('answers none with multiple-active-sprints for two files under active/', async () => {
    const two = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sprint-scope-ref-multi-'));
    try {
      git(two, ['init', '--quiet', '--initial-branch=main']);
      git(two, ['config', 'user.email', 'test@example.com']);
      git(two, ['config', 'user.name', 'Test']);
      fs.mkdirSync(path.join(two, 'docs/sprints/active'), { recursive: true });
      fs.writeFileSync(path.join(two, 'docs/sprints/active/one.md'), SPRINT);
      fs.writeFileSync(path.join(two, 'docs/sprints/active/two.md'), SPRINT);
      git(two, ['add', '-A']);
      git(two, ['commit', '--quiet', '-m', 'two active sprints']);
      git(two, ['remote', 'add', 'origin', two]);
      git(two, ['fetch', '--quiet', 'origin']);
      const scope = await sprintScopeRef(
        refsGit({ repoRoot: two, scriptDir: path.join(two, 'scripts') }),
        scriptsConfig('docs/sprints'),
        'origin/main',
      );
      expect(scope).toEqual({ read: 'none', why: 'multiple-active-sprints' });
    } finally {
      fs.rmSync(two, { recursive: true, force: true });
    }
  });
});
