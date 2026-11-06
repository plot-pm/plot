import type {
  ActionKind,
  CardFacts,
  CardKind,
  CardPrFact,
  CostReading,
  ItemState,
  Known,
  Reason,
  Ref,
  UnknownReach,
} from '@plot-pm/domain/entities/card-facts';

/**
 * THE CARD GRAMMAR'S WORDS. `CardFacts` says what is true; this says how a card
 * reads it — three sections in a fixed order (header, status, footer),
 * every sentence, the colour each word sits beside, and which section the board
 * emphasises. Pure and browser-free; `<Card>` renders what it returns.
 *
 * `scripts/check-card-presentation.sh` holds this file to two imports: the
 * `CardFacts` types and the board's UI helpers. A reading reached from here
 * would be a fact decided in the UI.
 */

/** The alert a card shows in place of its sections when the board sent it no facts. */
export const UNREADABLE_CARD = 'unreadable card';

/**
 * Where a card renders: a planning column (`plans`), the Testing column
 * (`testing`), swimlanes, or discovery's story and ticket lanes.
 */
export type CardBoard = 'plans' | 'testing' | 'swimlanes' | 'stories' | 'tickets';

/** One of the card's three sections, each in a fixed place and on its own surface on every kind. */
export type Section = 'header' | 'status' | 'footer';

/**
 * How loudly a piece reads. Every tone also carries its meaning in words;
 * `unknown` is a fact the board did not read.
 */
export type Tone = 'neutral' | 'muted' | 'unknown' | 'warn' | 'alert' | 'type';

/** A colour a word sits beside; never the only carrier of a meaning. */
export type Hue = 'slate' | 'sky' | 'blue' | 'green' | 'teal' | 'violet' | 'orange' | 'amber' | 'red';

/** The kinds of item an icon names: the three card kinds, and the items they link to. */
export type IconKind = Ref['kind'];

/** An icon for a kind of item: the kind, its accessible name and its hue. */
export interface KindIcon {
  kind: IconKind;
  label: string;
  hue: Hue;
}

/** One rendered fact: its words, how loud, what leads it and what it links to. */
/** A pull request as a card shows it: its number, its branch and its build, each its own link. */
export interface PrView {
  number: number;
  branch: string;
  /** The build's state in words. */
  checks: string;
  /** What the number links to: the PR. */
  prRef: Ref;
  /** What the branch links to. */
  branchRef: Ref;
}

export interface Piece {
  text: string;
  tone: Tone;
  /** The pull request this piece shows, drawn as its number, branch and build; `null` for none. */
  pr: PrView | null;
  /** The kind icon this piece leads with; `null` for none. */
  icon: KindIcon | null;
  /** A coloured dot this piece leads with, beside its words; `null` for none. */
  dot: Hue | null;
  /** The rest of the sentence, in the piece's tooltip; `null` for none. */
  detail: string | null;
  /** The item this piece names, which the renderer may link; `null` for none. */
  ref: Ref | null;
  /** `data-*` attributes, without the prefix. */
  data: Readonly<Record<string, string>>;
}

/** One coloured count in a summary: its hue, the count and the word it stands for. */
export interface Dot {
  hue: Hue;
  count: number;
  word: string;
}

/** A single piece, a count whose items open in a popover, or a work measure. */
export type Part =
  | { kind: 'piece'; piece: Piece }
  | { kind: 'list'; id: string; summary: Piece; dots: Dot[]; items: Piece[] }
  | { kind: 'work'; piece: Piece; done: number | null; total: number };

/** An action as the card shows it. */
export interface PresentedAction {
  action: ActionKind;
  label: string;
  enabled: boolean;
  /** Why it is disabled, in words; `null` when enabled. */
  reason: string | null;
  /** The same sentence in parts, each item it names its own link; `null` when enabled. */
  reasonParts: ReasonPart[] | null;
}

/** A stretch of a sentence, and the item it names where it names one. */
export interface ReasonPart {
  text: string;
  ref: Ref | null;
}

