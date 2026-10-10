/**
 * What the operator's session does with the channel's findings.
 *
 * This file imports nothing. The `plot-follow` mod copies it byte for byte into
 * `mods/plot-follow/hooks/follow-channel.ts`, because a mod installs as its own
 * folder and cannot import from the workspace. `follow-channel.corpus.test.ts`
 * fails when the two differ.
 */

/** The fields of a channel finding that these rules read. */
export interface FollowedFinding {
  monitor: string;
  branch: string;
  finding: string;
  since: string;
  evidence: string;
}

/** The finding names that raise a toast. */
export const TOAST_ON: readonly string[] = ['checks failing', 'pr merged', 'owes an answer'];

/** The shortest time between two turns the mod starts, in milliseconds. */
export const TURN_GAP_MS = 5 * 60 * 1000;

/** The most turns the mod starts in one UTC day. */
export const TURNS_PER_DAY = 24;

/**
 * The turn bound's memory. The mod persists it in `$.store`, so a reload or a
 * new session continues the same day's count.
 */
export interface TurnGateState {
  /** Milliseconds since the epoch of the last turn started; `null` before the first. */
  lastStartedAt: number | null;
  /** The UTC date (`YYYY-MM-DD`) that `count` belongs to; `''` before the first. */
  day: string;
  /** Turns started on `day`. */
  count: number;
  /** Lines of listed findings that arrived while no turn could start. */
  held: readonly string[];
}

/** The state before any finding arrived. */
export const EMPTY_TURN_GATE: TurnGateState = {
  lastStartedAt: null,
  day: '',
  count: 0,
  held: [],
};

/** What {@link turnGate} decided. */
export interface TurnGateResult {
  /** Whether the mod starts a turn now. */
  start: boolean;
  /** The turn's text when `start` is true; `''` otherwise. */
  text: string;
  /** The state to persist. */
  state: TurnGateState;
}

/** The oldest held lines are dropped past this many, so a capped day cannot grow the store. */
const HELD_LIMIT = 50;

/**
 * Decides whether an arriving finding starts a turn.
 *
 * A finding whose name is not in `listed` changes nothing and never starts a
 * turn. A listed finding starts one when the last turn began at least
 * {@link TURN_GAP_MS} ago and fewer than {@link TURNS_PER_DAY} turns started on
 * the current UTC day. Otherwise its line joins `held`, and the next turn's
 * text carries every held line followed by the arriving one. A line already
 * held is not added twice.
 *
 * @param state the persisted state
 * @param finding the arriving finding
 * @param now the current time in milliseconds since the epoch
 * @param listed the finding names the operator allows to start a turn
 * @returns the decision and the state to persist
 */
export const turnGate = (
  state: TurnGateState,
  finding: FollowedFinding,
  now: number,
  listed: readonly string[],
): TurnGateResult => {
  if (!listed.includes(finding.finding)) return { start: false, text: '', state };

  const day = new Date(now).toISOString().slice(0, 10);
  const count = state.day === day ? state.count : 0;
  const line = `${finding.finding} — ${finding.branch}: ${finding.evidence}`;
  const held = state.held.includes(line) ? state.held : [...state.held, line];
  const waited = state.lastStartedAt === null ? Infinity : now - state.lastStartedAt;

  if (waited < TURN_GAP_MS || count >= TURNS_PER_DAY) {
    return { start: false, text: '', state: { ...state, day, count, held: held.slice(-HELD_LIMIT) } };
  }
  return {
    start: true,
    text: held.join('\n'),
    state: { lastStartedAt: now, day, count: count + 1, held: [] },
  };
};

/** Whether a finding of this name raises a toast. */
export const raisesToast = (name: string): boolean => TOAST_ON.includes(name);

/** The slot a finding occupies: one reading per monitor and branch. */
const slotOf = (f: Pick<FollowedFinding, 'monitor' | 'branch'>): string =>
  `${f.monitor}\u0000${f.branch}`;

/**
 * The findings held after one finding arrives.
 *
 * A `clear` removes its slot. Any other finding replaces the slot's earlier
 * reading, so the list holds the current state and no history.
 */
export const absorbFinding = (
  current: readonly FollowedFinding[],
  arriving: FollowedFinding,
): readonly FollowedFinding[] => {
  const rest = current.filter((f) => slotOf(f) !== slotOf(arriving));
  return arriving.finding === 'clear' ? rest : [...rest, arriving];
};

/**
 * The pane's text lines.
 *
 * @param current the findings held
 * @param heard whether a `welcome` has arrived on this connection; without one
 *   the pane says it has heard nothing and never reads as an all-clear
 */
export const paneLines = (current: readonly FollowedFinding[], heard: boolean): string[] => {
  if (!heard) return ['fleet channel: nothing heard yet'];
  if (current.length === 0) return ['fleet channel: no current findings'];
  return [...current]
    .sort((a, b) => a.since.localeCompare(b.since))
    .map((f) => `${f.finding} — ${f.branch} (${f.monitor}): ${f.evidence}`);
};
