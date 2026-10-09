import fs from 'node:fs';
import { askForBrief, briefAskPrompt, briefCommand } from './brief-ask.js';
import { recordActionReceipt } from './action-receipt.js';
import type { FleetSettings } from './fleet-settings-store.js';
import { refsGit, shellContext } from '@plot-pm/domain/adapters';
import {
  LIVE_STATES,
  isAnswered,
  machineDefers,
  machineIsClear,
  dispatchDefers,
  outstandingAsks,
  briefAskBudget,
  planAutoDispatch,
  pruneInFlight,
  liveAgentCount,
  liveAgentBranches,
  freeAgentCount,
  freeAgentLabels,
  skippedClaimedBranches,
  dispatchCandidates,
  skippedPlans,
  firstBrieflessBranch,
  startableBranches,
  type AutoDispatchPlan,
  type FleetReading,
  type Machine as MachineEntity,
} from '@plot-pm/domain';
import type { AgentEntry } from './registry.js';
import { DISPATCH_SCRIPT, dispatchLogPath, scriptsOf, type ActOptions } from './action-log.js';
import { readInFlight, writeInFlight } from './in-flight-store.js';
import { briefPath } from './brief-path.js';

export { briefPath };

/**
 * Branches from `candidates` whose brief does not exist on `origin/main`.
 *
 * Reads git, not the filesystem, so the board cannot be wrong about main
 * even when its own checkout lags. Measured cost: ~8-27 ms per branch, so
 * 11 candidates cost ~100-300 ms against the 5 s pulse cadence — affordable.
 *
 * The spike's numbers (2026-08-26): a board checkout 20+ commits behind held
 * 150 briefs where main held 157. Three briefs that exist would have read as
 * missing under a filesystem check. This is why we read git.
 *
 * @param repoRoot The repository root where git is run
 * @param candidates Branches to check
 * @returns The subset of candidates whose brief is missing
 */
export function findMissingBriefs(repoRoot: string, candidates: string[]): Set<string> {
  const missing = new Set<string>();
  for (const branch of candidates) {
    try {
      // Presence, asked without reading the content. Synchronous, which is fine:
      // this is already on the scan's success path and the cost is measured and
      // bounded.
      const read = refsGit(shellContext(repoRoot)).fileExistsSync(
        'origin/main',
        briefPath(branch),
      );
      // A failed reading and an absent object both count as missing — the
      // worker would face the same problem either way.
      if (!isAnswered(read) || !read.value) missing.add(branch);
    } catch {
      missing.add(branch);
    }
  }
  return missing;
}


/**
 * Fan out this pulse's plan of dispatches, detached, and return the branches
 * newly put in flight so the caller can fold them into the cache's set.
 *
 * Each plan is ONE `plot-dispatch.sh --max <n> <slug>` — the script hands up to
 * `n` of its own eligible branches to the registry. Detached and unwaited,
 * exactly as `/api/dispatch` spawns it: a dispatch queues the slice and the
 * registry matches it to an agent, strictly slower than the scan that must not
 * block on it.
 *
 * IT PUSHES NO CLAIM REF, and this sentence used to say it did. Measured
 * 2026-09-11: dispatch stopped claiming by ref push when it became a hand-over
 * to the registry (`plot-dispatch.sh` contains no `git push` at all). That is
 * precisely WHY the in-flight set has to exist and has to be shared — with no
 * ref written, nothing outside the dispatching process knows the slot is spent.
 * Output goes to the same per-slug dispatcher log the route writes, so an
 * operator reads one file whether the dispatch was clicked or automatic.
 *
 * The branches marked in flight are the plan's startable ones, capped at the
 * invocation's `max`: the script may start fewer (a branch may lose its claim
 * race), and over-marking would only make the board briefly more conservative,
 * never less — the safe direction. They are retired by {@link pruneInFlight}
 * once the pulse confirms them.
 */
