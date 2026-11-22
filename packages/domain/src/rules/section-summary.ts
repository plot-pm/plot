import type {
  FleetHeaderGroup,
  HeaderNumber,
  HeaderTone,
  MachineHeaderGroup,
  WorkHeaderGroup,
  YouHeaderGroup,
} from './delivery-header.js';
import type { FleetGroup } from './delivery-placement.js';
import type { ReleaseDeliveryHeader, StripSegment } from './release-plan-rows.js';

/** The colour of a summary chip. `zero` is a count of 0; `unread` is a count nobody read. */
export type SummaryTone = 'red' | 'amber' | 'blue' | 'green' | 'grey' | 'zero' | 'unread';

/** One coloured counter of a folded section's summary. */
export interface SummaryChip {
  kind: 'chip';
  key: string;
  /** The chip's words, icon first: `● 1 blocks delivery`. */
  text: string;
  /** The number the chip shows; `null` for a chip with no count or a count nobody read. */
  count: number | null;
  tone: SummaryTone;
}

/** Muted words of the summary: `6 plans`, `oldest 2d`, `2 working · 1 free`. */
export interface SummaryText {
  kind: 'text';
  key: string;
  text: string;
}

/** The segment bar of Release delivery: one segment per slice state, in `SLICE_STATES` order. */
export interface SummaryBar {
  kind: 'bar';
  segments: StripSegment[];
  /** The sum of the segments' counts. */
  total: number;
}

/** One circle per placed agent: working first, then blocked, then free. */
export interface SummaryCircles {
  kind: 'circles';
  circles: FleetGroup[];
}

export type SummaryPart = SummaryChip | SummaryText | SummaryBar | SummaryCircles;

/** The Machine meter share above which a host limit shows its chip. */
export const MACHINE_CHIP_SHARE = 0.5;

const chip = (key: string, text: string, count: number | null, tone: SummaryTone): SummaryChip => ({ kind: 'chip', key, text, count, tone });

const text = (key: string, words: string): SummaryText => ({ kind: 'text', key, text: words });

const TONE_OF: Readonly<Record<HeaderTone, SummaryTone>> = { red: 'red', amber: 'amber', grey: 'grey', green: 'green', plain: 'blue' };

const numberChip = (n: HeaderNumber, icon: string, unread: boolean, tone: SummaryTone = TONE_OF[n.tone]): SummaryChip => {
  if (n.count === 0 && unread) return chip(n.key, `${icon} ? ${n.words}`, null, 'unread');
  return chip(n.key, `${icon} ${n.count} ${n.words}`, n.count, n.count === 0 ? 'zero' : tone);
};

const unreadChip = (unread: { count: number; text: string } | null): SummaryChip[] =>
  unread === null ? [] : [chip('unread', unread.text, unread.count, 'amber')];

const YOU_ICONS: Readonly<Record<string, string>> = { 'blocks-delivery': '●', 'input-to-the-fleet': '◆', unblock: '⑂' };

const WORK_ICONS: Readonly<Record<string, readonly [string, SummaryTone]>> = {
  'at-a-gate': ['◷', 'amber'],
  'being-built': ['▶', 'blue'],
  queued: ['≡', 'blue'],
};

/**
 * The folded summary of Release delivery: the five-state bar, the plan count and the blocked chip.
 *
 * @param head - the section's header line.
 * @returns the bar, `N plans`, `■ N blocked` over the plans that hold a blocked slice (red above 0, `zero` at 0), and `! N not read` where a slice is unread.
 */
export const releaseSummary = (head: Pick<ReleaseDeliveryHeader, 'bar' | 'blockedPlans' | 'counts'>): SummaryPart[] => {
  const plans = head.counts.find((c) => c.key === 'plans')?.count ?? 0;
  const unread = head.counts.find((c) => c.key === 'unread')?.count ?? 0;
  return [
    { kind: 'bar', segments: head.bar, total: head.bar.reduce((n, s) => n + s.count, 0) },
    text('plans', `${plans} ${plans === 1 ? 'plan' : 'plans'}`),
    chip('blocked', `■ ${head.blockedPlans} blocked`, head.blockedPlans, head.blockedPlans > 0 ? 'red' : 'zero'),
    ...(unread > 0 ? [chip('unread', `! ${unread} not read`, unread, 'amber')] : []),
  ];
};

/**
 * The folded summary of You: blocks delivery (red), input (amber) and unblock (grey).
 *
 * @param group - the You group of `deliveryHeader`.
 * @returns one chip per number, `zero` at 0; a 0 reads `?` with a `null` count where an item is unread, and the `! N not read` chip follows.
 */
export const youSummary = (group: Pick<YouHeaderGroup, 'numbers' | 'unread'>): SummaryPart[] => [
  ...group.numbers.map((n) => numberChip(n, YOU_ICONS[n.key] ?? '', group.unread !== null)),
  ...unreadChip(group.unread),
];

/**
 * The folded summary of Work items: at a gate (amber), being built and queued (blue), and the oldest wait.
 *
 * @param group - the Work items group of `deliveryHeader`.
 * @returns one chip per number as `youSummary` makes them, the `! N not read` chip, and `oldest 2d` where an item has an age.
 */
export const workSummary = (group: Pick<WorkHeaderGroup, 'numbers' | 'unread' | 'oldest'>): SummaryPart[] => [
  ...group.numbers.map((n) => {
    const [icon, tone] = WORK_ICONS[n.key] ?? ['', 'blue'];
    return numberChip(n, icon, group.unread !== null, tone);
  }),
  ...unreadChip(group.unread),
  ...(group.oldest === null ? [] : [text('oldest', group.oldest.replace(/^oldest waits /, 'oldest '))]),
];

