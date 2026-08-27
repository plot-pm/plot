import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { usableCommand, readIssue, lastLines, BODY_MAX, type IssueDetail } from './idea.js';

/**
 * Turning a ticket into a story — the issue row's SECOND action, and the twin
 * of `/api/idea` rather than a new mechanism.
 *
 * **The refusal this replaces claimed impossibility, and the skill contradicts
 * it.** `storyRefusal` said a story *"is a decision you make — where it lives,
 * whether it is wanted yet — so it is created with /story-tracking at a
 * terminal, not from a board click"*, and named that as permanent rather than
 * as an oversight. Measured against `skills/story-tracking/SKILL.md` on
 * 2026-08-20, neither named decision is what the refusal says it is:
 *
 * - **Where it lives** — the skill states its own escape: *"Skip the question
 *   only when the repo has exactly one home"*. This repo has one.
 * - **Whether it is wanted yet** — triage, with the skill's own override:
 *   *"if the user explicitly wants a story the triage advises against, push
 *   back once with the reasoning, then create it"*. **A click on *Create story*
 *   IS that explicit request.**
 *
 * And the practice refutes the premise the refusal rests on. `/story-tracking`
 * is run unattended several times a day from the prompt; a skill run unattended
 * many times a day cannot be categorically unrunnable unattended. Plot has a
 * contract for exactly this case — `PLOT_UNATTENDED` and the `PLOT-UNASKED`
 * line every skill declares — which is why `/api/idea` works.
 *
 * So the refusal becomes CONDITIONAL: a repo that has not set `Story command`
 * is refused and told which key to add, and a repo with more than one declared
 * home is refused and told which question went unanswered. What is gone is the
 * claim that no such route could exist.
 *
 * **Nothing is written to the tracker. Ever.** The same one-directional rule
 * `idea.ts` states: Plot reads the tracker and never writes to it. This module
 * uses exactly one host op, `issue-view`, and it reads.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED — the same-origin check from `dispatch.ts`, the
 * loopback boundary from the router's `WRITE_ROUTES` table, `usableCommand`
 * and `readIssue` from `idea.ts` itself. This is the same class of endpoint as
 * the nine that precede it (it spawns a process on the machine the board runs
 * on), so it is deliberately the same shape and not a tenth one.
 *
 * **It does NOT take `idea.ts`'s worktree.** `/plot-idea` checks out the branch
 * it creates, which is why that route stands somewhere else to keep the board's
 * own checkout still. `/story-tracking` writes a directory of markdown on the
 * current branch and moves HEAD nowhere, so `cwd: opts.repoRoot` is correct
 * here for the reason approve, deliver and reslice keep it.
 */

/**
 * How the board runs `/story-tracking`. The TENTH agent-runner key, and a
 * member of an existing family rather than a new mechanism.
 *
 * REQUIRED, exactly as `Idea command` is and for its reason: creating a story
 * runs a SKILL, and no script in this repo invokes one, because bash cannot
 * reach one at all. Every step of `/story-tracking` is judgement — the triage,
 * the slug, the home, the owning unit, what belongs in the objective.
 *
 * So an absent key is a REFUSAL THAT NAMES ITSELF, never a silent no-op. That
 * refusal is the ordinary case for an adopting project and stays fully tested,
 * even though this repo now sets the key.
 */
export const STORY_COMMAND_KEY = 'Story command';

/**
 * Where the story homes are DECLARED — and the key this route counts, rather
 * than the filesystem.
 *
 * **This is the trap the design exists to avoid, and it was measured.**
 * `Quatico.Webseite/quaweb-website` has exactly one story home, `docs/stories/`
 * holding five stories. But it also contains:
 *
 *     packages/website/content/de/stories/                      ← website content
 *     packages/website/content/en/stories/                      ← website content
 *     packages/website/images__deprecated/…/success-stories/…   ← image assets
 *
 * A `git ls-files | grep stories/` counts FOUR homes where there is one, and
 * the button would refuse *"more than one home"* in a repo that has no
 * ambiguity at all. Those are customer stories on a website and image assets —
 * paths that happen to contain a word.
 *
 * Manifesto Principle 5 applied: Plot discovers what a repo DECLARES, and never
 * infers structure from names it did not choose. A repo declaring several homes
 * declares them here; a repo that merely contains the word does not.
 */