export function runAutoDispatch(
  opts: ActOptions,
  pulse: FleetReading,
  plans: AutoDispatchPlan[],
  inFlight: Set<string>,
  missingBriefs: Set<string> = new Set(),
): string[] {
  const newlyInFlight: string[] = [];
  for (const plan of plans) {
    const log = dispatchLogPath(opts.repoRoot, plan.slug);
    let out: number;
    try {
      out = fs.openSync(log, 'a');
    } catch (err) {
      console.error(`auto-dispatch could not open ${log}:`, err);
      continue;
    }
    // The same receipt /api/dispatch writes, for the same reason: this IS a
    // controller acting, and the gate cannot tell a timer's dispatch from a
    // hand-typed one by the command line alone.
    recordActionReceipt(opts.repoRoot, 'dispatch', plan.slug);
    scriptsOf(opts).start(DISPATCH_SCRIPT, ['--max', String(plan.max), plan.slug], {
      log: out,
      onError: (err) => console.error('auto-dispatch failed to spawn:', err),
    });
    fs.closeSync(out);

    // Mark the branches this invocation may claim so the next pulse counts them
    // before the detached script has pushed their refs. Capped at `max`: the
    // script starts at most that many.
    const branches = startableBranches(pulse, plan.slug, inFlight, missingBriefs).slice(0, plan.max);
    newlyInFlight.push(...branches);
  }
  return newlyInFlight;
}

/**
 * Decide and dispatch in one call — the whole of auto-dispatch as `refresh` sees
 * it. Reads the controls fresh (a switch flipped this pulse takes effect now),
 * counts liveness from the registry the scan just refreshed, plans against the
 * budget, spawns, and returns the in-flight set the cache should hold next
 * pulse.
 *
 * The returned set is the pruned old set plus the newly dispatched branches, so
 * the caller assigns it whole rather than mutating — the cache's one-directional
 * rule.
 *
 * AT THE CAP, REFUSES AND NAMES THE BRANCHES. Refusing silently is what made
 * the cap invisible — see `a-worker-asks-for-the-next-wave.md`, "Counted" slice.
 * The log line names the branches occupying the slots, not just the count.
 *
 * THE CAP IS PER-REPOSITORY, NOT PER-BOARD, and this is where that is made
 * true. The live half already was: `entry.agents` comes from the SHARED agent
 * registry, so `parallelAgents − live` is the same number whoever asks. The
 * in-flight half was not — it lived in one process's memory, so a second board
 * saw an empty fleet and spent the whole budget again, reaching `2N` between the
 * two. This function reads the shared marks from `.plot/state/`, folds them into
 * the set the planner counts, and renews its own before it returns. Every read
 * and write is HERE; `planAutoDispatch` receives values and stays pure.
 */
