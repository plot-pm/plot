import type { IssueAnswer } from '../entities/issue.js';
import { youCaseOf, type ItemKind, type YouMarker, type YouReason, type ItemPlacement } from './delivery-placement.js';
import { reasonVerb, youKindWord } from './delivery-row-form.js';
import { TICKETS_ANCHOR } from './tickets-section.js';
import { linkIconKind, type LinkIconKind } from './link-icon.js';

/** The marker words a line carries as text; a marker is never colour alone. */
export const TODO_MARKER_WORDS: Record<YouMarker, string> = {
  'blocks-delivery': 'blocks delivery',
  input: 'input',
  'clean-up': 'clean up',
};

/** Most urgent first: the markers' order in the list. */
const MARKER_ORDER: readonly YouMarker[] = ['blocks-delivery', 'input', 'clean-up'];

/** The fixed order of reasons within one marker, declared once. */
const REASON_ORDER: readonly YouReason[] = [
  'release-approval',
  'plan-approval',
  'spike-approval',
  'merge-conflict',
  'fleet-stuck',
  'agent-died',
  'blocked-marker',
  'person-comment',
  'review-pr',
  'test-delivered-plan',
  'draft-plan',
  'loose',
];

/** An item of the You section with what the line needs to name and link it. */
export interface TodoItem {
  placement: ItemPlacement;
  /** The label a link to the item shows. */
  label: string;
  /** The DOM id the line's name scrolls to. */
  anchor: string;
}

export interface TodoListInput {
  /** The placed items; only those under You make a line. */
  items: readonly TodoItem[];
  /** Whether the tracker answered; `null` where nobody asked. */
  ticketAnswer: IssueAnswer | null;
  /** The tickets the placement gave the Tickets section. */
  tickets: readonly { ownership: string }[];
  /** The releases the release cards owe an approval for (`releaseTodoEntries`); absent reads as none. */
  releases?: readonly { id: string; label: string; anchor: string }[];
}

export interface TodoLine {
  id: string;
  /** The verb capitalised, then the label: `Approve my-plan`; always `${verb} ${label}`. */
  text: string;
  /** The verb alone, capitalised: `Approve`. */
  verb: string;
  /** The name the verb acts on: `my-plan`. */
  label: string;
  marker: YouMarker;
  /** The marker as words. */
  markerWords: string;
  anchor: string;
  /** The kind of item the line's name leads to: the placed item's kind, or `release` for a release approval. */
  icon: LinkIconKind;
}

export interface TodoList {
  /** One line per You item, most urgent first. */
  lines: TodoLine[];
  /** Lines per marker; the three sum to `lines.length`. */
  counts: Record<YouMarker, number>;
  /** `You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up`, or `You block nothing`. */
  header: string;
  /** Tickets assigned to the reader with no plan; `null` where the tracker has not answered. */
  tickets: number | null;
  /** The triage line; says the count is not read where it is `null`. */
  triageText: string;
  /** The DOM id the triage link scrolls to. */
  triageAnchor: string;
  /** The kind of item the triage link leads to. */
  triageIcon: LinkIconKind;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The Delivery tab's to-do list: one line per You item, verb first, most urgent on top.
 *
 * A line's marker is the placement's own; no second reason-to-marker map exists. A clean-up line
 * names the item's kind (`youKindWord`) in place of a verb, because a loose item offers no single act. The order is
 * marker (blocks delivery, input, clean up), then `REASON_ORDER`, then item id, and does not read age.
 * A release a release card binds adds one `release-approval` line, sorted with the rest.
 * The header counts the three markers from the same lines and prints only non-zero parts;
 * with no line it reads `You block nothing`. The triage count is the tickets with ownership `mine`,
 * the figure the Tickets section shows as "assigned to you with no plan", and is `null` unless the tracker answered.
 *
 * @param input - the placed items, the releases owed an approval, the tracker answer and the placed tickets.
 */
export const todoList = (input: TodoListInput): TodoList => {
  const release = youCaseOf('release-approval');
  const entries = [
    ...input.items.flatMap((i) => (i.placement.section === 'you'
      ? [{ id: i.placement.id, reason: i.placement.reason, kind: i.placement.kind as ItemKind | undefined, marker: i.placement.marker, label: i.label, anchor: i.anchor }]
      : [])),
    ...(input.releases ?? []).map((r) => ({ id: r.id, reason: release.reason, kind: undefined, marker: release.marker, label: r.label, anchor: r.anchor })),
  ];
  const rank = (e: (typeof entries)[number]): [number, number] => [MARKER_ORDER.indexOf(e.marker), REASON_ORDER.indexOf(e.reason)];
  entries.sort((a, b) => {
    const [am, ar] = rank(a);
    const [bm, br] = rank(b);
    if (am !== bm) return am - bm;
    if (ar !== br) return ar - br;
    return a.id < b.id ? -1 : 1;
  });
  const word = (e: (typeof entries)[number]): string =>
    capital(e.reason === 'loose' && e.kind !== undefined ? youKindWord(e.kind) : reasonVerb(e.reason));
  const lines: TodoLine[] = entries.map((e) => ({
    id: e.id,
    text: `${word(e)} ${e.label}`,
    verb: word(e),
    label: e.label,
    marker: e.marker,
    markerWords: TODO_MARKER_WORDS[e.marker],
    anchor: e.anchor,
    icon: linkIconKind(e.kind ?? 'release') ?? 'release',
  }));
  const counts: Record<YouMarker, number> = { 'blocks-delivery': 0, input: 0, 'clean-up': 0 };
  for (const l of lines) counts[l.marker] += 1;
  const parts = [
    counts['blocks-delivery'] > 0 ? `You block ${plural(counts['blocks-delivery'], 'delivery', 'deliveries')}` : null,
    counts.input > 0 ? `the fleet waits for ${plural(counts.input, 'input', 'inputs')}` : null,
    counts['clean-up'] > 0 ? `${counts['clean-up']} to clean up` : null,
  ].filter((s): s is string => s !== null);
  const tickets = input.ticketAnswer === 'answered' ? input.tickets.filter((t) => t.ownership === 'mine').length : null;
  return {
    lines,
    counts,
    header: parts.length === 0 ? 'You block nothing' : parts.join(' · '),
    tickets,
    triageText: tickets === null ? 'Tickets assigned to you with no plan: not read' : `${plural(tickets, 'ticket', 'tickets')} assigned to you with no plan`,
    triageAnchor: TICKETS_ANCHOR,
    triageIcon: 'ticket',
  };
};