export const STORY_DIRECTORY_KEY = 'Story directory';

/** The default the skill itself names, so an unset key still resolves a home. */
export const STORY_DIRECTORY_DEFAULT = 'docs/stories/';

/**
 * Where the story brief is written, and why it is a FILE.
 *
 * **This is a safety property, not a convenience** — `idea.ts` states it for
 * its twin and it is the same boundary. `Story command` is a shell FRAGMENT run
 * through `sh -c`, so anything interpolated into it is shell source. An issue
 * body is free text written by whoever can file an issue, which on a public
 * tracker is anyone at all; a single `"; rm -rf ~` in it would execute. Writing
 * the brief to a file and naming that file in the ENVIRONMENT means no part of
 * an issue ever becomes a shell word, whatever it contains.
 *
 * OUTSIDE THE REPO, beside the log and the state — the placement `idea.ts`
 * measured into existence. `pnpm board` runs under `node --watch`, which
 * watches the whole tree and does not read .gitignore, so a prompt written
 * INSIDE the repo restarts the very server that just spawned the agent.
 *
 * Keyed by issue number so two clicks on two rows cannot overwrite each other's
 * brief, and so the file left behind says which issue it was for.
 */
export function storyPromptPath(repoRoot: string, number: number): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-story-issue-${number}.prompt.md`);
}

/** The environment variable naming that file, beside `PLOT_IDEA_PROMPT`. */
export const STORY_PROMPT_ENV = 'PLOT_STORY_PROMPT';

/** Where the command's own words go — the neighbourhood `idea` established. */
export function storyLogPath(repoRoot: string, number: number): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-story-issue-${number}.log`);
}

/** Where the outcome is recorded, so a later GET can read it back. */
function storyStatePath(repoRoot: string, number: number): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-story-issue-${number}.state`);
}

/** Why creating a story was refused — each sends the reader somewhere different. */
export type StoryRefusal =
  /** No `Story command` is configured, so no agent can be started. */
  | 'no-story-command'
  /** Several homes are DECLARED, and which one is a question nobody answered. */
  | 'several-story-homes'
  /** This host has no issue read at all (Bitbucket) — see `plot-host.sh` exit 4. */
  | 'tracker-unsupported'
  /** The issue could not be read. NOT the same as "it has no body". */
  | 'issue-unreadable';

export interface StoryOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, for the reason `dispatchAvailability` exists.
 *
 * Its own function rather than a re-export of `ideaAvailability`, which is the
 * lesson `approve.ts` records and every flag since has kept: today all ten
 * capabilities answer the same binding question, and one flag for several
 * capabilities is precisely how they diverge without anyone noticing.
 *
 * Over a non-localhost binding this is unavailable, and that is CORRECT rather
 * than a gap: creating a story spawns an agent that writes to this disk, and a
 * Tailscale address is deliberately not localhost. The phone that reads the
 * board does not write stories from it.
 */
export function storyAvailability(host: string): { available: boolean; reason: string } {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — turning a ticket into a story is available only on the machine that owns the repo`,
  };
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function storyCommand(opts: BuildBoardOptions): string {
  return usableCommand(readConfig(opts, STORY_COMMAND_KEY, ''));
}