/** Who the item is assigned to, as the footer's avatars show it. */
export interface PresentedAssignees {
  /** `named` draws the first assignee's initials; `unassigned` and `unknown` an empty dashed circle. */
  kind: 'named' | 'unassigned' | 'unknown';
  /** The first assignee's initials; `null` for the empty circle. */
  initials: string | null;
  /** How many more assignees the `+N` beside the avatar counts. */
  more: number;
  /** The accessible name and the tooltip: every name, `Unassigned` or `Assignee unknown`. */
  label: string;
}

/** A card's three sections. An empty section, and an empty line in one, is not drawn. */
export interface CardSections {
  /** The section this board emphasises with the stronger tint. */
  emphasis: Section;
  /** The accent colour of the card's left edge: its state's hue. */
  accent: Hue;
  header: {
    kind: KindIcon;
    /** The ticket number the title leads with (`#3073`), its own link to the ticket; `null` for none. */
    number: string | null;
    /** The ticket the number links to; `null` where the title names none. */
    numberRef: Ref | null;
    title: string;
    /** The title as a reader names the item: the key, then the title. */
    label: string;
    ref: Ref;
    /** The muted meta line: subtype tag, alerts, then each related item as icon + identifier + name. */
    meta: Part[];
  };
  status: {
    /** Line 1: the state pill. */
    state: Piece;
    /** Line 1: work done of total, drawn with a bar across the panel; `null` where there is none. */
    work: Extract<Part, { kind: 'work' }> | null;
    /** The signals: PR check dots, rounds and spike, verification, a measured cost. */
    signals: Part[];
  };
  footer: {
    assignees: PresentedAssignees;
    age: Piece | null;
    primary: PresentedAction | null;
    secondary: PresentedAction[];
  };
}

/** What the board adds to a card: filters it already shows, its own action entries and the clock. */
export interface PresentOptions {
  /** Lineage relations the board's active filter already names. */
  hide?: readonly ('stories' | 'sprints')[];
  /**
   * The board's own sentence for each action it will not run, from its action
   * entry. An `action-unavailable` reason reads as that sentence where one is
   * given.
   */
  unavailable?: Readonly<Partial<Record<ActionKind, string>>>;
  /** Epoch milliseconds the relative age is measured from; absent shows no age. */
  now?: number;
}

const EMPHASIS: Readonly<Record<CardBoard, Section>> = {
  plans: 'footer',
  testing: 'status',
  swimlanes: 'footer',
  stories: 'status',
  tickets: 'header',
};

const LABEL: Readonly<Record<ActionKind, string>> = {
  'create-plan': 'Create plan',
  'create-story': 'Create story',
  'add-plan': 'Add plan',
  'needs-design': 'Needs design',
  interrogate: 'Interrogate',
  approve: 'Approve',
  'approve-spike': 'Approve spike',
  'confirm-slices': 'Confirm slices and approve',
  'start-work': 'Start work',
  deliver: 'Deliver',
};

const REACH: Readonly<Record<UnknownReach, string>> = {
  unasked: 'not asked',
  throttled: 'host throttled',
  secondary: 'host rate-limited',
  failed: 'unreadable',
};

const CHECKS: Readonly<Record<CardPrFact['checks'], string>> = {
  green: 'checks green',
  pending: 'checks running',
  failing: 'checks failing',
  none: 'no checks',
  unknown: 'checks unknown',
};

const CHECKS_HUE: Readonly<Record<CardPrFact['checks'], Hue>> = {
  green: 'green',
  pending: 'amber',
  failing: 'red',
  none: 'slate',
  unknown: 'slate',
};

const SPIKE: Readonly<Record<string, string>> = {
  'spike-not-approved': 'spike not approved yet',
  'spike-approved': 'spike approved — waiting for its PR to merge',
  'spike-merged': 'spike merged — confirm the slices to approve',
};

const KIND_LABEL: Readonly<Record<IconKind, string>> = {
  ticket: 'Ticket',
  story: 'Story',
  plan: 'Plan',
  sprint: 'Sprint',
  slice: 'Slice',
};

const KIND_HUE: Readonly<Record<IconKind, Hue>> = {
  ticket: 'green',
  story: 'violet',
  plan: 'blue',
  sprint: 'teal',
  slice: 'slate',
};

