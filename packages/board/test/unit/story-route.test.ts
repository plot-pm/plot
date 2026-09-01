// `POST /api/story`: what it refuses, what it spawns, and what the brief it
// writes must contain.
//
// **The plan's `## Done when` assertions that need a real handler run live
// here.** Four of them are about things a pure function cannot show: that
// nothing from an issue body reaches the shell, that an absent `Story command`
// names the key, that several DECLARED homes refuse rather than guess, and that
// a repo full of unrelated `stories/` paths is still a one-home repo.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the brief file, the 202 body
// — never against output a spawned command produces. The command these tests
// configure is `true`, which needs no budget at all. The measured failure this
// avoids, recorded by `idea-route.test.ts`: a 1 ms timeout that passed on macOS
// and lost on CI, and a teardown racing a detached child.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  STORY_COMMAND_KEY,
  STORY_DIRECTORY_DEFAULT,
  STORY_DIRECTORY_KEY,
  STORY_PROMPT_ENV,
  composeStoryPrompt,
  declaredStoryHomes,
  handleStory,
  storyAvailability,
  storyPromptPath,
  type StoryDeps,
  type StoryRefusal,
} from '../../src/server/story.js';
import type { IssueDetail } from '../../src/server/idea.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  // Synchronous and unconditional. Nothing spawned here outlives the call —
  // `true` has exited by the time the 202 is written — so there is no child to
  // race and `maxRetries` is not being asked to win anything.
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/**
 * A repo, with whatever directories a test wants in it.
 *
 * A NESTED DIR, the shape `idea-route.test.ts` established: a spawning command
 * writes its brief, log and state to `path.resolve(repoRoot, '..')`. With the
 * repo AT the tmpdir root those land in the shared temp directory, survive
 * `rmSync(dir)`, and the next run finds a file a refusal test asserts is absent.
 */
function repo(dirs: string[] = []): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-story-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return dir;
}

const ISSUE: IssueDetail = {
  number: 228,
  title: 'The board should show which sprint a plan belongs to',
  body: 'Four plans in flight and no way to tell which train they are on.',
  url: 'https://example.test/issues/228',
};

/** A request, with a body and the headers a same-origin POST carries. */
function request(body: unknown): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

/** A response that records rather than writes. */
function response(): { res: http.ServerResponse; got: Captured } {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
}

/**
 * Run the handler with everything injectable defaulted to a working repo.
 *
 * `Story command: true` — a command that exists, succeeds and produces nothing.
 * The tests assert what the handler wrote BEFORE spawning, so the command's
 * behaviour is deliberately irrelevant and deliberately instant.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    homes?: string;
    issue?: IssueDetail | (() => Promise<IssueDetail>);
    host?: string;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: StoryDeps = {
    config: (_o, key, fallback) => {
      if (key === STORY_COMMAND_KEY) return opts.command ?? 'true';
      if (key === STORY_DIRECTORY_KEY) return opts.homes ?? STORY_DIRECTORY_DEFAULT;
      return fallback;
    },
    issue: async () => {
      if (typeof opts.issue === 'function') return opts.issue();
      return opts.issue ?? ISSUE;
    },
  };
  await handleStory(
    request(opts.body ?? { number: 228 }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the route spawns a story command on a ticket', () => {
  it('accepts and writes the brief before it answers', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.number, 228);
    // The brief exists at 202 time — the property that makes every assertion
    // below raceless.
    const prompt = fs.readFileSync(storyPromptPath(dir, 228), 'utf8');
    assert.match(prompt, /\/story-tracking/);
  });

  it('carries the ticket into the brief, quoted rather than summarised', async () => {
    const dir = repo();
    await post({ repoRoot: dir });
    const prompt = fs.readFileSync(storyPromptPath(dir, 228), 'utf8');
    assert.ok(prompt.includes(ISSUE.title), 'the brief must carry the ticket title');
    assert.ok(prompt.includes(ISSUE.body), 'the brief must carry the ticket body');
    assert.ok(prompt.includes(`#${ISSUE.number}`), 'the brief must name the issue number');
  });

  it('never asks for a write to the tracker', async () => {
    const dir = repo();
    await post({ repoRoot: dir });
    const prompt = fs.readFileSync(storyPromptPath(dir, 228), 'utf8');
    assert.match(prompt, /Write nothing to the tracker/);
    for (const write of ['gh issue comment', 'gh issue close', 'gh issue edit', '--add-label']) {
      assert.ok(!prompt.includes(write), `the brief must not ask for \`${write}\``);
    }
  });
});

/**
 * NOTHING FROM THE ISSUE BODY REACHES THE SHELL — the plan's item 1, and a
 * command-injection boundary rather than a style choice.
 *
 * `Story command` is a shell FRAGMENT run through `sh -c`, and an issue body is
 * free text from anyone who can file an issue. The route's answer is `/api/idea`'s:
 * the ticket goes to a FILE, and only that file's path is ever named.
 */
