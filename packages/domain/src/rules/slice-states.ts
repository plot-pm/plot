import {
  youCaseOfItem,
  type DeliveryInput,
  type DeliveryReadings,
  type WorkItemReading,
} from './delivery-placement.js';

/** The five states a counted slice takes, in the order the rule tests them. */
export const SLICE_STATES = ['delivered', 'blocked', 'at-a-gate', 'being-built', 'not-started'] as const;

export type SliceState = (typeof SLICE_STATES)[number];

/** One counted slice: the id of its work item and the merge answer of the pulse. */
export interface CountedSlice {
  readonly id: string;
  readonly merge: 'merged' | 'open';
}

/** Slices per state. `total` is the sum of the five states; `unread` is counted apart and is not in it. */
export interface SliceStateCounts extends Record<SliceState, number> {
  /** Slices whose reading is absent: no item, or an item whose stage or PR checks nobody read. */
  readonly unread: number;
  readonly total: number;
}

const empty = (): { -readonly [K in keyof SliceStateCounts]: number } => ({
  delivered: 0,
  blocked: 0,
  'at-a-gate': 0,
  'being-built': 0,
  'not-started': 0,
  unread: 0,
  total: 0,
});

/**
 * The state of one slice, or `unread` where a reading it needs is absent.
 *
 * The first state that matches wins: delivered, blocked, at a gate, being
 * built, not started. Delivered reads the pulse's merge answer. Blocked is the
 * Blocks delivery case of the item alone, so ownership and the Mine mode do
 * not move it. A claimed or running slice reads being built, queued or not.
 *
 * @param slice - the slice's merge answer.
 * @param item - the slice's work item, or `undefined` where none was read.
 * @param live - running agents acting on the item.
 * @param stopped - stopped agents acting on the item.
 * @param input - the `Auto-review` key and the `Correction budget`.
 */
export const sliceStateOf = (
  slice: Pick<CountedSlice, 'merge'>,
  item: WorkItemReading | undefined,
  live: number,
  stopped: number,
  input: DeliveryInput,
): SliceState | 'unread' => {
  if (slice.merge === 'merged') return 'delivered';
  if (item === undefined) return 'unread';
  const you = youCaseOfItem(item, input, live, stopped);
  if (you !== null && you.group === 'blocks-delivery') return 'blocked';
  if (item.heldBy !== undefined) return 'at-a-gate';
  if (item.stage === 'pr') return item.pr === undefined || item.pr.ci === 'unread' ? 'unread' : 'at-a-gate';
  if (item.stage === 'building' || live > 0) return 'being-built';
  return item.stage === 'queued' ? 'not-started' : 'unread';
};

/**
 * Counts slices by state from one set of readings.
 *
 * @param slices - the counted slices; a deferred-only slice is not among them.
 * @param readings - the work items and agents as measured.
 * @param input - the `Auto-review` key and the `Correction budget`.
 * @returns per-state counts. The five states add up to `total`; `unread` is outside it.
 */
export const countSliceStates = (
  slices: readonly CountedSlice[],
  readings: DeliveryReadings,
  input: DeliveryInput,
): SliceStateCounts => {
  const items = new Map(readings.items.map((i) => [i.id, i]));
  const counts = empty();
  for (const slice of slices) {
    const acting = readings.agents.filter((a) => a.actsOn === slice.id);
    const live = acting.filter((a) => a.process === 'running').length;
    const stopped = acting.filter((a) => a.process === 'stopped').length;
    const state = sliceStateOf(slice, items.get(slice.id), live, stopped, input);
    counts[state] += 1;
    if (state !== 'unread') counts.total += 1;
  }
  return counts;
};

/**
 * Sums counts, as a release or a sprint does over its plans.
 *
 * @param parts - the counts of each plan.
 */
export const sumSliceStates = (parts: readonly SliceStateCounts[]): SliceStateCounts => {
  const sum = empty();
  for (const part of parts) for (const key of Object.keys(sum) as (keyof SliceStateCounts)[]) sum[key] += part[key];
  return sum;
};

/**
 * Counts the slices of the plans a release or a sprint names, each plan once.
 *
 * @param plans - the counted slices per plan key, `undefined` where a plan's merge answer is unread.
 * @param keys - the plan keys the release or sprint names; a key listed twice, as by two sprints naming one plan, counts once.
 * @param readings - the work items and agents as measured.
 * @param input - the `Auto-review` key and the `Correction budget`.
 * @returns the sum of the per-plan counts, or `undefined` where any named plan has no merge answer, so a partial pulse never reads as a smaller count.
 */
export const countSliceStatesOver = (
  plans: ReadonlyMap<string, readonly CountedSlice[] | undefined>,
  keys: readonly string[],
  readings: DeliveryReadings,
  input: DeliveryInput,
): SliceStateCounts | undefined => {
  const parts: SliceStateCounts[] = [];
  for (const key of new Set(keys)) {
    const slices = plans.get(key);
    if (slices === undefined) return undefined;
    parts.push(countSliceStates(slices, readings, input));
  }
  return sumSliceStates(parts);
};