/** Each state's word and hue, per kind of item. */
const PLAN_STATE: Readonly<Record<string, [string, Hue]>> = {
  draft: ['Draft', 'slate'],
  design: ['Design', 'sky'],
  approved: ['Approved', 'green'],
  delivered: ['Delivered', 'violet'],
  released: ['Released', 'orange'],
  rejected: ['Rejected', 'slate'],
  superseded: ['Superseded', 'slate'],
};
const STORY_STATE: Readonly<Record<string, [string, Hue]>> = {
  draft: ['Draft', 'slate'],
  ready: ['Ready', 'sky'],
  active: ['Active', 'green'],
  'in-review': ['In review', 'amber'],
  paused: ['Paused', 'slate'],
  done: ['Done', 'violet'],
};
const TICKET_STATE: Readonly<Record<string, [string, Hue]>> = {
  open: ['Open', 'green'],
  'in-progress': ['In progress', 'amber'],
  done: ['Done', 'violet'],
  hidden: ['Archived', 'slate'],
};

/**
 * The icon for a kind of item, named by the kind, in the kind's hue.
 *
 * @param kind - a card kind or the kind of a linked item.
 * @returns the icon, its accessible name and its hue.
 */
export const kindIcon = (kind: CardKind | IconKind): KindIcon => ({ kind, label: KIND_LABEL[kind], hue: KIND_HUE[kind] });

const piece = (text: string, over: Partial<Piece> = {}): Piece => ({
  text, tone: 'neutral', pr: null, icon: null, dot: null, detail: null, ref: null, data: {}, ...over,
});
const one = (p: Piece): Part => ({ kind: 'piece', piece: p });
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How a slice ref reads in a sentence: its branch and, where known, its PR. */
const sliceWords = (ref: Ref): string =>
  ref.kind === 'slice' ? `${ref.branch}${ref.pr === null ? '' : ` #${ref.pr}`}` : refWords(ref);

/** How any ref reads by name. */
const refWords = (ref: Ref): string => {
  switch (ref.kind) {
    case 'ticket': return ref.title === ref.key ? ref.key : `${ref.key}: ${ref.title}`;
    case 'slice': return sliceWords(ref);
    default: return ref.title;
  }
};

/**
 * Why an action is disabled, in words.
 *
 * @param reason - the typed reason from `CardFacts`.
 * @param unavailable - the board's own sentence per action it will not run.
 * @returns the sentence the card shows beside the action.
 */
export const reasonWords = (reason: Reason, unavailable: PresentOptions['unavailable'] = {}): string => {
  switch (reason.kind) {
    case 'action-unavailable': return unavailable[reason.action]?.trim() || 'unavailable on this board';
    case 'awaiting-fleet-scan': return 'no fleet scan yet';
    case 'nothing-eligible':
      return reason.waitsOn.length === 0
        ? 'no branch is eligible to start'
        : `waits on ${reason.waitsOn.map(sliceWords).join(', ')}`;
    case 'awaits-spike': return `waits on its spike ${sliceWords(reason.spike)}`;
    case 'linked-from-many-stories': return `linked from ${reason.stories.length} stories`;
    case 'lineage-unknown': return `${reason.relation} unread — ${REACH[reason.reach]}`;
  }
};

/** The slice refs a reason names, joined into parts: each one a link, the commas between them text. */
const sliceParts = (lead: string, refs: readonly Ref[]): ReasonPart[] => [
  { text: lead, ref: null },
  ...refs.flatMap((ref, i): ReasonPart[] => [
    ...(i === 0 ? [] : [{ text: ', ', ref: null }]),
    { text: sliceWords(ref), ref },
  ]),
];

/**
 * Why an action is disabled, in parts: the words `reasonWords` gives, with each
 * branch or PR it names its own part, so the renderer can link it.
 *
 * @param reason - the typed reason from `CardFacts`.
 * @param unavailable - the board's own sentence per action it will not run.
 * @returns the sentence in parts.
 */
export const reasonParts = (reason: Reason, unavailable: PresentOptions['unavailable'] = {}): ReasonPart[] => {
  if (reason.kind === 'nothing-eligible' && reason.waitsOn.length > 0) return sliceParts('waits on ', reason.waitsOn);
  if (reason.kind === 'awaits-spike') return sliceParts('waits on its spike ', [reason.spike]);
  return [{ text: reasonWords(reason, unavailable), ref: null }];
};

