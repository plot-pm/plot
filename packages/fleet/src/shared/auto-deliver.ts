import fs from 'node:fs';
import {
  deliveryReadings,
  planAutoDeliver,
  pruneDelivering,
  pruneFailures,
  recordDeliveryFailure,
  retryVerdict,
  type AutoDeliverPlan,
  type DeliveryFailure,
  type FleetReading,
} from '@plot-pm/domain';
import { readConfig } from './config-reader.js';
import { usableCommand } from './usable-command.js';
import { deliverLogPath, scriptsOf, type ActOptions } from './action-log.js';
import {
  IN_FLIGHT_RENEW_AFTER_MS,
  readInFlight,
  updateDeliverState,
  writeDeliverState,
  type InFlightFile,
  type InFlightReading,
} from './in-flight-store.js';
import { recordActionReceipt } from './action-receipt.js';
import { startBoardRun } from './board-run.js';

/**
 * A finished plan delivers itself, and its desks are cleared behind it.
 *
 * The measurement already existed and acted on nothing. `allSlicesMerged`
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

/**
 * The ref release, run after the reap — the LAST link in the chain.
 *
 * Deliver, then reap, then delete. The ordering is a `Done when` item and it is
 * asserted as ordering rather than as end state, because every order ends with
 * a delivered plan, no worktree and no ref: only this one never shows an
 * intermediate a person would misread. Reversed, a worktree would outlive the
 * ref it tracks — a checkout of a branch that no longer exists anywhere.
 *
 * WHY THE REFS ARE WORTH DELETING AT ALL. They are what the scan actually
 * costs. Measured 2026-08-27 across four runs: 54 worktrees/43 branches took
 * 462.9 s, 42/43 took 51.3 s, 11/43 took 218.5 s, and 11/34 took 111.5 s.
 * Worktree count does not order those runs — 11 worktrees was slower than 42.
 * Deleting nine merged branches is what moved it reliably, roughly halving it.
 *
 * SLUG-SCOPED, unlike the reap beside it, and that asymmetry is the whole
 * safety argument. `plot-reap.sh` sweeps every worktree because a removed
 * checkout is re-creatable with `git worktree add`; a deleted ref is not
 * re-creatable at all. So this is told WHICH plan finished and touches only the
 * branches that plan names — a sweep over every merged ref on the estate would
 * satisfy "a delivered plan's merged branches lose their refs" while destroying
 * unlanded work belonging to plans nobody delivered.
 */
export const RELEASE_REFS_SCRIPT = 'plot-release-refs.sh';

/** The prompt handed to a configured `Deliver command`. The slug is the only variable. */
export function deliverPrompt(slug: string): string {
  return `/plot-deliver ${slug}`;
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function deliverCommand(opts: ActOptions): string {
  return usableCommand(readConfig(opts, DELIVER_COMMAND_KEY, ''));
}

/**
 * Deliver each finished plan, then reap, then release its refs — and the ORDER
 * is the point, at both links.
 *
 * The reap is chained to the delivery's `exit`, not spawned beside it. Both
 * orders end with a delivered plan and no worktree, so an end-state assertion
 * passes either way; only this one never shows a desk-less `Approved` plan
 * mid-flight, which is the state a human reads as *work in progress with nobody
 * on it*. The ordering is therefore structural rather than incidental: two
 * detached spawns fired together would race, and a test of the end state would
 * not notice. The reap chains a third link the same way — the ref release —
 * so the whole sequence is deliver → reap → delete, each waiting on the last.
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
export interface DeliveryHooks {
  /** A script delivery came up with this pid. */
  onStart?: (slug: string, pid: number) => void;
  /**
   * The delivery ended. Called exactly once per plan handed in: `ok` is `true`
   * only for a delivery that exited 0. A log that cannot open, a spawn
   * `error`, a spawn with no pid and a refused agent run are failures.
   */
  onEnd?: (slug: string, ok: boolean) => void;
}