/**
 * The story homes this repo DECLARES, in the order it declares them.
 *
 * A pure function of the configured string so the route and the test agree by
 * construction rather than by both remembering the separator — the shape
 * `usableCommand` established for its sentinel.
 *
 * **It reads a declaration and counts it. It never looks at a disk.** See
 * {@link STORY_DIRECTORY_KEY} for the measured repo where a filesystem search
 * finds four homes and the declaration says one. A key naming several homes
 * separates them with a comma or with whitespace, which are the two separators
 * a `## Plot Config` value can carry without quoting.
 *
 * An empty or unset key is ONE home, the skill's own default — not zero. A repo
 * that has said nothing about where stories live has not thereby declared an
 * ambiguity, and refusing it would be this route inventing a question the repo
 * never posed.
 */
export function declaredStoryHomes(configured: string): string[] {
  const homes = (configured || '')
    .split(/[,\s]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  return homes.length ? homes : [STORY_DIRECTORY_DEFAULT];
}

/**
 * The brief handed to `/story-tracking`: the ticket as the story's subject,
 * plus the facts an unattended run would otherwise have to ask for.
 *
 * **The issue is QUOTED, never summarised** — the rule `composeIdeaPrompt`
 * states, for the same reason. A well-written ticket already is the brain dump
 * the skill wants, and a lossy copy between the operator's words and the story
 * is the same mistake as mirroring tracker state one layer up.
 *
 * **The home is STATED, never left to be derived.** The route has already
 * established that the repo declares exactly one — that is the precondition of
 * reaching here at all — so naming it is passing on a fact, not making a
 * choice. The skill's escape (*"Skip the question only when the repo has
 * exactly one home"*) is the same fact read from the same key.
 *
 * **THE BOARD OFFERS NO TRIAGE ADVICE OF ITS OWN** — the plan's closed Open
 * Point, and the reason it is closed is worth keeping next to the code. A
 * second opinion rendered here is a second place to keep the heuristic correct,
 * and it would drift from the skill's own triage. So the brief hands the skill
 * the fact it needs to apply ITS triage — that this is an explicit request —
 * and says nothing about whether a story is the right answer. `/api/idea`
 * already behaves this way, and the parallel is the whole design.
 *
 * The override wording is the skill's own, verbatim, so a story created from a
 * click is indistinguishable from one created at a terminal over triage advice
 * — which is exactly what it is.
 */
export function composeStoryPrompt(input: {
  issue: IssueDetail;
  home: string;
  truncated: boolean;
}): string {
  const { issue, home, truncated } = input;
  const parts: string[] = [];

  parts.push(
    `/story-tracking: create a story for issue #${issue.number}`,
    '',
    'This story comes from a tracker ticket somebody decided was worth tracking.',
    'The ticket below is the subject — read it as the input to your own triage,',
    'not as a specification to copy into the story.',
    '',
  );

  parts.push(
    '## What this run already knows',
    '',
    // ITEM 4's other half. The route refuses where several homes are declared,
    // so reaching this line means exactly one was — the skill's own escape,
    // read from the same key the skill reads.
    `1. **The home is \`${home}\`.** This repo declares exactly one story home in`,
    `   its \`## Plot Config\` \`${STORY_DIRECTORY_KEY}\` key, so the home question`,
    '   does not arise — the escape the skill names for exactly this case.',
    // THE OVERRIDE, in the skill's own words. See the header.
    '2. **This is an explicit request.** A person clicked *Create story* on this',
    '   ticket. Run your triage as you would at a terminal; where it advises',
    '   against, there is nobody here to push back to, so proceed and say so —',
    '   note "created on explicit request over triage advice" in the story.',
    '3. **Nobody is here to answer a question.** Where you would ask, take the',
    '   shape your own instructions give for an unattended run and name the',
    '   question you skipped with a `PLOT-UNASKED` line, so the log says what',
    '   went undecided rather than leaving it to be inferred from the result.',
    '',
    'Write nothing to the tracker: no comment, no label, no state change. The',
    "story's own reference to the ticket is the only link, and it points one way.",
    '',
  );

  parts.push(
    `## Issue #${issue.number}${issue.url ? ` — ${issue.url}` : ''}`,
    '',
    `**${issue.title}**`,
    '',
    issue.body.trim() || '_The issue has no body — its title is the whole of it._',
    '',
  );

  if (truncated) {
    parts.push(
      `_This issue's body was truncated at ${BODY_MAX} characters. Read the whole_`,
      '_issue on the tracker before deciding anything that turns on its detail._',
      '',
    );
  }

  return parts.join('\n');
}

/**
 * What the board may say about a story it asked for — the same four states
 * `IdeaState` carries, for the same reason.
 *
 * `unknown` is not a degraded `failed`: nothing has been attempted for that
 * issue, and painting a message on a row whose button was never pressed would
 * be the board asserting something it does not know.
 */
export type StoryState = 'unknown' | 'running' | 'done' | 'failed';

export interface StoryStatus {
  state: StoryState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function storyStatus(opts: BuildBoardOptions, number: number): StoryStatus {
  const log = storyLogPath(opts.repoRoot, number);
  const statePath = storyStatePath(opts.repoRoot, number);
  let recorded = '';
  try {
    recorded = fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    return fs.existsSync(log)
      ? { state: 'running', message: '', log }
      : { state: 'unknown', message: '', log };
  }
  if (recorded === '0') return { state: 'done', message: '', log };
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return {
    state: 'failed',
    message: lastLines(text) || `the story command exited ${recorded}`,
    log,
  };
}

/** The two facts this route reads from outside itself, injectable for test. */
export interface StoryDeps {
  /** The configured `Story command` and `Story directory`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The host's account of one issue. */
  issue?: (opts: BuildBoardOptions, number: number) => Promise<IssueDetail>;
}

/**
 * Handle `POST /api/story` — refuse, or write the brief and spawn
 * `/story-tracking` on it.
 *
 * Detached and answered 202 immediately, for the reason `/api/idea` documents:
 * this server is single-threaded, and awaiting an agent would freeze every
 * viewer's board for the length of somebody else's click. The outcome is read
 * back from `GET /api/story/<number>`.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | not localhost | it spawns an agent that writes to this disk |
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | `no-story-command` | no script can do `/story-tracking`'s job; accepting the click and doing nothing is the silent failure |
 * | `several-story-homes` | a missing story is recoverable; a story in the wrong home is referenced from elsewhere before anyone notices |
 * | `tracker-unsupported` | a host with no issue read cannot answer, and an action that cannot work must not be offered |
 * | `issue-unreadable` | an outage is not an answer — writing a story about a body nobody returned is the failure this repo keeps removing |
 *
 * **There is no `already-planned` twin, deliberately.** `/api/idea` refuses a
 * second plan for one signal because every plan carries an `Issue:` field the
 * board reads, so it can KNOW. A story carries no such field, so the equivalent
 * check would be a guess dressed as a precondition — and this route would then
 * refuse on something it cannot actually observe, which is the defect the whole
 * plan was written about.
 */
export async function handleStory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: StoryOptions,
  deps: StoryDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const readOne = deps.issue ?? readIssue;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: StoryRefusal, number: number, detail: string) =>
    json(status, { ok: false, number, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // is enforced in the router for every write route at once — see
  // `write-gate.ts`. `storyAvailability` still answers this control's
  // capability flag, which is the question the BUTTON asks before it is clicked.
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

  // THE NUMBER IS THE WHOLE REQUEST. The title, the body and the URL are read
  // from the host by this server — never taken from the caller — so no text a
  // page supplies can become the brief an agent acts on. The same rule
  // `handleIdea` follows, and the same boundary.
  const raw = (body as { number?: unknown })?.number;
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    json(400, { error: 'number must be a positive issue number' });
    return;
  }

  // ASKED BEFORE ANYTHING IS READ OR WRITTEN. A repo with no runner cannot act
  // on this click at all, and finding that out after fetching an issue would
  // spend a host call to reach the same refusal.
  const usable = usableCommand(readCfg(opts, STORY_COMMAND_KEY, ''));
  if (!usable) {
    refuse(
      409,
      'no-story-command',
      number,
      `no \`${STORY_COMMAND_KEY}\` in Plot Config — creating a story runs the /story-tracking SKILL, which no script can do; add the key or run /story-tracking yourself`,
    );
    return;
  }

  // WHICH HOME? — read from the DECLARATION, never from the filesystem. See
  // `STORY_DIRECTORY_KEY` for the measured repo where a search finds four homes
  // and the declaration says one.
  //
  // Several declared homes REFUSE rather than guess, and the asymmetry is the
  // reason: a missing story is recoverable — click again, or run the skill at a
  // terminal — while a story in the wrong home is referenced from elsewhere
  // before anyone notices. So the board names the question and leaves it to the
  // person who can answer it.
  const homes = declaredStoryHomes(readCfg(opts, STORY_DIRECTORY_KEY, STORY_DIRECTORY_DEFAULT));
  if (homes.length > 1) {
    refuse(
      409,
      'several-story-homes',
      number,
      `this repo declares ${homes.length} story homes (${homes.join(', ')}) — which one owns this outcome is a judgement about the work, so run /story-tracking yourself and name the home; nothing was created`,
    );
    return;
  }

  let issue: IssueDetail;
  try {
    issue = await readOne(opts, number);
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    const detail = err instanceof Error ? err.message : String(err);
    if (code === 4) {
      // The standing fact, not an outage: this host has no issue read at all.
      refuse(409, 'tracker-unsupported', number, detail ||
        'this host has no issue read, so a ticket cannot become a story from here');
      return;
    }
    refuse(502, 'issue-unreadable', number, detail ||
      `issue #${number} could not be read — an outage is not an answer, so nothing was created`);
    return;
  }

  const truncated = issue.body.length > BODY_MAX;
  const prompt = composeStoryPrompt({
    issue: truncated ? { ...issue, body: issue.body.slice(0, BODY_MAX) } : issue,
    home: homes[0],
    truncated,
  });

  const promptPath = storyPromptPath(opts.repoRoot, number);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = storyLogPath(opts.repoRoot, number);
  const statePath = storyStatePath(opts.repoRoot, number);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Story command` is a shell FRAGMENT, the same
  // interpretation `Idea command` and `Worker command` get. NOTHING from the
  // issue is interpolated into that string: the brief reached the disk as a
  // file, and its PATH travels in the environment. The prompt is passed as ONE
  // argument via `"$@"` — already the shape `idea.ts` uses, and here it carries
  // only a path this server itself composed.
  //
  // `cwd: opts.repoRoot`, and NOT a worktree of its own. `/api/idea` needs one
  // because `/plot-idea` checks out the branch it creates, so the board's own
  // checkout is the one that would move. `/story-tracking` writes a directory
  // of markdown and commits it on the branch already checked out; it moves HEAD
  // nowhere. This is the same choice approve, deliver and reslice make.
  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-story', `Read ${promptPath} and follow it.`],
    {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch. There is nobody at this board to
        // answer `AskUserQuestion`, and under `claude -p` that tool is not even
        // registered — so a skill that improvises here exits 0 having written
        // nothing. Setting it makes each skipped question take the shape its
        // author chose and name itself in the log. This is the contract that
        // makes the whole route possible: `/story-tracking` is run this way
        // several times a day from the prompt.
        PLOT_UNATTENDED: '1',
        [STORY_PROMPT_ENV]: promptPath,
        PLOT_ISSUE: String(number),
      },
    },
  );
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync(statePath, String(signal ? `signal ${signal}` : code ?? 1), 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  });
  child.on('error', (err) => {
    console.error('story failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // `detached` WITHOUT `unref`, exactly as `idea.ts` is and for its reason:
  // detached keeps a Ctrl-C in the board's terminal off the agent, and keeping
  // the handle keeps the exit listener above alive — dropping it would make
  // every creation read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, number, prompt: promptPath, log });
}
