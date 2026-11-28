import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scriptsFor, primeAgentSettings, refsFor, hostFor, gateContractFor, type BuildBoardOptions } from '../board.js';
import { estateFromEnv, realEstate } from '../estate.js';
import { leaveBoardRunsToTheBoard } from '../board-run.js';
import { gatherReadingsAndRelease } from '../release-claim.js';
import { stateHomeAtSync } from '@plot-pm/domain/adapters/main-checkout';
import { stateHomeReadOf } from '@plot-pm/domain';
import { baseBranchIn, baseRepairIn, repairRecordIn, stateHomeFor } from '../state-home.js';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { CALLER_ENV, fleetdStartFile, prIndexFile, readFleetdHeartbeatSync } from '@plot-pm/domain/adapters';
import { deliveryMetrics, deliveryMetricsLines, lastIsoWeeks, planTransitionsOf, type PlanTransitions } from '@plot-pm/domain/rules/delivery-metrics';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';
import { hostTransportStatusLine } from '@plot-pm/domain/rules/host-transport';
import { trackerTransportStatusLine } from '@plot-pm/domain/rules/tracker-transport';
import { spawnerStatus, spawnerStatusText, spawnerStatusLines, bundleDriftDetected, bundleDriftText } from '@plot-pm/domain/rules/spawn-contract';
import { callerOf } from '@plot-pm/domain/workflows/decision';
import { askOnce, askOncePerEstate, newMemory, type Question } from './ask.js';
import { mergeAt, nameRepairPrAt } from './merge.js';
import { releaseApproveAt } from './release-approve.js';
import { finishContextFor, mergePortsFor, versionFinishContextFor } from './merge-ports.js';
import { finishExitCode, finishRelease, finishReleaseVersion, releaseVersionArg } from './release-finish.js';
import { recordActionReceipt } from '../action-receipt.js';
import { planGateAnswer, planGateAskFrom } from './plangate.js';
import { licensedSpike } from '@plot-pm/domain/rules/spike';
import type { PlanStore } from '@plot-pm/domain/ports/plan-store';
import { deskLiveness, resolveManifestDirAsync } from '@plot-pm/fleet/shared/registry';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';