export function runAutoDeliver(
  opts: ActOptions,
  plans: AutoDeliverPlan[],
  hooks: DeliveryHooks = {},
): string[] {
  const command = deliverCommand(opts);
  const started: string[] = [];
  for (const plan of plans) {
    // ONE END PER PLAN. A spawn can emit `error` and then `exit`, and an agent
    // run can refuse through its end record and through its return value.
    let ended = false;
    const end = (ok: boolean): void => {
      if (ended) return;
      ended = true;
      hooks.onEnd?.(plan.slug, ok);
    };
    const log = deliverLogPath(opts.repoRoot, plan.slug);
    let out: number;
    try {
      // Appended, not truncated: this log is shared with `/api/deliver`, whose
      // status route reads it back as an answer for ONE click. An automatic run
      // that truncated it would erase the words a person is still reading.
      out = fs.openSync(log, 'a');
    } catch (err) {
      console.error(`auto-deliver could not open ${log}:`, err);
      end(false);
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
    // THE ORDERING, and it is this listener rather than a second spawn below.
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (signal || code !== 0) {
        console.log(
          `auto-deliver: ${plan.slug} exited ${signal ? `on ${signal}` : code}; ` +
          'not reaping — the delivery refused, so its desks are not finished',
        );
        // A FAILED DELIVERY LEAVES THE PULSE UNCHANGED (still approved, still
        // merged), so `pruneDelivering` can never retire its mark. The exit is
        // the only signal, and the caller's `onEnd` acts on it.
        end(false);
        return;
      }
      console.log(`auto-deliver: delivered ${plan.slug}; reaping its worktrees`);
      end(true);
      reap(opts, plan.slug);
    };
    const onError = (err: Error): void => {
      console.error('auto-deliver failed to spawn:', err);
      end(false);
    };
    // ABOVE BOTH ARMS, because both are this controller acting. The agent arm
    // is the one that needs it most: a spawned `claude -p` inherits these same
    // plugin hooks and runs from the REPOSITORY ROOT, not a desk, so its own
    // `plot-deliver.sh` call reaches the gate exactly as a master agent's does.
    // Without a receipt written before it starts, the board's legitimate
    // delivery route would be refused by the gate the board itself installs.
    recordActionReceipt(opts.repoRoot, 'deliver', plan.slug);
    if (command) {
      // THROUGH THE `agentRun` PORT, in this process's group. A `refused`
      // outcome is not a delivery: `boardRunEnd` records it as code 1, so the
      // reap below never runs after one.
      void startBoardRun(
        opts,
        {
          role: 'auto-deliver',
          fragmentKey: DELIVER_COMMAND_KEY,
          readCfg: (o, key, fallback) => (key === DELIVER_COMMAND_KEY ? command : readConfig(o, key, fallback)),
          tree: opts.repoRoot,
          prompt: deliverPrompt(plan.slug),
          env: {
            // THE DECLARATION, not a switch. An unattended /plot-deliver must
            // STOP at a branch it cannot confirm merged rather than delivering
            // anyway; setting this makes a skipped check name itself in the log
            // rather than the agent improvising past it.
            PLOT_UNATTENDED: '1',
            PLOT_PLAN_SLUG: plan.slug,
          },
          logFile: log,
          statePath: null,
        },
        (record) => onExit(record.code, null),
      ).then(
        // A run left to the running board returns `refused` without an end record.
        (how) => {
          if (how === 'refused') end(false);
        },
        (err: unknown) => {
          console.error('auto-deliver agent run failed:', err);
          end(false);
        },
      );
    } else {
      const run = scriptsOf(opts).start(DELIVER_SCRIPT, [plan.slug], { log: out, onExit, onError });
      if (run.started) hooks.onStart?.(plan.slug, run.pid);
      else end(false);
    }
    // The script arm keeps its handle: the EXIT CODE is what the reap waits
    // for. `detached` there keeps a Ctrl-C in the board's terminal off a
    // delivery that has merged a PR and not yet written its record.
    fs.closeSync(out);
    started.push(plan.slug);
  }
  return started;
}

