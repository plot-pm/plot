import type {
  ActionKind,
  CardFacts,
  CardPrFact,
  CostReading,
  Known,
  Reason,
  Ref,
  UnknownReach,
} from '@plot-pm/domain/entities/card-facts';

/**
 * THE CARD GRAMMAR'S WORDS. `CardFacts` says what is true; this says how a card
 * reads it — the five rows in a fixed order, every sentence, and which row the
 * board emphasises. Pure and browser-free; `<Card>` renders what it returns.
 *
 * `scripts/check-card-presentation.sh` holds this file to two imports: the
 * `CardFacts` types and the board's UI helpers. A reading reached from here
 * would be a fact decided in the UI.
 */

/** The board a card renders on. */
export type CardBoard = 'plans' | 'swimlanes' | 'stories' | 'tickets';

/** One of the five facets, which is also one row. */
export type Facet = 'identity' | 'lineage' | 'progress' | 'next' | 'ownership';

/** How loudly a piece reads. Every tone also carries its meaning in words. */
export type Tone = 'neutral' | 'muted' | 'warn' | 'alert' | 'type';

/** One rendered fact: its words, how loud, and what it links to. */
export interface Piece {
  text: string;
  tone: Tone;
  /** Hover text for a reader who wants the rest of the sentence; `null` for none. */
  detail: string | null;
  /** The item this piece names, which the renderer may link; `null` for none. */
  ref: Ref | null;
  /** `data-*` attributes, without the prefix. */
  data: Readonly<Record<string, string>>;
}

/** A single piece, or a list collapsed to a summary that expands in place. */
export type Part =
  | { kind: 'piece'; piece: Piece }
  | { kind: 'list'; id: string; summary: Piece; items: Piece[] };

/** An action as the card shows it. */
export interface PresentedAction {
  action: ActionKind;
  label: string;
  enabled: boolean;
  /** Why it is disabled, in words; `null` when enabled. */
  reason: string | null;
}

/** A card's rows, in the fixed order title, lineage, progress, next, ownership. */
export interface CardRows {
  /** The facet this board emphasises. */
  emphasis: Facet;
  title: { text: string; ref: Ref };
  /** The type badge and the labelled alerts, beside the title. */
  identity: Part[];
  lineage: Part[];
  progress: Part[];
  next: { primary: PresentedAction | null; secondary: PresentedAction[] };
  ownership: Part[];
}

/** What the board adds to a card: filters it already shows, and its own action entries. */
export interface PresentOptions {
  /** Lineage relations the board's active filter already names. */
  hide?: readonly ('stories' | 'sprints')[];
  /**
   * The board's own sentence for each action it will not run, from its action
   * entry. An `action-unavailable` reason reads as that sentence where one is
   * given.
   */
  unavailable?: Readonly<Partial<Record<ActionKind, string>>>;
}

