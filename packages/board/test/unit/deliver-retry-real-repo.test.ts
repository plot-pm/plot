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

/**
 * `tickSprint` picks the sprint file `sprintOfPlan` names, never the first
 * file a directory scan finds containing `[slug]` — the regression covered
 * here is `f57425ec0`, where delivery ticked a Closed sprint's `### Deferred`
 * line while the plan belonged to a different, open sprint.
 */
describe('plot-deliver ticks the sprint sprintOfPlan names, not the first file scanned', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // Trimmed from the real texts at f57425ec0^:
  // docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md
  // docs/sprints/2026-W43-bugfix-2-28-1.md
  const w42Closed = `# Sprint: Bitbucket, Jira and Jenkins work with the board

## Status

- **State:** Closed
- **Actual End:** 2026-10-22
- **Start:** 2026-10-16
- **End:** 2026-10-23
- **Release:** 2.28.0

## Sprint Goal

A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.

### Must Have

- [x] [bitbucket-parity-and-app-identities] Host connector: Bitbucket parity and App identities (#1848)

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

- [ ] [p] Board hides a green draft slice PR that waits for a person to mark it ready (#2319)
`;

  const bugfix2281Open = `# Sprint: Bugfix 2.28.1

## Status

- **State:** Planning
- **Start:** YYYY-MM-DD
- **End:** YYYY-MM-DD
- **Release:** 2.28.1

## Sprint Goal

2.28.0 shipped with two Should Haves of W42 deferred.

### Must Have

- [ ] [p] Board hides a green draft slice PR that waits for a person to mark it ready (#2319)

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->
`;

  /** A plain repo + origin with a plan ready to deliver and the given sprint files staged. */
  const setup = (sprintFiles: Record<string, string>, planFields = ''): { root: string; repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-deliver-sprint-')));
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    mkdirSync(path.join(repo, 'docs/sprints'), { recursive: true });
    writeFileSync(
      path.join(repo, PLAN),
      `# P\n\n## Status\n\n- **State:** Approved\n- **Approved:** 2026-10-01 by jw\n${planFields}`,
    );
    symlinkSync('../2026-10-01-p.md', path.join(repo, 'docs/plans/active/p.md'));
    for (const [name, content] of Object.entries(sprintFiles)) {
      writeFileSync(path.join(repo, 'docs/sprints', name), content);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    return { root, repo, origin };
  };

  it('ticks the open sprint naming the plan, not the Closed sprint whose Deferred line names it too', async () => {
    const { root, repo } = setup({
      '2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md': w42Closed,
      '2026-W43-bugfix-2-28-1.md': bugfix2281Open,
    }, '- **Sprint:** bugfix-2-28-1\n');
    roots.push(root);

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--who', 'jw', 'p'], repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));
    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);

    git(repo, 'fetch', '-q', 'origin', 'main');
    const closedAfter = git(repo, 'show', 'origin/main:docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md');
    const openAfter = git(repo, 'show', 'origin/main:docs/sprints/2026-W43-bugfix-2-28-1.md');
    expect(closedAfter).toContain('- [ ] [p] Board hides a green draft slice PR');
    expect(openAfter).toContain('- [x] [p] Board hides a green draft slice PR');
  }, 60_000);

  it('ticks the sprint item even though the plan carries no Sprint: field', async () => {
    const { root, repo } = setup({
      '2026-W43-bugfix-2-28-1.md': bugfix2281Open,
    });
    roots.push(root);

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--who', 'jw', 'p'], repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));
    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);

    git(repo, 'fetch', '-q', 'origin', 'main');
    const openAfter = git(repo, 'show', 'origin/main:docs/sprints/2026-W43-bugfix-2-28-1.md');
    expect(openAfter).toContain('- [x] [p] Board hides a green draft slice PR');
  }, 60_000);

  it('stages only the one sprint file it ticks, leaving an unrelated sprint edit unstaged', async () => {
    const { root, repo } = setup({
      '2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md': w42Closed,
      '2026-W43-bugfix-2-28-1.md': bugfix2281Open,
    });
    roots.push(root);

    // An unrelated, uncommitted edit to the Closed sprint file — never named
    // by `sprintOfPlan` for this plan, so it must stay out of the commit.
    const closedPath = path.join(repo, 'docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md');
    writeFileSync(closedPath, `${w42Closed}\n- unrelated edit\n`);

    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--who', 'jw', 'p'], repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s));
    const said = `${out.join('')}\n--- stderr ---\n${err.join('')}`;
    expect(code, said).toBe(0);

    git(repo, 'fetch', '-q', 'origin', 'main');
    const landedClosed = git(repo, 'show', 'origin/main:docs/sprints/2026-W42-bitbucket-jira-and-jenkins-work-with-the-board.md');
    expect(landedClosed).not.toContain('unrelated edit');
    expect(git(repo, 'status', '--porcelain', closedPath).trim()).not.toBe('');
  }, 60_000);
});
