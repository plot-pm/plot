import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath } from './agent-log.js';
import { execFileSync, spawn } from 'node:child_process';
import { readConfig, allWavesMerged, type BuildBoardOptions } from './board.js';
import { pulseFor, pulseCompleteFor } from './fleet.js';
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
 * Delivering a plan whose every wave has merged — the board's SEVENTH
 * state-changing route, and the fourth that spawns a plot agent to make a
 * commitment the board cannot make itself.
 *
 * **It is the sibling of `/api/reslice`, not a new mechanism.** Reslice takes a
 * plan with a tangled wave and asks `/plot-reslice` to slice it; this takes a
 * plan the board has already MEASURED complete — every non-deferred branch
 * merged — and asks `/plot-deliver` to make the DECISION to deliver it. Both are
 * SLUG-scoped, both refuse until a cheap mechanical precondition holds, and both
 * write none of the transition themselves.
 *
 * **Delivery is a DECISION, and this button is a person making it.** The domain
 * model is explicit (`docs/board-domain-model.md`): *every wave being complete
 * is a measurement; delivering is a decision. A measurement cannot make a
 * commitment.* The board bumps a fully-merged plan's card into Testing on its
 * own — that is the measurement — but flips no phase and writes no `Delivered:`
 * record. This route is the seam where the decision is made: it spawns
 * `/plot-deliver`, which verifies the merges once more and moves the plan. So
 * reaching Testing must never imply this was pressed, and this must never fire
 * automatically — which is why it is a click and not a consequence of the bump.
 *
 * **What the agent produces is a delivered plan, and the board writes NONE of
 * it.** `/plot-deliver` re-verifies every implementation PR is merged
 * (cross-repo aware), flips the phase to Delivered, fills the `Delivered:`
 * record and moves the plan's index symlink. This is the standing rule for board
 * writes: reuse the agent-spawn shape for a lifecycle act rather than inventing
 * the transition here. See `board-writes-wrap-scripts-or-are-licensed-repairs`.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED — `isSameOrigin`, the bounded body reader and
 * `SLUG_RE` from `dispatch.ts`, availability and the command sentinel from
 * `idea.ts` — for the reason every write route states: a second copy of a
 * security decision is a second place for it to be weakened. This spawns a
 * process on the machine the board runs on, so it is deliberately the same
 * shape as the six beside it and not a seventh one.
 */

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, and a WRAPPER over `ideaAvailability` rather than an alias.
 *
 * Delivering shares the idea BINDING — the same "spawn a plot agent on this
 * disk" authority, unavailable off localhost for the same reason — so the two
 * answer the same question today. But the repo's rule is one capability, one
 * flag: `approve.ts` records that a single flag answering several capabilities
 * is precisely how they diverge without anyone noticing. So this is its own
 * named export that DELEGATES, not a re-export that loses the name — the day
 * delivering needs a different precondition than idea, there is already a seam
 * to put it in.
 */
export function deliverAvailability(host: string): { available: boolean; reason: string } {
  return ideaAvailability(host);
}

/**
 * Where the deliver prompt is written inside the repo, and why it is a FILE.
 *
 * The same safety property `idea.ts` and `reslice.ts` document: `Idea command`
 * is a shell FRAGMENT run through `sh -c`, so anything interpolated into it is
 * shell source. The prompt travels as a file and its PATH travels in the
 * environment, so no part of the plan text ever becomes a shell word. Keyed by
 * slug so two clicks on two rows cannot overwrite each other's prompt, and so
 * the file left behind says which plan it was for.
 */
  // OUTSIDE THE REPO, beside the log and the state this command already keeps
  // there — see {@link agentLogDir} for the measurement that put them there.
export function deliverPromptPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'deliver', slug, 'prompt');
}

/** Where the command's own words go — the neighbourhood `idea` established. */
export function deliverLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'deliver', slug, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function deliverStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'deliver', slug, 'state');
}

/** Why delivering a plan was refused — each sends the reader somewhere different. */
export type DeliverRefusal =
  /** No `Idea command` is configured, so no agent can be started. */
  | 'no-deliver-command'
  /** The plan could not be found or its waves could not be read. */
  | 'plan-unreadable'
  /**
   * The plan has an open (not merged, not deferred) branch, or no landed work at
   * all — so it is not deliverable. #350 kept this gate: `/plot-deliver` refuses
   * a plan whose implementation is not done, and this route must not weaken it.
   */
  | 'not-deliverable'
  /**
   * The fleet scan has not finished, so the board cannot say whether this plan
   * has landed. SEPARATE FROM `not-deliverable`, and the separation is the whole
   * point: that one sends a reader to their unfinished branch, this one sends
   * them back in five seconds. Conflating them told an operator on 2026-08-27
   * that a plan whose two PRs had merged the day before had a branch that had
   * not — and they went looking for it.
   */
  | 'scan-incomplete'
  /**
   * The plan is already `delivered` (or past it). The row that offers this
   * control never shows on such a plan — the card carries `deliverable` only
   * where the board auto-bumped it, never on a plan whose decision was already
   * made — so reaching here means the board and the plan file disagree, and
   * saying so is the only useful answer.
   */
  | 'already-delivered';

