// `POST /api/story-status` runs the story status move in process against a
// real repository and a bare origin, and answers with its summary or its refusal.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleStoryStatus, refusalStatus } from '../../src/server/story-status.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const STORY = 'docs/stories/a-story/STORY-a-story.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const storyText = (status: string): string => `---\ntitle: A story\nstatus: ${status}\nupdated: 2026-11-02\n---\n\n# A story\n`;

describe('POST /api/story-status', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const setup = (status = 'ready'): { repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-story-status-route-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'docs/stories/a-story'), { recursive: true });
    writeFileSync(path.join(repo, STORY), storyText(status));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'remote', 'set-head', 'origin', 'main');
    return { repo, origin };
  };

  const post = async (
    repo: string,
    payload: unknown,
    env: NodeJS.ProcessEnv = {},
    headers: http.IncomingHttpHeaders = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const req = Readable.from([JSON.stringify(payload)]) as unknown as http.IncomingMessage;
    req.headers = headers;
    req.method = 'POST';
    let status = 0;
    let text = '';
    const res = {
      headersSent: false,
      writeHead(s: number) {
        status = s;
        return this;
      },
      end(chunk?: string) {
        text = chunk ?? '';
        return this;
      },
    } as unknown as http.ServerResponse;
    await handleStoryStatus(req, res, { repoRoot: repo, scriptsDir: SCRIPTS, host: 'localhost', port: 7999, env });
    return { status, body: JSON.parse(text) as Record<string, unknown> };
  };

  const tipOf = (origin: string): string => git(origin, 'rev-parse', 'main').trim();

  it('answers 200 with the summary and books the status on the default branch', async () => {
    const { repo, origin } = setup();
    const answer = await post(repo, { slug: 'a-story', status: 'active', who: 'jw' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.summary).toMatch(/^summary: status=active archived=untouched push=/);
    expect(git(origin, 'show', `main:${STORY}`)).toBe(storyText('active'));
  }, 60_000);

  it('answers 409 with status-unreachable and writes nothing', async () => {
    const { repo, origin } = setup('draft');
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'a-story', status: 'done' });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe('status-unreachable');
    expect(String(answer.body.error)).toContain("cannot go 'draft' -> 'done'");
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 422 with status-unrecognised and writes nothing', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'a-story', status: 'archived' });
    expect(answer.status).toBe(422);
    expect(answer.body.reason).toBe('status-unrecognised');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 404 for a slug that names no story', async () => {
    const { repo } = setup();
    const answer = await post(repo, { slug: 'ghost', status: 'active' });
    expect(answer.status).toBe(404);
    expect(answer.body.reason).toBe('story-not-found');
  }, 60_000);

  it('answers 403 on an unattended board before it reads the story', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'a-story', status: 'active' }, { PLOT_UNATTENDED: '1' });
    expect(answer.status).toBe(403);
    expect(answer.body.reason).toBe('unattended');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 403 for a cross-origin request', async () => {
    const { repo } = setup();
    const answer = await post(repo, { slug: 'a-story', status: 'active' }, {}, { 'sec-fetch-site': 'cross-site' });
    expect(answer.status).toBe(403);
  }, 60_000);

  it('answers 400 for a body without a status, and for a slug that names a path', async () => {
    const { repo } = setup();
    expect((await post(repo, { slug: 'a-story' })).status).toBe(400);
    expect((await post(repo, { slug: '../x', status: 'active' })).status).toBe(400);
  }, 60_000);

  it('maps each refusal class to its status', () => {
    expect(refusalStatus('status-unchanged')).toBe(409);
    expect(refusalStatus('status-terminal')).toBe(409);
    expect(refusalStatus('story-unreadable')).toBe(422);
    expect(refusalStatus('slug-invalid')).toBe(422);
    expect(refusalStatus('push-rejected')).toBe(500);
  });
});