const presentAction = (
  a: NonNullable<CardFacts['next']['primary']>, unavailable: PresentOptions['unavailable'],
): PresentedAction => ({
  action: a.action,
  label: LABEL[a.action],
  enabled: a.enabled,
  reason: a.reason === null ? null : reasonWords(a.reason, unavailable),
  reasonParts: a.reason === null ? null : reasonParts(a.reason, unavailable),
});

const RELATION_WORD: Readonly<Record<keyof CardFacts['lineage'], [string, string]>> = {
  tickets: ['ticket', 'tickets'],
  stories: ['story', 'stories'],
  plans: ['plan', 'plans'],
  sprints: ['sprint', 'sprints'],
};


/** A ticket key as a reader names it: `#3170` for a number, the key as written otherwise. */
const ticketKey = (key: string): string => (/^\d+$/.test(key) ? `#${key}` : key);

/**
 * How a related item reads on the card: its identifier first, then its name.
 * A sprint is its `Release:` verbatim and its title (the title alone where it
 * names no release); a ticket its key; a plan its ticket number, where it has
 * one, and its title; a story its title. The
 * card shortens the name to fit; the tooltip holds it whole.
 */
const identifierOf = (ref: Ref): string => {
  switch (ref.kind) {
    case 'sprint': return ref.release === null ? ref.title : `${ref.release} · ${ref.title}`;
    case 'ticket': return ticketKey(ref.key);
    case 'plan': return ref.key === null ? ref.title : `${ticketKey(ref.key)} ${ref.title}`;
    case 'story': return ref.title;
    case 'slice': return sliceWords(ref);
  }
};

/** A related item's title and state, for its tooltip. */
const relatedDetail = (ref: Ref): string => {
  switch (ref.kind) {
    case 'sprint':
      return [ref.title, ref.release === null ? null : `release ${ref.release}`, ref.state].filter((x) => x !== null).join(' · ');
    case 'ticket':
      return [ref.title === ref.key ? null : ref.title, ref.lane].filter((x) => x !== null).join(' · ') || ticketKey(ref.key);
    case 'plan': return `${ref.title} · ${ref.status}`;
    case 'story': return [ref.title, ref.status].filter((x) => x !== null).join(' · ');
    case 'slice': return sliceWords(ref);
  }
};

/**
 * One lineage relation: nothing when read and empty, an unknown word when
 * unread, a count past one. Each item is its kind icon and its identifier,
 * with its title and state in the tooltip; the icon's accessible name says
 * the kind, so the word does not repeat.
 */
const relationParts = (relation: keyof CardFacts['lineage'], known: Known<Ref[]>, facts: CardFacts): Part[] => {
  const [singular, many] = RELATION_WORD[relation];
  if ('unknown' in known) {
    return [one(piece(`${many} unknown`, { tone: 'unknown', detail: REACH[known.unknown], data: { lineage: relation, unknown: known.unknown } }))];
  }
  // The ticket the title already names by its key is shown there; every other one shows here.
  const refs = relation === 'tickets' ? known.value.filter((r) => !(r.kind === 'ticket' && r.key === facts.identity.key)) : known.value;
  const items = refs.map((ref) => piece(identifierOf(ref), {
    tone: 'muted', ref, icon: kindIcon(ref.kind), detail: relatedDetail(ref), data: { lineage: relation },
  }));
  if (items.length === 0) return [];
  if (items.length === 1) return [one(items[0])];
  return [{ kind: 'list', id: `lineage-${relation}`, summary: piece(plural(refs.length, singular), { icon: kindIcon(refs[0].kind), data: { lineage: relation } }), dots: [], items }];
};

