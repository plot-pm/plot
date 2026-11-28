import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { removeTree } from '../rm-tree.mjs';
import { releaseUnbookedReadingsFor, type ReleaseWorld } from '../../src/shared/release-world.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-23T10:00:00', GIT_COMMITTER_DATE: '2026-11-23T10:00:00' } });

const write = (repo: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};

const changeset = (plan: string): string => `---\n'plot': patch\n---\n\nA description long enough to publish.\n\n<!--\nplan: ${plan}\n-->\n`;
const sprint = (state: string, release: string): string =>
  `# Sprint: S\n\n## Status\n\n- **State:** ${state}\n- **Start:** 2026-11-11\n- **Release:** ${release}\n\n### Must Have\n\n- [x] [a] item\n`;

/** A repository whose `v1.0.0` tag sits on the merge that removed two changesets. */
const estate = (): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-unbooked-')));
  roots.push(root);
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
  write(repo, '.changeset/README.md', 'readme\n');
  write(repo, '.changeset/one.md', changeset('docs/plans/2026-11-01-a.md'));
  write(repo, '.changeset/two.md', changeset('docs/plans/2026-11-01-b.md'));
  write(repo, 'docs/sprints/2026-W47-w47.md', sprint('Closed', '1.0.0'));
  write(repo, 'docs/sprints/active/.keep', '');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'work');
  git(repo, 'checkout', '-q', '-b', 'changeset-release/main');
  git(repo, 'rm', '-q', '.changeset/one.md', '.changeset/two.md');
  git(repo, 'commit', '-q', '-m', 'release');
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'other.txt', 'x\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'meanwhile');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #9', 'changeset-release/main');
  git(repo, 'tag', 'v0.9.0', 'HEAD~1');
  git(repo, 'tag', 'v1.0.0');
  return repo;
};

const world = (repo: string, over: Partial<ReleaseWorld> = {}): ReleaseWorld =>
  ({
    refs: refsGit({ repoRoot: repo, scriptDir: SCRIPT_DIR }),
    plans: {
      listPlans: async () => ({ ok: true, value: ['docs/plans/2026-11-01-a.md'] }),
      readPlans: async () => ({ ok: true, value: [{ file: 'docs/plans/2026-11-01-a.md', phase: 'Delivered', releasedRaw: '', slices: [] }] }),
    },
    ref: 'main',
    sprintDir: 'docs/sprints/',
    ...over,
  }) as unknown as ReleaseWorld;

describe('releaseUnbookedReadingsFor', () => {
  it('reads the newest tag, the changesets its merge removed, and every sprint file outside active/', async () => {
    const r = await releaseUnbookedReadingsFor(world(estate()));
    expect(r.tag).toEqual({ tag: 'v1.0.0', date: '2026-11-23' });
    expect(r.shipped).toEqual([
      { file: 'one.md', plan: 'docs/plans/2026-11-01-a.md' },
      { file: 'two.md', plan: 'docs/plans/2026-11-01-b.md' },
    ]);
    expect(r.sprints).toMatchObject([{ slug: 'w47', state: 'Closed', release: '1.0.0', slugs: ['a'] }]);
    expect(r.plans).toEqual([{ slug: 'a', file: 'docs/plans/2026-11-01-a.md', phase: 'delivered', releasedRecord: '' }]);
  });

  it('answers unaskable for a ref that does not resolve, and for an empty plan list', async () => {
    const repo = estate();
    expect((await releaseUnbookedReadingsFor(world(repo, { ref: 'origin/nowhere' }))).tag).toBe('unaskable');
    const empty = await releaseUnbookedReadingsFor(
      world(repo, { plans: { listPlans: async () => ({ ok: true, value: [] }), readPlans: async () => ({ ok: true, value: [] }) } as never }),
    );
    expect(empty.plans).toBe('unaskable');
  });
});
