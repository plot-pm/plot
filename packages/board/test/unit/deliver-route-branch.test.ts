// `POST /api/deliver` with a `branch`: the route takes the branch
// `plot-deliver.mjs --branch` takes, validates it the same way, and hands it to
// `/plot-deliver`, which runs `plot-deliver.sh --branch <branch> <slug>`.
//
// The estate is a real clone whose plan only `origin/sprint/two-weeks` holds,
// so the route's plan lookup and phase read run against git, not a stub.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { deliverPromptPath, handleDeliver } from '../../src/server/deliver.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'a-sprint-plan';
const SPRINT = 'sprint/two-weeks';

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop() as string);
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A plan file's text at `state`. */
const planText = (state: string): string =>
  `# A sprint plan\n\n## Status\n\n- **State:** ${state}\n- **Sprint:** two-weeks\n\n## Branches\n\n### Slice\n\n- \`feature/one\` — the work → #12\n`;

/** A clone whose `origin/main` holds no plan and whose `origin/sprint/two-weeks` holds one at `state`. */
const sprintEstate = (state = 'Approved'): string => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-deliver-branch-')));
  made.push(parent);
  const origin = path.join(parent, 'origin.git');
  const repoRoot = path.join(parent, 'repo');
  git(parent, 'init', '--bare', '-q', '-b', 'main', origin);
  git(parent, 'clone', '-q', origin, repoRoot);
  git(repoRoot, 'config', 'user.email', 'test@example.invalid');
  git(repoRoot, 'config', 'user.name', 'Plot Test');
  git(repoRoot, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repoRoot, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs', 'plans', '.keep'), '');
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'init');
  git(repoRoot, 'push', '-q', 'origin', 'main');
  git(repoRoot, 'remote', 'set-head', 'origin', 'main');
  git(repoRoot, 'checkout', '-q', '-b', SPRINT);
  fs.writeFileSync(path.join(repoRoot, 'docs', 'plans', `2099-01-01-${SLUG}.md`), planText(state));
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'plan on the sprint branch');
  git(repoRoot, 'push', '-q', 'origin', SPRINT);
  git(repoRoot, 'checkout', '-q', 'main');
  git(repoRoot, 'branch', '-q', '-D', SPRINT);
  git(repoRoot, 'fetch', '-q', 'origin');
  return repoRoot;
};

/** Posts `body` to the route with `Idea command: true`, and answers the status and body. */
const post = async (repoRoot: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  const got = { status: 0, body: {} as Record<string, unknown> };
  const res = {
    headersSent: false,
    writeHead(s: number) { got.status = s; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  await handleDeliver(req, res, { repoRoot, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 }, {
    config: (_o, key, fallback) => (key === 'Idea command' ? 'true' : fallback),
  });
  return got;
};

describe('POST /api/deliver with a branch', () => {
  it('finds the plan on origin/<branch> and hands the branch to /plot-deliver', async () => {
    const repoRoot = sprintEstate();
    const got = await post(repoRoot, { slug: SLUG, branch: SPRINT });
    expect(got.status).toBe(202);
    expect(got.body).toMatchObject({ ok: true, slug: SLUG, branch: SPRINT });
    const prompt = fs.readFileSync(deliverPromptPath(repoRoot, SLUG), 'utf8');
    expect(prompt.split('\n')[0]).toBe(`/plot-deliver --branch ${SPRINT} ${SLUG}`);
    expect(prompt).toContain(`plot-deliver.sh --branch ${SPRINT} ${SLUG}`);
    expect(prompt).toContain(`origin/${SPRINT}:docs/plans/2099-01-01-${SLUG}.md`);
  });

  it('refuses a branch name that is not a branch name, as the bundle refuses a flag', async () => {
    const repoRoot = sprintEstate();
    for (const branch of ['', '--dry-run', 7]) {
      const got = await post(repoRoot, { slug: SLUG, branch });
      expect(got.status).toBe(400);
      expect(got.body.error).toBe('branch must be a branch name');
    }
  });

  it('refuses a branch origin does not hold, and writes no prompt', async () => {
    const repoRoot = sprintEstate();
    const got = await post(repoRoot, { slug: SLUG, branch: 'sprint/nowhere' });
    expect(got.status).toBe(409);
    expect(got.body.reason).toBe('branch-not-on-origin');
    expect(fs.existsSync(deliverPromptPath(repoRoot, SLUG))).toBe(false);
  });

  it('refuses a plan the branch already holds as delivered', async () => {
    const repoRoot = sprintEstate('Delivered');
    const got = await post(repoRoot, { slug: SLUG, branch: SPRINT });
    expect(got.status).toBe(409);
    expect(got.body.reason).toBe('already-delivered');
  });

  it('refuses a slug the branch holds no plan for', async () => {
    const repoRoot = sprintEstate();
    const got = await post(repoRoot, { slug: 'no-such-plan', branch: SPRINT });
    expect(got.status).toBe(409);
    expect(got.body.reason).toBe('plan-unreadable');
  });
});