/** The PR list: one PR reads inline, two or more collapse to a count with one dot per check state. */
const prParts = (prs: CardFacts['progress']['prs'], plan: string): Part[] => {
  if ('unknown' in prs) return [one(piece('PRs unknown', { tone: 'unknown', detail: REACH[prs.unknown], data: { prs: 'unknown' } }))];
  const conflicts = (pr: CardPrFact) => pr.checks === 'none' && pr.mergeable === 'conflicting';
  const notLookedUp = (pr: CardPrFact) => pr.checks === 'unknown' && pr.checksLookup === 'skipped';
  const items = prs.value.map((pr) => {
    const conflicting = conflicts(pr);
    const words = conflicting ? 'no checks — conflicts' : notLookedUp(pr) ? 'checks not looked up yet' : CHECKS[pr.checks];
    return piece(`#${pr.number} ${words}`, {
      pr: {
        number: pr.number,
        branch: pr.branch,
        checks: words,
        prRef: { kind: 'slice', plan, branch: pr.branch, pr: pr.number },
        branchRef: { kind: 'slice', plan, branch: pr.branch, pr: null },
      },
      tone: pr.checks === 'failing' || conflicting ? 'warn' : pr.checks === 'unknown' ? 'unknown' : 'neutral',
      dot: conflicting ? 'red' : CHECKS_HUE[pr.checks],
      ref: { kind: 'slice', plan, branch: pr.branch, pr: pr.number },
      data: { 'pr-checks': '', 'pr-checks-state': pr.checks, 'pr-number': String(pr.number) },
    });
  });
  if (items.length === 0) return [];
  if (items.length === 1) return [one(items[0])];
  const count = (holds: (pr: CardPrFact) => boolean) => prs.value.filter(holds).length;
  const candidates: Dot[] = [
    { hue: 'green', count: count((pr) => pr.checks === 'green'), word: 'green' },
    { hue: 'red', count: count((pr) => pr.checks === 'failing'), word: 'failing' },
    { hue: 'red', count: count(conflicts), word: 'conflicting' },
    { hue: 'amber', count: count((pr) => pr.checks === 'pending'), word: 'running' },
    { hue: 'slate', count: count((pr) => pr.checks === 'none' && !conflicts(pr)), word: 'without checks' },
    { hue: 'slate', count: count((pr) => pr.checks === 'unknown' && !notLookedUp(pr)), word: 'checks unknown' },
    { hue: 'slate', count: count(notLookedUp), word: 'not looked up yet' },
  ];
  const dots = candidates.filter((dot) => dot.count > 0);
  // The count is neutral; only the dots of a failing check or a conflict carry a warning hue.
  return [{
    kind: 'list', id: 'prs',
    summary: piece(plural(items.length, 'PR'), {
      tone: 'neutral',
      detail: dots.map((dot) => `${dot.count} ${dot.word}`).join(' · '),
      data: { prs: 'summary' },
    }),
    dots,
    items,
  }];
};

/**
 * The cost as coverage: how many slices were measured here, never a summed
 * counter. The four counters ride on the detail, listed apart. `null` where
 * nothing was measured or the record could not be read: that reading belongs
 * to the detail view, not the card.
 */
const measuredCost = (cost: Known<CostReading>): Piece | null => {
  if ('unknown' in cost) return null;
  const c = cost.value;
  if (c.slices === 0 || c.tokens === null) return null;
  const scope =
    `${c.measured} of ${c.slices} slices measured on this machine` +
    (c.absent > 0 ? `, ${c.absent} not measured here` : '') +
    (c.unreadable > 0 ? `, ${c.unreadable} unreadable` : '');
  const t = c.tokens;
  const n = (v: number) => v.toLocaleString('en-US');
  const runs = c.fromRuns === 0
    ? ''
    : ` ${c.fromRuns} of the measured slices are read from SDK run lines, which include subagents and compaction; a seal line excludes them.`;
  const base = `measured on ${c.measured} of ${c.slices} slices`;
  return piece(c.unreadable > 0 ? `${base} · ${c.unreadable} unreadable` : base, {
    detail:
      `in ${n(t.inputTokens)} · out ${n(t.outputTokens)} · cache-write ${n(t.cacheCreationTokens)} · cache-read ${n(t.cacheReadTokens)}. ` +
      `${scope}. Counters are listed apart rather than summed — cache reads are the overwhelming majority of any total. ` +
      `Runs killed by the worker bound record nothing, so this is biased low.${runs}`,
    data: { cost: 'measured' },
  });
};

