// `plot-story-status.mjs` against a real repository and a bare origin: the move
// is decided by the domain, only the front matter's status (and archive date)
// changes, and the booking lands on the default branch.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from '../../src/server/entry/story-status.js';

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const STORY = 'docs/stories/a-story/STORY-a-story.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const storyText = (status: string): string =>
  `---\ntitle: A story\nauthor: jw\nstatus: ${status}\ncreated: 2026-11-01\nupdated: 2026-11-02\n---\n\n# A story\n\n## Objective\n\nstatus: ready is prose, not front matter.\n`;

describe('plot-story-status moves a story to a status', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** A repository whose `main` holds one story at `status`, pushed to a bare origin. */
  const setup = (status = 'ready', text = storyText(status)): { repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-story-status-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'docs/stories/a-story'), { recursive: true });
    writeFileSync(path.join(repo, STORY), text);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    return { repo, origin };
  };

  const move = async (repo: string, argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, repo, SCRIPT_DIR, (s) => out.push(s), (s) => err.push(s), env);
    return { code, out: out.join(''), err: err.join('') };
  };

  const tipOf = (origin: string): string => git(origin, 'rev-parse', 'main').trim();

  it('writes only the status line, commits as --who, pushes, and removes its booking branch', async () => {
    const { repo, origin } = setup('ready');

    const r = await move(repo, ['--who', 'jw', 'a-story', 'active']);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    expect(r.out).toMatch(/summary: status=active archived=untouched push=/);
    expect(git(origin, 'show', `main:${STORY}`)).toBe(storyText('ready').replace('status: ready\n', 'status: active\n'));
    expect(git(origin, 'log', '-1', '--format=%s|%an', 'main').trim()).toBe('plot: move story a-story to active|jw');
    expect(git(repo, 'branch', '--list', 'plot/story-status-a-story').trim()).toBe('');
    expect(existsSync(path.join(repo, '.plot/state/state-receipts'))).toBe(false);
  }, 60_000);

  it('writes the archive date beside done', async () => {
    const { repo, origin } = setup('in-review');

    const r = await move(repo, ['a-story', 'done']);
    expect(r.code, `${r.out}\n${r.err}`).toBe(0);
    expect(r.out).toMatch(/summary: status=done archived=written push=/);
    expect(git(origin, 'show', `main:${STORY}`)).toMatch(/\nstatus: done\narchived: \d{4}-\d{2}-\d{2}\ncreated: 2026-11-01\n/);
  }, 60_000);

  it.each([
    ['status-unreachable', 'draft', 'active'],
    ['status-unchanged', 'ready', 'ready'],
    ['status-terminal', 'done', 'active'],
    ['status-unrecognised', 'ready', 'archived'],
  ])('refuses %s by name and writes nothing', async (reason, from, to) => {
    const { repo, origin } = setup(from);
    const before = tipOf(origin);

    const r = await move(repo, ['a-story', to]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`plot-story-status: ${reason}: `);
    expect(tipOf(origin)).toBe(before);
    expect(git(repo, 'branch', '--list', 'plot/story-status-a-story').trim()).toBe('');
  }, 60_000);

  it('refuses story-not-found for a slug with no story file', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);

    const r = await move(repo, ['no-such-story', 'active']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('plot-story-status: story-not-found: ');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('refuses story-unreadable for a story whose status is outside the six', async () => {
    const { repo, origin } = setup('ready', storyText('someday'));
    const before = tipOf(origin);

    const r = await move(repo, ['a-story', 'active']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('plot-story-status: story-unreadable: ');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('refuses slug-invalid for a slug that names a path', async () => {
    const { repo } = setup();
    const r = await move(repo, ['../x', 'active']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('plot-story-status: slug-invalid: ');
  }, 60_000);

  it('refuses under PLOT_UNATTENDED=1 before it reads anything', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);

    const r = await move(repo, ['a-story', 'active'], { PLOT_UNATTENDED: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('plot-story-status: unattended: ');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);
});

describe('parseArgs', () => {
  it('reads a slug, a status and --who', () => {
    expect(parseArgs(['--who', 'jw', 'a', 'active'])).toEqual({ who: 'jw', slug: 'a', status: 'active' });
  });

  it('refuses a missing status', () => {
    expect(parseArgs(['a'])).toMatch(/need a story slug and a status/);
  });

  it('refuses an unknown flag', () => {
    expect(parseArgs(['--force', 'a', 'active'])).toBe("unknown flag '--force'");
  });
});