/**
 * The folded summary of Fleet: the agent circles, the agent line, the supervisor status and the auto chip.
 *
 * @param group - the Fleet group of `deliveryHeader`.
 * @returns the circles, the line where the group has one, a red `■ fleet stopped` or an amber `?` status chip where the supervisor is not a fresh `up`, `! N not read`, and `auto K of 4` with K the switches that are on (blue above 0).
 */
export const fleetSummary = (group: Pick<FleetHeaderGroup, 'circles' | 'line' | 'status' | 'kind' | 'unread' | 'marks'>): SummaryPart[] => {
  const on = group.marks.filter((m) => m.on).length;
  const status = group.status === null ? []
    : [group.kind === 'stopped' ? chip('status', `■ ${group.status}`, null, 'red') : chip('status', `? ${group.status}`, null, 'unread')];
  return [
    { kind: 'circles', circles: group.circles },
    ...(group.line === null ? [] : [text('line', group.line)]),
    ...status,
    ...unreadChip(group.unread),
    chip('auto', `auto ${on} of ${group.marks.length}`, on, on > 0 ? 'blue' : 'zero'),
  ];
};

const LOAD_CHIP: Readonly<Record<HeaderTone, readonly [string, SummaryTone]>> = {
  green: ['✓ load ok', 'green'],
  amber: ['◔ load tight', 'amber'],
  red: ['● load starved', 'red'],
  grey: ['? load not measured', 'unread'],
  plain: ['? load not measured', 'unread'],
};

/**
 * The folded summary of Machine: the load chip, and a chip per host limit past `MACHINE_CHIP_SHARE`.
 *
 * @param group - the Machine group of `deliveryHeader`.
 * @param threshold - the used share above which a host meter shows its chip.
 * @returns `✓ load ok`, `◔ load tight`, `● load starved` or `? load not measured`; then `◔ GraphQL 57% used` for each host meter whose used share is above `threshold` (red where its tone is red), and the meter's own text, red, for a rate-limited host with no share.
 */
export const machineSummary = (group: Pick<MachineHeaderGroup, 'meters'>, threshold: number = MACHINE_CHIP_SHARE): SummaryPart[] => {
  const load = group.meters.find((m) => m.key === 'load');
  const [loadText, loadTone] = LOAD_CHIP[load?.share === null || load === undefined ? 'grey' : load.tone];
  const limits = group.meters.filter((m) => m.key !== 'load').flatMap((m): SummaryChip[] => {
    if (m.share !== null && m.share > threshold) {
      return [chip(m.key, `◔ ${m.label} ${Math.round(m.share * 100)}% used`, null, m.tone === 'red' ? 'red' : 'amber')];
    }
    return m.share === null && m.tone === 'red' ? [chip(m.key, `● ${m.text}`, null, 'red')] : [];
  });
  return [chip('load', loadText, null, loadTone), ...limits];
};

/** What the Tickets summary reads. */
export interface TicketsSummaryInput {
  /** `ticketsSection`'s state: only `rows` carries counts. */
  state: 'rows' | 'failed' | 'unsupported' | 'unasked';
  assigned: number;
  others: number;
  /** The waiting read's unassigned count; `null` where it carries none. */
  unassigned: number | null;
  /** The tickets the filters hide. */
  hidden: number;
  /** The rows of Delivered by the sprint; `null` where the tracker is unread; absent where the caller reads no scope. */
  delivered?: number | null;
  /** The rows of Found during the sprint; `null` where the tracker is unread; absent where the caller reads no scope. */
  found?: number | null;
}

/**
 * The folded summary of Tickets: assigned to me, others, unassigned and the count the filters hide.
 *
 * @param input - the state and the counts.
 * @returns `? tickets unread` where the tracker gave no rows; otherwise `◉ N assigned to me` (blue above 0), `N others`, `N unassigned` (`? unassigned` with a `null` count where the read carries none) and `N hidden by filter`, each `zero` at 0. Both forms end with `◎ N delivered by the sprint` and `⚑ N found` where the input carries those counts: grey above 0, `zero` at 0, and `◎ ? …`/`⚑ ? …` unread where the count is `null`.
 */
export const ticketsSummary = (input: TicketsSummaryInput): SummaryPart[] => {
  const counted = (key: string, icon: string, n: number, words: string, tone: SummaryTone): SummaryChip =>
    chip(key, `${icon}${n} ${words}`, n, n === 0 ? 'zero' : tone);
  const scope = (key: string, icon: string, n: number | null | undefined, words: string): SummaryChip[] =>
    n === undefined ? [] : [n === null ? chip(key, `${icon}? ${words}`, null, 'unread') : counted(key, icon, n, words, 'grey')];
  const scoped = [...scope('delivered', '◎ ', input.delivered, 'delivered by the sprint'), ...scope('found', '⚑ ', input.found, 'found')];
  if (input.state !== 'rows') return [chip('tickets', '? tickets unread', null, 'unread'), ...scoped];
  return [
    counted('assigned', '◉ ', input.assigned, 'assigned to me', 'blue'),
    counted('others', '', input.others, 'others', 'grey'),
    input.unassigned === null ? chip('unassigned', '? unassigned', null, 'unread') : counted('unassigned', '', input.unassigned, 'unassigned', 'grey'),
    counted('hidden', '', input.hidden, 'hidden by filter', 'grey'),
    ...scoped,
  ];
};

/**
 * The folded summary of Not placed: one chip.
 *
 * @param count - the entries the section holds.
 * @returns `N not placed`, amber above 0 and `zero` at 0.
 */
export const notPlacedSummary = (count: number): SummaryPart[] => [chip('not-placed', `${count} not placed`, count, count > 0 ? 'amber' : 'zero')];
