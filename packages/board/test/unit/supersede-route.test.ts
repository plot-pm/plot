// `POST /api/supersede` runs the supersession in process against a real
// repository and a bare origin, and answers with its summary or its refusal.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleSupersede, refusalStatus } from '../../src/server/supersede.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const OLD = 'docs/plans/2026-11-01-old.md';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const planText = (title: string, state: string): string =>
  `# ${title}\n\n## Status\n\n- **State:** ${state}\n- **Review:** pr\n\n## Branches\n\n- \`feature/${title}\` — the work\n`;

describe('POST /api/supersede', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const setup = (oldState = 'Approved'): { repo: string; origin: string } => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'plot-supersede-route-')));
    roots.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(path.join(repo, OLD), planText('old', oldState));
    writeFileSync(path.join(repo, 'docs/plans/2026-11-02-new.md'), planText('new', 'Draft'));
    symlinkSync('../2026-11-01-old.md', path.join(repo, 'docs/plans/active/old.md'));
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
    await handleSupersede(req, res, { repoRoot: repo, scriptsDir: SCRIPTS, host: 'localhost', port: 7777, env });
    return { status, body: JSON.parse(text) as Record<string, unknown> };
  };

  const tipOf = (origin: string): string => git(origin, 'rev-parse', 'main').trim();

  it('answers 200 with the summary and books the supersession on the default branch', async () => {
    const { repo, origin } = setup();
    const answer = await post(repo, { slug: 'old', by: 'new', who: 'jw' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.summary).toMatch(/^summary: phase=flipped record=written index=moved push=/);
    expect(git(origin, 'show', `main:${OLD}`)).toContain('- **State:** Superseded');
    expect(git(origin, 'ls-tree', '-r', '--name-only', 'main')).toContain('docs/plans/delivered/old.md');
  }, 60_000);

  it('answers 422 with successor-not-found and writes nothing', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'old', by: 'nowhere' });
    expect(answer.status).toBe(422);
    expect(answer.body.reason).toBe('successor-not-found');
    expect(String(answer.body.error)).toContain("no plan file carries the slug 'nowhere'");
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 409 with the domain reason for a Delivered plan', async () => {
    const { repo, origin } = setup('Delivered');
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'old', by: 'new' });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe('state-terminal');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 404 for a slug that names no plan', async () => {
    const { repo } = setup();
    const answer = await post(repo, { slug: 'ghost', by: 'new' });
    expect(answer.status).toBe(404);
    expect(answer.body.reason).toBe('plan-not-found');
  }, 60_000);

  it('answers 403 on an unattended board before it reads the plan', async () => {
    const { repo, origin } = setup();
    const before = tipOf(origin);
    const answer = await post(repo, { slug: 'old', by: 'new' }, { PLOT_UNATTENDED: '1' });
    expect(answer.status).toBe(403);
    expect(answer.body.reason).toBe('unattended');
    expect(tipOf(origin)).toBe(before);
  }, 60_000);

  it('answers 403 for a cross-origin request', async () => {
    const { repo } = setup();
    const answer = await post(repo, { slug: 'old', by: 'new' }, {}, { 'sec-fetch-site': 'cross-site' });
    expect(answer.status).toBe(403);
  }, 60_000);

  it('answers 400 for a body without a successor', async () => {
    const { repo } = setup();
    const answer = await post(repo, { slug: 'old' });
    expect(answer.status).toBe(400);
  }, 60_000);

  it('maps each refusal class to its status', () => {
    expect(refusalStatus('same-plan')).toBe(422);
    expect(refusalStatus('state-wrong')).toBe(409);
    expect(refusalStatus('push-rejected')).toBe(500);
  });
});
