import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import {
  PlanMetaSchema,
  TransitionSchema,
  type Transition,
  type TransitionResult,
} from '../contract/index.js';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { APPROVE_SCRIPT } from './approve.js';

/**
 * `POST /api/transition` — apply one phase transition, and say what resulted.
 *
 * THE GUARDRAILS ARE NOT NEGOTIABLE THROUGH THIS ROUTE, and the way that is
 * guaranteed is by this file containing no phase logic at all. It does not know
 * that a Draft cannot be delivered or that a Released plan cannot be approved
 * again. It runs `plot-approve.sh` and reports what the script said — so a
 * transition the spoke would refuse is refused here, in the spoke's own words,
 * because the spoke is what evaluated it.
 *
 * That is the answer to the plan's open question — *does /api/transition
 * supersede the spoke commands, or wrap them?* Superseding would put the four
 * phase guardrails in two places, which is how they drift; the endpoint would
 * then be a bypass of the lifecycle rather than an interface to it. Wrapping
 * keeps one implementation and inherits its prose, including the sentences that
 * explain a refusal well enough that the reader does not need a terminal.
 *
 * ONE TRANSITION, AND THAT IS A FINDING RATHER THAN AN OMISSION. Plot has four
 * phases, and only `Draft → Approved` has a mechanical implementation:
 * `plot-approve.sh` performs seven writes with no judgement in any of them.
 * `Delivered` and `Released` are written by /plot-deliver and /plot-release as
 * PROSE — an agent editing markdown — and there is no script to wrap. Adding
 * them here would mean writing those guardrails a second time, beside the ones
 * that exist, which is the one thing this endpoint must not do. They are
 * refused by name, and the refusal says which command owns them.
 */

/**
 * How long a transition may take before this server stops waiting.
 *
 * An approval MERGES A PULL REQUEST — it reaches the git host, and the endpoint
 * must await it because returning the resulting phase is the whole contract.
 * Generous for the reason `claim.ts` states: a bound tuned to a fast local run
 * is a test that passes here and loses on a loaded CI runner, which this repo
 * measured twice in one day.
 */
const TRANSITION_TIMEOUT_MS = 120_000;

/** Which script performs each transition, and nothing about when it may run. */
const TRANSITION_SCRIPT: Record<Transition, string> = {
  approve: APPROVE_SCRIPT,
};

/**
 * The phases a transition targets, used ONLY to read back whether it landed.
 *
 * Never to decide whether it may run — that question belongs to the script, and
 * a table here that answered it would be the duplicate guardrail this endpoint
 * exists to avoid. This one is consulted strictly after the fact.
 */
const TRANSITION_TARGET: Record<Transition, string> = {
  approve: 'approved',
};

/**
 * The transitions Plot has but this API cannot apply, and who owns each.
 *
 * NAMED RATHER THAN ABSENT. A caller that posts `deliver` and gets *"transition
 * must be one of: approve"* learns that it typed something invalid; one that
 * gets the sentence below learns the true thing — the transition is real, it
 * has no mechanical implementation to wrap, and here is the command that
 * performs it. The second costs one map and saves a reader the search that ends
 * in this file.
 */
const UNMECHANISED: Record<string, string> = {
  deliver:
    'delivering a plan is performed by /plot-deliver, which verifies every implementation PR has ' +
    'merged and then rewrites the plan — prose an agent applies, with no script to wrap. This API ' +
    'refuses it rather than reimplementing those checks beside the ones the spoke already makes.',
  release:
    'releasing is performed by /plot-release, which cuts a version and rewrites every delivered ' +
    'plan — prose an agent applies, with no script to wrap. This API refuses it rather than ' +
    'reimplementing those checks beside the ones the spoke already makes.',
};

export interface TransitionOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * The plan file a slug names, resolved the way `plot-approve.sh` resolves it.
 *
 * THE SAME TWO CANDIDATES IN THE SAME ORDER — the active index first, then the
 * date-prefixed file in the plan directory. Deliberately mirrored rather than
 * invented: this lookup exists to read back the phase of the file the SCRIPT
 * acted on, and a locator that disagreed with the script's would report the
 * phase of a different plan, which is a worse answer than none.
 */
