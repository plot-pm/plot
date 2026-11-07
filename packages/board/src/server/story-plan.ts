import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { StoryStatusSchema, storyIsLive } from '@plot-pm/domain';
import { agentLogPath } from './agent-log.js';
import { readCommittedStory, readConfig, type BuildBoardOptions, type CommittedStory } from './board.js';
import { markBoardRun, readRunState, startBoardRun } from './board-run.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { BODY_MAX, IDEA_COMMAND_KEY, IDEA_PROMPT_ENV, lastLines, prepareIdeaTree, usableCommand } from './idea.js';

/**
 * *Add plan* on a story card: `/plot-idea` creates a Draft plan inside the
 * story. The request names the story by slug and carries nothing else; the
 * brief is built from the story's file as `origin/<default>` holds it.
 *
 * It runs the `Idea command` in the same detached worktree shape as
 * `/api/idea`, because `/plot-idea` checks out the branch it creates.
 */

/** The shape a story slug must have before it names a file. */
export const STORY_SLUG_RE = /^[a-z0-9-]+$/;

/** Where the brief is written; keyed by slug, outside the repository. */
export const storyPlanPromptPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'idea-story', slug, 'prompt');

/** Where the command's own words go. */
export const storyPlanLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'idea-story', slug, 'log');

const storyPlanStatePath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'idea-story', slug, 'state');

/** Why adding a plan to a story was refused. */
export type StoryPlanRefusal =
  /** The slug is malformed, names no story on `origin/<default>`, or names a done or archived one. */
  | 'unknown-story'
  /** The default branch's stories could not be read. */
  | 'stories-unread'
  /** No `Idea command` is configured. */
  | 'no-idea-command'
  /** The board runs unattended, where no person asked for the plan. */
  | 'unattended'
  /** A plan for this story is still being created; a second run would remove the first one's worktree. */
  | 'already-running';

/**
 * The brief handed to `/plot-idea`: the story as the problem statement, and the
 * `Story:` field the plan must carry.
 *
 * The story is QUOTED from its committed file, never summarised, and the slug
 * stands on a line above it. The Type is the board's default, `feature`,
 * stated because `/plot-idea` unattended stops without one; the plan is a
 * Draft so a reader can correct it.
 *
 * @param story - the story as the default branch holds it.
 * @returns the brief.
 */
export const composeStoryPlanPrompt = (story: CommittedStory): string => {
  const truncated = story.content.length > BODY_MAX;
  const parts = [
    `/plot-idea: a plan inside story ${story.slug}`,
    '',
    'Type: feature',
    `Story: ${story.slug}`,
    '',
    'A person clicked *Add plan* on this story. The story below is the problem',
    'statement — read it as the brain dump `/plot-idea` prefers, and choose the',
    'next piece of work it still needs; do not copy the story into the plan.',
    '',
    '## Two things this plan must do',
    '',
    `1. Record \`- **Story:** ${story.slug}\` in the plan's \`## Status\` block.`,
    '   That field is how the board lists the plan under this story.',
    '2. Stop at **Draft**. Do not approve it, and do not start implementing it.',
    '',
    'Nobody is here to answer a question. Where you would ask, take the shape',
    'your own instructions give for an unattended run and name the question',
    'you skipped with a `PLOT-UNASKED` line.',
    '',
    `## Story ${story.slug} — ${story.path}`,
    '',
    truncated ? story.content.slice(0, BODY_MAX) : story.content,
    '',
  ];
  if (truncated) {
    parts.push(`_The story was truncated at ${BODY_MAX} characters. Read the whole file before deciding anything that turns on its detail._`, '');
  }
  return parts.join('\n');
};

/** What the board may say about a plan it asked for inside a story. */
export interface StoryPlanStatus {
  state: 'unknown' | 'running' | 'done' | 'failed';
  /** The command's own last words — empty while running and on success. */
  message: string;
  log: string;
}

/**
 * Read back what an earlier POST started. Never spawns, never blocks.
 *
 * @param opts - the board's repo root.
 * @param slug - the story's slug, already checked against {@link STORY_SLUG_RE}.
 * @returns the run's state and, on failure, the command's last lines.
 */
export const storyPlanStatus = (opts: BuildBoardOptions, slug: string): StoryPlanStatus => {
  const log = storyPlanLogPath(opts.repoRoot, slug);
  const { state, recorded } = readRunState(storyPlanStatePath(opts.repoRoot, slug), log);
  if (state !== 'failed') return { state, message: '', log };
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return { state: 'failed', message: lastLines(text) || `the idea command exited ${recorded}`, log };
};

