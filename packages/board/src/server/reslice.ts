import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath } from './agent-log.js';
import { spawn } from 'node:child_process';
import { readConfig, scriptsFor, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { PlanMetaSchema } from '../contract/schema.js';
import {
  IDEA_COMMAND_KEY,
  ideaAvailability,
  lastLines,
  usableCommand,
  type IdeaState,
} from './idea.js';

/**
 * Reslicing a plan whose slice holds several branches — the board's SIXTH
 * state-changing route, and the third that spawns a plot agent to make a
 * judgement the board cannot make itself.
 *
 * **It is the sibling of `/api/commission`, not a new mechanism.** Commission
 * takes a Draft plan and moves it into Design; this takes a plan whose
 * `## Branches` holds a slice of several branches and asks `/plot-reslice` to cut
 * it into one slice per branch. Both are SLUG-scoped — the request names an
 * existing plan file, and the plan's text comes from disk, never from the
 * caller — and both refuse to act until a cheap, mechanical precondition holds.
 *
 * **What the agent produces is a sliced plan, and the board writes NONE of it.**
 * `/plot-reslice` reads the branches' diffs and PRs, proposes one named slice per
 * branch in an argued order, and — this is the whole reason it is an agent and
 * not a script — ASKS a person before rewriting the plan's `## Branches`. The
 * order is judgement: a wrong order blocks work that could have run, a missing
 * dependency lets two agents collide. This is the standing rule for board
 * writes: reuse the agent-spawn shape for a judgement act rather than inventing
 * a lifecycle transition. See `board-writes-wrap-scripts-or-are-licensed-repairs`.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED — `isSameOrigin`, the bounded body reader and
 * `SLUG_RE` from `dispatch.ts`, availability and the command sentinel from
 * `idea.ts` — for the reason every write route states: a second copy of a
 * security decision is a second place for it to be weakened. This spawns a
 * process on the machine the board runs on, so it is deliberately the same
 * shape as the five beside it and not a sixth one.
 */

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, and a WRAPPER over `ideaAvailability` rather than an alias.
 *
 * Reslicing shares the idea BINDING — the same "spawn a plot agent on this disk"
 * authority, unavailable off localhost for the same reason — so the two answer
 * the same question today. But the repo's rule is one capability, one flag:
 * `idea.ts`'s `ideaAvailability` records that a single flag answering several
 * capabilities is precisely how they diverge without anyone noticing. So this is
 * its own named export that DELEGATES, not a re-export that loses the name — the
 * day reslicing needs a different precondition than idea, there is already a
 * seam to put it in.
 */
export function resliceAvailability(host: string): { available: boolean; reason: string } {
  return ideaAvailability(host);
}

/**
 * Where the reslice prompt is written inside the repo, and why it is a FILE.
 *
 * The same safety property `idea.ts` and `commission.ts` document: `Idea
 * command` is a shell FRAGMENT run through `sh -c`, so anything interpolated
 * into it is shell source. The prompt travels as a file and its PATH travels in
 * the environment, so no part of the plan text ever becomes a shell word. Keyed
 * by slug so two clicks on two rows cannot overwrite each other's prompt, and so
 * the file left behind says which plan it was for.
 */
  // OUTSIDE THE REPO, beside the log and the state this command already keeps
  // there. `pnpm board` runs under `node --watch`, which watches the whole tree
  // and does not read .gitignore — so a prompt written INSIDE the repo restarts
  // the very server that just spawned the agent, and the restart can take the
  // agent with it.
  //
  // Measured 2026-08-25 walking the v2.9.0 endgame: clicking *Create plan* on
  // issue #333 wrote `.plot/idea-issue-333.md`, the board log recorded
  // `Restarting 'board-server.mjs'` in the same second, and the agent's log sat
  // at 0 bytes. It recovered on a later attempt, which is worse than a clean
  // failure: the defect is a race, so it disappears when looked at.
  //
  // All four spawning commands had the same split — prompt inside, log and
  // state outside. The log's placement was already right; the prompt simply
  // never followed it.
export function reslicePromptPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'reslice', slug, 'prompt');
}

