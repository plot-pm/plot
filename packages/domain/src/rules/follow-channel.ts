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
  held: readonly HeldLine[];
  /**
   * The reading last announced per slot, so a reading that arrives again starts
   * nothing, whether the pane still holds it or a welcome replaced the pane.
   */
  announced: AnnouncedReadings;
}

/** The reading last announced per slot, keyed by slot. */
export type AnnouncedReadings = Readonly<Record<string, string>>;

/** One line waiting for the next turn, and the slot of the finding it came from. */
export interface HeldLine {
  /** The finding's monitor and branch; `''` for a line stored before slots were kept. */
  slot: string;
  /** The line the turn's text carries. */
  line: string;
}

/** The state before any finding arrived. */
export const EMPTY_TURN_GATE: TurnGateState = {
  lastStartedAt: null,
  day: '',
  count: 0,
  held: [],
  announced: {},
};

/** What {@link turnGate} decided. */
export interface TurnGateResult {
  /** Whether the mod starts a turn now. */
  start: boolean;
  /** Whether the finding is a reading not announced before; the mod toasts only such a reading. */
  isNew: boolean;
  /** The turn's text when `start` is true; `''` otherwise. */
  text: string;
  /** The state to persist. */
  state: TurnGateState;
}

/** The slot a finding occupies: one reading per monitor and branch. */
const slotOf = (f: Pick<FollowedFinding, 'monitor' | 'branch'>): string =>
  `${f.monitor}\u0000${f.branch}`;

/** The reading a finding reports in its slot: its name, `since` and `evidence`. */
const readingOf = (f: Pick<FollowedFinding, 'finding' | 'since' | 'evidence'>): string =>
  JSON.stringify([f.finding, f.since, f.evidence]);

/** The oldest held lines are dropped past this many, so a capped day cannot grow the store. */
const HELD_LIMIT = 50;

/** The longest-unchanged slots are forgotten past this many, so the store stays bounded. */
const ANNOUNCED_LIMIT = 500;

/**
 * Decides whether an arriving finding starts a turn.
 *
 * A finding whose reading equals the one last announced for its slot (see
 * {@link isRepeat}) changes nothing and is not new: a fleetd restart or a
 * reconnect republishes it. Any other reading is new and becomes the slot's
 * announced reading. A new finding whose name is not in `listed`, or that
 * `owned` says another session claimed, starts no turn and holds no line. A
 * listed finding starts one when the last turn began at least
 * {@link TURN_GAP_MS} ago and fewer than {@link TURNS_PER_DAY} turns started on
 * the current UTC day. Otherwise its line joins `held`, and the next turn's
 * text carries every held line followed by the arriving one. A line already
 * held is not added twice. A `clear` starts no turn and removes the held lines
 * and the announced reading of its slot, since the channel has retracted the
 * finding they report.
 *
 * @param state the persisted state
 * @param finding the arriving finding
 * @param now the current time in milliseconds since the epoch
 * @param listed the finding names the operator allows to start a turn
 * @param owned whether this session holds the reading's claim; `false` when
 *   another session of the same repository claimed it first
 * @returns the decision and the state to persist
 */
export const turnGate = (
  state: TurnGateState,
  finding: FollowedFinding,
  now: number,
  listed: readonly string[],
  owned = true,
): TurnGateResult => {
  const slot = slotOf(finding);
  const others = Object.entries(state.announced).filter(([s]) => s !== slot);
  if (finding.finding === 'clear') {
    const held = state.held.filter((h) => h.slot !== slot);
    return { start: false, isNew: false, text: '', state: { ...state, held, announced: Object.fromEntries(others) } };
  }
  if (isRepeat(state.announced, finding)) return { start: false, isNew: false, text: '', state };
  const announced = Object.fromEntries([...others, [slot, readingOf(finding)]].slice(-ANNOUNCED_LIMIT));
  if (!owned || !listed.includes(finding.finding)) {
    return { start: false, isNew: true, text: '', state: { ...state, announced } };
  }

  const day = new Date(now).toISOString().slice(0, 10);
  const count = state.day === day ? state.count : 0;
  const line = `${finding.finding} — ${finding.branch}: ${finding.evidence}`;
  const held = state.held.some((h) => h.line === line)
    ? state.held
    : [...state.held, { slot, line }];
  const waited = state.lastStartedAt === null ? Infinity : now - state.lastStartedAt;

  if (waited < TURN_GAP_MS || count >= TURNS_PER_DAY) {
    return { start: false, isNew: true, text: '', state: { ...state, day, count, held: held.slice(-HELD_LIMIT), announced } };
  }
  return {
    start: true,
    isNew: true,
    text: held.map((h) => h.line).join('\n'),
    state: { lastStartedAt: now, day, count: count + 1, held: [], announced },
  };
};

/** Whether a finding of this name raises a toast. */
export const raisesToast = (name: string): boolean => TOAST_ON.includes(name);

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
 * Whether a finding reports the reading last announced for its slot: the same
 * name, `since` and `evidence`. A fleetd restart or a reconnect republishes
 * every current finding, and an unchanged one starts nothing. The announced
 * readings are kept apart from the pane's list, because a `welcome` replaces
 * that list.
 *
 * @param announced the reading last announced per slot
 * @param arriving the arriving finding
 */
export const isRepeat = (announced: AnnouncedReadings, arriving: FollowedFinding): boolean =>
  announced[slotOf(arriving)] === readingOf(arriving);

/**
 * The pane's text lines.
 *
 * @param current the findings held
 * @param heard whether a `welcome` has arrived on this connection; without one
 *   the pane says it has heard nothing and never reads as an all-clear
 * @param stale whether the findings were heard before a reload and the channel
 *   has not answered since; the pane shows them under a warning line
 */
export const paneLines = (
  current: readonly FollowedFinding[],
  heard: boolean,
  stale = false,
): string[] => {
  if (!heard && !stale) return ['fleet channel: nothing heard yet'];
  if (current.length === 0 && !stale) return ['fleet channel: no current findings'];
  const lines = [...current]
    .sort((a, b) => a.since.localeCompare(b.since))
    .map((f) => `${f.finding} — ${f.branch} (${f.monitor}): ${f.evidence}`);
  return stale ? ['fleet channel: reconnecting, findings may be out of date', ...lines] : lines;
};