/**
 * The `node` entry point a skill runs.
 *
 * ```
 * node skills/plot/scripts/board/plot-ask.mjs board
 * node skills/plot/scripts/board/plot-ask.mjs fleet
 * node skills/plot/scripts/board/plot-ask.mjs deliverable <slug> <plan-file>
 * node skills/plot/scripts/board/plot-ask.mjs release-claim <branch>
 * node skills/plot/scripts/board/plot-ask.mjs merge <pr> <sha>
 * node skills/plot/scripts/board/plot-ask.mjs release-approve <pr> <sha>
 * node skills/plot/scripts/board/plot-ask.mjs release-finish <version>
 * node skills/plot/scripts/board/plot-ask.mjs repair-pr <pr>
 * node skills/plot/scripts/board/plot-ask.mjs spike <slug> [<plan-file>]
 * node skills/plot/scripts/board/plot-ask.mjs spawner [pid] [--lines]
 * node skills/plot/scripts/board/plot-ask.mjs desk-states <desk>...
 * node skills/plot/scripts/board/plot-ask.mjs desk-quiet <desk>...
 * node skills/plot/scripts/board/plot-ask.mjs metrics [--weeks N]
 * <GET /api/board body> | node skills/plot/scripts/board/plot-ask.mjs spawner --from-board [--lines]
 * <plan-meta JSON> | node skills/plot/scripts/board/plot-ask.mjs plangate --slug <slug> --default-branch <main> [--source <text>] [--ref-resolved] [--allow-local]
 * ```
 *
 * **`release-claim` is a WRITE, not a `Question`.** The three questions above
 * answer `Board | Fleet | DeliverabilityAnswer` through `askOnce`'s ternary;
 * this one runs {@link gatherReadingsAndRelease} — the SAME function
 * `POST /api/release-claim` calls — directly, so there is exactly one
 * computation of "is this branch releasable" reached from two callers. It does
 * not join `Question`/`askOnce`: that machinery is built around read-only
 * answers with no action to perform, and widening it for one write would make
 * it the general action dispatcher the plan this implements explicitly rules
 * out.
 *
 * **A SECOND artifact rather than a flag on the board's.** `index.ts` binds a
 * port the moment it is imported, so a `--json` flag on it would mean a skill
 * that asks a question also starts a server and has to be told to stop. The two
 * entry points share every line below the controller and differ only in who
 * calls it — which is exactly the seam this plan built.
 *
 * **`merge` IS A WRITE TOO, AND IT FOLLOWS THE SAME SHAPE.** It dispatches on
 * `argv[0]` before {@link questionFrom} and prints one JSON line; it exits 0
 * when the PR merged and 1 when a rule or the host refused, the reason being in
 * the line. {@link mergeAt} is the workflow's caller.
 *
 * **`repair-pr` IS A WRITE OF THE SAME SHAPE.** It records a PR as the repair
 * PR of the open red episode on `.plot/state/repair-record.json`, through
 * {@link nameRepairPrAt}, and prints one JSON line; it exits 0 when the record
 * names the PR and 1 on a refusal. A person runs it: `PLOT_UNATTENDED=1` maps
 * to the `unattended` caller, which refuses before any read.
 *
 * **`spike` answers one line of words, not JSON.** It reads a plan through the
 * plan store and answers `licensedSpike` over that one record: `licensed <branch> <date>`
 * exits 0, `unlicensed <reason> <date or ->` exits 1, and `unaskable <why>`
 * exits 2 where no plan file matches the slug or the file does not parse as a
 * plan. `<plan-file>` names the file to read instead of the configured plan
 * directory's, for a caller that parsed a plan from another commit.
 *
 * **`metrics` prints a table of words, not JSON.** One header line and one
 * line per ISO week, oldest first, from {@link deliveryMetricsLines}: the plan
 * files on `origin/<default branch>` and the PR index's MERGED rows, over the
 * last `N` weeks (8 by default). It asks no host. An index that is missing,
 * unparseable or of another version prints `unread` in the merged column.
 * Exit 0 prints the table, 2 is a usage error or a plan directory git cannot
 * list, which prints `unaskable plans-unread`.
 *
 * The other answers go to stdout as JSON and nothing else does. Diagnostics go to
 * stderr, so a caller can pipe stdout into a parser the way
 * `plot-sprint-candidates.sh` does — the precedent the plan cites, and the same
 * reason it gives: node is already required to run the board and every test
 * suite.
 */

/** Where the plot helper scripts sit, relative to this artifact. */
const scriptsDirFor = (here: string): string =>
  process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..');

/**
 * The configured plan directory, read the way every other helper reads config.
 *
 * Through the `Scripts` port rather than a second parser: the key has a default
 * and an override, and a duplicate reader is how the two drift. A repo that
 * cannot be asked falls back to the same default the script does.
 */
const planDirFor = (opts: BuildBoardOptions): string => {
  const answer = scriptsFor(opts).configSync('Plan directory', 'docs/plans/');
  if (!answer.ok) return 'docs/plans';
  return (answer.value.trim() || 'docs/plans/').replace(/\/$/, '');
};

/**
 * The plan file a slug names in the plan directory: `<slug>.md` or `<date>-<slug>.md`.
 *
 * @param repoRoot - the repository root.
 * @param planDir - the configured plan directory, relative to the root.
 * @param slug - the plan's slug.
 * @returns the path relative to the root, or null where no file matches.
 */
const planFileOfSlug = (repoRoot: string, planDir: string, slug: string): string | null => {
  let entries: string[];
  try {
    entries = readdirSync(path.join(repoRoot, planDir));
  } catch {
    return null;
  }
  const hit = entries.find((e) => e === `${slug}.md` || (/^\d{4}-\d{2}-\d{2}-/.test(e) && e.slice(11) === `${slug}.md`));
  return hit === undefined ? null : path.join(planDir, hit);
};

/**
 * The `spike` answer line and exit code for one plan file.
 *
 * @param store - the plan store that reads the file.
 * @param file - the plan file, absolute or relative to the repository root.
 * @returns the line to print and the exit code: 0 licensed, 1 unlicensed, 2 unaskable.
 */