describe('nothing from the ticket reaches the shell', () => {
  const HOSTILE: IssueDetail = {
    number: 41,
    title: 'crash on "; touch /tmp/plot-pwned; #',
    body: '$(touch /tmp/plot-pwned-body) `touch /tmp/plot-pwned-tick` \'; rm -rf ~\'',
    url: 'https://example.test/issues/41',
  };

  it('puts a hostile ticket in the FILE and names only its path', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, body: { number: 41 }, issue: HOSTILE });
    assert.equal(got.status, 202);

    // The dangerous text is in the file — the whole point is that it is carried
    // faithfully, just never as a shell word.
    const written = fs.readFileSync(storyPromptPath(dir, 41), 'utf8');
    assert.ok(written.includes(HOSTILE.body), 'the ticket body must reach the brief intact');

    // And what the ROUTE hands back as the thing it passed is a path this server
    // composed, carrying nothing from the issue but the number.
    const promptPath = String(got.body.prompt);
    assert.equal(promptPath, storyPromptPath(dir, 41));
    for (const meta of ['$(', '`', ';', '"', "'"]) {
      assert.ok(
        !promptPath.includes(meta),
        `the path passed to the shell must not contain \`${meta}\``,
      );
    }
  });

  it('names the brief by a path built from the NUMBER alone', () => {
    // The filename is `plot-story-issue-<n>.prompt.md` — a title could carry
    // anything, so it contributes nothing to the name.
    const p = storyPromptPath('/tmp/x/repo', 41);
    assert.match(path.basename(p), /^plot-story-issue-41\.prompt\.md$/);
  });
});

/**
 * AN ABSENT `Story command` REFUSES AND NAMES THE KEY — the plan's item 3, and
 * the assertion that must survive this repo now setting the key.
 *
 * A repo that has not configured it is the ORDINARY adopting case. What changed
 * is that the refusal is now conditional and names what is missing; what must
 * not change is that it refuses at all rather than accepting the click and doing
 * nothing.
 */
describe('an unconfigured repo refuses, and names the key', () => {
  it('refuses with `no-story-command`', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(got.status, 409);
    assert.equal(got.body.ok, false);
    assert.equal(got.body.reason, 'no-story-command' satisfies StoryRefusal);
  });

  it('NAMES THE KEY, so the reader knows what to add', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.ok(
      String(got.body.detail).includes(STORY_COMMAND_KEY),
      `the refusal must name \`${STORY_COMMAND_KEY}\`; got: ${got.body.detail}`,
    );
  });

  it('writes no brief and spawns nothing', async () => {
    const dir = repo();
    await post({ repoRoot: dir, command: '' });
    assert.ok(
      !fs.existsSync(storyPromptPath(dir, 228)),
      'a refused click must leave no brief behind',
    );
  });

  it('treats the `none` sentinel as unconfigured, never as a command to run', async () => {
    // `none` is the repo's established answer for *asked, and we do this by
    // hand*. Running it would spawn `none: command not found` and log that as
    // the reason a story does not exist.
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    assert.equal(got.body.reason, 'no-story-command' satisfies StoryRefusal);
  });
});