/**
 * Clear the desks of work that has landed — the second link, run only from the
 * delivery's success.
 *
 * Slug-blind on purpose: `plot-reap.sh` takes no plan argument and reaps every
 * worktree that passes its five measurements. That is not this module widening
 * its scope, it is the reaper's existing behaviour — a branch belonging to no
 * plan is reaped by an ordinary run too, and needs no plan-shaped trigger. The
 * slug travels so the log line says which delivery caused the sweep, AND
 * because the ref release chained to this exit is not slug-blind at all.
 */
function reap(opts: ActOptions, slug: string): void {
  const log = deliverLogPath(opts.repoRoot, slug);
  let out: number;
  try {
    out = fs.openSync(log, 'a');
  } catch (err) {
    console.error(`auto-deliver could not open ${log} for the reap:`, err);
    return;
  }
  // THE SECOND ORDERING, and the same mechanism as the first: a listener on the
  // exit, never a spawn beside it. The refs go after the desks are cleared,
  // because a worktree must not outlive the ref it tracks.
  //
  // Unlike the delivery→reap link, this one does NOT gate on the exit code. The
  // reaper exits 0 whatever it decides and reports its verdicts as text — a
  // `keep` is a normal outcome, not a failure — so there is no non-zero to read
  // as a refusal. And the release re-derives every fact for itself: it asks the
  // host about each branch and checks the worktree list again. A reap that
  // failed halfway leaves a worktree in place, which the release then SEES and
  // refuses on. The guards are the gate here, not the exit code.
  scriptsOf(opts).start(REAP_SCRIPT, ['--yes'], {
    log: out,
    onExit: () => releaseRefs(opts, slug),
    onError: (err) => console.error('auto-deliver reap failed to spawn:', err),
  });
  // No `unref`, since 2026-08-28: the ref release is chained to THIS exit code
  // now, and dropping the handle would drop the listener with it — every plan
  // would be reaped and no ref would ever be deleted. This is the same reason
  // the delivery above keeps its handle, arriving one link later.
  fs.closeSync(out);
}

/**
 * Delete the remote refs of the delivered plan's merged branches — the third
 * and last link.
 *
 * SCOPED TO THE PLAN, and passed the slug for exactly that reason. Every
 * refusal that protects an unlanded ref lives in the script: a `deferred:`
 * annotation, no merged PR, an open PR, a checkout sitting on the branch, the
 * default branch itself. The board asks for none of those judgements and makes
 * none — it names the plan that finished, which is the one fact it has that the
 * script does not.
 *
 * `--yes` because this IS the decision to release; without it the script
 * reports and does nothing, which would be a wire ending in a dry run — the
 * same reason the reap above passes it.
 *
 * Unreferenced, unlike the two before it: nothing is chained to this exit code,
 * so the board need not outlive it. A release interrupted midway leaves refs the
 * next delivery's run — or a typed one — removes, because every gate is
 * re-derived from the host and from git rather than from a progress file.
 */
