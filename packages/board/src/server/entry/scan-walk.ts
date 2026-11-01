import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { removeStageDirsOnSignal } from '@plot-pm/domain/adapters/stage-dirs';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { agentsFs } from '@plot-pm/domain/adapters/agents/agents-fs';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { shellContext } from '@plot-pm/domain/adapters/scripts';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { logToPlan, pulseLine, recordBridge, type PulseCounts } from './pulse-log.js';
import type { Host } from '@plot-pm/domain/ports/host';
import { readBranchConflicts, readBranchReadings, stageMergeDetect, type ConflictCandidate } from '@plot-pm/domain/workflows/plan-walk-branches';
import { readDeskReadings } from '@plot-pm/domain/workflows/plan-walk-desks';
import { readEstate } from '@plot-pm/domain/workflows/plan-walk-estate';
import {
  assemblePlanWalk,
  chosenPlans,
  fleetReading,
  hasBranchLines,
  offerAnswer,
  planRow,
  planWalkAssembler,
  sliceNamesOf,
  sliceNamesText,
  whyNothingText,
  type FleetReadingHeader,
} from '@plot-pm/domain/workflows/plan-walk-assembly';
import { planReport, reportBanner, reportFooter, reportNotes, type ReportContext } from '@plot-pm/domain/workflows/plan-walk-report';
import type { BranchReading, BranchStageReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import type { DeskReading } from '@plot-pm/domain/workflows/plan-walk-desks';

/**
 * The plan walk for `plot-fleet-scan.sh` under `PLOT_SCAN_WALK=domain`: the four
 * stages (estate, branches, desks, assembly) run in process, and the answer for
 * one caller mode is printed.
 *
 * ```
 * plot-scan-walk.mjs <flags> <slug> <main> <planDir> <activeDir> <deliveredDir> \
 *   <prefixes, "|"-separated> <offline 0|1> <readRef> <localHead> <fetchFailed 0|1> <fetchError>
 * ```
 *
 * `flags` is the scan's `slice_names why_nothing list_all next_only as_json log_pulse loose stream loose_verifiable` bits in that order. The first six select `slice-names`, `why-nothing`, `list-eligible`, `next`, `json` or `log-pulse`; `stream` selects `stream`. `log-pulse` appends one pulse line to each plan under `planDir`, writes the bridge under `<root>/.plot/state/` unless the fleet holds it, and prints the wave report, the delta, `Pulse complete.` and the `summary:` line. `stream` prints one `{"kind":"plan"}` line as each plan resolves, writes the bridge unless `PLOT_SCAN_RECORD=0`, then prints the `{"kind":"reading"}` line; a failed walk prints no `reading` line. `loose` is an input to the branch and assembly stages in every mode, and `loose_verifiable` says a host could be asked.
 * The offer modes (`next`, `list-eligible`, `why-nothing`) read no desks;
 * `slice-names` reads the estate alone. With `offline` set and the mode not an
 * offer, the host answers `unaskable` for every question that costs a request.
 *
 * Exit: 0 on an answer, 1 on an empty offer, 2 on a stage that failed.
 */

/** The host methods that read configuration and cost no request. */
const FREE_HOST_QUESTIONS: ReadonlySet<string> = new Set(['backend', 'account']);

/**
 * Wraps a host so every question that costs a request answers `unaskable`.
 *
 * @param host - the host to wrap.
 * @returns a host that asks nothing.
 */
const unaskedHost = (host: Host): Host =>
  new Proxy(host, {
    get: (target, name, receiver) =>
      typeof name === 'string' && !FREE_HOST_QUESTIONS.has(name)
        ? name === 'lastRefusal'
          ? () => ({ kind: 'failed' as const, said: 'not logged in: the scan ran offline' })
          : () => Promise.resolve({ ok: false as const, why: 'unaskable' as const, reason: 'offline' })
        : Reflect.get(target, name, receiver),
  });

/** Reads the desks of one plan's branches. */
type DeskReader = (branches: readonly BranchReading[]) => Promise<readonly DeskReading[] | null>;

/** Reads which paths each assembled branch would conflict on. */
type ConflictReader = (candidates: readonly ConflictCandidate[]) => Promise<ReadonlyMap<string, readonly string[]>>;

/**
 * The assembled branches of the given plans, as conflict candidates.
 *
 * @param plans - the assembled plans.
 * @returns every branch of every slice.
 */
const branchesOf = (plans: readonly { slices: readonly { branches: readonly ConflictCandidate[] }[] }[]): ConflictCandidate[] =>
  plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches));

/**
 * Runs the walk for `--stream`: each plan is assembled and printed as soon as
 * its branch and desk readings are in, in the order the report lists plans.
 *
 * @param estate - the estate stage's answer.
 * @param readBranches - starts the branch stage with the per-plan callback.
 * @param readDesks - reads one plan's desks, or answers `null` on a failed stage.
 * @param readConflicts - reads the conflicts of a plan's branches before its line prints.
 * @param input - the slug, offer flag and `--loose` input.
 * @param header - the checkout's facts for the rows.
 * @param root - the repository root, for the bridge.
 * @returns the exit code.
 */
