import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath } from './agent-log.js';
import { spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { readPhase } from './transition.js';
import {
  IDEA_COMMAND_KEY,
  ideaAvailability,
  lastLines,
  usableCommand,
  type IdeaState,
} from './idea.js';

/**
 * Commissioning a Draft plan into Design — the twin of `/api/idea`, and the
 * board's FIFTH state-changing route.
 *
 * **It is `/api/idea` turned inward.** `/api/idea` takes a tracker signal that
 * is *not yet a plan* and makes a Draft from it; this takes a plan that *is
 * already a Draft* and moves it into **Design**, the phase where a Draft's spec
 * gets written. So where idea is ISSUE-scoped — the whole request is a number
 * the host resolves — this is SLUG-scoped: the request names an existing plan
 * file, exactly as `/api/transition` does, because commissioning design is a
 * decision ABOUT a Draft the way Approve is.
 *
 * **What the agent produces is a plan in Design with an EMPTY spec section, and
 * that emptiness is the whole design rather than a detail.** The prompt does
 * not draft the spec, and it deliberately does not choose between spec, spike
 * and tracer-bullet — that distinction is a judgement the plan makes with the
 * problem in front of it, not one this route can make from a slug. Building
 * three prompt variants here would be answering a question the operator has not
 * been asked, the same failure `idea.ts` avoids by stopping at Draft.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED — `isSameOrigin`, the bounded body reader and
 * `SLUG_RE` from `dispatch.ts`, availability and the command sentinel from
 * `idea.ts` — for the reason every write route states: a second copy of a
 * security decision is a second place for it to be weakened. This spawns a
 * process on the machine the board runs on, so it is deliberately the same
 * shape as the four beside it and not a fifth one.
 */

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, and a WRAPPER over `ideaAvailability` rather than an alias.
 *
 * Commissioning shares the idea BINDING — the same "spawn a plot agent on this
 * disk" authority, unavailable off localhost for the same reason — so the two
 * answer the same question today. But the repo's rule is one capability, one
 * flag: `idea.ts`'s `ideaAvailability` records that a single flag answering
 * several capabilities is precisely how they diverge without anyone noticing.
 * So this is its own named export that DELEGATES, not a re-export that loses
 * the name — the day commissioning needs a different precondition than idea,
 * there is already a seam to put it in.
 */
export function commissionAvailability(host: string): { available: boolean; reason: string } {
  return ideaAvailability(host);
}

/**
 * Where the commission prompt is written inside the repo, and why it is a FILE.
 *
 * The same safety property `idea.ts` documents: `Idea command` is a shell
 * FRAGMENT run through `sh -c`, so anything interpolated into it is shell
 * source. The prompt travels as a file and its PATH travels in the environment,
 * so no part of the plan text ever becomes a shell word. Keyed by slug so two
 * clicks on two rows cannot overwrite each other's prompt, and so the file left
 * behind says which plan it was for.
 */
  // OUTSIDE THE REPO, beside the log and the state this command already keeps
  // there — see {@link agentLogDir} for the measurement that put them there.
export function commissionPromptPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'commission', slug, 'prompt');
}

/** Where the command's own words go — the neighbourhood `idea` established. */
export function commissionLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'commission', slug, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function commissionStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'commission', slug, 'state');
}

/** Why commissioning a plan was refused — each sends the reader somewhere different. */
export type CommissionRefusal =
  /** No `Idea command` is configured, so no agent can be started. */
  | 'no-idea-command'
  /** The plan could not be found or its phase could not be read. */
  | 'plan-unreadable'
  /** The plan is past Draft — commissioning design is a decision about a Draft. */
  | 'not-a-draft';