function releaseRefs(opts: ActOptions, slug: string): void {
  const log = deliverLogPath(opts.repoRoot, slug);
  let out: number;
  try {
    out = fs.openSync(log, 'a');
  } catch (err) {
    console.error(`auto-deliver could not open ${log} for the ref release:`, err);
    return;
  }
  scriptsOf(opts).start(RELEASE_REFS_SCRIPT, ['--yes', slug], {
    log: out,
    onError: (err) => console.error('auto-deliver ref release failed to spawn:', err),
  });
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
  opts: ActOptions,
  pulse: FleetReading | null,
  inFlight: Set<string>,
): Set<string> {
  // COMPLETENESS IS THE PULSE'S OWN, not a cache lookup.  calls this
  // from inside a landed refresh, passing the pulse it names  for
  // exactly that reason — a pulse reaching this path is one the scan finished.
  //
  // An earlier fix read  here. That worked in
  // production and broke every unit test: these functions are documented pure
  // ("the decision, and it is pure"), and reaching into the fleet cache made
  // them depend on module state a temp-dir fixture cannot provide.
  const complete = pulse !== null;
  const pruned = pruneDelivering(inFlight, pulse, complete);
  const plans = planAutoDeliver({ pulse, inFlight: pruned, complete });
  if (plans.length === 0) return pruned;
  const started = runAutoDeliver(opts, plans);
  return new Set([...pruned, ...started]);
}

/**
 * The deliveries this process started and that have not ended, per repository.
 *
 * A mark is renewed only while its delivery runs: in this set, or under a
 * recorded pid that is still alive. Held in memory, so a restarted daemon
 * reads the pid from the file instead.
 */
const running = new Map<string, Set<string>>();

const runningIn = (repoRoot: string): Set<string> => {
  let set = running.get(repoRoot);
  if (!set) {
    set = new Set();
    running.set(repoRoot, set);
  }
  return set;
};