export const spikeAnswerOf = async (store: PlanStore, file: string): Promise<{ line: string; code: number }> => {
  const read = await store.readPlan(file);
  if (!read.ok || read.value.format === 'none') return { line: 'unaskable plan-unreadable', code: 2 };
  const date = read.value.spikeApprovedRaw.split(',')[0]?.trim() || '-';
  const answer = licensedSpike(read.value.spikeApprovedRaw, read.value.slices);
  return answer.licensed
    ? { line: `licensed ${answer.branch} ${date}`, code: 0 }
    : { line: `unlicensed ${answer.reason} ${date}`, code: 1 };
};

/** The number of weeks `metrics` prints when `--weeks` is not given. */
export const METRICS_DEFAULT_WEEKS = 8;

/**
 * The week count `metrics` was asked for.
 *
 * @param args - the arguments after `metrics`.
 * @returns the count, or null where the arguments are not `[]` or `--weeks <1-9999>`.
 */
export const metricsWeeksArg = (args: readonly string[]): number | null => {
  if (args.length === 0) return METRICS_DEFAULT_WEEKS;
  if (args.length === 2 && args[0] === '--weeks' && /^[1-9]\d{0,3}$/.test(args[1])) return Number(args[1]);
  return null;
};

/**
 * The transition records of every plan file directly in the plan directory on
 * `origin/<default branch>`, read in one listing and one batch read.
 *
 * @param refs - the repository's refs port.
 * @param planDir - the configured plan directory, relative to the root.
 * @returns the records, or null where the default branch or its plan directory cannot be read.
 */
export const defaultBranchPlans = async (refs: Refs, planDir: string): Promise<PlanTransitions[] | null> => {
  const branch = await refs.defaultBranch();
  if (!branch.ok || branch.value.trim() === '') return null;
  const listed = await refs.listBlobs(`origin/${branch.value.trim()}`, planDir);
  if (!listed.ok) return null;
  const files = listed.value.filter(
    (blob) => (blob.mode === '100644' || blob.mode === '100755') && path.posix.dirname(blob.path) === planDir && blob.path.endsWith('.md'),
  );
  if (files.length === 0) return [];
  const read = await refs.readBlobs(files.map((blob) => blob.sha));
  if (!read.ok) return null;
  return files.flatMap((blob) => {
    const text = read.value.get(blob.sha);
    return text === undefined ? [] : [planTransitionsOf(text)];
  });
};

/**
 * The `mergedAt` of every MERGED row in this repository's PR index.
 *
 * The connector is the git host's backend word, which `plot-host.sh backend`
 * reads from config and the remote URL without a network call.
 *
 * @param host - the git host port, asked only for its backend word.
 * @param repoRoot - the checkout whose common git dir holds the index.
 * @returns the timestamps, or null where the backend, the file or its version cannot be read.
 */
export const indexMergedAt = async (host: Host, repoRoot: string): Promise<string[] | null> => {
  const backend = await host.backend();
  if (!backend.ok) return null;
  const held = await prIndexFile({ cwd: repoRoot }).read(backend.value);
  if (!held.ok || held.value === null) return null;
  return held.value.rows.flatMap((row) => (row.state === 'MERGED' && row.mergedAt !== undefined ? [row.mergedAt] : []));
};

/** Everything the entry point needs, assembled from the environment. */
export interface EntryContext {
  opts: BuildBoardOptions;
  planDir: string;
}

/**
 * Assemble the context this process runs in.
 *
 * The same two environment variables the board reads, so a caller that can
 * point the board at a repo can point this at the same one.
 *
 * @param here the directory this artifact sits in
 * @returns the estate options and the configured plan directory
 */
export const contextFrom = (here: string): EntryContext => {
  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const opts: BuildBoardOptions = {
    repoRoot,
    scriptsDir: scriptsDirFor(here),
    // The four state files live under the main checkout, also from a linked worktree.
    stateHome: stateHomeAtSync(repoRoot),
  };
  return { opts, planDir: planDirFor(opts) };
};

/**
 * Parse the one argument this entry point takes.
 *
 * @param argv the process arguments after the script name
 * @returns the question asked, or null when it is not one this answers
 */
export const questionFrom = (argv: string[]): Question | null => {
  const asked = argv[0];
  return asked === 'board' || asked === 'fleet' || asked === 'deliverable' ? asked : null;
};