/** Where the command's own words go — the neighbourhood `idea` established. */
export function resliceLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'reslice', slug, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function resliceStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'reslice', slug, 'state');
}

/** Why reslicing a plan was refused — each sends the reader somewhere different. */
export type ResliceRefusal =
  /** No `Idea command` is configured, so no agent can be started. */
  | 'no-idea-command'
  /** The plan could not be found or its slices could not be read. */
  | 'plan-unreadable'
  /**
   * The plan has no slice holding more than one branch, so there is nothing to
   * slice. A `complete` slice whose branches have all merged is history and does
   * not count — the board's `unsliced-wave` detector already suppresses it, and
   * the row that offers this control is only shown where a live multi-branch
   * slice exists.
   */
  | 'nothing-to-slice';

export interface ResliceOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * The plan file a slug names, resolved the way `plot-approve.sh` resolves it.
 *
 * A PRIVATE copy of `transition.ts`'s `resolvePlanBySlug` rather than an import,
 * for the reason `commission.ts` states about its own copy: that module does not
 * export it, and this route needs the same two candidates in the same order (the
 * active index first, then the date-prefixed file in the plan directory) so that
 * the slices it reads back belong to the file the resliced agent will act on.
 * Reaching across to export it there would edit a module another worker owns; a
 * four-line copy that agrees by construction is the smaller change.
 */
function resolvePlanBySlug(opts: BuildBoardOptions, slug: string): string | null {
  const repoRoot = opts.repoRoot;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const activeDir = readConfig(opts, 'Active index', 'docs/plans/active/');

  const active = path.join(repoRoot, activeDir, `${slug}.md`);
  if (fs.existsSync(active)) return active;

  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(repoRoot, planDir));
  } catch {
    return null;
  }
  const hit = entries.find((e) => e.endsWith(`${slug}.md`));
  return hit ? path.join(repoRoot, planDir, hit) : null;
}

/**
 * How many branches the plan's largest slice holds, counting only branches that
 * are NOT deferred — or null when the plan cannot be found or parsed.
 *
 * **This is the precondition the route rests on, and it is deliberately the same
 * arithmetic `stuck.ts`'s `unsliced-wave` arm applies** — a slice with more than
 * one live branch is the shape the model forbids and the row offers to repair.
 * A deferred branch is a branch set down on purpose, so it does not count toward
 * the tangle: a slice with one live branch and one deferred one is already the
 * one-branch slice the model wants.
 *
 * Read through `plot-plan-meta.sh`, the one parser that owns the plan format —
 * never inferred — for the same reason `readPhase` reads the phase through it.
 * `PlanMetaSchema` is imported as a READER: this module never writes the
 * contract, it only asks the contract what it says.
 *
 * Null on any failure, and the caller then REFUSES rather than proceeding: a
 * plan whose slices cannot be read is a plan whose shape is unknown, and spawning
 * an agent to reslice an unknown shape is the write nobody asked for.
 */
export function maxLiveSliceWidth(opts: BuildBoardOptions, slug: string): number | null {
  const file = resolvePlanBySlug(opts, slug);
  if (!file) return null;
  try {
    const answer = scriptsFor(opts).planMetaSync([file], { maxBuffer: 8 * 1024 * 1024 });
    if (!answer.ok) return null;
    const line = answer.value.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return null;
    const meta = PlanMetaSchema.parse(JSON.parse(line));
    let widest = 0;
    for (const wave of meta.slices) {
      const live = wave.branches.filter((b) => !b.deferred).length;
      if (live > widest) widest = live;
    }
    return widest;
  } catch {
    return null;
  }
}

/**
 * The prompt handed to the agent: read the plan's tangled slice, and slice it
 * into one slice per branch — asking before it writes.
 *
 * Three instructions ride with it, and each answers a property this route rests
 * on:
 *
 * 1. **Slice, and ask before writing.** The order is judgement a person owns;
 *    the prompt names the confirm as a requirement, not a nicety, and states
 *    that unattended the command must STOP rather than guess an order.
 *
 * 2. **Rewrite ONLY `## Branches`.** The branch names are already in the file
 *    and have PRs pointing at them — a rename breaks every claim ref — so only
 *    the `### ` headings above them change, and the rest of the file stays
 *    byte-identical. A `complete` slice whose work has landed is left untouched.
 *
 * 3. **Slice, never build.** The repair produces a sliced plan; it merges
 *    nothing and dispatches nothing. Whether anyone then builds the branches is
 *    a separate question with a separate answer.
 *
 * The plan is passed by PATH so the agent opens the real file, and the slug is
 * passed to `/plot-reslice` as its `$ARGUMENTS` so it acts on this plan.
 */