/** Whether `pid` names a live process. EPERM is a live process owned by another user. */
const pidAlive = (pid: number | undefined): boolean => {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Order-independent JSON for a map, so two equal maps compare equal. */
const canonical = (map: Record<string, unknown>): string =>
  JSON.stringify(Object.keys(map).sort().map((key) => [key, map[key]]));

/** Whether writing `next` would leave the file as `read` reports it. */
const sameState = (read: InFlightReading, next: InFlightFile): boolean =>
  Object.keys(read.expired).length === 0 &&
  canonical(read.stamps) === canonical(next.marks) &&
  canonical(read.pids) === canonical(next.pids ?? {}) &&
  canonical(read.failures) === canonical(next.failures ?? {});

/**
 * Report a plan whose automatic delivery stopped, in the two places an
 * operator reads for an automatic delivery: the daemon's log and the plan's
 * deliver log.
 */
const reportStopped = (opts: ActOptions, slug: string, failure: DeliveryFailure): void => {
  const line =
    `auto-deliver: ${slug} failed ${failure.count} consecutive deliveries; ` +
    `stopped retrying — needs a person: run /plot-deliver ${slug}, or change the plan to reset the count`;
  console.log(line);
  try {
    fs.appendFileSync(deliverLogPath(opts.repoRoot, slug), `${line}\n`, 'utf8');
  } catch {
    /* the daemon log above still carries the line */
  }
};

/**
 * One delivery pass over the marks on disk: read them, retire the confirmed,
 * count the lapsed, mark what is about to start, then start it.
 *
 * The marks live in `.plot/state/auto-deliver-in-flight.json` with a 180 s
 * lifetime. A mark is renewed only while its delivery runs, so a mark whose
 * delivery died outside this process expires and counts as a failed attempt.
 * A live mark is renewed once it is 80 s old, so a gap of one scan budget
 * between passes cannot expire it.
 *
 * A failed delivery is retried after {@link retryDelayMs} and stops after
 * {@link AUTO_DELIVER_MAX_FAILURES} consecutive failures; the stop is reported
 * once, in the daemon log and the plan's deliver log. A success or a change to
 * the plan's reading resets the count.
 *
 * A mark file that exists and cannot be read starts nothing: the marks are the
 * only evidence that a delivery is running, and a pass blind to them would start
 * a second one.
 *
 * @param opts - where the fleet acts.
 * @param pulse - the pulse the scan just wrote.
 * @param now - epoch milliseconds; the clock of this pass.
 */
export const runAutoDeliverPass = (opts: ActOptions, pulse: FleetReading | null, now: number = Date.now()): void => {
  const read = readInFlight(opts.repoRoot, now, 'deliver');
  if (read.branches === null) {
    console.log(`auto-deliver: cannot read the in-flight record (${read.error}); starting nothing this pass`);
    return;
  }
  const mine = runningIn(opts.repoRoot);
  const live = (slug: string): boolean => mine.has(slug) || pidAlive(read.pids[slug]);
  const complete = pulse !== null;
  const readings = deliveryReadings(pulse);

  // A LAPSED MARK whose plan still reads approved and merged, with no live
  // delivery behind it, is a delivery that died where no exit was heard.
  const lapsed = pruneDelivering(new Set(Object.keys(read.expired)), pulse, complete);
  const held = new Set([...pruneDelivering(read.branches, pulse, complete), ...[...lapsed].filter(live)]);
  const failures = pruneFailures(read.failures, pulse);
  const stopped: string[] = [];
  for (const slug of lapsed) {
    if (live(slug)) continue;
    const reading = readings.get(slug) ?? '';
    failures[slug] = recordDeliveryFailure(failures[slug], reading, now);
    if (retryVerdict(failures[slug], reading, now) === 'stopped') stopped.push(slug);
  }

  const plans = planAutoDeliver({ pulse, inFlight: held, complete, failures, now });
  const marks: Record<string, number> = {};
  for (const slug of held) {
    const at = read.stamps[slug] ?? read.expired[slug];
    // RENEWED ONLY WHILE THE DELIVERY RUNS. An orphaned mark keeps its stamp
    // and expires, and the expiry above counts it as a failure.
    marks[slug] = live(slug) && now - at >= IN_FLIGHT_RENEW_AFTER_MS ? now : at;
  }
  // MARKED BEFORE THE SPAWN, for the reason auto-dispatch marks first: a crash
  // between the two may over-mark and never under-mark.
  for (const plan of plans) marks[plan.slug] = now;
  const pids: Record<string, number> = {};
  for (const slug of held) if (read.pids[slug] !== undefined) pids[slug] = read.pids[slug];
  const next: InFlightFile = { marks, pids, failures };
  // Unchanged: the file already says this, so skip the write.
  const markError = sameState(read, next) ? '' : writeDeliverState(opts.repoRoot, next);
  if (markError) console.log(`auto-deliver: could not record in-flight marks: ${markError}`);
  for (const slug of stopped) reportStopped(opts, slug, failures[slug]);
  if (plans.length === 0) return;

  for (const plan of plans) mine.add(plan.slug);
  runAutoDeliver(opts, plans, {
    onStart: (slug, pid) => {
      const error = updateDeliverState(opts.repoRoot, (file) => ({ ...file, pids: { ...file.pids, [slug]: pid } }));
      if (error) console.log(`auto-deliver: could not record the pid for ${slug}: ${error}`);
    },
    onEnd: (slug, ok) => {
      mine.delete(slug);
      let failure: DeliveryFailure | undefined;
      const error = updateDeliverState(opts.repoRoot, (file) => {
        const filePids = { ...file.pids };
        const fileFailures = { ...file.failures };
        delete filePids[slug];
        if (ok) {
          // A SUCCESS RESETS THE COUNT. The mark stays until the pulse
          // confirms the delivery, and expires if it never does.
          delete fileFailures[slug];
          return { marks: file.marks, pids: filePids, failures: fileFailures };
        }
        const fileMarks = { ...file.marks };
        delete fileMarks[slug];
        failure = recordDeliveryFailure(fileFailures[slug], readings.get(slug) ?? '', Date.now());
        fileFailures[slug] = failure;
        return { marks: fileMarks, pids: filePids, failures: fileFailures };
      });
      if (error) console.log(`auto-deliver: could not record the end of ${slug}: ${error}`);
      if (failure && retryVerdict(failure, failure.reading, failure.lastAt) === 'stopped') {
        reportStopped(opts, slug, failure);
      }
    },
  });
};
