/**
 * What `plot-fleetctl.sh`'s shared `--start`/`--restart` arm decides, over the
 * readings the script takes.
 *
 * The script reads the machine (`command -v`, `platform`, `supervisor_loaded`,
 * `supervisor_pid`, `git rev-parse`) and hands the answers in; these rules do
 * no I/O. The script runs the reload command `reloadCommand` names and polls
 * the pid itself, because `supervisor_pid` is the one reader of the init
 * system.
 *
 * @concept fleetctl-start
 */

/** The readings the harness and init-system probes take, shared by `--start` and `--restart`. */
export interface StartProbeReading {
  /** The harness name looked for: `PLOT_HARNESS`, or `claude` when that is unset or empty. */
  readonly harnessName: string;
  /** What `command -v <harnessName>` printed, or an empty string when it failed. */
  readonly harnessBin: string;
  /** The value of `PLOT_HARNESS`, or an empty string when it is unset. */
  readonly harnessEnv: string;
  /** `<node's directory>/<harness basename>`, the file that would shadow the harness on the unit's PATH. */
  readonly shadow: string;
  /** True when `shadow` is an executable regular file and not the same file as `harnessBin`. */
  readonly shadowIsOther: boolean;
  /** `launchd`, `systemd` or `none`. */
  readonly platform: string;
  /** The supervisor bundle the unit would name. */
  readonly fleetd: string;
}

/**
 * Decides whether the harness and init-system probes refuse.
 *
 * The probes run in order: a harness that does not resolve to an absolute
 * path, then a different file of the harness's name in node's directory, then
 * no init system.
 *
 * @param reading - the probe readings.
 * @returns the refusal text with no trailing newline, or `undefined` to proceed.
 */
export const startProbeRefusal = (reading: StartProbeReading): string | undefined => {
  const { harnessName, harnessBin, harnessEnv, shadow, shadowIsOther, platform, fleetd } = reading;
  if (!harnessBin.startsWith('/')) {
    const reason =
      harnessEnv === ''
        ? "PLOT_HARNESS is unset, so the default name 'claude' was looked for."
        : `PLOT_HARNESS is set to '${harnessEnv}', so that is the name looked for.`;
    return `plot-fleetctl: cannot resolve the agent harness '${harnessName}' to a file on PATH\n  ${reason}\n  The unit bakes the harness's directory into its PATH permanently, and a\n  worker that cannot find its harness exits 127 after you have moved on.\n  Fix it: put the harness on PATH (or set PLOT_HARNESS to its name or\n  absolute path), check with 'command -v ${harnessName}', then run this again.`;
  }
  if (shadowIsOther) {
    const base = harnessName.replace(/^.*\//, '');
    return `plot-fleetctl: node's directory holds another '${base}' (${shadow})\n  The unit puts that directory first, so workers would run it instead of ${harnessBin}.\n  Fix it: remove or rename it, or use the node from the directory that holds the harness, then run this again.`;
  }
  if (platform === 'none') {
    return `plot-fleetctl: neither launchd nor systemd here — there is no unit to fill\n  Run the supervisor by hand instead: node ${fleetd}`;
  }
  return undefined;
};

/** The readings `--restart` takes before it reloads anything. */
export interface RestartReading {
  /** The supervisor's label. */
  readonly label: string;
  /** `launchd` or `systemd`. */
  readonly platform: string;
  /** True when `supervisor_loaded` answered that the unit is loaded. */
  readonly loaded: boolean;
  /** The supervisor's pid, or an empty string when it cannot be read. */
  readonly pid: string;
  /** The bundle checkout's short commit, or an empty string when it cannot be read. */
  readonly commit: string;
  /** True for `--restart --dry-run`. */
  readonly dryRun: boolean;
}

/** What `--restart` does next: refuse, print a dry run and stop, or reload. */
export type RestartPlan =
  | { readonly kind: 'refuse'; readonly message: string }
  | { readonly kind: 'preview'; readonly message: string }
  | { readonly kind: 'reload' };

/**
 * Decides what `--restart` does once the shared probes have passed.
 *
 * A unit that is not loaded refuses, because loading is `--start`'s job. A dry
 * run reports the unit, the current pid and the commit, and reloads nothing.
 *
 * @param reading - the restart readings.
 * @returns the plan; `refuse` and `preview` carry their text with no trailing newline.
 */
export const restartPlan = (reading: RestartReading): RestartPlan => {
  const { label, platform, loaded, pid, commit, dryRun } = reading;
  if (!loaded) {
    return {
      kind: 'refuse',
      message: `plot-fleetctl: no unit is loaded under '${label}', so there is no supervisor to restart; nothing was done. Run /plot-fleet --start`,
    };
  }
  if (dryRun) {
    return {
      kind: 'preview',
      message: `would reload ${label} (${platform}) — agents untouched\n  supervisor pid: ${pid || 'unreadable'}\n  bundle commit:  ${commit || 'unknown'}`,
    };
  }
  return { kind: 'reload' };
};

/** Where the supervisor's unit is addressed. */
export interface ReloadTarget {
  /** The launchd label. */
  readonly label: string;
  /** `launchd` or `systemd`. */
  readonly platform: string;
  /** The systemd unit name. */
  readonly unit: string;
  /** The user id the launchd domain `gui/<uid>` names. */
  readonly uid: number;
}

/**
 * Names the command that reloads the supervisor and signals no agent.
 *
 * launchd takes `launchctl kickstart -k`, never `bootout` then `bootstrap`,
 * because `bootout` ends every process the job started. systemd takes
 * `systemctl --user restart`; the unit's `KillMode=process` limits the signal to
 * the daemon.
 *
 * @param target - the unit to reload.
 * @returns the command's words, or `undefined` for a platform with no init system.
 */
export const reloadCommand = ({ label, platform, unit, uid }: ReloadTarget): readonly string[] | undefined => {
  if (platform === 'launchd') return ['launchctl', 'kickstart', '-k', `gui/${uid}/${label}`];
  if (platform === 'systemd') return ['systemctl', '--user', 'restart', unit];
  return undefined;
};

/** The readings taken after the reload. */
export interface RestartResult {
  /** The supervisor's label. */
  readonly label: string;
  /** The pid read before the reload, or an empty string when it could not be read. */
  readonly oldPid: string;
  /** The pid read after the reload, or an empty string when it could not be read. */
  readonly newPid: string;
  /** The bundle checkout's short commit, or an empty string when it cannot be read. */
  readonly commit: string;
  /** The `--wait` bound in seconds, for the failure text. */
  readonly waitSeconds: string;
  /** The command that reads the job by hand, for the failure text. */
  readonly readCmd: string;
}

/**
 * Reports a reload: done when a new pid differs from the old one.
 *
 * @param result - the readings taken after the reload.
 * @returns `ok` and the report text with no trailing newline. `ok` is false
 *   when the new pid is unreadable or equal to the old one.
 */
export const restartReport = (result: RestartResult): { readonly ok: boolean; readonly message: string } => {
  const { label, oldPid, newPid, commit, waitSeconds, readCmd } = result;
  const was = oldPid || 'unreadable';
  if (newPid === '' || newPid === oldPid) {
    return {
      ok: false,
      message: `plot-fleetctl: '${label}' reported no new pid within ${waitSeconds}s (was ${was}, now ${newPid || 'unreadable'})\n  Read it: ${readCmd}`,
    };
  }
  return {
    ok: true,
    message: `supervisor restarted — ${label}\n  old pid: ${was}\n  new pid: ${newPid}\n  bundle commit: ${commit || 'unknown'}\n  agents untouched`,
  };
};
