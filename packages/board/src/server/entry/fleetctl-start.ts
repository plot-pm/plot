import {
  agentDecision,
  reloadCommand,
  restartPlan,
  restartReport,
  startProbeRefusal,
} from '@plot-pm/domain/rules/fleetctl-start';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point `plot-fleetctl.sh` runs to ask the rules in
 * `fleetctl-start.ts` from its shared `--start`/`--restart` arm.
 *
 * ```
 * node plot-fleetctl-start.mjs probe <harness-name> <harness-bin> <PLOT_HARNESS> <node-bin> <platform> <fleetd>
 * node plot-fleetctl-start.mjs restart <label> <platform> <loaded> <pid> <commit> <dry-run> [<agents> <unattended>]
 * node plot-fleetctl-start.mjs agents <dry-run> <desk> <pid> <state> <branch> <blocked> <dirty> <pr> <pid-current>
 * node plot-fleetctl-start.mjs reload <label> <platform> <unit>
 * launchctl kickstart -k gui/501/com.plot-pm.fleetd
 * node plot-fleetctl-start.mjs restarted <label> <old-pid> <new-pid> <commit> <wait> <read-cmd>
 * ```
 *
 * `probe` prints nothing and exits 0 to proceed, or prints the refusal on
 * stderr and exits 1. It reads one fact itself: whether
 * `<node's directory>/<harness basename>` is an executable regular file and a
 * different file from `<harness-bin>`.
 *
 * `restart` exits 1 with the refusal on stderr when `<loaded>` is not
 * `loaded`. With `<dry-run>` `1` it prints the preview on stdout. It exits 0
 * otherwise.
 *
 * `restart` with `<agents>` `1` and `<unattended>` `1` exits 1 with the
 * refusal on stderr, before anything else.
 *
 * `agents` decides one live agent and prints `<action><TAB><line>` on stdout,
 * where `<action>` is `stop`, `keep` or `refuse`; it exits 0. `<blocked>` is
 * `1` when the desk holds a `PLOT-BLOCKED*` file. `<dirty>` is the count of
 * uncommitted files, or anything that is not a number when it could not be
 * read. `<pr>` is the JSON `plot-host.sh pr-state` printed, or empty when it
 * printed none. `<pid-current>` is `yes`, `no` or `unknown`.
 *
 * `reload` prints the reload command's words on one line, separated by spaces.
 *
 * `restarted` prints the report on stdout and exits 0 when a new pid differs
 * from the old one, and prints the failure on stderr and exits 1 otherwise.
 *
 * Every verb exits 2 for an unknown verb or a missing argument.
 */

/**
 * Whether `shadow` is an executable regular file and not the same file as `harnessBin`.
 *
 * @param shadow - the file of the harness's name in node's directory.
 * @param harnessBin - the resolved harness.
 * @returns false when `shadow` is absent, not a regular file or not
 *   executable; true when `harnessBin` cannot be read or has a different
 *   device and inode.
 */
export const shadowIsOther = (shadow: string, harnessBin: string): boolean => {
  let own;
  try {
    own = statSync(shadow);
    if (!own.isFile()) return false;
    accessSync(shadow, constants.X_OK);
  } catch {
    return false;
  }
  try {
    const harness = statSync(harnessBin);
    return own.dev !== harness.dev || own.ino !== harness.ino;
  } catch {
    return true;
  }
};

/**
 * The `state` of the JSON `plot-host.sh pr-state` printed.
 *
 * @param json - the printed JSON, or `''`.
 * @returns the state word, or `undefined` when nothing printed, the text does not parse or `state` is missing.
 */
const prStateOf = (json: string): string | undefined => {
  try {
    const state: unknown = (JSON.parse(json) as { state?: unknown }).state;
    return typeof state === 'string' && state !== '' ? state : undefined;
  } catch {
    return undefined;
  }
};

/** The number of arguments each verb takes after the verb itself. */
const ARITY: Readonly<Record<string, number>> = { probe: 6, restart: 6, agents: 9, reload: 3, restarted: 6 };

/**
 * Answers one verb.
 *
 * @param argv - the command-line arguments after the script path: the verb, then its arguments.
 * @param write - where a stdout answer goes.
 * @param writeErr - where a refusal or failure goes.
 * @param uid - the user id `reload` names in the launchd domain.
 * @returns the process exit code: 0 proceed, 1 refuse, 2 unknown verb or missing argument.
 */
export const run = (
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  writeErr: (s: string) => void = (s) => process.stderr.write(s),
  uid: number = process.getuid?.() ?? 0,
): number => {
  const [verb, ...args] = argv;
  const arity = verb === undefined ? undefined : ARITY[verb];
  if (arity === undefined || args.length < arity) {
    writeErr(`plot-fleetctl-start: expected one of probe, restart, agents, reload, restarted with its arguments, got '${argv.join(' ')}'\n`);
    return 2;
  }
  const a = (i: number): string => args[i] ?? '';
  switch (verb) {
    case 'probe': {
      const shadow = `${path.dirname(a(3))}/${a(0).replace(/^.*\//, '')}`;
      const refusal = startProbeRefusal({
        harnessName: a(0),
        harnessBin: a(1),
        harnessEnv: a(2),
        shadow,
        shadowIsOther: a(1).startsWith('/') && shadowIsOther(shadow, a(1)),
        platform: a(4),
        fleetd: a(5),
      });
      if (refusal === undefined) return 0;
      writeErr(`${refusal}\n`);
      return 1;
    }
    case 'restart': {
      const plan = restartPlan({
        label: a(0),
        platform: a(1),
        loaded: a(2) === 'loaded',
        pid: a(3),
        commit: a(4),
        dryRun: a(5) === '1',
        agents: a(6) === '1',
        unattended: a(7) === '1',
      });
      if (plan.kind === 'refuse') {
        writeErr(`${plan.message}\n`);
        return 1;
      }
      if (plan.kind === 'preview') write(`${plan.message}\n`);
      return 0;
    }
    case 'agents': {
      const pr = prStateOf(a(7));
      const dirty = /^\d+$/.test(a(6)) ? Number(a(6)) : undefined;
      const decision = agentDecision(
        {
          name: a(1),
          pid: a(2),
          state: a(3),
          branch: a(4),
          sliceHasMerged: pr === 'MERGED',
          openPr: pr === undefined ? undefined : pr === 'OPEN',
          blocked: a(5) === '1',
          dirtyFiles: dirty,
          pidCurrent: a(8) === 'yes' ? 'yes' : a(8) === 'no' ? 'no' : 'unknown',
        },
        a(0) === '1',
      );
      write(`${decision.action}\t${decision.line}\n`);
      return 0;
    }
    case 'reload': {
      const words = reloadCommand({ label: a(0), platform: a(1), unit: a(2), uid });
      if (words === undefined) {
        writeErr(`plot-fleetctl-start: no reload command for platform '${a(1)}'\n`);
        return 2;
      }
      write(`${words.join(' ')}\n`);
      return 0;
    }
    default: {
      const report = restartReport({
        label: a(0),
        oldPid: a(1),
        newPid: a(2),
        commit: a(3),
        waitSeconds: a(4),
        readCmd: a(5),
      });
      (report.ok ? write : writeErr)(`${report.message}\n`);
      return report.ok ? 0 : 1;
    }
  }
};

// Only when RUN, never when imported; `pathToFileURL` over `realpathSync` as in `old-label.ts`.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  void endEntry(run(process.argv.slice(2)));
}