const runStream = async (
  estate: Parameters<typeof chosenPlans>[0],
  readBranches: (onPlan: (plan: string, branches: readonly BranchReading[]) => Promise<void>) => Promise<{ ok: true; value: BranchStageReadings } | { ok: false }>,
  readDesks: DeskReader,
  readConflicts: ConflictReader,
  input: Parameters<typeof chosenPlans>[1],
  header: FleetReadingHeader,
  root: string,
): Promise<number> => {
  const assembler = planWalkAssembler(estate, input);
  const order = chosenPlans(estate, input).map(({ record }) => record);
  const arrived = new Map<string, ReadonlyMap<string, BranchReading>>();
  const deskOf = new Map<string, DeskReading>();
  const conflicts = new Map<string, readonly string[]>();
  let next = 0;
  let broken = false;
  const flush = async (final: boolean): Promise<void> => {
    while (!broken && next < order.length) {
      const record = order[next]!;
      const readings = arrived.get(record.file);
      if (readings === undefined && !final) return;
      const added = assembler.add(record, readings ?? new Map(), deskOf);
      if (!added.ok) {
        broken = true;
        return;
      }
      if (added.value !== null && hasBranchLines(added.value)) {
        for (const [branch, paths] of await readConflicts(branchesOf([added.value]))) conflicts.set(branch, paths);
        process.stdout.write(`${JSON.stringify({ kind: 'plan', plan: planRow(added.value, header, conflicts) })}\n`);
      }
      next += 1;
    }
  };
  const stage = await readBranches(async (plan, branches) => {
    const desks = await readDesks(branches);
    if (desks === null) throw new Error('the desks stage failed');
    for (const desk of desks) deskOf.set(desk.branch, desk);
    arrived.set(plan, new Map(branches.map((b) => [`${b.plan}\t${b.branch}`, b] as const)));
    await flush(false);
  });
  if (!stage.ok) {
    process.stderr.write('plot-scan-walk: the branches stage failed\n');
    return 2;
  }
  await flush(true);
  if (broken) {
    process.stderr.write('plot-scan-walk: the assembly stage failed\n');
    return 2;
  }
  const assembly = assembler.finish(stage.value.mainSha);
  const unread = branchesOf(assembly.plans).filter((b) => !conflicts.has(b.branch));
  for (const [branch, paths] of await readConflicts(unread)) conflicts.set(branch, paths);
  const chosen = new Set(order.map((record) => record.file));
  const document = fleetReading(assembly, { ...header, mergeDetect: stageMergeDetect(stage.value, chosen) }, conflicts);
  if (process.env.PLOT_SCAN_RECORD !== '0') recordBridge(root, document, Date.now(), false);
  process.stdout.write(`${JSON.stringify({ kind: 'reading', reading: document })}\n`);
  return 0;
};

