/**
 * One row of the process table: one process, read in one `ps` call.
 */
export interface ProcessRow {
  /** The process id. */
  readonly pid: number;
  /** The parent's process id. */
  readonly ppid: number;
  /** When the process started, as epoch milliseconds; `null` where `ps` printed no readable start. */
  readonly startedAt: number | null;
  /** The CPU time the process has used, in centiseconds. */
  readonly cpuCentis: number;
  /** The executable as `ps -o comm=` prints it; a path on macOS, a name on Linux. */
  readonly comm: string;
}

/** The start times a launch recorded beside a pid. */
export interface RecordedStart {
  /** The manifest's `startedAt`, ISO-8601 UTC at second precision; `''` where none was recorded. */
  readonly startedAt: string;
  /** The pid's own start, as `ps -o lstart=` printed it; `''` where none was recorded. */
  readonly pidStartedAt: string;
}

/** What {@link agentAlive} answers: an agent process under the pid, none, or no answer. */
export type AgentPresence = 'present' | 'absent' | 'unaskable';

/** The settings {@link agentAlive} reads. */
export interface AgentAliveOptions {
  /** The text the agent's executable name contains; the desk manifest's `agentProcess`. */
  readonly agentProcess: string;
  /** How long a wrapper must have been alive before an empty subtree counts, in seconds. */
  readonly graceSeconds: number;
}

/** The agent process name a manifest without `agentProcess` reads as. */
export const DEFAULT_AGENT_PROCESS = 'claude';

/** The grace `PLOT_AGENT_GRACE_SECONDS` defaults to. */
export const DEFAULT_AGENT_GRACE_SECONDS = 30;

/** The slack either side of a recorded start, in seconds. */
const SLACK_SECONDS = 3;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The weekday and month names macOS `ps -o lstart=` prints under a German or French locale. */
const LOCALIZED = [
  {
    days: ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'],
    months: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
  },
  {
    days: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  },
];

/** Local time from parsed fields, or `null` where the month is unknown. */
const localMs = (month: number, fields: readonly (string | undefined)[]): number | null => {
  if (month < 0) return null;
  const [day, hour, minute, second, year] = fields.map(Number) as [number, number, number, number, number];
  return new Date(year, month, day, hour, minute, second).getTime();
};

/**
 * Reads a `ps -o lstart=` text as local time: the C-locale form
 * (`Mon Nov  9 08:42:51 2026`), and the German (`Mo.  9 Nov. 08:42:51 2026`)
 * and French (`lun.  9 nov. 08:42:51 2026`) forms macOS prints, which
 * `_plot_lstart_epoch` reads under the recording locale.
 *
 * The weekday is matched and not checked against the date.
 *
 * @param text - the text `ps` printed, with any surrounding whitespace.
 * @returns epoch milliseconds, or `null` where the text does not parse.
 */
export const lstartMs = (text: string): number | null => {
  const trimmed = text.trim();
  const c = /^(\w{3}) (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(trimmed);
  if (c !== null) return DAYS.includes(c[1]!) ? localMs(MONTHS.indexOf(c[2]!), c.slice(3)) : null;
  const l = /^(\S+) +(\d{1,2}) (\S+) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(trimmed);
  if (l === null) return null;
  const names = LOCALIZED.find((locale) => locale.days.includes(l[1]!));
  return names === undefined ? null : localMs(names.months.indexOf(l[3]!), [l[2], ...l.slice(4)]);
};

/**
 * Reads a manifest `startedAt` (`2026-11-09T08:42:51Z`).
 *
 * @param text - the recorded stamp.
 * @returns epoch milliseconds, or `null` where the text is not that shape.
 */
export const isoStampMs = (text: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(text);
  if (m === null) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second);
};

/**
 * Whether the process holding a recorded pid is the one the launch recorded.
 *
 * With a `pidStartedAt`, the live start must lie within 3 s of it on either
 * side. Without one, the live start must lie at or after the manifest's
 * `startedAt` less 3 s. Both compare whole seconds. A start that cannot be
 * read on either side answers `false`.
 *
 * @param recorded - the start times the launch recorded.
 * @param startedAtMs - when the live process started, from the process table.
 * @returns true when the pid still names the launched process.
 */
export const pidIsCurrent = (recorded: RecordedStart, startedAtMs: number | null): boolean => {
  if (startedAtMs === null) return false;
  const live = Math.floor(startedAtMs / 1000);
  if (recorded.pidStartedAt !== '') {
    const own = lstartMs(recorded.pidStartedAt);
    if (own === null) return false;
    const diff = live - Math.floor(own / 1000);
    return diff >= -SLACK_SECONDS && diff <= SLACK_SECONDS;
  }
  const stamped = isoStampMs(recorded.startedAt);
  if (stamped === null) return false;
  return live >= Math.floor(stamped / 1000) - SLACK_SECONDS;
};

/** The basename of a `comm` value. */
const baseName = (comm: string): string => comm.slice(comm.lastIndexOf('/') + 1);

/**
 * Whether an agent process runs anywhere below a wrapper pid.
 *
 * `unaskable` for a wrapper younger than the grace, with its age taken from
 * the table's start time, and for a pid the table does not hold. Otherwise
 * `present` when a descendant's executable basename contains the agent
 * process name, and `absent` when none does. The wrapper itself never counts.
 * An empty agent process name matches nothing.
 *
 * @param table - one reading of the process table.
 * @param pid - the wrapper pid.
 * @param nowMs - the current time, epoch milliseconds.
 * @param options - the agent process name and the grace.
 * @returns the presence of an agent under the pid.
 */
export const agentAlive = (
  table: readonly ProcessRow[],
  pid: number,
  nowMs: number,
  options: AgentAliveOptions,
): AgentPresence => {
  const root = table.find((row) => row.pid === pid);
  if (root === undefined) return 'unaskable';
  if (root.startedAt !== null && Math.floor((nowMs - root.startedAt) / 1000) < options.graceSeconds) return 'unaskable';
  const inSet = new Set<number>([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of table) {
      if (!inSet.has(row.pid) && inSet.has(row.ppid)) {
        inSet.add(row.pid);
        grew = true;
      }
    }
  }
  const found = table.some(
    (row) => row.pid !== pid && inSet.has(row.pid) && options.agentProcess !== '' && baseName(row.comm).includes(options.agentProcess),
  );
  return found ? 'present' : 'absent';
};
