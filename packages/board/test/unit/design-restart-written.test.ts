import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { restart, type Context } from '../../src/server/entry/design.js';

const SLUG = 'ship-it';
const PLAN = `docs/plans/x-${SLUG}.md`;
const SPEC_EMPTY = '# P\n\n## Spec\n\n## Status\n\n- **State:** Design\n';
const SPEC_WRITTEN = '# P\n\n## Spec\n\nSome decided text.\n\n## Status\n\n- **State:** Design\n';

describe('design.ts restart: "written" reads the ## Spec section, not the commit count', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /**
   * A bare `origin` holding `main` (with the plan, empty) and a spec branch
   * `idea/<slug>-spec` carrying one commit past `main` — the shape `restart`
   * reads via `git ls-tree`/`git show` against `ctx.repoRoot`.
   */
  const repository = (specText: string): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'plot-design-restart-'));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
    writeFileSync(path.join(repo, PLAN), SPEC_EMPTY);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', `idea/${SLUG}-spec`);
    writeFileSync(path.join(repo, PLAN), specText);
    writeFileSync(path.join(repo, '.plot-spec-marker'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'spec work');
    git(repo, 'push', '-q', 'origin', `idea/${SLUG}-spec`);
    git(repo, 'checkout', '-q', 'main');
    return repo;
  };

  const contextOf = (repo: string): Context => ({
    repoRoot: repo,
    scriptDir: repo,
    refs: {
      defaultBranch: async () => ({ ok: true, value: 'main' }),
      remoteHead: async () => ({ ok: true, value: 'present' as const }),
      commitSubjects: async () => ({
        ok: true,
        value: [{ at: 1, subject: 'spec work', tree: 't1', parentTree: 't0' }],
      }),
      remoteSha: async () => ({ ok: true, value: 'unknown' as const }),
      showFile: async (ref: string, file: string) => ({
        ok: true,
        value: execFileSync('git', ['-C', repo, 'show', `${ref}:${file}`], { encoding: 'utf8' }),
      }),
      recordCommit: async () => ({ ok: true, value: 'abc1234' }),
    },
    host: {
      prState: async () => ({ ok: true, value: null }),
      prCreate: async () => ({ ok: true, value: '' }),
      prMerged: async () => ({ ok: true, value: 'not-merged' as const }),
    },
    trees: {
      deleteRemoteBranch: async () => ({ ok: true, value: undefined }),
    },
  });

  it('refuses to call the branch written when its only post-default commit leaves ## Spec empty', async () => {
    const repo = repository(SPEC_EMPTY);
    const lines: string[] = [];
    const code = await restart(contextOf(repo), SLUG, (s) => lines.push(s), (s) => lines.push(s));
    expect(code).toBe(0);
    expect(lines.join('')).toMatch(/restart: start/);
  });

  it('treats the branch as written when the post-default commit fills in ## Spec', async () => {
    const repo = repository(SPEC_WRITTEN);
    const prCreateCalls: { head: string }[] = [];
    const ctx = contextOf(repo);
    ctx.host = {
      ...ctx.host,
      prCreate: async (request) => {
        prCreateCalls.push(request);
        return { ok: true, value: '' };
      },
    };
    const lines: string[] = [];
    const code = await restart(ctx, SLUG, (s) => lines.push(s), (s) => lines.push(s));
    expect(code).toBe(0);
    expect(lines.join('')).toMatch(/restart: pr-opened/);
    expect(prCreateCalls).toHaveLength(1);
  });
});