export interface CommissionOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * The plan file a slug names, resolved the way `plot-approve.sh` resolves it.
 *
 * A PRIVATE copy of `transition.ts`'s `resolvePlanBySlug` rather than an import,
 * because that module does not export it — and this route needs the same two
 * candidates in the same order (the active index first, then the date-prefixed
 * file in the plan directory) so that the phase it reads back belongs to the
 * file the commissioned agent will act on. Reaching across to export it there
 * would edit a module another worker owns; a four-line copy that agrees by
 * construction is the smaller change, and the unit test pins the phase it reads.
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
 * The prompt handed to the agent: read the Draft, and rewrite it into Design
 * with an empty spec section.
 *
 * Three instructions ride with it, and each answers a property this route rests
 * on:
 *
 * 1. **Design, recorded where the parser reads it.** `- **Phase:** Design` in
 *    the `## Status` block is the exact field `plot-plan-meta.sh` normalises to
 *    `design` (a phase of its own since #259, not a synonym for anything). A
 *    plan that said "Design" in prose but kept `Phase: Draft` would read back as
 *    Draft, and the whole point of the row — that it MOVED — would be a lie.
 *
 * 2. **An empty spec section, and the distinction LEFT TO THE PLAN.** The prompt
 *    asks for the heading and a placeholder, not a drafted spec, and states in
 *    as many words that whether this becomes a spec, a spike or a tracer bullet
 *    is the plan's call. This route does not enumerate three variants to build,
 *    because choosing among them is the judgement Design exists to make.
 *
 * 3. **Unattended, and nothing to any tracker.** The same one-directional rule
 *    the whole of Plot follows: a plan references a tracker, a tracker is never
 *    written back.
 */
export function composeCommissionPrompt(input: { slug: string; planFile: string }): string {
  const { slug, planFile } = input;
  const parts: string[] = [];

  parts.push(
    `/plot commission ${slug}: move this Draft into Design`,
    '',
    `Read the existing Draft plan at ${planFile}. It is a Draft that someone`,
    'decided is worth specifying, and your job is to move it into **Design** —',
    'the phase where the spec is written — without writing the spec itself.',
    '',
  );

  parts.push(
    '## What this plan must do',
    '',
    // The load-bearing instruction. `- **Phase:** Design` is the field the
    // parser reads; see the header.
    "1. Record the phase as **Design** in the plan's `## Status` block, exactly",
    '   as `- **Phase:** Design`. That is the field the board reads to know the',
    '   plan has moved; any other wording leaves it reading as Draft.',
    '2. Add an **empty spec section** — a heading and a placeholder saying the',
    '   spec is to be filled in during Design. Do NOT draft the spec now, and do',
    '   NOT decide whether this plan wants a full spec, a spike or a tracer',
    '   bullet: that distinction is the plan\'s to make with the problem in front',
    '   of it, not one to settle here. Leave the section empty and let Design',
    '   fill it.',
    '3. Do the work unattended, and write nothing to any tracker — no comment, no',
    '   label, no state change. The plan references the tracker; the tracker is',
    '   never written back.',
    '',
  );

  parts.push(
    '## The empty spec section, for shape',
    '',
    'The section should look like this — a heading and a placeholder, nothing more:',
    '',
    '```markdown',
    '## Spec',
    '',
    '_To be filled in during Design._',
    '```',
    '',
  );

  return parts.join('\n');
}

/**
 * What the board may say about a plan it asked to be commissioned — the same
 * four states `IdeaState` carries, for the same reason, so the type is reused
 * rather than re-declared.
 */
export interface CommissionStatus {
  state: IdeaState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function commissionStatus(opts: BuildBoardOptions, slug: string): CommissionStatus {
  const log = commissionLogPath(opts.repoRoot, slug);
  const statePath = commissionStatePath(opts.repoRoot, slug);
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
    message: lastLines(text) || `the commission command exited ${recorded}`,
    log,
  };
}

/**
 * The one fact this route reads from outside itself, injectable for test.
 *
 * `phase` is how a slug's current phase is read back; it defaults to
 * `readPhase` from `transition.ts`, the one parser that owns the plan format.
 * Injecting it lets the tests assert the refusals — not-a-draft, plan-unreadable
 * — without standing up a real plan estate and a real `/plot-idea` run.
 */
export interface CommissionDeps {
  /** The configured `Idea command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The plan's current phase, or null when it cannot be read. */
  phase?: (opts: BuildBoardOptions, slug: string) => string | null;
}

/**
 * Handle `POST /api/commission` — refuse, or write the prompt and spawn the
 * agent that moves a Draft into Design.
 *
 * Detached and answered 202 immediately, for the reason `/api/idea` documents:
 * this server is single-threaded, and awaiting an agent would freeze every
 * viewer's board. The outcome is read back from the status route, and the ROW
 * MOVING to Design on the next refresh is the real confirmation.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | `no-idea-command` | no script can do a plot agent's job; accepting the click and doing nothing is the silent failure |
 * | `plan-unreadable` | a plan whose phase cannot be read cannot be commissioned; guessing would spawn an agent against an unknown plan |
 * | `not-a-draft` | commissioning design is a decision about a DRAFT, exactly as Approve is; a plan past Draft is answered differently |
 */
export async function handleCommission(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: CommissionOptions,
  deps: CommissionDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const readPh = deps.phase ?? readPhase;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: CommissionRefusal, slug: string, detail: string) =>
    json(status, { ok: false, slug, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // that used to sit above it is enforced in the router for every write route at
  // once — see `write-gate.ts`. `commissionAvailability` still answers this
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
      `no \`${IDEA_COMMAND_KEY}\` in Plot Config — commissioning a plan runs a plot agent, which no script can do; add the key or run it yourself`,
    );
    return;
  }

  // THE PLAN MUST BE A DRAFT. Its phase is read from the file through the one
  // parser that owns the format — never inferred — because commissioning is a
  // decision about a Draft the way Approve is. A null phase means the plan could
  // not be found or read, which is refused rather than guessed at: spawning an
  // agent against a plan whose state is unknown is the write nobody asked for.
  const phase = readPh(opts, slug);
  if (phase === null) {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be found or its phase could not be read — refusing rather than commissioning a plan whose state is unknown`,
    );
    return;
  }
  if (phase !== 'draft') {
    refuse(
      409,
      'not-a-draft',
      slug,
      `plan \`${slug}\` is ${phase}, not draft — commissioning design is a decision about a Draft plan, and this one has moved past it`,
    );
    return;
  }

  const planFile = resolvePlanBySlug(opts, slug);
  // `readPh` reported a phase, so the plan resolved a moment ago; a null here
  // means it vanished between the two reads. Refuse rather than compose a prompt
  // that names no file.
  if (!planFile) {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be resolved to a file — refusing rather than commissioning a plan that is not there`,
    );
    return;
  }

  const prompt = composeCommissionPrompt({ slug, planFile });

  const promptPath = commissionPromptPath(opts.repoRoot, slug);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = commissionLogPath(opts.repoRoot, slug);
  const statePath = commissionStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    // The same choice `idea.ts` makes, for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Idea command` is a shell FRAGMENT, the same
  // interpretation `idea.ts` gives it. NOTHING from the request is interpolated
  // into that string: the prompt reached the repo as a file, and its PATH
  // travels in the environment and as ONE argument via `"$@"`. The slug is
  // SLUG_RE-bounded, so even it carries nothing a shell would interpret.
  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-commission', `Read ${promptPath} and follow it.`],
    {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch — the same one `idea.ts` sets. There is
        // nobody at this board to answer `AskUserQuestion`, so a skill that
        // improvises here exits 0 having written nothing; setting it makes each
        // skipped question name itself in the log.
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
    console.error('commission failed to spawn:', err);
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
  // every commission read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, slug, prompt: promptPath, log });
}