const main = async (): Promise<number> => {
  const [flags = '000000000', slug = '', mainBranch = 'main', planDir = '', activeDir = '', deliveredDir = '', prefixList = '', offline = '0', readRef = 'unknown', localHead = 'unknown', fetchFailed = '0', fetchError = ''] =
    process.argv.slice(2);
  const [sliceNames, whyNothing, listAll, nextOnly, , logPulse, looseFlag, streamFlag, looseVerifiable] = flags;
  const loose = looseFlag === '1';
  const looseInput = loose ? { verifiable: looseVerifiable === '1' } : undefined;
  const mode =
    streamFlag === '1' ? 'stream' : logPulse === '1' ? 'log-pulse' : sliceNames === '1' ? 'slice-names' : whyNothing === '1' ? 'why-nothing' : listAll === '1' ? 'list-eligible' : nextOnly === '1' ? 'next' : 'json';
  const prefixes = prefixList.split('|').filter((p) => p !== '');
  const offer = mode === 'next' || mode === 'list-eligible' || mode === 'why-nothing';
  const root = process.env.PLOT_REPO_ROOT ?? process.cwd();
  // The helper scripts live beside the board directory this bundle ships in, which
  // is not `<root>/skills/plot/scripts` in a project that only installs Plot.
  const context = { ...shellContext(root), scriptDir: dirname(dirname(realpathSync(process.argv[1] ?? ''))) };
  const refs = refsGit(context);
  const store = planStoreRef(refs, context, `origin/${mainBranch}`);
  const estate = await readEstate(refs, store, { mainBranch, planDir, activeDir, deliveredDir, prefixes });

  if (mode === 'slice-names') {
    if (!estate.ok) return 2;
    process.stdout.write(sliceNamesText(sliceNamesOf(estate.value)));
    return 0;
  }

  const realHost = hostShell(context);
  const host = offline === '1' && !offer ? unaskedHost(realHost) : realHost;
  const stageInput = { mainBranch, planDir, loose: loose && looseVerifiable === '1' };
  const header: FleetReadingHeader = {
    main: mainBranch,
    readRef,
    localHead,
    fetchFailed: fetchFailed === '1',
    fetchError,
    planDir,
    host: offline === '1' ? 'unasked' : 'ok',
    mergeDetect: 'unaskable',
    nowSeconds: Math.floor(Date.now() / 1000),
  };

  if (mode === 'stream') {
    if (!estate.ok) {
      process.stderr.write('plot-scan-walk: the estate stage failed\n');
      return 2;
    }
    const trees = treesGit(context);
    const agents = agentsFs(context);
    const processes = processesShell(context);
    const mainSha = estate.value.mainSha;
    return runStream(
      estate.value,
      (onPlan) => readBranchReadings(refs, host, estate.value, { ...stageInput, onPlan }),
      async (branches) => {
        const subset = { mainSha, backend: '', origin: '', hostReach: 'ok', merges: [], added: new Map(), branches } as unknown as BranchStageReadings;
        const read = await readDeskReadings(trees, agents, processes, subset);
        return read.ok ? read.value.desks : null;
      },
      (candidates) => readBranchConflicts(refs, mainBranch, candidates),
      { slug, offer: false, ...(looseInput === undefined ? {} : { loose: looseInput }) },
      header,
      root,
    );
  }

  const branches = estate.ok ? await readBranchReadings(refs, host, estate.value, stageInput) : estate;
  const desks =
    offer || !branches.ok
      ? { ok: true as const, value: { mainSha: estate.ok ? estate.value.mainSha : '', desks: [] } }
      : await readDeskReadings(treesGit(context), agentsFs(context), processesShell(context), branches.value);

  const assembled = assemblePlanWalk(
    { estate, branches: branches as never, desks: desks as never },
    { slug, offer, ...(looseInput === undefined ? {} : { loose: looseInput }) },
  );
  if (!assembled.ok || !estate.ok || !branches.ok) {
    const failedStage = !estate.ok ? 'estate' : !branches.ok ? 'branches' : !desks.ok ? 'desks' : 'assembly';
    process.stderr.write(`plot-scan-walk: the ${failedStage} stage failed\n`);
    return 2;
  }
  const assembly = assembled.value;
  if (mode === 'why-nothing') {
    process.stdout.write(assembly.plans.length === 0 ? 'none\n' : whyNothingText(assembly));
    return 0;
  }
  if (mode === 'next' || mode === 'list-eligible') {
    const answer = offerAnswer(assembly, mode === 'list-eligible');
    process.stdout.write(answer.out);
    process.stderr.write(answer.err);
    return answer.exit;
  }
  const chosen = new Set(chosenPlans(estate.value, { slug, offer }).map(({ record }) => record.file));
  const read = { ...header, mergeDetect: stageMergeDetect(branches.value, chosen) };
  const document = fleetReading(assembly, read, await readBranchConflicts(refs, mainBranch, branchesOf(assembly.plans)));
  if (mode === 'log-pulse') {
    const summary = document.summary as Record<string, number>;
    const counts: PulseCounts = {
      waves: summary.waves ?? 0, eligible: summary.eligible ?? 0, claimed: summary.claimed ?? 0, blocked: summary.blocked ?? 0,
      deferred: summary.deferred ?? 0, waiting: summary.waiting ?? 0, prereq_missing: summary.prereq_missing ?? 0,
    };
    const line = pulseLine(new Date().toISOString().slice(0, 16) + 'Z', counts);
    for (const plan of document.plans as { file: string }[]) logToPlan(`${planDir}${plan.file}`, line);
    const behindRead = readRef !== 'unknown' && localHead !== readRef ? await refs.commitSubjects(`HEAD..origin/${mainBranch}`) : null;
    const report: ReportContext = {
      behind: behindRead !== null && behindRead.ok ? behindRead.value.length : null,
      loose,
      looseVerifiable: looseVerifiable === '1',
      offline: offline === '1',
      planSource: 'ref',
      subjectPredatesPlan: 0,
    };
    let out = reportBanner(read, report);
    if (assembly.plans.length === 0) out += `No plans found in ${planDir}.\n`;
    for (const plan of assembly.plans) out += planReport(plan, read, loose);
    out += reportNotes(read, report);
    const delta = recordBridge(root, document, Date.now());
    if (delta !== '') out += `${delta.replace(/\n+$/, '')}\n\n`;
    process.stdout.write(out + reportFooter(assembly, read, report));
    return 0;
  }
  process.stdout.write(`${JSON.stringify(document)}\n`);
  return 0;
};

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? '')).href) {
  // No other SIGTERM handler here: without this the default action skips the
  // `finally` that removes a parse's stage directory.
  removeStageDirsOnSignal();
  main().then(
    (code) => endEntry(code),
    (error: unknown) => {
      process.stderr.write(`plot-scan-walk: ${error instanceof Error ? error.message : String(error)}\n`);
      return endEntry(2);
    },
  );
}