/** A cost the card leaves out, in words for the detail view; `null` where the card shows it or there is none. */
const unshownCost = (cost: Known<CostReading>): Piece | null => {
  if ('unknown' in cost) {
    return piece(`cost unknown — spend record ${REACH[cost.unknown]}`, { tone: 'unknown', data: { cost: 'unknown' } });
  }
  const c = cost.value;
  if (c.slices === 0 || c.tokens !== null) return null;
  const text = c.unreadable > 0 ? `cost not measured here (${c.unreadable} unreadable)` : 'cost not measured here';
  return piece(text, {
    tone: 'unknown',
    detail: `${c.measured} of ${c.slices} slices measured on this machine${c.absent > 0 ? `, ${c.absent} not measured here` : ''}. A run that was never measured here records nothing rather than zero.`,
    data: { cost: 'unmeasured' },
  });
};

/** The item's state as a pill: its word, its hue, and `state unknown` where it was not read. */
const statePiece = (state: Known<ItemState>): Piece => {
  if ('unknown' in state) {
    return piece('state unknown', { tone: 'unknown', dot: 'slate', detail: REACH[state.unknown], data: { state: 'unknown' } });
  }
  const s = state.value;
  const [word, hue] = s.kind === 'plan'
    ? PLAN_STATE[s.state]
    : s.kind === 'story' ? STORY_STATE[s.status] : TICKET_STATE[s.lane];
  const key = s.kind === 'plan' ? s.state : s.kind === 'story' ? s.status : s.lane;
  return piece(word, { dot: hue, data: { state: key } });
};

/** Initials for an avatar: the first letters of a handle's words, else its first two letters. */
const initialsOf = (handle: string): string => {
  const words = handle.split(/[-_.\s]+/).filter((w) => w !== '');
  const letters = words.length > 1 ? words[0][0] + words[1][0] : handle.slice(0, 2);
  return letters.toUpperCase();
};

const presentAssignees = (assignees: Known<string[]>): PresentedAssignees => {
  if ('unknown' in assignees) return { kind: 'unknown', initials: null, more: 0, label: 'Assignee unknown' };
  const names = assignees.value;
  if (names.length === 0) return { kind: 'unassigned', initials: null, more: 0, label: 'Unassigned' };
  return {
    kind: 'named',
    initials: initialsOf(names[0]),
    more: names.length - 1,
    label: names.map((n) => `@${n}`).join(', '),
  };
};
const DAY_MS = 86_400_000;

/**
 * A date as a reader measures it from now: today, yesterday, N days, months or
 * years ago.
 *
 * @param at - an ISO date, `YYYY-MM-DD`.
 * @param now - epoch milliseconds to measure from.
 * @returns the relative words, or the date itself where it does not parse.
 */
export const relativeAge = (at: string, now: number): string => {
  const then = Date.parse(`${at}T00:00:00`);
  if (Number.isNaN(then)) return at;
  const today = new Date(now);
  const days = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(
    new Date(then).getFullYear(), new Date(then).getMonth(), new Date(then).getDate(),
  )) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return plural(Math.floor(days / 30), 'month') + ' ago';
  return plural(Math.floor(days / 365), 'year') + ' ago';
};

const ALERT_DETAIL = 'This plan is in the board\'s working tree but not on the ref it reads — nobody else can see it yet';

/**
 * A card's four sections and every word on them, from its facts.
 *
 * @param facts - the item's `CardFacts`.
 * @param board - the board the card renders on; it decides only the emphasised section.
 * @param options - relations a board filter already names, the board's own action sentences, and the clock.
 * @returns the sections `<Card>` renders.
 */
