// `POST /api/story-plan`: what it refuses, and the brief it writes before it
// answers. Every assertion reads state the handler writes before its reply; the
// configured command is `true`, which exits at once and writes nothing.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { CommittedStory } from '../../src/server/board.js';
import { IDEA_COMMAND_KEY } from '../../src/server/idea.js';
import {
  composeStoryPlanPrompt,
  handleStoryPlan,
  storyPlanLogPath,
  storyPlanPromptPath,
  storyPlanStatus,
  type StoryPlanDeps,
} from '../../src/server/story-plan.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo nested one level down, so the brief and the log land inside the temp parent. */
const repo = (): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-story-plan-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const STORY: CommittedStory = {
  slug: 'nothing-runs',
  title: 'Nothing changed, nothing runs',
  status: 'draft',
  archived: false,
  path: 'docs/stories/nothing-runs/STORY-nothing-runs.md',
  content: '---\ntitle: Nothing changed, nothing runs\nstatus: draft\n---\n\n## Objective\n\nFind out why.\n',
};

const request = (body: unknown): http.IncomingMessage => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
};

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

const response = (): { res: http.ServerResponse; got: Captured } => {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
};

const post = async (opts: {
  repoRoot: string;
  body?: unknown;
  command?: string;
  story?: CommittedStory | null | 'unread';
  unattended?: boolean;
  asked?: string[];
  tree?: StoryPlanDeps['tree'];
}): Promise<Captured> => {
  const { res, got } = response();
  const deps: StoryPlanDeps = {
    config: (_o, key, fallback) => (key === IDEA_COMMAND_KEY ? opts.command ?? 'true' : fallback),
    story: async (_o, slug) => {
      opts.asked?.push(slug);
      return opts.story === undefined ? STORY : opts.story;
    },
    tree: opts.tree ?? ((o) => o.repoRoot),
    unattended: () => opts.unattended ?? false,
  };
  await handleStoryPlan(request(opts.body ?? { slug: 'nothing-runs' }), res, { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, port: 7777 }, deps);
  return got;
};

describe('Add plan starts the idea agent inside a live story', () => {
  it('accepts and writes the brief before it answers', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.slug, 'nothing-runs');
    const brief = fs.readFileSync(storyPlanPromptPath(dir, 'nothing-runs'), 'utf8');
    assert.match(brief, /\/plot-idea/);
    assert.match(brief, /- \*\*Story:\*\* nothing-runs/);
  });

  it('builds the brief from the committed file, never from the request', async () => {
    const dir = repo();
    await post({ repoRoot: dir, body: { slug: 'nothing-runs', title: 'INJECTED', content: 'INJECTED' } });
    const brief = fs.readFileSync(storyPlanPromptPath(dir, 'nothing-runs'), 'utf8');
    assert.ok(brief.includes('Find out why.'), 'the brief must quote the committed story');
    assert.ok(!brief.includes('INJECTED'), 'nothing from the body but the slug may reach the brief');
  });

  it('names the slug on a line above the quoted story', () => {
    const brief = composeStoryPlanPrompt({ ...STORY, content: 'Story: someone-else\n' });
    assert.ok(brief.indexOf('Story: nothing-runs') < brief.indexOf('Story: someone-else'));
  });
});

describe('Add plan refuses by name', () => {
  it('refuses a malformed slug before it reads anything', async () => {
    const asked: string[] = [];
    for (const slug of ['../etc', 'Upper', 'a b', '', 42]) {
      const got = await post({ repoRoot: repo(), body: { slug }, asked });
      assert.equal(got.status, 400);
      assert.equal(got.body.reason, 'unknown-story');
    }
    assert.deepEqual(asked, []);
  });

  it('refuses a slug that names no story on the default branch', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, story: null });
    assert.equal(got.body.reason, 'unknown-story');
    assert.ok(!fs.existsSync(storyPlanPromptPath(dir, 'nothing-runs')), 'a refusal writes no brief');
  });

  it('refuses a done or an archived story', async () => {
    assert.equal((await post({ repoRoot: repo(), story: { ...STORY, status: 'done' } })).body.reason, 'unknown-story');
    assert.equal((await post({ repoRoot: repo(), story: { ...STORY, archived: true } })).body.reason, 'unknown-story');
  });

  it('refuses where the stories could not be read, rather than reading that as no story', async () => {
    const got = await post({ repoRoot: repo(), story: 'unread' });
    assert.equal(got.status, 502);
    assert.equal(got.body.reason, 'stories-unread');
  });

  it('refuses with no Idea command, naming the key', async () => {
    const got = await post({ repoRoot: repo(), command: '' });
    assert.equal(got.body.reason, 'no-idea-command');
    assert.match(String(got.body.detail), /Idea command/);
  });

  it('refuses while an earlier run for the story still runs, and leaves its log alone', async () => {
    const dir = repo();
    const log = storyPlanLogPath(dir, 'nothing-runs');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    // A log with no state file is a run in progress.
    fs.writeFileSync(log, 'the first run is working\n', 'utf8');
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 409);
    assert.equal(got.body.reason, 'already-running');
    assert.equal(fs.readFileSync(log, 'utf8'), 'the first run is working\n');
  });

  it('leaves no run reading as running where the worktree could not be made', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, tree: () => { throw new Error('no worktree'); } });
    assert.equal(got.status, 500);
    assert.notEqual(storyPlanStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, 'nothing-runs').state, 'running');
    // The next click is not refused as already running.
    assert.equal((await post({ repoRoot: dir })).status, 202);
  });

  it('lets one of two requests in flight start, and refuses the other', async () => {
    const dir = repo();
    let release: () => void = () => {};
    let reached: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reading = new Promise<void>((resolve) => { reached = resolve; });
    const slow = async (): Promise<CommittedStory> => { reached(); await gate; return STORY; };
    const { res: resA, got: a } = response();
    const { res: resB, got: b } = response();
    const deps: StoryPlanDeps = {
      config: (_o, key, fallback) => (key === IDEA_COMMAND_KEY ? 'true' : fallback),
      story: slow,
      tree: (o) => o.repoRoot,
      unattended: () => false,
    };
    const first = handleStoryPlan(request({ slug: 'nothing-runs' }), resA, { repoRoot: dir, scriptsDir: SCRIPTS, port: 7777 }, deps);
    // The second request arrives while the first one reads its story.
    await reading;
    await handleStoryPlan(request({ slug: 'nothing-runs' }), resB, { repoRoot: dir, scriptsDir: SCRIPTS, port: 7777 }, deps);
    release();
    await first;
    assert.deepEqual([a.status, b.status], [202, 409]);
    assert.equal(b.body.reason, 'already-running');
  });

  it('refuses an unattended board', async () => {
    const got = await post({ repoRoot: repo(), unattended: true });
    assert.equal(got.status, 409);
    assert.equal(got.body.reason, 'unattended');
  });
});