export function composeReslicePrompt(input: { slug: string; planFile: string }): string {
  const { slug, planFile } = input;
  const parts: string[] = [];

  parts.push(
    `/plot-reslice ${slug}`,
    '',
    `Read the plan at ${planFile}. One of its slice-section slices — a \`### \``,
    'heading — carries several branch lines, which the model forbids: a slice is',
    'the unit of ordering and a branch the unit of work, and the two are',
    'one-to-one. Your job is to cut that slice into one slice per branch.',
    '',
  );

  parts.push(
    '## What this must do',
    '',
    '1. Read the entangled branches themselves — their diffs, their PRs, their',
    '   conflicts — so the slice NAMES describe what each branch is about, not',
    '   just restate the branch name.',
    '2. Propose one slice per branch in a dependency order you ARGUE for, then',
    '   **ask a person to confirm the order before writing anything**. The order',
    '   is the judgement this command exists for: a wrong order blocks work that',
    '   could have run, and a missing dependency lets two agents collide. If you',
    '   are running unattended, STOP and record the question — do not guess an',
    '   order.',
    '3. Rewrite ONLY the plan file\'s slice section — whichever of `## Slices`,',
    '   `## Waves` or `## Branches` the file itself uses; the three are one',
    '   section under different spellings and a plan carries exactly one of them.',
    '   Change only the',
    '   `### ` headings above the branch lines; leave the branch lines',
    '   byte-identical (they have PRs and claim refs pointing at their names, and',
    '   a rename breaks both), and leave the rest of the file untouched.',
    '4. Do NOT reorder a slice whose work has already landed — a `complete`',
    '   slice is history, and its ordering already happened. Cut nothing there.',
    '5. Slice, never build. Merge nothing, dispatch nothing: the repair produces',
    '   a sliced plan, and `/plot-dispatch` then does what it always does.',
    '',
  );

  return parts.join('\n');
}

/**
 * What the board may say about a plan it asked to be resliced — the same four
 * states `IdeaState` carries, for the same reason, so the type is reused rather
 * than re-declared.
 */
export interface ResliceStatus {
  state: IdeaState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function resliceStatus(opts: BuildBoardOptions, slug: string): ResliceStatus {
  const log = resliceLogPath(opts.repoRoot, slug);
  const statePath = resliceStatePath(opts.repoRoot, slug);
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
    message: lastLines(text) || `the reslice command exited ${recorded}`,
    log,
  };
}

/**
 * The one fact this route reads from outside itself, injectable for test.
 *
 * `width` is how a slug's widest live slice is read back; it defaults to
 * `maxLiveSliceWidth`. Injecting it lets the tests assert the refusals —
 * nothing-to-slice, plan-unreadable — without standing up a real plan estate
 * and a real `/plot-reslice` run.
 */
export interface ResliceDeps {
  /** The configured `Idea command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The plan's widest live slice, or null when it cannot be read. */
  width?: (opts: BuildBoardOptions, slug: string) => number | null;
}

/**
 * Handle `POST /api/reslice` — refuse, or write the prompt and spawn the agent
 * that slices a tangled slice into one slice per branch.
 *
 * Detached and answered 202 immediately, for the reason `/api/commission`
 * documents: this server is single-threaded, and awaiting an agent would freeze
 * every viewer's board. The outcome is read back from the status route; and
 * because `/plot-reslice` ASKS before it writes, a click here does not
 * necessarily move the row at all — success is the plan's `## Branches` growing
 * one slice per branch on the next refresh, which the board re-derives from git.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | `no-idea-command` | no script can do a plot agent's job; accepting the click and doing nothing is the silent failure |
 * | `plan-unreadable` | a plan whose slices cannot be read cannot be sliced; guessing would spawn an agent against an unknown plan |
 * | `nothing-to-slice` | reslicing is a repair for a slice of several live branches; a plan with none is answered differently |
 */
