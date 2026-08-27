import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig, allWavesMerged, type BuildBoardOptions } from './board.js';
import { usableCommand } from './idea.js';
import { deliverLogPath } from './deliver.js';
import type { PlanMeta, FleetPulse } from '../contract/schema.js';

/**
 * A finished plan delivers itself, and its desks are cleared behind it.
 *
 * The measurement already existed and acted on nothing. `allWavesMerged`
 * (`board.ts`) computes the exact condition — every non-deferred branch of a
 * plan has merged — and `planStatus` renders it as `deliverable`, and both
 * deliberately touch nothing. That restraint is right for a measurement. What
 * was missing is the WIRE: four plans were delivered by hand in one day, each
 * after the same manual check, while eleven more sat `merged_not_delivered` and
 * twelve worktrees sat reapable because nobody had typed the command.
 *
 * The estate that accumulates is what eventually stops the board working at
 * all: a 90 s scan could not walk 54 worktrees and 43 branches.
 *
 * ## NOT a route, by construction
 *
 * The THIRD automatic write, and it is the same kind as the two beside it —
 * `maybeRepair` and `maybeAutoDispatch`. It rides the SCAN's clock inside
 * `refresh`'s success path, from a pulse that actually landed: delivering on a
 * failed scan's last good answer would act on refs that may have moved, which
 * is the stale-prediction mistake this repo has named once and licensed nothing
 * on top of.
 *
 * Off the request path entirely. It never becomes an `/api/*` route, so it
 * joins no `WRITE_ROUTES` list and reuses no same-origin guard: there is
 * nothing to reach, from any binding, localhost included.
 *
 * `/api/deliver` is NOT this and is not replaced by it. That route is a person
 * clicking *Deliver* on a card, spawning a plot agent through `Idea command`;
 * it stays exactly as it is. This is the unattended path, and it calls the
 * SCRIPT — see {@link DELIVER_COMMAND_KEY}.
 *
 * ## The board may not invent a lifecycle transition
 *
 * The rule this repo keeps: *board writes wrap scripts, or they are licensed
 * repairs — the board never invents a lifecycle transition.* So nothing here
 * flips a phase, writes a `Delivered:` record or moves an index symlink.
 * `skills/plot/scripts/plot-deliver.sh` owns those three writes and performs
 * them in ONE commit, which is load-bearing rather than tidy: the fleet scan
 * reads its rolling window from `delivered_raw`, so a phase flip without the
 * record makes a plan *invisible* rather than delivered (measured 2026-08-20).
 *
 * Grep this package for a phase write and find nothing. That absence is the
 * assertion.
 */

/**
 * How a project interposes its own checks between the board and the delivery —
 * and why the DEFAULT is the script rather than an agent.
 *
 * The exact shape `Approve command` has, named the same way and for the same
 * reason (`approve.ts:65` is the precedent). Delivery has two entrances and ONE
 * implementation, because the skill itself calls the script:
 *
 *     no Deliver command:    board → plot-deliver.sh
 *     with Deliver command:  board → agent → SKILL.md → plot-deliver.sh
 *
 * The mechanical steps therefore happen once either way and cannot drift. What
 * the key buys is the SKILL's judgement — the completeness walkthrough, the
 * partial-deliverable question — for a project that wants it interposed, without
 * this module having to know what those checks are.
 *
 * Direct is the default because `plot-deliver.sh` refuses, with a reason,
 * everything that needs a reader: a phase that is not `approved`, a non-deferred
 * branch that has not merged. There is a safe thing to call, so calling it is
 * not a shortcut past the judgement — the judgement is in the exit code.
 */
export const DELIVER_COMMAND_KEY = 'Deliver command';

/** The script the board falls back to — the one Plot ships. */
export const DELIVER_SCRIPT = 'plot-deliver.sh';

/** The reaper, run after the delivery. Plot ships it; the board only calls it. */
export const REAP_SCRIPT = 'plot-reap.sh';

