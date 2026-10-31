import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { agentsFs } from '@plot-pm/domain/adapters/agents/agents-fs';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { shellContext } from '@plot-pm/domain/adapters/scripts';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host } from '@plot-pm/domain/ports/host';
import { readBranchReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import { readDeskReadings } from '@plot-pm/domain/workflows/plan-walk-desks';
import { readEstate } from '@plot-pm/domain/workflows/plan-walk-estate';
import {
  assemblePlanWalk,
  fleetReading,
  offerAnswer,
  sliceNamesOf,
  sliceNamesText,
  whyNothingText,
} from '@plot-pm/domain/workflows/plan-walk-assembly';

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
 * `flags` is the scan's `slice_names why_nothing list_all next_only as_json` bits in that order; they select `slice-names`, `why-nothing`, `list-eligible`, `next` or `json`.
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
        ? () => Promise.resolve({ ok: false as const, why: 'unaskable' as const, reason: 'offline' })
        : Reflect.get(target, name, receiver),
  });

const main = async (): Promise<number> => {
  const [flags = '00000', slug = '', mainBranch = 'main', planDir = '', activeDir = '', deliveredDir = '', prefixList = '', offline = '0', readRef = 'unknown', localHead = 'unknown', fetchFailed = '0', fetchError = ''] =
    process.argv.slice(2);
  const [sliceNames, whyNothing, listAll, nextOnly] = flags;
  const mode = sliceNames === '1' ? 'slice-names' : whyNothing === '1' ? 'why-nothing' : listAll === '1' ? 'list-eligible' : nextOnly === '1' ? 'next' : 'json';
  const prefixes = prefixList.split('|').filter((p) => p !== '');
  const offer = mode === 'next' || mode === 'list-eligible' || mode === 'why-nothing';
  const root = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const context = shellContext(root);
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
  const branches = estate.ok ? await readBranchReadings(refs, host, estate.value, { mainBranch, planDir }) : estate;
  const desks =
    offer || !branches.ok
      ? { ok: true as const, value: { mainSha: estate.ok ? estate.value.mainSha : '', desks: [] } }
      : await readDeskReadings(treesGit(context), agentsFs(context), processesShell(context), branches.value);

  const assembled = assemblePlanWalk(
    { estate, branches: branches as never, desks: desks as never },
    { slug, offer },
  );
  if (!assembled.ok) {
    process.stderr.write('plot-scan-walk: a stage of the walk failed\n');
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
  const document = fleetReading(assembly, {
    main: mainBranch,
    readRef,
    localHead,
    fetchFailed: fetchFailed === '1',
    fetchError,
    host: offline === '1' ? 'offline' : 'ok',
    mergeDetect: 'ok',
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  process.stdout.write(`${JSON.stringify(document)}\n`);
  return 0;
};

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? '')).href) {
  main().then(
    (code) => endEntry(code),
    (error: unknown) => {
      process.stderr.write(`plot-scan-walk: ${error instanceof Error ? error.message : String(error)}\n`);
      return endEntry(2);
    },
  );
}
