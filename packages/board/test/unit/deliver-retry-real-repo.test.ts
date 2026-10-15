// `plot-deliver.mjs`'s whole deliver arm against a real repository whose
// `main` moves while the first push is under way. A `pre-push` hook in the
// clone pushes a competing edit of the same plan from a second clone, once, so
// git rejects the first push; the retry must land the delivery on top of it.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/server/entry/deliver.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const PLAN = 'docs/plans/2026-10-01-p.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

describe('plot-deliver retries a push that main outran', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('lands the flip, the record and the moved index link on top of the competing commit', async () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-deliver-retry-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    const hooks = path.join(root, 'hooks');
    mkdirSync(hooks);
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'core.hooksPath', hooks);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(
      path.join(repo, PLAN),
      '# P\n\n## Status\n\n- **State:** Approved\n- **Approved:** 2026-10-01 by jw\n\n## Notes\n\n- one\n',
    );
    symlinkSync('../2026-10-01-p.md', path.join(repo, 'docs/plans/active/p.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    git(root, 'clone', '-q', origin, other);

    // Runs once: the marker makes every later push a plain push.
    const marker = path.join(root, 'moved');
    const hook = path.join(hooks, 'pre-push');
    writeFileSync(
      hook,
      [
        '#!/bin/sh',
        `[ -e '${marker}' ] && exit 0`,
        `touch '${marker}'`,
        'unset $(git rev-parse --local-env-vars)',
        `cd '${other}' || exit 1`,
        `printf -- '- moved on main\\n' >> '${PLAN}'`,
        "git -c user.name=o -c user.email=o@o commit -q -am 'move main' || exit 1",
        'git push -q origin HEAD:main || exit 1',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(hook, 0o755);

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--who', 'jw', 'p'], repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));

    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);
    expect(said).toContain('push: rejected');
    expect(said).toContain('step: push rejected — retrying (attempt 1 of 5)');
    expect(said).toMatch(/summary: phase=flipped record=written index=moved sprint=none push=clean /);
    git(repo, 'fetch', '-q', 'origin', 'main');
    const landed = git(repo, 'show', `origin/main:${PLAN}`);
    expect(landed).toContain('- **State:** Delivered\n');
    expect(landed).toMatch(/- \*\*Delivered:\*\* \d{4}-\d{2}-\d{2}/);
    expect(landed).toContain('- moved on main\n');
    expect(git(repo, 'log', '-2', '--format=%s', 'origin/main')).toBe('plot: deliver p\nmove main\n');
    expect(git(repo, 'ls-tree', '--name-only', 'origin/main', 'docs/plans/delivered/p.md').trim()).toBe('docs/plans/delivered/p.md');
    expect(git(repo, 'ls-tree', '--name-only', 'origin/main', 'docs/plans/active/p.md').trim()).toBe('');
  }, 60_000);
});