export function maybeAutoDispatch(
  opts: ActOptions,
  pulse: FleetReading,
  controls: FleetSettings,
  agents: AgentEntry[],
  inFlight: Set<string>,
  machine?: MachineEntity,
  briefsAsked: Set<string> = new Set(),
): Set<string> {
  // THE ASK RECORD IS MUTATED, NOT RETURNED, and that is the one asymmetry in
  // this signature. The in-flight set is returned because its contents are
  // DERIVED each pulse — pruned, merged with the peers', and handed back as this
  // board's own contribution. The ask record holds the branches this board asked
  // a brief for; the caller holds the same set across pulses, and each pass
  // prunes it in place to the asks whose brief is still missing. Returning a
  // second value would change the contract every existing caller reads, to
  // express a lifetime the caller already owns.
  //
  // IN MEMORY AND PER-DAEMON: a restart loses it, the brief either landed or
  // did not, and the next pass asks again. That is the same recovery `plot-registryd.mjs` relies
  // on by holding nothing between ticks — so no state file, deliberately.
  const pruned = pruneInFlight(inFlight, pulse, agents);
  const liveCount = liveAgentCount(agents, pulse);

  // THE OTHER BOARDS' MARKS. Read fresh every pulse, uncached, for the reason
  // `readFleetSettings` is: a cache would put an authoritative copy back in this
  // process's memory, which is the defect being fixed.
  //
  // Marks this board wrote come back too, and that is deliberate — the file is
  // the answer, not a peer-only supplement, so a board recovering from a restart
  // re-adopts its own unexpired marks instead of re-dispatching what it already
  // started. `pruned` is still merged in: a mark this board holds in memory and
  // has not yet written (or failed to write) must not go uncounted.
  const shared = readInFlight(opts.repoRoot);
  // Named `allInFlight`, not `merged`: in this file `merged` means a branch that
  // LANDED (`mergedBranches`, `isFree`'s `sliceHasMerged`), and a set of
  // in-flight branches called `merged` reads as the opposite of what it holds.
  const allInFlight = new Set(pruned);
  for (const branch of shared.branches ?? []) allInFlight.add(branch);

  // RENEW THIS BOARD'S MARKS EVERY PULSE, BEFORE ANY EARLY RETURN. The marks
  // expire, so a board that stops renewing is a board whose budget comes back —
  // and the pulses where this function returns early are exactly the ones where
  // the fleet is fullest. A board sitting at the cap, or deferring on a starved
  // machine, is still holding its in-flight branches; if the renewal lived after
  // those returns, its marks would lapse after {@link IN_FLIGHT_TTL_MS} and the
  // other board would spend slots this one has already spent. That is the
  // original bug, arrived at through the fix.
  //
  // `pruned`, not `allInFlight`: this board renews what IT holds. Re-stamping a
  // peer's marks with `now` would let a dead board's budget be renewed forever
  // by a live board that never dispatched those branches.
  const renewError = writeInFlight(opts.repoRoot, pruned);
  if (renewError && controls.autoDispatch) {
    // Logged and not fatal. A board that cannot WRITE its marks still dispatches
    // — it may be the only board, and refusing here would stop a single-board
    // fleet on a permissions problem. The conservative refusal is on the READ
    // side, where an unknown shared answer can actually hide another board's
    // worker.
    console.log(`auto-dispatch: could not record in-flight marks: ${renewError}`);
  }

  if (shared.branches === null && controls.autoDispatch) {
    // NAMED, because this refusal starts nothing and an operator reading a
    // still fleet deserves the reason. The file exists and will not read, so
    // this board cannot know what the others are holding — and counting only
    // what it can see is the bug itself.
    console.log(
      `auto-dispatch: cannot read the shared in-flight record ` +
      `(${shared.error}); starting nothing this pulse — another board may ` +
      `already hold the budget`,
    );
  }

  // THE MACHINE DEFERS, AND IT SAYS WHAT IT MEASURED. Logged before the cap
  // arithmetic because it outranks it: a starved machine is not a full one, and
  // an operator reading "at cap" while the real answer is "spawn cost 287 ms"
  // would raise the dial and make it worse.
  //
  // `"too much load"` is not answerable and load average is never the verdict;
  // the sentence carries the number so a person can act on it — including by
  // setting `Machine override` and saying now anyway.
  if (controls.autoDispatch) {
    const deferral = machineDefers(machine, controls);
    if (deferral) {
      const hasEligible = pulse.plans.some(
        (p) => p.phase === 'approved' && p.slices.some((w) => w.verdict === 'eligible'),
      );
      // Same rule as the cap refusal: a deferral with nothing to dispatch is
      // routine, not a decision anybody needs to read every five seconds.
      if (hasEligible) console.log(`auto-dispatch: ${deferral}`);
      // This board's own set, never the merged one — see the ownership note
      // on the final return. An early return must not adopt a peer's marks.
      return pruned;
    }
    // NOT CLEAR, BUT NOT STARVED EITHER — the `tight` band, which dispatches.
    // Said out loud because a fleet that feels slow while nothing refuses is
    // the case an operator otherwise has no reading for; this is the one line
    // that distinguishes *the machine is working hard* from *Plot is stuck*.
    if (machine && !machineIsClear(machine) && !dispatchDefers(machine)) {
      console.log(
        `auto-dispatch: machine reads ${machine.headroom} ` +
        `(spawn cost ${machine.spawnCostMs?.toFixed(1) ?? 'unmeasured'} ms); dispatching anyway`,
      );
    }
  }

  // Check if we're at the cap BEFORE calling planAutoDispatch, so we can log
  // meaningfully. The switch being off is a deliberate absence, not a refusal;
  // the cap being reached is what needed visibility.
  if (controls.autoDispatch) {
    const budget = controls.parallelAgents - (liveCount + allInFlight.size);
    if (budget <= 0) {
      // THE SAME ARITHMETIC AND THE SAME SECOND QUESTION as `planAutoDispatch`.
      // These two must not diverge: this branch decides whether to log a
      // refusal, and the planner decides whether to dispatch. If this refused
      // where the planner dispatches, the board would print "refusing" on the
      // pulse it started a worker.
      const free = freeAgentCount(agents, pulse);
      if (free <= 0) {
        const liveBranches = liveAgentBranches(agents, pulse);
        const inFlightList = [...allInFlight];
        // Only log when there IS something to dispatch — a cap hit with no
        // eligible work is routine, not a refusal.
        const hasEligible = pulse.plans.some(
          (p) => p.phase === 'approved' && p.slices.some((w) => w.verdict === 'eligible'),
        );
        if (hasEligible) {
          // NAMES WHICH OF THE TWO IT IS. "At the cap" alone was ambiguous
          // between *every machine is held* and *nobody can take work*; the
          // second clause is what tells a reader whether waiting will help.
          console.log(
            `auto-dispatch: at cap (${controls.parallelAgents}) and no free agent, ` +
            `refusing new dispatch. Slots held by: ` +
            `${[...liveBranches, ...inFlightList].join(', ') || '(in-flight only)'}`,
          );
        }
        return pruned;
      }
      // At the cap, but an agent can take a slice — the slot is already paid
      // for, so this is not a refusal and the planner proceeds below.
      console.log(
        `auto-dispatch: at cap (${controls.parallelAgents}) but ${free} free ` +
        `agent(s) can take a slice: ${freeAgentLabels(agents, pulse).join(', ')}`,
      );
    }
  }

  // NAMES A CLAIMED BRANCH IT SKIPPED, ONCE PER PULSE. A `wip` branch whose ref
  // already exists cannot be claimed — `plot-dispatch.sh` refuses it — so the
  // budget is withheld rather than spent on a refusal (the measured defect,
  // 2026-08-25). Silently withholding it is what made the budget look broken:
  // the only recourse was to replay the planner by hand against the pulse JSON.
  // Logged here, off the cap path, so a cap refusal and a claim skip are two
  // distinct sentences and neither repeats the other. One call per pulse.
  if (controls.autoDispatch) {
    const skipped = skippedClaimedBranches(pulse, allInFlight);
    if (skipped.length > 0) {
      console.log(
        `auto-dispatch: skipping claimed branch(es) a dispatch cannot start ` +
        `(ref already exists): ${skipped.join(', ')}`,
      );
    }
  }

  // Check which dispatchable branches lack a brief on origin/main. A slice with
  // no brief is not started — see `a-worker-starts-with-its-brief.md`.
  //
  // This is the impure side: `findMissingBriefs` spawns `git cat-file -e` per
  // candidate. The cost is ~8-27 ms per branch (measured 2026-08-26), so 11
  // candidates add ~100-300 ms to the pulse — affordable against the 5 s cadence.
  //
  // The check reads `origin/main`, not the filesystem, so the board cannot be
  // wrong about main even when its own checkout lags. The spike measured a
  // checkout 20+ commits behind main, missing 7 briefs — filesystem reads would
  // have refused starts that should have happened.
  const candidates = controls.autoDispatch ? dispatchCandidates(pulse, allInFlight) : [];
  const missingBriefs = controls.autoDispatch
    ? findMissingBriefs(opts.repoRoot, candidates)
    : new Set<string>();

  // Log which branches auto-dispatch is skipping for missing briefs, once per
  // pulse. Same pattern as the claimed-branch skip above: a refusal nobody sees
  // is the defect this slice removes.
  // AN ASK HOLDS ITS SLOT ONLY WHILE ITS BRIEF IS MISSING. Pruned here, after
  // this pass read `origin/<main>` and before any budget reads the tally, and
  // written back into the caller's set so the cache entry keeps the pruned
  // record. A branch whose brief landed, or that left the candidates, drops.
  const kept = outstandingAsks(briefsAsked, missingBriefs);
  for (const branch of briefsAsked) if (!kept.has(branch)) briefsAsked.delete(branch);

  if (controls.autoDispatch && missingBriefs.size > 0) {
    const missing = [...missingBriefs];
    console.log(
      `auto-dispatch: skipping branch(es) with no brief on origin/main ` +
      `(run /plot-implement first): ${missing.join(', ')}`,
    );
  }

  // NAMES THE PLAN AND THE REASON, ONCE PER PULSE — the PLAN-level decision
  // `planAutoDispatch` makes at `if (startable === 0) continue;` and has until
  // now made in silence. The branch logs above already say which branches were
  // skipped; what nothing said is that a whole plan left the candidate list,
  // and for which of four reasons.
  //
  // Printed BEFORE the planner runs and derived from the same three filters, so
  // the sentence and the dispatch cannot describe different pulses. A reason is
  // a name a reader can act on — `no-brief` is a person's next move,
  // `no-eligible-wave` asks for nothing — which is what makes a plan skipped
  // for briefs distinguishable from one skipped for anything else.
  if (controls.autoDispatch) {
    const skipped = skippedPlans(pulse, allInFlight, missingBriefs);
    if (skipped.length > 0) {
      console.log(
        `auto-dispatch: skipping plan(s) with nothing startable: ` +
        `${skipped.map((p) => `${p.slug} (${p.reason})`).join(', ')}`,
      );
    }

    // ASK FOR THE BRIEF THE SKIP ABOVE JUST NAMED.
    //
    // A plan reported `no-brief` is approved, has an eligible slice, holds no
    // blocking ref and is not in flight — `skippedPlans` checks briefs LAST, so
    // the only thing between it and a worker is a file nobody has written.
    // Measured 2026-09-12 across seven dispatches in one session: every one
    // reported `brief_asked=1 dispatched=0` on the first pass, and the claim
    // followed 60-75 seconds later once a human's brief reached `origin/main`.
    // The board was never the slow part.
    //
    // NOTHING IS CLAIMED ON THIS PASS, and that is not a limitation to fix. The
    // gate reads `origin/<main>` rather than the filesystem, so a brief written
    // this instant is still invisible to it; the next pulse finds it and claims
    // normally. A pass that spawned and then dispatched the same branch would be
    // dispatching against a brief that is not there.
    //
    // AFTER the skip log, so the two sentences read in the order they happened:
    // the plan was skipped, and then it was asked for.
    const asking = skipped.filter((p) => p.reason === 'no-brief');
    if (asking.length > 0) {
      // THE BUDGET, BECAUSE A BRIEF WRITER COSTS AN AGENT. A `claude -p` brief
      // session is a process like any other, so asking while the cap is spent
      // starts work the operator capped. The same arithmetic the cap refusal and
      // the planner use — and the asks already outstanding are charged too,
      // which is what stops N pulses from starting N writers for N plans while
      // none of them has landed.
      //
      // A FREE AGENT IS NOT CHARGED. It holds no branch and is waiting for
      // exactly the brief this budget would otherwise refuse. The dispatch
      // budget above keeps `liveCount`, because a free agent does take a slice.
      const LIVE_SET = new Set<string>(LIVE_STATES);
      const busyAgents = agents.filter((a) => LIVE_SET.has(a.state) && a.branch).length;
      let askBudget = briefAskBudget({
        cap: controls.parallelAgents,
        busyAgents,
        inFlight: allInFlight.size,
        outstanding: briefsAsked.size,
      });
      // READ FRESH, never cached at startup: a key added while the board runs
      // takes effect on the next pulse. An unset or `none` command answers ''
      // and this whole block does nothing — today's behaviour exactly, which is
      // Principle 5: Plot hardcodes no agent tooling.
      const command = askBudget > 0 ? briefCommand(opts) : '';
      for (const plan of asking) {
        if (askBudget <= 0) break;
        // ONE ASK PER BRANCH, AND NEVER A SECOND WHILE ONE IS OUTSTANDING.
        // Measured 2026-09-11: a foreground dispatch timed out at 2 minutes
        // while `timeout 300` on the inner script outlived it, and re-running
        // produced two `claude -p` briefs for one slug. Keyed by branch, so a
        // plan's later slice is asked for once its first slice's brief landed.
        if (!command) continue;
        const branch = firstBrieflessBranch(pulse, plan.slug, missingBriefs);
        // A plan reported `no-brief` has one by construction; the guard is for a
        // caller that hands in a reason and a pulse that disagree.
        if (!branch) continue;
        if (briefsAsked.has(branch)) continue;
        const log = askForBrief(
          opts,
          command,
          plan.slug,
          briefAskPrompt(plan.slug, branch, pulse.main),
        );
        // MARKED EVEN WHEN THE SPAWN FAILED. `askForBrief` reports and returns
        // '' rather than throwing, and marking anyway is the conservative
        // direction: a board that re-asked every pulse on a broken command would
        // write a process per pulse. The restart clears it.
        briefsAsked.add(branch);
        askBudget -= 1;
        // THE ASK IS REPORTED, in the same voice as the skips above, so an
        // operator reading the console sees the fleet acting rather than idling.
        console.log(
          `auto-dispatch: asked the Brief command to write ${plan.slug}'s brief ` +
          `for ${branch}${log ? ` — log: ${log}` : ''}; claiming nothing this pass ` +
          `(the gate reads origin/${pulse.main})`,
        );
      }
    }
  }

  const plans = planAutoDispatch({
    controls,
    pulse,
    liveCount,
    // The same reading this function already logged about, so the planner's
    // machine question and the sentence above cannot answer differently.
    machine,
    // The registry the cap was measured against, so the planner's free-agent
    // question is asked of the same fleet this function just logged about.
    agents,
    // THIS BOARD'S MARKS PLUS EVERY OTHER BOARD'S. The planner charges the
    // budget for all of them and drops all of them from the startable set, so a
    // branch another board dispatched two seconds ago is neither started again
    // nor counted as free capacity.
    inFlight: allInFlight,
    // The one fact the merged set cannot carry: whether the merge is complete.
    // Read here, handed in as a value — the planner stays pure.
    sharedInFlight: shared.branches !== null,
    missingBriefs,
  });

  if (plans.length === 0) return pruned;

  // MARKED BEFORE THE SPAWN, NOT AFTER, and the order is the whole point. The
  // window this slice closes is the one between deciding and being visible, so a
  // mark written after the spawn leaves it open at its widest — and a crash
  // between the two would leave a dispatch running that no board is charged for,
  // which is the failure direction the plan forbids. Marking first can only
  // over-mark (the script may start fewer than planned), and `runAutoDispatch`
  // already states that asymmetry: over-marking makes the board briefly more
  // conservative, never less.
  //
  // The branches are the ones `runAutoDispatch` will mark, derived by the same
  // call with the same arguments — `startableBranches` is pure, so asking it
  // twice cannot answer differently, and the spawn side keeps its own reading
  // rather than being handed one.
  const willStart: string[] = [];
  for (const plan of plans) {
    willStart.push(
      ...startableBranches(pulse, plan.slug, allInFlight, missingBriefs).slice(0, plan.max),
    );
  }

  // THIS BOARD'S OWN: `pruned` plus what it is about to start, and never the
  // shared marks it merely read. Re-stamping a peer's marks with `now` would let
  // a dead board's budget be renewed indefinitely by a live board that never
  // dispatched those branches — the marks would stop expiring and the TTL would
  // buy nothing. `writeInFlight` merges, so the peer's marks survive this write
  // on their own timestamps; they are simply not refreshed by a board that does
  // not own them.
  const owned = new Set(pruned);
  for (const b of willStart) owned.add(b);
  const markError = writeInFlight(opts.repoRoot, owned);
  if (markError) {
    console.log(`auto-dispatch: could not record in-flight marks: ${markError}`);
  }

  const newly = runAutoDispatch(opts, pulse, plans, allInFlight, missingBriefs);
  for (const b of newly) owned.add(b);

  // THE RETURNED SET IS THIS BOARD'S, NOT THE MERGED ONE, and that is the same
  // ownership rule the write above keeps. The caller assigns this to
  // `entry.autoInFlight`, which is what the NEXT pulse renews; returning the
  // merged set would make this board adopt every peer mark as its own and renew
  // it forever, so a board that died would have its budget held by whichever
  // board happened to read the file. The peers' marks are re-read fresh every
  // pulse instead — the file is the shared answer, and this set is only ever
  // this board's contribution to it.
  return owned;
}