function resolvePlanBySlug(opts: BuildBoardOptions, slug: string): string | null {
  const repoRoot = opts.repoRoot;
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const activeDir = readConfig(opts, 'Active index', 'docs/plans/active/');

  const active = path.join(repoRoot, activeDir, `${slug}.md`);
  if (fs.existsSync(active)) return active;

  // `<plan dir>/*<slug>.md` — the same glob, walked rather than globbed.
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
 * The plan's phase right now, read from the file — never inferred.
 *
 * `plot-plan-meta.sh` is the plan-format contract, so the phase comes from the
 * one parser that owns it. Null when the plan cannot be found or parsed, which
 * is reported as null rather than flattened into a phase that sounds plausible:
 * the endpoint's promise is that the caller never has to re-derive whether its
 * write landed, and a confident wrong answer breaks that promise worse than an
 * admitted gap does.
 */
export function readPhase(opts: BuildBoardOptions, slug: string): string | null {
  const file = resolvePlanBySlug(opts, slug);
  if (!file) return null;
  try {
    const out = execFileSync('bash', [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), file], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const line = out.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return null;
    return PlanMetaSchema.parse(JSON.parse(line)).phase || null;
  } catch {
    return null;
  }
}

/**
 * Handle `POST /api/transition`. Awaits the spoke's script and answers with the
 * phase that resulted, whether or not it changed.
 *
 * The loopback gate is applied in the router ahead of this — see
 * `write-gate.ts`.
 */
export async function handleTransition(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: TransitionOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

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

  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  const requested = (body as { transition?: unknown })?.transition;
  if (typeof requested === 'string' && requested in UNMECHANISED) {
    // 501, not 400: the caller asked for something real and correctly named,
    // and this server has not implemented it. A 400 would say the request was
    // malformed, which would send the caller to fix a spelling that is right.
    json(501, { error: UNMECHANISED[requested] });
    return;
  }

  const parsed = TransitionSchema.safeParse(requested);
  if (!parsed.success) {
    json(400, {
      error: `transition must be one of: ${TransitionSchema.options.join(', ')}`,
    });
    return;
  }
  const transition = parsed.data;

  const result = await new Promise<TransitionResult>((resolve) => {
    execFile(
      'bash',
      [path.join(opts.scriptsDir, TRANSITION_SCRIPT[transition]), slug],
      { cwd: opts.repoRoot, timeout: TRANSITION_TIMEOUT_MS, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // THE PHASE IS RE-READ FROM THE FILE, always, and on the refusal path
        // too. On success it proves the write landed rather than trusting the
        // exit code; on a refusal it tells the caller where the plan actually
        // stands, which is usually the thing it needs in order to do something
        // useful next. Inferring it from `exit 0` would be the same act of
        // hoping this endpoint exists to replace.
        const phase = readPhase(opts, slug);
        const applied = phase === TRANSITION_TARGET[transition];
        if (!err) {
          resolve({ slug, transition, applied, phase, reason: lastSaid(stdout) });
          return;
        }
        // The script's OWN sentence — "Plan is still a draft PR (#N). Mark it
        // ready for review first." — forwarded rather than replaced. It is
        // written on the way out, so stderr's tail is the reason; stdout's is
        // the fallback for a failure that explained itself there instead.
        resolve({
          slug,
          transition,
          applied,
          phase,
          reason: lastSaid(stderr) || lastSaid(stdout) || 'the transition failed without a reason',
        });
      },
    );
  });

  // 200 on a refusal as well as on a success, and `applied` carries which it
  // was. The request was well formed and the server did exactly what was asked
  // — ask the spoke — and the spoke answered. Mapping a guardrail refusal onto
  // a 4xx would make the lifecycle's normal operation look like a client
  // error, and would tempt a caller into retrying a transition that will be
  // refused for the same reason every time. What resulted is in the body,
  // which is this endpoint's whole premise.
  json(200, result);
}

/**
 * What a command said, as a reason a caller can act on.
 *
 * THE LAST FEW LINES, NOT THE LAST ONE. `plot-approve.sh` explains a refusal
 * across more than one line, and the continuation carries the part that tells
 * the reader what to do:
 *
 *     plot-approve: plan 'x' declares 'Review: in-session' — the reviewer is a
 *       human in the room.
 *       A script cannot stand in for one. Approve it with /plot-approve x.
 *
 * Taking only the final line would keep the instruction and drop the cause;
 * taking only the first would do the reverse. Both halves are the reason, which
 * is the whole value this endpoint forwards rather than replaces.
 *
 * Bounded, because a response body is not a log: a script that failed noisily
 * must not put its whole transcript in a JSON field.
 */
export function lastSaid(text: string | undefined, max = 4, maxChars = 600): string {
  const lines = (text ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const tail = lines.slice(-max).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}
