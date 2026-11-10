import {
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
 * node plot-fleetctl-start.mjs restart <label> <platform> <loaded> <pid> <commit> <dry-run>
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

/** The number of arguments each verb takes after the verb itself. */
const ARITY: Readonly<Record<string, number>> = { probe: 6, restart: 6, reload: 3, restarted: 6 };

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
    writeErr(`plot-fleetctl-start: expected one of probe, restart, reload, restarted with its arguments, got '${argv.join(' ')}'\n`);
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
      });
      if (plan.kind === 'refuse') {
        writeErr(`${plan.message}\n`);
        return 1;
      }
      if (plan.kind === 'preview') write(`${plan.message}\n`);
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