/** The prompt handed to a configured `Deliver command`. The slug is the only variable. */
export function deliverPrompt(slug: string): string {
  return `/plot-deliver ${slug}`;
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function deliverCommand(opts: BuildBoardOptions): string {
  return usableCommand(readConfig(opts, DELIVER_COMMAND_KEY, ''));
}

/**
 * One plan this pulse says has finished, and the file the delivery will move.
 *
 * The slug is what `plot-deliver.sh` resolves the plan from; `file` is carried
 * only so a log line can name what was delivered.
 */
export interface AutoDeliverPlan {
  slug: string;
  file: string;
}

/**
 * The plan slug the delivery script will use — the basename with its
 * `YYYY-MM-DD-` prefix and `.md` suffix stripped, the exact spelling
 * `/api/deliver` already sends and `planSlug` in `auto-dispatch.ts` produces.
 *
 * A private twin rather than an import, deliberately kept byte-identical: the
 * two modules are independent actors on the same clock, and a shared helper
 * would make one able to break the other's slug resolution.
 */
export function planSlug(file: string): string {
  return path.basename(file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
}

export interface PlanAutoDeliverInput {
  /**
   * The pulse the scan just landed — every plan's phase AND the merge state of
   * every branch, which is the whole input this decision takes.
   *
   * Read from the pulse rather than from plan files, and that is the same
   * choice `allWavesMerged` documents for merge state, extended to the phase.
   * The scan has just walked the estate; re-reading 150 plan files to learn what
   * it already reported would put this actor on a different clock from the
   * measurement it acts on, and the two could then disagree about which plans
   * exist. `FleetPlanSchema.phase` is `plot-plan-meta.sh`'s own normalization,
   * so it is the same parser's answer either way.
   */
  pulse: FleetPulse | null;
  /** Slugs a delivery has already been started for and not yet confirmed. */
  inFlight: Set<string>;
}

/**
 * The join key `allWavesMerged` takes, built from a pulse plan.
 *
 * `allWavesMerged` finds its plan by `path.basename(meta.file)`, and a pulse
 * plan's `file` is ALREADY that basename — so this is the identity mapping plus
 * the fields the signature requires. Building it here rather than reading the
 * plan file again is what keeps this actor on the pulse's clock: the function is
 * called with the scan's own answer, not with a second opinion about it.
 */
function joinKey(file: string): PlanMeta {
  return { file } as PlanMeta;
}

/**
 * Which plans this pulse has FINISHED — the whole decision, and pure.
 *
 * Separated from the act for the reason `auto-dispatch.ts` separates its own:
 * every refusal below is a property worth asserting directly, and asserting it
 * through a spawn would test the stub rather than the rule.
 *
 * Four things must hold, and each is a `Done when` item that exists because a
 * naive implementation would pass without it:
 *
 *  - **The phase is `approved`.** A `draft` plan has not been approved and a
 *    `delivered` one is already answered; `plot-deliver.sh` refuses both, and
 *    spawning it to be refused would put a failure in a log every five seconds.
 *
 *  - **Every non-deferred branch has merged** — `allWavesMerged`, CALLED and not
 *    reimplemented. This is the gate `/plot-deliver` applies by hand, and an
 *    auto-deliverer that skips it ships the exact refusal Plot exists to
 *    enforce. Calling the shared function rather than re-deriving it is also
 *    what lets a fix to the gate reach this actor without anyone remembering to
 *    copy it.
 *
 *  - **At least one branch actually merged.** `allWavesMerged`'s own `merged > 0`
 *    guard, and the reason a plan whose remaining waves are ALL `deferred` is not
 *    delivered here. Shelved is not finished: delivering it would record a
 *    completion nobody decided, and that call stays with a person.
 *
 *  - **No delivery is already in flight for it.** The scan fires every few
 *    seconds and `plot-deliver.sh` pushes to the default branch; without this,
 *    a plan would be delivered a dozen times over while the first run was still
 *    working. Idempotence makes that harmless, not free.
 *
 * Note what is NOT re-derived: merge state comes from the pulse, never from the
 * plan file, because the plan file carries no merge record and inventing one
 * here would answer a different question than the scan does.
 */
export function planAutoDeliver(input: PlanAutoDeliverInput): AutoDeliverPlan[] {
  const { pulse, inFlight } = input;
  if (!pulse) return [];
  const out: AutoDeliverPlan[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase.toLowerCase() !== 'approved') continue;
    const slug = planSlug(plan.file);
    if (inFlight.has(slug)) continue;
    // The measurement, unmodified. `allWavesMerged` returns false for a plan the
    // pulse does not know, for any unmerged non-deferred branch, and for a plan
    // with no merged branch at all — the all-deferred case included.
    if (!allWavesMerged(joinKey(plan.file), pulse)) continue;
    out.push({ slug, file: plan.file });
  }
  return out;
}

/**
 * Retire the slugs whose delivery has landed, so the set does not grow forever.
 *
 * A plan still reading `approved` with every wave merged is one whose delivery
 * has not taken effect yet — it stays in flight. Anything else is confirmed:
 * either the phase moved (the delivery worked) or the plan stopped being
 * deliverable (a branch reopened, and the next pulse will decide afresh).
 *
 * Returned whole rather than mutated, the cache's one-directional rule.
 */
export function pruneDelivering(
  inFlight: Set<string>,
  pulse: FleetPulse | null,
): Set<string> {
  if (inFlight.size === 0) return inFlight;
  // A pulse the scan could not land says nothing about whether anything
  // finished, and "nothing said" is not "confirmed". Holding the set unchanged
  // keeps a delivery from being started twice across a failed scan.
  if (!pulse) return inFlight;
  const stillPending = new Set<string>();
  for (const plan of pulse.plans) {
    const slug = planSlug(plan.file);
    if (!inFlight.has(slug)) continue;
    if (plan.phase.toLowerCase() !== 'approved') continue; // moved on — confirmed
    if (!allWavesMerged(joinKey(plan.file), pulse)) continue; // not deliverable — confirmed
    stillPending.add(slug);
  }
  return stillPending;
}

/**
 * Deliver each finished plan, then reap — and the ORDER is the point.
 *
 * The reap is chained to the delivery's `exit`, not spawned beside it. Both
 * orders end with a delivered plan and no worktree, so an end-state assertion
 * passes either way; only this one never shows a desk-less `Approved` plan
 * mid-flight, which is the state a human reads as *work in progress with nobody
 * on it*. The ordering is therefore structural rather than incidental: two
 * detached spawns fired together would race, and a test of the end state would
 * not notice.
 *
 * It also matters that the reap runs at ALL only after a delivery succeeded.
 * `plot-deliver.sh` exits non-zero on every refusal it owns — a phase that is
 * not `approved`, a branch that did not merge — and reaping after a refusal
 * would clear the desks of work the delivery just declined to call finished.
 * So the exit code gates it.
 *
 * The reaper is called, never re-derived. It reads `mergedAt` on ANY PR for a
 * branch (never `state`, since a merged PR reports `CLOSED`, and never ancestry,
 * since squash-merge leaves a branch permanently ahead of main) and refuses on
 * five measurements of its own: a live worker, a dirty tree, a `PLOT-BLOCKED`
 * marker, a tree on the default branch, or no merged PR. Every one of those
 * protections applies to an unwatched reap exactly as it does to a typed one.
 *
 * `--yes` because this IS the decision to remove; without it the script reports
 * and does nothing, which would be a wire that ends in a dry run.
 *
 * Both children are detached and unwaited. A delivery pushes to the git host and
 * a reap walks every worktree, both strictly slower than the scan that must not
 * block on them. Output goes to the per-slug deliver log the click route already
 * writes, so an operator reads ONE file whether the delivery was clicked or
 * automatic.
 */
export function runAutoDeliver(
  opts: BuildBoardOptions,
  plans: AutoDeliverPlan[],
): string[] {
  const command = deliverCommand(opts);
  const started: string[] = [];
  for (const plan of plans) {
    const log = deliverLogPath(opts.repoRoot, plan.slug);
    let out: number;
    try {
      // Appended, not truncated: this log is shared with `/api/deliver`, whose
      // status route reads it back as an answer for ONE click. An automatic run
      // that truncated it would erase the words a person is still reading.
      out = fs.openSync(log, 'a');
    } catch (err) {
      console.error(`auto-deliver could not open ${log}:`, err);
      continue;
    }

    // TWO ENTRANCES, ONE IMPLEMENTATION — the shape `approve.ts` established.
    // With `Deliver command` declared the board asks for the skill by name and
    // the project says what runs it; without one it runs the script Plot ships,
    // which the skill itself calls. The mechanical steps happen once either way.
    //
    // In the command case the prompt is passed as ONE argument via `"$@"`, never
    // interpolated into the command string: `sh -c "$cmd /plot-deliver $slug"`
    // would make a slug a shell injection point. The slug comes from a plan
    // file's own basename rather than from a request, so this is defence in
    // depth — which is precisely when it is worth keeping. The script case
    // builds no shell string at all.
    const child = command
      ? spawn(
          'sh',
          ['-c', `${command} "$@"`, 'plot-deliver', deliverPrompt(plan.slug)],
          {
            cwd: opts.repoRoot,
            detached: true,
            stdio: ['ignore', out, out],
            env: {
              ...process.env,
              // THE DECLARATION, not a switch. An unattended /plot-deliver must
              // STOP at a branch it cannot confirm merged rather than delivering
              // anyway; setting this makes a skipped check name itself in the log
              // rather than the agent improvising past it.
              PLOT_UNATTENDED: '1',
              PLOT_PLAN_SLUG: plan.slug,
            },
          },
        )
      : spawn('bash', [path.join(opts.scriptsDir, DELIVER_SCRIPT), plan.slug], {
          cwd: opts.repoRoot,
          detached: true,
          stdio: ['ignore', out, out],
        });

    // THE ORDERING, and it is this listener rather than a second spawn below.
    child.on('exit', (code, signal) => {
      if (signal || code !== 0) {
        console.log(
          `auto-deliver: ${plan.slug} exited ${signal ? `on ${signal}` : code}; ` +
          'not reaping — the delivery refused, so its desks are not finished',
        );
        return;
      }
      console.log(`auto-deliver: delivered ${plan.slug}; reaping its worktrees`);
      reap(opts, plan.slug);
    });
    child.on('error', (err) => console.error('auto-deliver failed to spawn:', err));
    // No `unref`: the EXIT CODE is what the reap is waiting for, and dropping
    // the handle would drop the listener above with it — every delivery would
    // land and nothing would ever be reaped. `detached` still keeps a Ctrl-C in
    // the board's terminal off a delivery that has merged a PR and not yet
    // written its record.
    fs.closeSync(out);
    started.push(plan.slug);
  }
  return started;
}

/**
 * Clear the desks of work that has landed — the second half, run only from the
 * delivery's success.
 *
 * Slug-blind on purpose: `plot-reap.sh` takes no plan argument and reaps every
 * worktree that passes its five measurements. That is not this module widening
 * its scope, it is the reaper's existing behaviour — a branch belonging to no
 * plan is reaped by an ordinary run too, and needs no plan-shaped trigger. The
 * slug travels only so the log line says which delivery caused the sweep.
 */
function reap(opts: BuildBoardOptions, slug: string): void {
  const log = deliverLogPath(opts.repoRoot, slug);
  let out: number;
  try {
    out = fs.openSync(log, 'a');
  } catch (err) {
    console.error(`auto-deliver could not open ${log} for the reap:`, err);
    return;
  }
  const child = spawn('bash', [path.join(opts.scriptsDir, REAP_SCRIPT), '--yes'], {
    cwd: opts.repoRoot,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.on('error', (err) => console.error('auto-deliver reap failed to spawn:', err));
  // Unreferenced, unlike the delivery: nothing is chained to THIS exit code, so
  // the board need not outlive it. A reap interrupted midway leaves a worktree
  // the next run removes.
  child.unref();
  fs.closeSync(out);
}

/**
 * Decide and deliver in one call — the whole of auto-deliver as `refresh` sees
 * it, and the mirror of `maybeAutoDispatch`.
 *
 * Returns the in-flight set the cache should hold next pulse: the pruned old set
 * plus the slugs newly started, assigned whole rather than mutated.
 *
 * There is no switch and no cap, which is a deliberate asymmetry with
 * auto-dispatch rather than an omission. Dispatch STARTS agents, so it is
 * bounded by how many machines the operator will run; delivery is a bounded
 * consequence of work that already finished — a plan can be delivered once, and
 * the set of finished plans is not something the board can run out of room for.
 */
export function maybeAutoDeliver(
  opts: BuildBoardOptions,
  pulse: FleetPulse | null,
  inFlight: Set<string>,
): Set<string> {
  const pruned = pruneDelivering(inFlight, pulse);
  const plans = planAutoDeliver({ pulse, inFlight: pruned });
  if (plans.length === 0) return pruned;
  const started = runAutoDeliver(opts, plans);
  return new Set([...pruned, ...started]);
}