export interface DeliverOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * The plan file a slug names, resolved the way `plot-approve.sh` resolves it.
 *
 * A PRIVATE copy of `transition.ts`'s `resolvePlanBySlug` rather than an import,
 * for the reason `reslice.ts` states about its own copy: that module does not
 * export it, and this route needs the same candidates in the same order (the
 * active index first, then the date-prefixed file in the plan directory, then
 * the delivered index — because a plan being delivered may already have moved)
 * so the waves it reads back belong to the file the delivering agent will act
 * on. Reaching across to export it there would edit a module another worker
 * owns; a short copy that agrees by construction is the smaller change.
 */
function resolvePlanBySlug(opts: BuildBoardOptions, slug: string): string | null {
  const repoRoot = opts.repoRoot;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const activeDir = readConfig(opts, 'Active index', 'docs/plans/active/');
  const deliveredDir = readConfig(opts, 'Delivered index', 'docs/plans/delivered/');

  const active = path.join(repoRoot, activeDir, `${slug}.md`);
  if (fs.existsSync(active)) return active;
  const delivered = path.join(repoRoot, deliveredDir, `${slug}.md`);
  if (fs.existsSync(delivered)) return delivered;

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
 * Whether a plan is deliverable, and if not, why — the precondition the route
 * rests on, and deliberately the same arithmetic `buildBoard` applies when it
 * auto-bumps a fully-merged plan's card into Testing.
 *
 * A discriminated verdict rather than a bare boolean, because the route owes
 * three different refusals to three different states, and the card that offers
 * the control is gated on the same distinction:
 *  - `not-found` — the slug resolves to no file, or its waves cannot be parsed.
 *  - `already-delivered` — the plan's own phase is `delivered` or past it; the
 *    decision was already made, and re-making it is not what the button does.
 *  - `not-merged` — a non-deferred branch has not merged, or the plan has no
 *    landed work at all. `allWavesMerged`'s own `merged > 0` guard folds the
 *    empty case in here: a plan nobody built is not deliverable.
 *  - `scan-incomplete` — the scan did not finish, so the pulse holds only the
 *    plans that arrived before it was cut short. A FIFTH verdict rather than a
 *    fifth reason for `not-merged`, because the two need opposite responses: one
 *    says go finish the branch, this one says wait and ask again. Folding it in
 *    is the defect measured 2026-08-27, when a plan whose two PRs had merged the
 *    day before was told a branch of its had not.
 *  - `deliverable` — Development phase, every non-deferred branch merged. The
 *    exact card `buildBoard` moves into Testing and marks `deliverable`.
 *
 * Read through `plot-plan-meta.sh`, the one parser that owns the plan format,
 * and against the SAME pulse the board renders from (`pulseFor`) — never
 * inferred, so this route and the card it gates agree by construction. Its own
 * pulse read rather than one threaded in, so a caller need not hold the cache;
 * `pulseFor` is memoised, so the read is a lookup, not a scan.
 */
export type Deliverability =
  | { verdict: 'not-found' }
  | { verdict: 'already-delivered' }
  | { verdict: 'not-merged' }
  | { verdict: 'scan-incomplete' }
  | { verdict: 'deliverable' };

export function deliverability(opts: BuildBoardOptions, slug: string): Deliverability {
  const file = resolvePlanBySlug(opts, slug);
  if (!file) return { verdict: 'not-found' };
  let meta;
  try {
    const out = execFileSync('bash', [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), file], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const line = out.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return { verdict: 'not-found' };
    meta = PlanMetaSchema.parse(JSON.parse(line));
  } catch {
    return { verdict: 'not-found' };
  }
  // The plan's own phase decides `already-delivered` FIRST — a delivered plan
  // has every wave merged too, so `allWavesMerged` alone would read it as
  // deliverable. `delivered`/`released` are the phases past Development where
  // the decision is already recorded.
  const phase = meta.phase.toLowerCase();
  if (phase === 'delivered' || phase === 'released') return { verdict: 'already-delivered' };
  // Then the measurement, against the same pulse the board renders from, so the
  // route agrees with the card by construction.
  // THREE ANSWERS FROM THE MEASUREMENT, mapped one-to-one onto verdicts. The
  // `unknown` arm is the one that earns this shape: it is the scan not having
  // finished, which is not a statement about any branch.
  switch (allWavesMerged(meta, pulseFor(opts), pulseCompleteFor(opts))) {
    case 'merged':
      return { verdict: 'deliverable' };
    case 'unknown':
      return { verdict: 'scan-incomplete' };
    default:
      return { verdict: 'not-merged' };
  }
}

/**
 * The prompt handed to the agent: deliver this plan — verify every
 * implementation PR is merged, then flip the phase and move the plan.
 *
 * Three instructions ride with it, and each answers a property this route rests
 * on:
 *
 * 1. **Verify, THEN deliver.** The board's Testing bump is a measurement the
 *    plan file does not record; `/plot-deliver` re-checks the merges for itself
 *    (cross-repo aware, #350's PR-by-branch match included) so nothing is
 *    delivered on a stale pulse. If a branch is not merged, STOP and say which —
 *    do not deliver a plan whose work is not done.
 *
 * 2. **Deliver, never release.** For features and bugs, delivering is not
 *    releasing: it flips Development → Delivered and stops. Cutting a version is
 *    `/plot-release`, a separate decision with a separate answer.
 *
 * 3. **Do the whole transition, or none of it.** Flip the phase, fill the
 *    `Delivered:` record AND move the index symlink together — a phase flip
 *    without the symlink move is the drift `plot-deliver-must-move-the-symlink-too`
 *    names, and it fails the reconcile gate.
 *
 * The plan is passed by PATH so the agent opens the real file, and the slug is
 * passed to `/plot-deliver` as its `$ARGUMENTS` so it acts on this plan.
 */
export function composeDeliverPrompt(input: { slug: string; planFile: string }): string {
  const { slug, planFile } = input;
  const parts: string[] = [];

  parts.push(
    `/plot-deliver ${slug}`,
    '',
    `Read the plan at ${planFile}. The board has MEASURED this plan complete —`,
    'every non-deferred branch has merged — and bumped its card into Testing. That',
    'measurement is not the decision: delivering flips the phase and records it,',
    'and this is a person asking you to make that decision now.',
    '',
  );

  parts.push(
    '## What this must do',
    '',
    '1. Verify, THEN deliver. Re-check that every implementation PR is merged —',
    '   across repos, and by matching merged PR heads to branch names where the',
    '   plan carries no `→ #N` annotation. The board bump reads a pulse that can',
    '   be stale; do not trust it. If any branch is not merged, STOP and name it',
    '   rather than delivering a plan whose work is not done.',
    '2. Deliver, never release. For a feature or a bug this flips the phase',
    '   Development → Delivered and stops there. Cutting a versioned release is',
    '   `/plot-release`, a separate decision — do not run it here.',
    '3. Do the whole transition or none of it: flip the phase, fill the',
    '   `Delivered:` record, AND move the plan\'s index symlink together. A phase',
    '   flip without the symlink move is drift that fails the reconcile gate.',
    '',
  );

  return parts.join('\n');
}

/**
 * What the board may say about a plan it asked to be delivered — the same four
 * states `IdeaState` carries, for the same reason, so the type is reused rather
 * than re-declared.
 */
export interface DeliverStatus {
  state: IdeaState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function deliverStatus(opts: BuildBoardOptions, slug: string): DeliverStatus {
  const log = deliverLogPath(opts.repoRoot, slug);
  const statePath = deliverStatePath(opts.repoRoot, slug);
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
    message: lastLines(text) || `the deliver command exited ${recorded}`,
    log,
  };
}

/**
 * The one fact this route reads from outside itself, injectable for test.
 *
 * `check` is how a slug's deliverability is read back; it defaults to
 * `deliverability`. Injecting it lets the tests assert the refusals —
 * not-deliverable, plan-unreadable, already-delivered — without standing up a
 * real plan estate, a real pulse and a real `/plot-deliver` run.
 */
export interface DeliverDeps {
  /** The configured `Idea command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The plan's deliverability, or a refusal reason. */
  check?: (opts: BuildBoardOptions, slug: string) => Deliverability;
}

/**
 * Handle `POST /api/deliver` — refuse, or write the prompt and spawn the agent
 * that delivers a fully-merged plan.
 *
 * Detached and answered 202 immediately, for the reason `/api/reslice`
 * documents: this server is single-threaded, and awaiting an agent would freeze
 * every viewer's board. The outcome is read back from the status route; and
 * because delivering moves the plan out of Testing, success is the card leaving
 * the column on the next refresh, which the board re-derives from git.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | `no-deliver-command` | no script can do a plot agent's job; accepting the click and doing nothing is the silent failure |
 * | `plan-unreadable` | a plan whose waves cannot be read cannot be delivered; guessing would spawn an agent against an unknown plan |
 * | `not-deliverable` | #350's gate: a plan with an open branch is not deliverable, and this must not weaken it |
 * | `already-delivered` | the decision was already made; re-making it is not what the button does |
 */
export async function handleDeliver(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: DeliverOptions,
  deps: DeliverDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const readCheck = deps.check ?? deliverability;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: DeliverRefusal, slug: string, detail: string) =>
    json(status, { ok: false, slug, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // is enforced in the router for every write route at once — see
  // `write-gate.ts`. `deliverAvailability` still answers this control's
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
      'no-deliver-command',
      slug,
      `no \`${IDEA_COMMAND_KEY}\` in Plot Config — delivering a plan runs the /plot-deliver SKILL, which no script can do; add the key or run /plot-deliver yourself`,
    );
    return;
  }

  // THE PLAN MUST BE DELIVERABLE. Its waves are read from the file through the
  // one parser that owns the format, against the same pulse the board renders
  // from — never inferred — because delivering a plan whose work is not done is
  // exactly the gate #350 kept, and offering it on such a plan would spawn an
  // agent to refuse. The four verdicts map to three refusals and the happy path.
  const state = readCheck(opts, slug);
  if (state.verdict === 'not-found') {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be found or its waves could not be read — refusing rather than delivering a plan whose shape is unknown`,
    );
    return;
  }
  if (state.verdict === 'already-delivered') {
    refuse(
      409,
      'already-delivered',
      slug,
      `plan \`${slug}\` is already delivered — the decision was made and the card is answered; the row offering this will go on the next refresh`,
    );
    return;
  }
  // NAMES THE SCAN, NOT THE BRANCHES. A reader told *a branch has not merged*
  // about a branch that merged goes looking for work that does not exist — which
  // is what happened on 2026-08-27. 409 like its neighbours: the request is fine
  // and the state is not, and this state clears on its own.
  if (state.verdict === 'scan-incomplete') {
    refuse(
      409,
      'scan-incomplete',
      slug,
      `the fleet scan has not finished, so the board cannot yet say whether plan \`${slug}\` has landed every branch — nothing is known to be unmerged; wait for the next pulse and try again`,
    );
    return;
  }
  if (state.verdict === 'not-merged') {
    refuse(
      409,
      'not-deliverable',
      slug,
      `plan \`${slug}\` has a branch that is not merged — a plan is deliverable only once every non-deferred branch has landed, and /plot-deliver would refuse it too`,
    );
    return;
  }

  const planFile = resolvePlanBySlug(opts, slug);
  // `readCheck` reported `deliverable`, so the plan resolved a moment ago; a null
  // here means it vanished between the two reads. Refuse rather than compose a
  // prompt that names no file.
  if (!planFile) {
    refuse(
      409,
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be resolved to a file — refusing rather than delivering a plan that is not there`,
    );
    return;
  }

  const prompt = composeDeliverPrompt({ slug, planFile });

  const promptPath = deliverPromptPath(opts.repoRoot, slug);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = deliverLogPath(opts.repoRoot, slug);
  const statePath = deliverStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    // The same choice `reslice.ts` makes, for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Idea command` is a shell FRAGMENT, the same
  // interpretation `reslice.ts` gives it. NOTHING from the request is
  // interpolated into that string: the prompt reached the repo as a file, and
  // its PATH travels in the environment and as ONE argument via `"$@"`. The slug
  // is SLUG_RE-bounded, so even it carries nothing a shell would interpret.
  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-deliver', `Read ${promptPath} and follow it.`],
    {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch — the same one `reslice.ts` sets.
        // /plot-deliver unattended must STOP at a branch it cannot confirm
        // merged rather than delivering anyway; setting this makes a skipped
        // check name itself in the log rather than the agent improvising.
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
    console.error('deliver failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // `detached` WITHOUT `unref`, exactly as `reslice.ts` is and for its reason:
  // detached keeps a Ctrl-C in the board's terminal off the agent, and keeping
  // the handle keeps the exit listener above alive — dropping it would make
  // every delivery read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, slug, prompt: promptPath, log });
}