/** The facts this route reads from outside itself, injectable for test. */
export interface StoryPlanDeps {
  /** The configured `Idea command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The story as `origin/<default>` holds it. */
  story?: (opts: BuildBoardOptions, slug: string) => Promise<CommittedStory | null | 'unread'>;
  /** The worktree the agent runs in. */
  tree?: (opts: BuildBoardOptions, name: string) => string;
  /** Whether the board runs unattended; defaults to `PLOT_UNATTENDED=1`. */
  unattended?: () => boolean;
}

export interface StoryPlanOptions extends BuildBoardOptions {
  port: number;
}

/**
 * Handle `POST /api/story-plan` — refuse, or write the brief and start
 * `/plot-idea` on it. Answers 202 at once; the outcome is read back from
 * `GET /api/story-plan/<slug>`.
 *
 * | refusal | when |
 * |---|---|
 * | cross-origin | the request comes from another origin |
 * | `unattended` | the board runs with `PLOT_UNATTENDED=1` |
 * | `unknown-story` | the slug is malformed, names no story on `origin/<default>`, or names a done or archived one |
 * | `no-idea-command` | no `Idea command` is configured |
 * | `stories-unread` | the default branch's stories could not be read |
 * | `already-running` | an earlier *Add plan* for this story still runs |
 *
 * Nothing from the body reaches `sh -c`: the brief is a file, and its path
 * travels in the environment.
 */
export const handleStoryPlan = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: StoryPlanOptions,
  deps: StoryPlanDeps = {},
): Promise<void> => {
  const readCfg = deps.config ?? readConfig;
  const readStory = deps.story ?? readCommittedStory;
  const makeTree = deps.tree ?? prepareIdeaTree;
  const unattended = deps.unattended ?? (() => process.env.PLOT_UNATTENDED === '1');
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: StoryPlanRefusal, slug: string, detail: string) =>
    json(status, { ok: false, slug, reason, detail });

  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const raw = (body as { slug?: unknown })?.slug;
  const slug = typeof raw === 'string' ? raw : '';

  if (unattended()) {
    refuse(409, 'unattended', slug, 'this board runs unattended — a plan inside a story is a person\'s request; nothing was created');
    return;
  }
  // The slug becomes a path component and a line in the brief, so its shape is checked before either.
  if (!STORY_SLUG_RE.test(slug)) {
    refuse(400, 'unknown-story', slug, 'slug must be a story slug: lowercase letters, digits and hyphens');
    return;
  }
  if (!usableCommand(readCfg(opts, IDEA_COMMAND_KEY, ''))) {
    refuse(409, 'no-idea-command', slug, `no \`${IDEA_COMMAND_KEY}\` in Plot Config — creating a plan runs the /plot-idea SKILL; add the key or run /plot-idea yourself`);
    return;
  }

  // A second run would truncate the first one's log and remove its worktree under it.
  if (storyPlanStatus(opts, slug).state === 'running') {
    refuse(409, 'already-running', slug, `a plan for \`${slug}\` is still being created — see its log; nothing was started`);
    return;
  }

  const story = await readStory(opts, slug);
  if (story === 'unread') {
    refuse(502, 'stories-unread', slug, 'the default branch\'s stories could not be read, so whether this story exists is unknown — nothing was created');
    return;
  }
  const status = story === null ? null : StoryStatusSchema.safeParse(story.status.trim());
  if (story === null || status === null || !storyIsLive({ status: status.success ? status.data : null, archived: story.archived })) {
    refuse(409, 'unknown-story', slug, `no live story \`${slug}\` on the default branch — a done or archived story takes no new plan; nothing was created`);
    return;
  }

  const promptPath = storyPlanPromptPath(opts.repoRoot, slug);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, composeStoryPlanPrompt(story), 'utf8');
  } catch (err) {
    json(500, { error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  const log = storyPlanLogPath(opts.repoRoot, slug);
  const statePath = storyPlanStatePath(opts.repoRoot, slug);
  try {
    // Truncated, not appended: this log is read back AS the answer.
    fs.rmSync(statePath, { force: true });
    fs.writeFileSync(log, '', 'utf8');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  let tree: string;
  try {
    tree = makeTree(opts, `plot-idea-story-${slug}`);
  } catch (err) {
    // A refusal, never a run in the board's own checkout.
    json(500, { error: `cannot make a worktree for the idea: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  try {
    markBoardRun(statePath, log);
  } catch (err) {
    json(500, { error: `cannot write ${statePath}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  await startBoardRun(opts, {
    role: 'idea',
    fragmentKey: IDEA_COMMAND_KEY,
    readCfg,
    tree,
    prompt: `Read ${promptPath} and follow it.`,
    env: {
      PLOT_UNATTENDED: '1',
      [IDEA_PROMPT_ENV]: promptPath,
    },
    logFile: log,
    statePath,
  });
  json(202, { ok: true, slug, prompt: promptPath, log });
};