/**
 * Answer one question and print it.
 *
 * **`askOnce`, not `askOncePerEstate`, and the difference is the point.** One
 * process asking one question has no previous answer to re-use; the memory that
 * makes the gate cheap belongs to the CALLER that asks twice, which is why it
 * is a parameter there rather than a global here. A per-process cache would
 * save nothing and would need a lifetime nobody could state.
 *
 * @param argv the process arguments after the script name
 * @param here the directory this artifact sits in
 * @param write where the answer goes
 * @returns the process exit code
 */
export const run = async (
  argv: string[],
  here: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  // A ONE-SHOT PROCESS STARTS NO BOARD-ROLE AGENT. `maybeAutoDispatch` can ask
  // for a brief and `maybeAutoDeliver` can start a delivery; here either would
  // run in this process's group and end with it, and waiting for it would hold
  // the caller for the agent's whole run. The running board starts them on its
  // next pass.
  leaveBoardRunsToTheBoard(true);

  if (argv[0] === 'release-claim') {
    const branch = argv[1];
    if (!branch) {
      process.stderr.write('usage: plot-ask.mjs release-claim <branch>\n');
      return 2;
    }
    const { opts } = contextFrom(here);
    const { result } = await gatherReadingsAndRelease(branch, {
      repoRoot: opts.repoRoot,
      scriptDir: opts.scriptsDir,
    });
    write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  if (argv[0] === 'merge') {
    const [, pr, sha] = argv;
    if (!pr || !sha || !/^[0-9]+$/.test(pr) || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      process.stderr.write('usage: plot-ask.mjs merge <pr> <sha>\n');
      return 2;
    }
    const { opts } = contextFrom(here);
    const result = await mergeAt(await mergePortsFor(opts), Number(pr), sha);
    write(`${JSON.stringify(result)}\n`);
    return result.merged ? 0 : 1;
  }

  if (argv[0] === 'release-approve') {
    const [, pr, sha] = argv;
    if (!pr || !sha || !/^[0-9]+$/.test(pr) || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      process.stderr.write('usage: plot-ask.mjs release-approve <pr> <sha>\n');
      return 2;
    }
    const { opts } = contextFrom(here);
    recordActionReceipt(opts.repoRoot, 'release-approve', pr);
    const ports = await mergePortsFor(opts);
    // The command line carries no passkey assertion, so it is refused
    // `person-unproven` whatever its caller reads: the approval is the board button's.
    const result = await releaseApproveAt(ports, Number(pr), sha, 'none');
    write(`${JSON.stringify(result)}\n`);
    if (!result.approved) return 1;
    // The finish runs as the person: an unattended caller was refused above.
    return finishRelease(
      finishContextFor(opts, ports),
      Number(pr),
      (s) => write(s),
      (s) => process.stderr.write(s),
    );
  }

  if (argv[0] === 'release-finish') {
    // A PERSON'S COMMAND, refused unattended before it reads anything. It books
    // plan records and a sprint close in one revertible commit, so it carries no
    // passkey assertion.
    if (process.env.PLOT_UNATTENDED === '1') {
      process.stderr.write('plot-ask: release-finish: unattended: a release finish needs a person; PLOT_UNATTENDED=1 is set, so nothing is read or written.\n');
      return 1;
    }
    const [, version] = argv;
    if (!version || argv.length > 2 || releaseVersionArg(version) === null) {
      process.stderr.write('usage: plot-ask.mjs release-finish <version>\n');
      return 2;
    }
    const { opts } = contextFrom(here);
    const outcome = await finishReleaseVersion(
      versionFinishContextFor(opts),
      version,
      (s) => write(s),
      (s) => process.stderr.write(s),
    );
    return finishExitCode(outcome);
  }

  if (argv[0] === 'repair-pr') {
    const [, pr] = argv;
    if (!pr || !/^[0-9]+$/.test(pr) || argv.length > 2) {
      process.stderr.write('usage: plot-ask.mjs repair-pr <pr>\n');
      return 2;
    }
    const { opts } = contextFrom(here);
    // The real estate, as for `merge`: the record names a PR that `merge` admits on the real host.
    const estate = realEstate(opts);
    const home = stateHomeFor(opts);
    const result = await nameRepairPrAt(
      {
        host: estate.host,
        refs: estate.refs,
        defaultBranch: estate.defaultBranch,
        repair: repairRecordIn(home),
        baseBranch: (base) => baseBranchIn(home, base),
        baseRepair: (base) => baseRepairIn(home, base),
        stateHome: stateHomeReadOf(home),
        caller: callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' }),
      },
      Number(pr),
    );
    write(`${JSON.stringify(result)}\n`);
    return result.named ? 0 : 1;
  }

  if (argv[0] === 'metrics') {
    const weeks = metricsWeeksArg(argv.slice(1));
    if (weeks === null) {
      process.stderr.write('usage: plot-ask.mjs metrics [--weeks N]\n');
      return 2;
    }
    const { opts, planDir } = contextFrom(here);
    const plans = await defaultBranchPlans(refsFor(opts), planDir);
    if (plans === null) {
      write('unaskable plans-unread\n');
      return 2;
    }
    const merged = await indexMergedAt(hostFor(opts), opts.repoRoot);
    for (const line of deliveryMetricsLines(deliveryMetrics(plans, merged, lastIsoWeeks(Date.now(), weeks)))) write(`${line}\n`);
    return 0;
  }

  if (argv[0] === 'spike') {
    const [, slug, given] = argv;
    if (!slug || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || argv.length > 3) {
      process.stderr.write('usage: plot-ask.mjs spike <slug> [<plan-file>]\n');
      return 2;
    }
    const { opts, planDir } = contextFrom(here);
    const file = given ?? planFileOfSlug(opts.repoRoot, planDir, slug);
    if (file === null) {
      write('unaskable plan-not-found\n');
      return 2;
    }
    const { line, code } = await spikeAnswerOf(estateFromEnv(opts).planStore, file);
    write(`${line}\n`);
    return code;
  }

  if (argv[0] === 'spawner' && argv[1] === '--from-board') {
    // The board's OWN spawn contract, reported through `/api/board` rather
    // than `fleetd-start.json` — `plot-boardctl.sh --status` is the one
    // caller, and it already fetched that body for `served=`/`answers:`
    // above. It pipes the whole body in, and this mode reads its
    // `spawnContract` object: ONE fetch is also the source for this line, and
    // no JSON is parsed in shell.
    //
    // `--lines` prints the finished, indented `--status` lines, and nothing
    // for a body with no `spawnContract` (a board built before #2728).
    //
    // There is no independent process to compare a pid against — the board's
    // own reply IS proof it is the process running right now — so this uses
    // the same sentinel pid the board's own `AgentList.tsx` uses for its
    // identical call (`WIRE_IDENTITY_PID`), never a real one.
    const raw = readFileSync(0, 'utf8');
    let parsed: { spawnContract: number; bundlePath: string; bundleHash: string | null; runningBundleHash: string | null; gateNumber: number | null; gatePath: string } | null = null;
    try {
      parsed = JSON.parse(raw)?.spawnContract ?? null;
    } catch {
      parsed = null;
    }
    const identity = parsed ? { pid: 1, spawnContract: parsed.spawnContract } : null;
    const verdict = spawnerStatus(identity, 1, parsed?.gateNumber ?? null);
    const drifted = parsed ? bundleDriftDetected(parsed.bundleHash, parsed.runningBundleHash) : false;
    if (argv.includes('--lines')) {
      if (parsed) write(spawnerStatusLines(verdict, drifted ? bundleDriftText(parsed.bundlePath) : null));
      return 0;
    }
    write(`${JSON.stringify({
      status: spawnerStatusText(verdict),
      verdict,
      bundlePath: parsed?.bundlePath ?? null,
      bundleDrift: drifted,
      bundleDriftText: drifted && parsed ? bundleDriftText(parsed.bundlePath) : null,
      gatePath: parsed?.gatePath ?? null,
      gateNumber: parsed?.gateNumber ?? null,
    })}\n`);
    return 0;
  }

  if (argv[0] === 'spawner') {
    // fleetd's own spawn contract against the gate's — #2728 (docs/plans/
    // 2026-10-26-a-board-or-fleetd-older-than.md). `plot-fleetctl.sh --status`
    // is the one caller; it has no gate/hash-resolution logic of its own and
    // never duplicates `spawnerStatus`/`bundleDriftDetected`.  REPORT ONLY:
    // this reads `fleetd-start.json` and a gate's answer and prints a verdict;
    // it starts, stops, kicks and reloads nothing.
    //
    // `argv[1]` is the LIVE pid the caller already observed (e.g.
    // `plot-fleetctl.sh`'s own `$sup_pid`, read straight from the supervisor).
    // Without it there is no independent process to compare the record
    // against, so the record's own pid is the only candidate — a caller that
    // omits it can never see `unknown` from a pid mismatch, only from a
    // missing record or an unanswered gate.
    //
    // `--lines` prints the finished, indented `--status` lines instead of JSON.
    const { opts } = contextFrom(here);
    const record = await fleetdStartFile({ cwd: opts.repoRoot }).read();
    const identity = record.ok && record.value ? { pid: record.value.pid, spawnContract: record.value.spawnContract } : null;
    const resolved = await gateContractFor(opts).resolve(opts.repoRoot);
    const gatePath = resolved.ok ? resolved.value.path : null;
    const answered = resolved.ok ? await gateContractFor(opts).spawnContract(resolved.value.path) : null;
    const gateAnswer = answered?.ok ? answered.value : null;
    const liveArg = argv[1] ? Number(argv[1]) : null;
    const runningPid = liveArg !== null && Number.isInteger(liveArg) ? liveArg : record.ok && record.value ? record.value.pid : -1;
    const verdict = spawnerStatus(identity, runningPid, gateAnswer);
    let runningHash: string | null = null;
    if (record.ok && record.value) {
      const hashed = refsFor(opts).hashFilesSync([record.value.bundlePath]);
      runningHash = hashed.ok ? hashed.value.get(record.value.bundlePath) ?? null : null;
    }
    const drifted = record.ok && record.value ? bundleDriftDetected(record.value.bundleHash, runningHash) : false;
    const driftText = drifted && record.ok && record.value ? bundleDriftText(record.value.bundlePath) : null;
    if (argv.includes('--lines')) {
      // The transport fleetd published with its heartbeat: in-process or shell, and why.
      const home = stateHomeFor(opts);
      const beating = 'home' in home ? readFleetdHeartbeatSync(home.home) : null;
      write(spawnerStatusLines(verdict, driftText) + hostTransportStatusLine(beating?.hostTransport) + trackerTransportStatusLine(beating?.trackerTransport));
      return 0;
    }
    write(`${JSON.stringify({
      status: spawnerStatusText(verdict),
      verdict,
      bundlePath: record.ok && record.value ? record.value.bundlePath : null,
      bundleDrift: drifted,
      bundleDriftText: driftText,
      gatePath,
      gateNumber: gateAnswer,
    })}\n`);
    return 0;
  }

  if (argv[0] === 'desk-states') {
    // The board's state of each desk, for `plot-fleetctl.sh --status` to print
    // beside the shell's own: one line `<desk>\t<state>` per argument, in
    // order, `unknown` for every desk where the batch could not be read.
    const desks = argv.slice(1);
    const { opts } = contextFrom(here);
    const manifestDir = await resolveManifestDirAsync(opts.repoRoot, { scriptsDir: opts.scriptsDir });
    const log = (line: string): void => {
      process.stderr.write(`${line}\n`);
    };
    const states = await deskLiveness(opts.repoRoot, opts.scriptsDir, manifestDir, log)(desks);
    for (const [i, desk] of desks.entries()) write(`${desk}\t${states.length === desks.length ? states[i] : 'unknown'}\n`);
    return 0;
  }

  if (argv[0] === 'desk-quiet') {
    // Seconds since each desk's newest live signal, for `plot-fleetctl.sh
    // --status`: one line `<desk>\t<seconds>` per argument, in order, and an
    // empty second field where the rule answers `null` or the read fails.
    const { opts } = contextFrom(here);
    const trees = treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
    const desks = argv.slice(1);
    const readings = await Promise.all(desks.map((desk) => trees.logQuietSeconds?.(desk)));
    for (const [i, desk] of desks.entries()) {
      const reading = readings[i];
      write(`${desk}\t${reading?.ok && reading.value !== null ? reading.value : ''}\n`);
    }
    return 0;
  }

  if (argv[0] === 'plangate') {
    // The dispatch phase and `Impl:` gate, read from the plan-meta record on
    // stdin. Exit 0 lets the fan-out go on; 1 prints the rule's detail and the
    // next command on stderr. Stdout stays empty.
    const ask = planGateAskFrom(argv.slice(1));
    if (!ask) {
      process.stderr.write(
        'usage: plot-ask.mjs plangate --slug <slug> --default-branch <main> [--source <text>] [--ref-resolved] [--allow-local]  (plan-meta JSON on stdin)\n',
      );
      return 2;
    }
    const { code, lines } = planGateAnswer(ask, readFileSync(0, 'utf8'));
    for (const line of lines) process.stderr.write(`${line}\n`);
    return code;
  }

  const question = questionFrom(argv);
  if (!question) {
    process.stderr.write(
      'usage: plot-ask.mjs <board|fleet> | deliverable <slug> <plan-file> | release-claim <branch> | merge <pr> <sha> | spike <slug> [<plan-file>] | spawner [pid] [--lines] | spawner --from-board [--lines] | desk-states <desk>... | desk-quiet <desk>... | plangate --slug <slug> --default-branch <main> | metrics [--weeks N]\n',
    );
    return 2;
  }
  // The plan is named by the CALLER rather than resolved here. `plot-deliver.sh`
  // has already found the file — across three configured directories, with its
  // own refusal when none matches — and re-deriving it would be a second
  // implementation of a lookup that has one, free to disagree about which plan
  // the gate is even about.
  if (question === 'deliverable' && (!argv[1] || !argv[2])) {
    process.stderr.write('usage: plot-ask.mjs deliverable <slug> <plan-file>\n');
    return 2;
  }
  const { opts, planDir } = contextFrom(here);
  // The SAME composition root the board uses, so `PLOT_BOARD_MOCK` works here
  // for the reason it works there: the variable chooses adapters once, and
  // nothing above them can tell which it got.
  // The WHOLE estate, not just its source: `deliverable` is answered by a
  // controller that asks ports, and those ports are chosen by the same
  // composition root — so `PLOT_BOARD_MOCK` reaches this question too.
  const estate = estateFromEnv(opts);

  // THE SETTINGS FILE, IN THIS PROCESS TOO — and this is a SECOND process, which
  // is the whole reason the line exists. `askOnce` runs `maybeAutoDispatch` and
  // `maybeAutoDeliver`, which start agents; the board's own
  // `process.env.PLOT_AGENT_SETTINGS` never reaches here, because this artifact
  // runs as its own `node`.
  //
  // AWAITED, unlike the board's fire-and-forget assignment at `index.ts:131`.
  // There the process is long-lived and the first spawn is a request away; here
  // the dispatch happens INSIDE the `askOnce` below, so an unawaited resolve
  // would race the agents it is meant to configure and lose on a fast estate.
  //
  // STDOUT CARRIES THE ANSWER AND NOTHING ELSE. `plot-deliver.sh` and every
  // other caller parse it as one JSON document, so the announcement goes to
  // stderr; on stdout it turned a `deliverable: true` into a refusal.
  await primeAgentSettings(scriptsFor(opts), process.env, (s) => console.error(s));

  const answer = await askOnce({
    ports: estate,
    question,
    opts,
    estate: estate.source,
    planDir,
    slug: argv[1],
    planFile: argv[2],
  });
  write(`${JSON.stringify(answer.value)}\n`);
  return 0;
};

// Only when RUN, never when imported — a test importing `run` must not have the
// process exit under it. `import.meta.url` is realpath-resolved and
// percent-encoded and `process.argv[1]` is neither, so on macOS — where `/tmp`
// is a symlink — a bundle built there never matches without `pathToFileURL`
// on the realpath.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Every ledger line the board and its children write names `board`.
  process.env[CALLER_ENV] = 'board';
  // `run` awaits ports now, so the exit code arrives as a promise. Awaiting it
  // at the entry keeps the contract a NUMBER for every other caller.
  void run(process.argv.slice(2), path.dirname(fileURLToPath(import.meta.url))).then(endEntry);
}

export { askOnce, askOncePerEstate, newMemory };