/**
 * THE HOME COUNT READS THE DECLARATION, NEVER THE FILESYSTEM — the plan's items
 * 4 and 5, and the trap the design exists to avoid.
 */
describe('story homes are counted from what the repo DECLARES', () => {
  it('several declared homes refuse, naming the home question', async () => {
    const dir = repo();
    const got = await post({
      repoRoot: dir,
      homes: 'docs/stories/, teams/blue/stories/',
    });
    assert.equal(got.status, 409);
    assert.equal(got.body.reason, 'several-story-homes' satisfies StoryRefusal);
    // NAMED, not guessed. A missing story is recoverable; a story in the wrong
    // home is referenced from elsewhere before anyone notices.
    const detail = String(got.body.detail);
    assert.ok(detail.includes('docs/stories/'), 'the refusal must name the homes it found');
    assert.ok(detail.includes('teams/blue/stories/'), 'the refusal must name the homes it found');
    assert.ok(
      !fs.existsSync(storyPromptPath(dir, 228)),
      'a refused click must leave no brief behind',
    );
  });

  /**
   * THE MEASURED TRAP. `Quatico.Webseite/quaweb-website` has exactly ONE story
   * home and three unrelated paths matching `stories/`: website content in two
   * languages, and image assets. A `git ls-files | grep stories/` counts four
   * homes and the button would refuse *"more than one home"* in a repo with no
   * ambiguity at all.
   */
  it('is still a ONE-HOME repo when the filesystem is full of unrelated stories/', async () => {
    const dir = repo([
      'docs/stories/plot-board',
      'packages/website/content/de/stories',
      'packages/website/content/en/stories',
      'packages/website/images__deprecated/refs/success-stories/acme',
    ]);
    // The DECLARATION says one home. The disk says four directories. The route
    // reads the declaration.
    const got = await post({ repoRoot: dir, homes: 'docs/stories/' });
    assert.equal(got.status, 202, 'a repo declaring one home must not be refused');
    const prompt = fs.readFileSync(storyPromptPath(dir, 228), 'utf8');
    assert.ok(prompt.includes('docs/stories/'), 'the brief must name the declared home');
    assert.ok(
      !prompt.includes('packages/website'),
      'no path the repo did not declare may reach the brief',
    );
  });

  it('an unset key is ONE home — the default — never zero and never ambiguous', () => {
    // A repo that has said nothing about where stories live has not thereby
    // declared an ambiguity, and refusing it would invent a question the repo
    // never posed.
    assert.deepEqual(declaredStoryHomes(''), [STORY_DIRECTORY_DEFAULT]);
    assert.deepEqual(declaredStoryHomes('   '), [STORY_DIRECTORY_DEFAULT]);
  });

  it('splits several homes on a comma or on whitespace, and on nothing else', () => {
    assert.deepEqual(declaredStoryHomes('docs/stories/'), ['docs/stories/']);
    assert.deepEqual(
      declaredStoryHomes('docs/stories/, teams/blue/stories/'),
      ['docs/stories/', 'teams/blue/stories/'],
    );
    assert.deepEqual(
      declaredStoryHomes('docs/stories/ teams/blue/stories/'),
      ['docs/stories/', 'teams/blue/stories/'],
    );
  });
});

/**
 * WHAT THE BRIEF TELLS THE SKILL — and, as loudly, what it does NOT.
 */