export async function handleReslice(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ResliceOptions,
  deps: ResliceDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const readWidth = deps.width ?? maxLiveSliceWidth;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: ResliceRefusal, slug: string, detail: string) =>
    json(status, { ok: false, slug, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // that used to sit above it is enforced in the router for every write route at
  // once — see `write-gate.ts`. `resliceAvailability` still answers this
  // control's capability flag, which is the question the BUTTON asks before it
  // is clicked.
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

  // THE SLUG IS THE WHOLE REQUEST. Nothing else a page supplies is read: the
  // plan is resolved from the slug and its text comes from the file on disk,
  // never from the caller. `SLUG_RE` bounds it to a plan slug — the same value
  // `plot-plan-meta.sh` will glob with — so a value that is not a slug is a
  // caller bug refused, not something to sanitize.
  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  // ASKED BEFORE ANYTHING IS READ OR WRITTEN. A repo with no runner cannot act
  // on this click at all, and finding that out after resolving a plan would
  // spend the read to reach the same refusal.
  const usable = usableCommand(readCfg(opts, IDEA_COMMAND_KEY, ''));
  if (!usable) {
    refuse(
      409,
      'no-idea-command',
      slug,
      `no \`${IDEA_COMMAND_KEY}\` in Plot Config — reslicing a plan runs the /plot-reslice SKILL, which no script can do; add the key or run /plot-reslice yourself`,
    );
    return;
  }

  // THE PLAN MUST HAVE A SLICE TO SLICE. Its slices are read from the file through
  // the one parser that owns the format — never inferred — because reslicing is
  // a repair for the exact shape `unsliced-wave` names, and offering it on a
  // plan with no tangled slice would spawn an agent to do nothing. A null width
  // means the plan could not be found or read, which is refused rather than
  // guessed at.
  const width = readWidth(opts, slug);
  if (width === null) {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be found or its slices could not be read — refusing rather than reslicing a plan whose shape is unknown`,
    );
    return;
  }
  if (width < 2) {
    refuse(
      409,
      'nothing-to-slice',
      slug,
      `plan \`${slug}\` has no slice holding more than one live branch — there is nothing to cut, and a slice whose work has landed is history the reslice must not touch`,
    );
    return;
  }

  const planFile = resolvePlanBySlug(opts, slug);
  // `readWidth` reported a width, so the plan resolved a moment ago; a null here
  // means it vanished between the two reads. Refuse rather than compose a prompt
  // that names no file.
  if (!planFile) {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be resolved to a file — refusing rather than reslicing a plan that is not there`,
    );
    return;
  }

  const prompt = composeReslicePrompt({ slug, planFile });

  const promptPath = reslicePromptPath(opts.repoRoot, slug);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = resliceLogPath(opts.repoRoot, slug);
  const statePath = resliceStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    // The same choice `commission.ts` makes, for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Idea command` is a shell FRAGMENT, the same
  // interpretation `commission.ts` gives it. NOTHING from the request is
  // interpolated into that string: the prompt reached the repo as a file, and
  // its PATH travels in the environment and as ONE argument via `"$@"`. The slug
  // is SLUG_RE-bounded, so even it carries nothing a shell would interpret.
  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-reslice', `Read ${promptPath} and follow it.`],
    {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch — the same one `commission.ts` sets.
        // /plot-reslice unattended must STOP at the order it cannot choose
        // alone; setting this makes that skipped question name itself in the log
        // rather than the agent improvising a slice.
        PLOT_UNATTENDED: '1',
        // Reuses `PLOT_IDEA_PROMPT` because this IS the idea binding — the same
        // runner reads the same variable to find its prompt file.
        PLOT_IDEA_PROMPT: promptPath,
        PLOT_PLAN_SLUG: slug,
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
    console.error('reslice failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // `detached` WITHOUT `unref`, exactly as `commission.ts` is and for its
  // reason: detached keeps a Ctrl-C in the board's terminal off the agent, and
  // keeping the handle keeps the exit listener above alive — dropping it would
  // make every reslice read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, slug, prompt: promptPath, log });
}