export const presentCard = (facts: CardFacts, board: CardBoard, options: PresentOptions = {}): CardSections => {
  const { identity, lineage, progress, next, ownership } = facts;
  const hide = new Set(options.hide ?? []);

  const meta: Part[] = [];
  if (identity.type !== null) meta.push(one(piece(identity.type, { tone: 'type', data: { type: identity.type } })));
  for (const alert of identity.alerts) {
    if (alert.kind === 'not-pushed') {
      const text = alert.commits === null ? 'not pushed' : `not pushed · ${plural(alert.commits, 'commit')}`;
      meta.push(one(piece(text, { tone: 'neutral', detail: ALERT_DETAIL, data: { alert: alert.kind } })));
    } else if (alert.kind === 'status-behind') {
      meta.push(one(piece(`status behind: ${alert.proven}`, { tone: 'warn', data: { alert: alert.kind } })));
    } else {
      meta.push(one(piece(`issue link unreadable: ${alert.value}`, { tone: 'warn', data: { alert: alert.kind } })));
    }
  }
  meta.push(...(['tickets', 'stories', 'plans', 'sprints'] as const)
    .filter((r) => !(r === 'stories' || r === 'sprints') || !hide.has(r))
    .flatMap((r) => relationParts(r, lineage[r], facts)));

  const { work, prs, design, verification, cost } = progress;
  let workPart: Extract<Part, { kind: 'work' }> | null = null;
  if (work !== null) {
    const unit = work.total === 1 ? work.unit.slice(0, -1) : work.unit;
    workPart = 'unknown' in work.done
      ? { kind: 'work', done: null, total: work.total, piece: piece(`${work.total} ${unit} · progress unknown`, { tone: 'unknown', detail: 'no fleet scan has read this plan yet', data: { work: 'unknown' } }) }
      : { kind: 'work', done: work.done.value, total: work.total, piece: piece(`${work.done.value}/${work.total} ${unit}`, { data: { work: 'known' } }) };
  }
  const signals: Part[] = [...prParts(prs, identity.id)];
  if (design !== null) {
    if (design.spike !== null) {
      signals.push(one(piece(SPIKE[design.spike], { tone: 'muted', data: { 'spike-state': design.spike } })));
    }
    signals.push(one(design.rounds === null
      ? piece('not interrogated', { tone: 'muted', detail: 'No Rounds: field — nobody has interrogated this plan', data: { rounds: 'absent' } })
      : piece(plural(design.rounds, 'round'), { detail: `Interrogated: ${plural(design.rounds, 'round')} recorded in the plan`, data: { rounds: 'recorded' } })));
  }
  if (verification !== null && verification.state === 'refuted' && verification.refuted > 0) {
    signals.push(one(piece(`${verification.refuted} refuted`, {
      tone: 'alert',
      dot: 'red',
      detail: 'Verification refuted claims of this delivered plan; see ## Verification in the plan',
      data: { 'refuted-badge': identity.id },
    })));
  }
  const shownCost = measuredCost(cost);
  if (shownCost !== null) signals.push(one(shownCost));

  const state = statePiece(progress.state);
  const age = ownership.since === null || options.now === undefined
    ? null
    : piece(relativeAge(ownership.since.at, options.now), {
      tone: 'muted',
      detail: `${ownership.since.event} ${ownership.since.at}`,
      data: { since: ownership.since.event },
    });

  return {
    emphasis: EMPHASIS[board],
    accent: state.dot ?? 'slate',
    header: {
      kind: kindIcon(identity.kind),
      number: identity.key === null ? null : ticketKey(identity.key),
      numberRef: identity.key === null ? null : { kind: 'ticket', key: identity.key, title: identity.key, lane: null },
      title: identity.title,
      label: identity.key === null ? identity.title : `${identity.key}: ${identity.title}`,
      ref: identity.opens,
      meta,
    },
    status: { state, work: workPart, signals },
    footer: {
      assignees: presentAssignees(ownership.assignees),
      age,
      primary: next.primary === null ? null : presentAction(next.primary, options.unavailable),
      secondary: next.secondary.map((a) => presentAction(a, options.unavailable)),
    },
  };
};

/** What a detail view shows that the card leaves out. */
export interface PresentedDetails {
  /** The item's source: a plan's path, or the reference it came from. */
  source: Piece;
  /** The cost, where the card does not show it; `null` where the card does or there is none. */
  cost: Piece | null;
}

/**
 * The facts a card leaves to its detail view: the source, and an unmeasured or
 * unread cost.
 *
 * @param facts - the item's `CardFacts`.
 * @returns the pieces the detail view shows.
 */
export const presentDetails = (facts: CardFacts): PresentedDetails => ({
  source: 'path' in facts.ownership.source
    ? piece(facts.ownership.source.path, { data: { source: 'path' } })
    : piece(refWords(facts.ownership.source), { ref: facts.ownership.source, data: { source: 'ref' } }),
  cost: unshownCost(facts.progress.cost),
});