describe('the brief hands over facts and withholds opinions', () => {
  it('states the home, so the skill takes its own single-home escape', () => {
    const prompt = composeStoryPrompt({
      issue: ISSUE, home: 'docs/stories/', truncated: false,
    });
    assert.ok(prompt.includes('docs/stories/'), 'the brief must name the home');
    assert.match(prompt, /exactly one story home/);
  });

  it("carries the skill's own override wording for an explicit request", () => {
    const prompt = composeStoryPrompt({
      issue: ISSUE, home: 'docs/stories/', truncated: false,
    });
    // A click IS the explicit request the skill's triage names an override for.
    // The wording is the skill's own, verbatim, so a story created from a click
    // is indistinguishable from one created at a terminal over triage advice.
    assert.match(prompt, /created on explicit request over triage advice/);
  });

  it('asks for a PLOT-UNASKED line rather than for silence', () => {
    const prompt = composeStoryPrompt({
      issue: ISSUE, home: 'docs/stories/', truncated: false,
    });
    assert.match(prompt, /PLOT-UNASKED/);
  });

  /**
   * THE BOARD OFFERS NO TRIAGE ADVICE OF ITS OWN — the plan's item 8, a closed
   * Open Point. A second opinion rendered here is a second place to keep the
   * heuristic correct, and it would drift from the skill's own triage.
   */
  it('offers no triage verdict of its own', () => {
    const prompt = composeStoryPrompt({
      issue: ISSUE, home: 'docs/stories/', truncated: false,
    });
    // It asks the skill to RUN its triage; it never pre-empts the answer.
    assert.match(prompt, /Run your triage/);
    for (const verdict of [
      'this looks like a plan',
      'this should be a plan',
      'not worth a story',
      'this is worth a story',
    ]) {
      assert.ok(
        !prompt.toLowerCase().includes(verdict),
        `the board must offer no triage advice of its own; found: ${verdict}`,
      );
    }
  });

  it('says the body was truncated, rather than letting a fragment pass as the whole', () => {
    const prompt = composeStoryPrompt({
      issue: ISSUE, home: 'docs/stories/', truncated: true,
    });
    assert.match(prompt, /truncated/);
  });
});

describe('the binding, and the tracker', () => {
  it('is available on loopback and nowhere else', () => {
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      assert.equal(storyAvailability(host).available, true, `${host} must be available`);
    }
    const remote = storyAvailability('100.64.1.2');
    assert.equal(remote.available, false);
    // The reason names the BINDING, which is a fact that could change — unlike
    // the constant this whole feature replaced.
    assert.ok(remote.reason.includes('100.64.1.2'));
  });

  it('keeps `tracker-unsupported` apart from an outage', async () => {
    const dir = repo();
    const got = await post({
      repoRoot: dir,
      issue: () => {
        const e = new Error('bitbucket has no issue read') as Error & { code?: number };
        e.code = 4;
        return Promise.reject(e);
      },
    });
    assert.equal(got.status, 409);
    assert.equal(got.body.reason, 'tracker-unsupported' satisfies StoryRefusal);
  });

  it('refuses an unreadable ticket rather than writing a story about nothing', async () => {
    const dir = repo();
    const got = await post({
      repoRoot: dir,
      issue: () => Promise.reject(new Error('502 from the host')),
    });
    assert.equal(got.status, 502);
    assert.equal(got.body.reason, 'issue-unreadable' satisfies StoryRefusal);
    assert.ok(
      !fs.existsSync(storyPromptPath(dir, 228)),
      'an outage is not an answer — nothing may be created',
    );
  });

  it('refuses a body that does not name a positive issue number', async () => {
    const dir = repo();
    for (const bad of [{}, { number: 0 }, { number: -3 }, { number: 'x' }]) {
      const got = await post({ repoRoot: dir, body: bad });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });
});

/**
 * THE ENVIRONMENT THE SPAWNED RUN GETS — the plan's item 2.
 *
 * Asserted on the CONSTANTS the route exports and uses, rather than on a
 * captured argv: the spawn is detached and this suite deliberately races no
 * child. The route's own source is the single place either name appears, so a
 * drift in one is a drift in both.
 */
describe('the spawned run is declared unattended', () => {
  it('names the environment variables the run is given', async () => {
    // `PLOT_UNATTENDED` is the contract that makes the whole route possible:
    // `/story-tracking` is run this way several times a day from the prompt,
    // which is what refutes the categorical refusal this feature replaced.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/server/story.ts'),
      'utf8',
    );
    assert.match(src, /PLOT_UNATTENDED: '1'/);
    assert.match(src, /PLOT_ISSUE: String\(number\)/);
    assert.equal(STORY_PROMPT_ENV, 'PLOT_STORY_PROMPT');
    assert.ok(src.includes('[STORY_PROMPT_ENV]: promptPath'));
  });
});