const EMPHASIS: Readonly<Record<CardBoard, Facet>> = {
  plans: 'next',
  swimlanes: 'next',
  stories: 'progress',
  tickets: 'lineage',
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

const SPIKE: Readonly<Record<string, string>> = {
  'spike-not-approved': 'spike not approved yet',
  'spike-approved': 'spike approved — waiting for its PR to merge',
  'spike-merged': 'spike merged — confirm the slices to approve',
};

const piece = (text: string, over: Partial<Piece> = {}): Piece => ({
  text, tone: 'neutral', detail: null, ref: null, data: {}, ...over,
});
const one = (p: Piece): Part => ({ kind: 'piece', piece: p });
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How a slice ref reads in a sentence: its branch and, where known, its PR. */
const sliceWords = (ref: Ref): string =>
  ref.kind === 'slice' ? `${ref.branch}${ref.pr === null ? '' : ` #${ref.pr}`}` : refWords(ref);

/** How any ref reads by name. */
const refWords = (ref: Ref): string => {
  switch (ref.kind) {
    case 'ticket': return ref.title === ref.key ? `ticket ${ref.key}` : `${ref.key}: ${ref.title}`;
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

const presentAction = (
  a: NonNullable<CardFacts['next']['primary']>, unavailable: PresentOptions['unavailable'],
): PresentedAction => ({
  action: a.action,
  label: LABEL[a.action],
  enabled: a.enabled,
  reason: a.reason === null ? null : reasonWords(a.reason, unavailable),
});

const RELATION_WORD: Readonly<Record<keyof CardFacts['lineage'], [string, string]>> = {
  tickets: ['ticket', 'tickets'],
  stories: ['story', 'stories'],
  plans: ['plan', 'plans'],
  sprints: ['sprint', 'sprints'],
};

/** One lineage relation: nothing when read and empty, a muted word when unread, a count past one. */
const relationParts = (relation: keyof CardFacts['lineage'], known: Known<Ref[]>, facts: CardFacts): Part[] => {
  const [singular, many] = RELATION_WORD[relation];
  if ('unknown' in known) {
    return [one(piece(`${many} unknown — ${REACH[known.unknown]}`, { tone: 'muted', data: { lineage: relation, unknown: known.unknown } }))];
  }
  // The ticket the title already names by its key is shown there; every other one shows here.
  const refs = relation === 'tickets' ? known.value.filter((r) => !(r.kind === 'ticket' && r.key === facts.identity.key)) : known.value;
  const items = refs.map((ref) => piece(
    ref.kind === 'story' || ref.kind === 'sprint' ? `${singular} ${ref.title}` : refWords(ref),
    { ref, data: { lineage: relation } },
  ));
  if (items.length === 0) return [];
  if (items.length === 1) return [one(items[0])];
  const summary = relation === 'sprints' ? `in ${refs.length} sprints` : plural(refs.length, singular);
  return [{ kind: 'list', id: `lineage-${relation}`, summary: piece(summary, { data: { lineage: relation } }), items }];
};

/** The PR list: one PR reads inline, two or more collapse to counts by check state. */
const prParts = (prs: NonNullable<CardFacts['progress']>['prs'], plan: string): Part[] => {
  if ('unknown' in prs) return [one(piece(`PRs unknown — ${REACH[prs.unknown]}`, { tone: 'muted', data: { prs: 'unknown' } }))];
  const items = prs.value.map((pr) => {
    const conflicting = pr.checks === 'none' && pr.mergeable === 'conflicting';
    return piece(`#${pr.number} ${conflicting ? 'no checks — conflicts' : CHECKS[pr.checks]}`, {
    tone: pr.checks === 'failing' || conflicting ? 'warn' : pr.checks === 'unknown' || pr.checks === 'pending' ? 'muted' : 'neutral',
    ref: { kind: 'slice', plan, branch: pr.branch, pr: pr.number },
    data: { 'pr-checks': '', 'pr-checks-state': pr.checks, 'pr-number': String(pr.number) },
    });
  });
  if (items.length === 0) return [];
  if (items.length === 1) return [one(items[0])];
  const count = (state: CardPrFact['checks']) => prs.value.filter((pr) => pr.checks === state).length;
  const words = [plural(items.length, 'PR')];
  const failing = count('failing');
  const pending = count('pending');
  const none = count('none');
  const unknown = count('unknown');
  if (failing > 0) words.push(`${failing} failing`);
  if (pending > 0) words.push(`${pending} running`);
  if (none > 0) words.push(`${none} without checks`);
  if (unknown > 0) words.push(`${unknown} checks unknown`);
  if (words.length === 1) words.push('all green');
  return [{
    kind: 'list', id: 'prs',
    summary: piece(words.join(' · '), { tone: failing > 0 ? 'warn' : 'neutral', data: { prs: 'summary' } }),
    items,
  }];
};

/**
 * The cost as coverage: how many slices were measured here, never a summed
 * counter. The four counters ride on the detail, listed apart.
 */
const costParts = (cost: Known<CostReading>): Part[] => {
  if ('unknown' in cost) {
    return [one(piece(`cost unknown — spend record ${REACH[cost.unknown]}`, { tone: 'muted', data: { cost: 'unknown' } }))];
  }
  const c = cost.value;
  if (c.slices === 0) return [];
  const scope =
    `${c.measured} of ${c.slices} slices measured on this machine` +
    (c.absent > 0 ? `, ${c.absent} not measured here` : '') +
    (c.unreadable > 0 ? `, ${c.unreadable} unreadable` : '');
  if (c.tokens === null) {
    const text = c.unreadable > 0 ? `cost not measured here (${c.unreadable} unreadable)` : 'cost not measured here';
    return [one(piece(text, {
      tone: 'muted',
      detail: `${scope}. A run that was never measured here records nothing rather than zero.`,
      data: { cost: 'unmeasured' },
    }))];
  }
  const t = c.tokens;
  const n = (v: number) => v.toLocaleString('en-US');
  const runs = c.fromRuns === 0
    ? ''
    : ` ${c.fromRuns} of the measured slices are read from SDK run lines, which include subagents and compaction; a seal line excludes them.`;
  const base = `measured on ${c.measured} of ${c.slices} slices`;
  return [one(piece(c.unreadable > 0 ? `${base} · ${c.unreadable} unreadable` : base, {
    detail:
      `in ${n(t.inputTokens)} · out ${n(t.outputTokens)} · cache-write ${n(t.cacheCreationTokens)} · cache-read ${n(t.cacheReadTokens)}. ` +
      `${scope}. Counters are listed apart rather than summed — cache reads are the overwhelming majority of any total. ` +
      `Runs killed by the worker bound record nothing, so this is biased low.${runs}`,
    data: { cost: 'measured' },
  }))];
};

const ALERT_DETAIL = 'This plan is in the board\'s working tree but not on the ref it reads — nobody else can see it yet';

/**
 * A card's rows and every word on them, from its facts.
 *
 * @param facts - the item's `CardFacts`.
 * @param board - the board the card renders on; it decides only the emphasised row.
 * @param options - lineage relations a board filter already names.
 * @returns the rows `<Card>` renders.
 */
export const presentCard = (facts: CardFacts, board: CardBoard, options: PresentOptions = {}): CardRows => {
  const { identity, lineage, progress, next, ownership } = facts;
  const hide = new Set(options.hide ?? []);

  const identityParts: Part[] = [];
  if (identity.type !== null) identityParts.push(one(piece(identity.type, { tone: 'type', data: { type: identity.type } })));
  for (const alert of identity.alerts) {
    if (alert.kind === 'not-pushed') {
      const text = alert.commits === null ? 'not pushed' : `not pushed · ${plural(alert.commits, 'commit')}`;
      identityParts.push(one(piece(text, { tone: 'warn', detail: ALERT_DETAIL, data: { alert: alert.kind } })));
    } else if (alert.kind === 'status-behind') {
      identityParts.push(one(piece(`status behind: ${alert.proven}`, { tone: 'warn', data: { alert: alert.kind } })));
    } else {
      identityParts.push(one(piece(`issue link unreadable: ${alert.value}`, { tone: 'warn', data: { alert: alert.kind } })));
    }
  }

  const lineageParts = (['tickets', 'stories', 'plans', 'sprints'] as const)
    .filter((r) => !(r === 'stories' || r === 'sprints') || !hide.has(r))
    .flatMap((r) => relationParts(r, lineage[r], facts));

  const progressParts: Part[] = [];
  if (progress !== null) {
    const { work, prs, design, verification, cost } = progress;
    if (work !== null) {
      progressParts.push(one('unknown' in work.done
        ? piece(`${plural(work.total, work.unit.slice(0, -1))} · progress unknown`, { tone: 'muted', data: { work: 'unknown' } })
        : piece(`${work.done.value}/${work.total} ${work.unit} complete`, { data: { work: 'known' } })));
    }
    progressParts.push(...prParts(prs, identity.id));
    if (design !== null) {
      if (design.spike !== null) {
        progressParts.push(one(piece(SPIKE[design.spike], { tone: 'muted', data: { 'spike-state': design.spike } })));
      }
      progressParts.push(one(design.rounds === null
        ? piece('not interrogated', { tone: 'muted', detail: 'No Rounds: field — nobody has interrogated this plan', data: { rounds: 'absent' } })
        : piece(plural(design.rounds, 'round'), { detail: `Interrogated: ${plural(design.rounds, 'round')} recorded in the plan`, data: { rounds: 'recorded' } })));
    }
    if (verification !== null && verification.state === 'refuted' && verification.refuted > 0) {
      progressParts.push(one(piece(`${verification.refuted} refuted`, {
        tone: 'alert',
        detail: 'Verification refuted claims of this delivered plan; see ## Verification in the plan',
        data: { 'refuted-badge': identity.id },
      })));
    }
    progressParts.push(...costParts(cost));
  }

  const ownershipParts: Part[] = [];
  if (ownership.owner !== null) ownershipParts.push(one(piece(`@${ownership.owner}`, { tone: 'muted', data: { owner: '' } })));
  if (ownership.since !== null) {
    const verb = ownership.since.event === 'opened' ? 'opened' : ownership.since.event === 'updated' ? 'updated' : 'changed';
    ownershipParts.push(one(piece(`${verb} ${ownership.since.at}`, { tone: 'muted', data: { since: ownership.since.event } })));
  }
  if ('path' in ownership.source) {
    ownershipParts.push(one(piece(ownership.source.path, { tone: 'muted', data: { source: 'path' } })));
  } else {
    ownershipParts.push(one(piece(refWords(ownership.source), { tone: 'muted', ref: ownership.source, data: { source: 'ref' } })));
  }

  return {
    emphasis: EMPHASIS[board],
    title: { text: identity.key === null ? identity.title : `${identity.key}: ${identity.title}`, ref: identity.opens },
    identity: identityParts,
    lineage: lineageParts,
    progress: progressParts,
    next: {
      primary: next.primary === null ? null : presentAction(next.primary, options.unavailable),
      secondary: next.secondary.map((a) => presentAction(a, options.unavailable)),
    },
    ownership: ownershipParts,
  };
};
