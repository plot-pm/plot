import {
  headerCountParts,
  headerCounts,
  type HeaderCountPart,
  headerText,
  releaseTicketWording,
  planOwner,
  planRoute,
  planRowFacts,
  releaseBlocks,
  releaseDeliveryHeader,
  stripStateCounts,
  type ReleaseDeliveryCount,
  type ReleaseDeliveryHeader,
  releasePersonCards,
  sprintDeliveryGroups,
  sprintDeliveryTitle,
  sprintGroupHeader,
  type DeliveryScopeKind,
  type PersonCard,
  notStartedHold,
  sliceStateIn,
  type PlanRowFacts,
  type PlanLine,
  type PlanSliceFact,
  type ReleaseCarried,
  DELIVERY_LAYOUT,
  deliveryGroupAnchor,
  looseActions,
  looseGroupRow,
  type LooseGroupRow,
  oldestWaitsClause,
  fleetCountText,
  workGroupCountText,
  placeDelivery,
  type AgentPlacement,
  type DeliveryPlacement,
  type DeliverySection,
  type ItemPlacement,
  type LooseActions,
  type Unplaced,
  linkIconKind,
  type LinkIconKind,
  planReference,
  type PlanIndex,
  type PlanLinkKey,
  TICKETS_ANCHOR,
} from '@plot-pm/domain';
import type { AgentRow, Card, DispatchInfo, DraftPlan, FleetSprint, IssueAnswer, IssueRow, Slice } from '../../../contract/schema.js';
import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import { countedSlicesByPlan, type PlanCountedSlice } from '@plot-pm/domain/rules/counted-slices';
import { createFromIssueVerdict } from '@plot-pm/domain/rules/create-from-issue';
import { NO_TICKET_ROW_REASON, type ScopeRowMenu } from '@plot-pm/domain/rules/scope-tickets';
import { createPlanRefusal } from '../card-presentation.js';
import { armedLabel as approveConfirm } from '../../components/ApproveButton.js';
import { armedLabel as deliverConfirm } from '../../components/DeliverButton.js';
import { armedLabel as createPlanConfirm } from '../../components/CreatePlanButton.js';
import { armedLabel as createStoryConfirm } from '../../components/CreateStoryButton.js';
import { armedLabel as needsDesignConfirm } from '../../components/NeedsDesignButton.js';
import { armedLabel as resliceConfirm } from '../../components/ResliceButton.js';
import { startRefusal } from '../../components/StartWorkButton.js';
import { changedFilesLabel } from './actions.js';
import { agentLabel, draftItemId, sliceItemId, type DeliveryMapping, type RegistryAgent } from './delivery-readings.js';
import { itemRowFactsOf } from './delivery-row-facts.js';
import { isStartable, isUnbegun } from './row-identity.js';
import { groupBySlice, type SliceGroup } from './slices.js';
import { rowInSlice } from './delivery-readings.js';
import { headSliceNames, showsSliceFold, slicesElsewhere } from './sections.js';
import { hasExceptions } from './stuck.js';
import { GLYPH_PATH, type GlyphKind } from '../glyphs.js';

/** Every key a collapse toggle can hold: a section or one of its groups. */
export type DeliveryKey = string;

const SECTION_LABELS: Record<DeliverySection, { icon: GlyphKind; label: string; hint: string }> = {
  'release-delivery': { icon: 'release', label: 'Release delivery', hint: 'what has left the fleet' },
  you: { icon: 'ticket', label: 'You', hint: 'review, merge, decide' },
  'work-items': { icon: 'plan', label: 'Work items', hint: 'what the fleet is carrying' },
  fleet: { icon: 'agent', label: 'Fleet', hint: 'the agents' },
  machine: { icon: 'build', label: 'Machine', hint: 'processes and rate limits' },
};

const GROUP_LABELS: Record<string, { label: string; hint: string }> = {
  'blocks-delivery': { label: 'Blocks delivery', hint: 'delivery waits for you' },
  'input-to-the-fleet': { label: 'Input to the fleet', hint: 'a plan waits for your input' },
  unblock: { label: 'Unblock', hint: 'branches no plan names and nobody works on' },
  'at-a-gate': { label: 'At a gate', hint: 'CI, review or another gate holds it' },
  'being-built': { label: 'Being built', hint: 'an agent works on it' },
  queued: { label: 'Queued', hint: 'nobody has taken it' },
  working: { label: 'Working', hint: 'an agent acts on an item' },
  blocked: { label: 'Blocked', hint: 'an agent waits on a gate' },
  free: { label: 'Free agents', hint: 'an agent holds no item' },
};

/** One work item the rule placed, with the payload rows it stands for. */
export interface PlacedItemView {
  /** What the rule placed; `null` for a delivered item, which the rule places in no section. */
  placement: ItemPlacement | null;
  rows: AgentRow[];
  draft: DraftPlan | null;
  /** The ticket the item stands for; `null` for every other kind. */
  ticket: IssueRow | null;
  /** The label a link to this item shows. */
  label: string;
  /** The DOM id a link to this item scrolls to. */
  anchor: string;
  /** The agents acting on the item, as links. */
  links: LinkView[];
  /** The `⋯` menu of the item's row: the loose items for a loose item, the branch row's own menu otherwise. */
  menu: RowMenuView;
}

/**
 * The `⋯` menu a row of an item carries. A loose item carries `items`: Open, Release claim and Delete branch,
 * built from `looseActions`, so no Quiet-section reading of the row (`quietKind`) can add a second Release. A plan,
 * slice, branch or Tickets row carries `items`: the fixed item set of its kind. The grouped Unblock row carries
 * `branches`: the loose item set of each branch it counts.
 */
export type RowMenuView =
  | { kind: 'row' }
  | {
    kind: 'branches';
    branches: { branch: string; items: RowMenuItem[] }[];
    /** `enabled` while a branch is listed, `none` for no branch. */
    trigger: 'enabled' | 'none';
  }
  | {
    kind: 'items';
    items: RowMenuItem[];
    /** `enabled` while the list holds an item, `none` for an empty list: the trigger never shows disabled. */
    trigger: 'enabled' | 'none';
  };

/** The actions a plan, slice, branch or Tickets row's `⋯` lists. */
export type RowMenuAction =
  | 'approve' | 'needs-design' | 'deliver' | 'implement' | 'dispatch' | 'start-work' | 'reslice'
  | 'open' | 'release-claim' | 'resolve-conflict' | 'write-brief' | 'open-run' | 'worker-log' | 'status' | 'changed-files'
  | 'create-plan' | 'create-story' | 'open-issue' | 'delete-branch';

/** One item of a row's `⋯` menu. */
export interface RowMenuItem {
  action: RowMenuAction;
  label: string;
  /** Whether the item acts on a click; a disabled item stays listed with its `reason`. */
  enabled: boolean;
  /** The missing criterion in words; `null` where the item is enabled. */
  reason: string | null;
  /** The sentence the item shows before it acts; `null` for an item that acts on one click. */
  confirm: string | null;
}

/** The plan row's facts, read by the renderer from the card and the board's bindings. */
export interface PlanMenuFacts {
  kind: 'plan';
  plan: string;
  /** The plan's card; `null` where the row's plan has none. */
  card: Card | null;
  /** `isDraft(card)`. */
  isDraft: boolean;
  /** `card.controls.needsDesign`. */
  needsDesign: boolean;
  /** `card.deliverable`. */
  deliverable: boolean;
  /** `hasEligibleWork(card)`. */
  hasEligible: boolean;
  /** The one slice folded into the row; `null` where the plan has none to start alone. */
  soleSlice: string | null;
  approve?: DispatchInfo;
  deliver?: DispatchInfo;
  implement?: DispatchInfo;
  dispatch?: DispatchInfo;
}

/** The branch row's facts: the flags `menuState` reads, with the words and addresses of each item. */
export interface BranchMenuFacts {
  kind: 'branch';
  branch: string;
  card: Card | null;
  /** `openTarget(row)`: the PR page or the branch on the host; `''` where the host gave none. */
  openUrl: string;
  /** `openLabel(row)`. */
  openLabel: string;
  /** `offersReleaseClaim(row.quietKind)` on a Quiet row. */
  releaseClaim: boolean;
  /** `isStartable(row)`. */
  startable: boolean;
  /** `row.stuck.state === 'conflict'`. */
  conflict: boolean;
  /** `needsBrief(row)`. */
  needsBrief: boolean;
  /** The last run's address; `''` where the row carries none. */
  runUrl: string;
  /** `runLinkLabel(row)`. */
  runLabel: string;
  /** `showsWorkerLog(row)`. */
  hasLog: boolean;
  /** `card.hasDispatchLog`. */
  hasStatus: boolean;
  /** The count of changed files a failing check lists; `null` where `offersChangedFiles` is false. */
  changedFiles: number | null;
  dispatch?: DispatchInfo;
  implement?: DispatchInfo;
}

/** The slice row's facts: its own two acts, and the branch items of its one branch. */
export interface SliceMenuFacts {
  kind: 'slice';
  wave: string;
  /** The plan's slug, which a reslice names. */
  slug: string;
  card: Card | null;
  /** Whether the fleet reads the slice as eligible to start. */
  eligible: boolean;
  /** Whether the board reports the slice `unsliced-wave`. */
  unsliced: boolean;
  dispatch?: DispatchInfo;
  reslice?: DispatchInfo;
  /** The facts of the slice's one branch; `null` where the slice holds several or none. */
  branch: Omit<BranchMenuFacts, 'kind' | 'card' | 'dispatch' | 'startable'> | null;
}

/** A Release delivery slice line's facts: what its one item, Start work, reads. */
export interface SliceLineMenuFacts {
  kind: 'slice-line';
  /** The line's slice state, or `unread` where a reading it needs is absent. */
  state: PlanLine['state'];
  /** Whether the line carries Start (`PlanLine.start`). */
  start: boolean;
  /** The slice the line waits on, or `''` where it waits on none. */
  waitsFor: string;
  /** The slice's one branch, which Start work posts; `null` where the line names none. */
  branch: string | null;
  card: Card | null;
  dispatch?: DispatchInfo;
}

/** The Tickets row's facts. */
export interface TicketMenuFacts {
  kind: 'ticket';
  issue: IssueRow;
  idea: DispatchInfo;
  story: DispatchInfo;
  issueAnswer: IssueAnswer | null;
  /** The ticket's card facts; `undefined` where the row carries none. */
  facts?: CardFacts;
}

/** A scope group row's facts: the arms `scopeTickets` decided, and the Tickets facts its `tickets` arms read. */
export interface ScopeTicketMenuFacts {
  kind: 'scope-ticket';
  /** The ticket's row; `null` for a key-only row, whose Create plan and Create story `menu` disables. */
  issue: IssueRow | null;
  menu: ScopeRowMenu;
  idea: DispatchInfo;
  story: DispatchInfo;
  issueAnswer: IssueAnswer | null;
  facts?: CardFacts;
}

/** What `rowMenuOf` reads: a placed item, or the facts of one plan, slice, Release slice line, branch, Tickets or scope group row. */
export type RowMenuInput =
  | { kind: 'placed'; placement: ItemPlacement | null; rows: readonly AgentRow[]; actions: LooseActions }
  | PlanMenuFacts
  | SliceMenuFacts
  | SliceLineMenuFacts
  | BranchMenuFacts
  | TicketMenuFacts
  | ScopeTicketMenuFacts;

const item = (action: RowMenuAction, label: string, reason: string | null, confirm: string | null = null): RowMenuItem =>
  ({ action, label, enabled: reason === null, reason, confirm });

/** The first refusal of `reasons`, or `null` where none refuses. */
const firstReason = (...reasons: (string | null | undefined | false)[]): string | null =>
  reasons.find((r): r is string => typeof r === 'string' && r !== '') ?? null;

/** Why a binding will not act, or `null` where it will. */
const bindingReason = (binding: DispatchInfo | undefined, act: string): string | null => {
  if (binding === undefined) return `this board has not said whether it can ${act}`;
  return binding.available ? null : binding.reason || `this board will not ${act}`;
};

const NO_CARD = 'no plan card for this row';
const NO_BRANCH = 'the slice has no single branch';

const planItems = (f: PlanMenuFacts): RowMenuItem[] => {
  const { card } = f;
  const noCard = card === null ? NO_CARD : null;
  const eligible = f.hasEligible ? null : 'no branch is eligible to start';
  return [
    item('approve', 'Approve', firstReason(noCard, !f.isDraft && 'the plan is not a Draft', bindingReason(f.approve, 'approve')),
      card === null ? null : approveConfirm(card)),
    item('needs-design', 'Needs design',
      firstReason(noCard, !f.needsDesign && 'only a Draft plan goes to design', bindingReason(f.approve, 'move a plan to design')),
      card === null ? null : needsDesignConfirm(card)),
    item('deliver', 'Deliver', firstReason(noCard, !f.deliverable && 'not every slice has merged', bindingReason(f.deliver, 'deliver')),
      deliverConfirm(f.plan)),
    item('implement', 'Implement', firstReason(noCard, eligible, bindingReason(f.implement, 'implement'))),
    item('dispatch', 'Dispatch', firstReason(noCard, eligible, bindingReason(f.dispatch, 'dispatch'))),
    item('start-work', f.soleSlice === null ? 'Start work' : `Start work on ${f.soleSlice}`,
      firstReason(noCard, f.soleSlice === null && 'the plan has no single slice to start', startReason(card, f.dispatch))),
  ];
};

/** Why Start work refuses for a card, or `null` where it acts. */
const startReason = (card: Card | null, dispatch: DispatchInfo | undefined): string | null => {
  if (card === null) return NO_CARD;
  return bindingReason(dispatch, 'dispatch') ?? startRefusal(card, dispatch as DispatchInfo) ?? null;
};

/** The branch items after Start work, in menu order. */
const branchTail = (f: SliceMenuFacts['branch'], card: Card | null, implement: DispatchInfo | undefined, dispatch: DispatchInfo | undefined): RowMenuItem[] => {
  const none = f === null ? NO_BRANCH : null;
  return [
    item('resolve-conflict', 'Resolve conflict',
      firstReason(none, f !== null && !f.conflict && 'the branch has no merge conflict', card === null ? NO_CARD : null, bindingReason(dispatch, 'dispatch'))),
    item('write-brief', 'Write brief',
      firstReason(none, f !== null && !f.needsBrief && 'the branch needs no brief', card === null ? NO_CARD : null, bindingReason(implement, 'implement'))),
    item('open-run', f?.runLabel || 'Open last run', firstReason(none, f !== null && f.runUrl === '' && 'no run to open')),
    item('worker-log', 'Show the agent', firstReason(none, f !== null && !f.hasLog && 'no agent works on this branch')),
    item('status', 'Status', firstReason(none, f !== null && !f.hasStatus && 'no dispatcher log for this plan')),
    item('changed-files', f?.changedFiles == null ? 'Changed files' : changedFilesLabel(f.changedFiles),
      firstReason(none, f !== null && f.changedFiles === null && 'no failing check lists changed files')),
  ];
};

/** The branch items before Start work: Open and Release claim. */
const branchHead = (f: SliceMenuFacts['branch']): RowMenuItem[] => {
  const none = f === null ? NO_BRANCH : null;
  return [
    item('open', f?.openLabel || 'Open', firstReason(none, f !== null && f.openUrl === '' && 'no address')),
    item('release-claim', 'Release claim', firstReason(none, f !== null && !f.releaseClaim && 'the branch holds no orphaned claim'),
      f === null ? null : releaseWords(f.branch, 'here').confirm),
  ];
};

const branchItems = (f: BranchMenuFacts): RowMenuItem[] => [
  ...branchHead(f),
  item('start-work', 'Start work', firstReason(!f.startable && 'the branch is not startable', startReason(f.card, f.dispatch))),
  ...branchTail(f, f.card, f.implement, f.dispatch),
];

const sliceItems = (f: SliceMenuFacts): RowMenuItem[] => [
  item('start-work', 'Start work', firstReason(!f.eligible && 'the slice is not eligible to start', startReason(f.card, f.dispatch))),
  item('reslice', 'Slice this plan', firstReason(!f.unsliced && 'the slice holds one branch', bindingReason(f.reslice, 'reslice')),
      resliceConfirm(f.slug)),
  ...branchHead(f.branch),
  ...branchTail(f.branch, f.card, f.branch?.implement, f.dispatch),
];

/** Why a slice line's state keeps Start work from acting, or `null` where the state lets it act. */
const sliceLineReason = (f: SliceLineMenuFacts): string | null => {
  switch (f.state) {
    case 'unread': return 'the slice\'s state is not read';
    case 'not-started':
      if (f.start) return null;
      return f.waitsFor === '' ? 'the slice is not eligible to start' : `the slice waits for ${f.waitsFor}`;
    default: return 'the slice is already under way';
  }
};

/** A merged slice has no act left, so its line lists no item; every other line lists Start work. */
const sliceLineItems = (f: SliceLineMenuFacts): RowMenuItem[] => (f.state === 'delivered' ? [] : [
  item('start-work', 'Start work', firstReason(sliceLineReason(f), f.branch === null && NO_BRANCH, startReason(f.card, f.dispatch))),
]);

const ticketItems = (f: TicketMenuFacts): RowMenuItem[] => {
  const verdict = createFromIssueVerdict(f.idea, f.issueAnswer, 'plan');
  const story = createFromIssueVerdict(f.story, f.issueAnswer, 'story');
  const refused = (v: typeof verdict) => (v.kind === 'refused' ? v.reason : null);
  const pending = f.issueAnswer === null ? 'the tracker has not been read yet' : null;
  return [
    item('create-plan', 'Create plan',
      firstReason(refused(verdict), createPlanRefusal(f.facts), pending),
      createPlanConfirm(f.issue)),
    item('create-story', 'Create story', firstReason(refused(story), pending), createStoryConfirm(f.issue)),
    item('open-issue', 'Open on host', f.issue.url === '' ? 'no address' : null),
  ];
};

/**
 * The items of a scope group row: Create plan and Create story by `scopeTickets`' arm, where a `tickets` arm takes
 * the Tickets row's answer, and Open on host at the arm's address.
 */
const scopeTicketItems = (f: ScopeTicketMenuFacts): RowMenuItem[] => {
  const tickets = f.issue === null ? null : ticketItems({ kind: 'ticket', issue: f.issue, idea: f.idea, story: f.story, issueAnswer: f.issueAnswer, facts: f.facts });
  const arm = (action: 'create-plan' | 'create-story', label: string, chosen: ScopeRowMenu['createPlan']): RowMenuItem =>
    chosen.kind === 'disabled' || tickets === null
      ? item(action, label, chosen.kind === 'disabled' ? chosen.reason : NO_TICKET_ROW_REASON)
      : tickets.find((i) => i.action === action) as RowMenuItem;
  return [
    arm('create-plan', 'Create plan', f.menu.createPlan),
    arm('create-story', 'Create story', f.menu.createStory),
    item('open-issue', 'Open on host', f.menu.openOnHost.reason),
  ];
};

const itemsView = (items: RowMenuItem[]): RowMenuView => ({ kind: 'items', items, trigger: items.length > 0 ? 'enabled' : 'none' });

/**
 * The fixed item set of one loose branch: Open, Release claim and Delete branch, each disabled with the reason
 * `looseActions` gives.
 *
 * @param branch - the branch the items act on.
 * @param open - the PR page or the branch on the host; `''` where the host gave no address.
 * @param actions - what `looseActions` answered for the branch.
 */
export const looseItems = (branch: string, open: string, actions: LooseActions): RowMenuItem[] => {
  const release = releaseWords(branch, actions.release.where ?? 'here');
  const remove = deleteWords(branch);
  return [
    item('open', 'Open', open === '' ? 'no address' : null),
    { action: 'release-claim', label: release.label, enabled: actions.release.enabled, reason: actions.release.reason, confirm: release.confirm },
    { action: 'delete-branch', label: remove.label, enabled: actions.delete.enabled, reason: actions.delete.reason, confirm: remove.confirm },
  ];
};

/**
 * The menu of one row.
 *
 * @param input - a placed item (`placement`, its payload `rows`, and what `looseActions` offers), or the facts of a
 *   plan, slice, branch, Tickets or scope group row.
 * @returns for a placed item, the loose item set under You with the reason `loose`, else `{ kind: 'row' }`; for a plan,
 *   slice, Release slice line, branch or Tickets row, the fixed item set of its kind, each item enabled or disabled with
 *   its reason. A Release slice line lists Start work alone, which posts the line's branch, and a merged
 *   slice's line lists none.
 */
export const rowMenuOf = (input: RowMenuInput): RowMenuView => {
  switch (input.kind) {
    case 'plan': return itemsView(planItems(input));
    case 'slice': return itemsView(sliceItems(input));
    case 'slice-line': return itemsView(sliceLineItems(input));
    case 'branch': return itemsView(branchItems(input));
    case 'ticket': return itemsView(ticketItems(input));
    case 'scope-ticket': return itemsView(scopeTicketItems(input));
    case 'placed': {
      const { placement, rows, actions } = input;
      const first = rows[0];
      if (placement?.section !== 'you' || placement.reason !== 'loose' || first === undefined) return { kind: 'row' };
      return itemsView(looseItems(first.branch, first.pr?.url || first.branchUrl || '', actions));
    }
  }
};

/** The row a You item renders as, which fixes its `⋯` item set; `null` where the item reaches no You row. */
export type YouRowKind = 'plan' | 'slice' | 'branch' | 'ticket' | 'loose-group' | null;

/**
 * The row kind of a placed item under You, and so the fixed item set its `⋯` lists.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @returns `loose-group` for the reason `loose`, `null` for `release-approval` and a release item (the header's
 *   Release group holds them), the item's own kind otherwise, with a PR rendered as its branch row; `null` outside You.
 */
export const youRowKindOf = (placement: ItemPlacement): YouRowKind => {
  if (placement.section !== 'you' || placement.reason === 'release-approval') return null;
  if (placement.reason === 'loose') return 'loose-group';
  switch (placement.kind) {
    case 'plan': return 'plan';
    case 'slice': return 'slice';
    case 'pr':
    case 'branch': return 'branch';
    case 'ticket': return 'ticket';
    case 'release': return null;
  }
};

/** The words a loose-branch action shows: its menu label and the confirmation it asks before it acts. */
export interface CleanUpWords {
  label: string;
  confirm: string;
}

/**
 * The words of Release claim for one loose branch.
 *
 * @param branch - the branch whose claim is released.
 * @param where - `elsewhere` where this machine holds no worktree for the claim.
 */
export const releaseWords = (branch: string, where: 'here' | 'elsewhere'): CleanUpWords => (where === 'elsewhere'
  ? {
    label: 'Release claim (another machine)',
    confirm: `The claim on ${branch} belongs to another machine. Releasing it deletes the claim and the remote ref there too.`,
  }
  : { label: 'Release claim', confirm: `Release the claim on ${branch}? The branch holds only its claim, so no work is lost.` });

/**
 * The words of Delete branch for one branch: the confirmation names the branch and the pin that restores it.
 *
 * @param branch - the branch whose remote ref is deleted.
 */
export const deleteWords = (branch: string): CleanUpWords => ({
  label: 'Delete branch…',
  confirm: `Delete origin/${branch}? Its tip is pinned first at refs/plot/reaped/${branch}/<sha>, and that ref restores it.`,
});

/** One agent the rule placed, with its registry entry. */
export interface PlacedAgentView {
  placement: AgentPlacement;
  entry: RegistryAgent | null;
  /** The row of the branch the agent acts on, where the payload holds one. */
  row: AgentRow | null;
  label: string;
  anchor: string;
  /** The item the agent acts on, as a link; `null` while it holds none or the item is unknown. */
  links: LinkView[];
}

export interface LinkView {
  label: string;
  anchor: string;
  /** The kind of place the link leads to, for its icon; absent or `null` draws none. */
  icon?: LinkIconKind | null;
}

/**
 * One slice item under a plan head: the slice row it renders and the rows that
 * render on their own beside it.
 */
export interface SliceBlockView {
  item: PlacedItemView;
  /** The slice row's group; `null` where every row of the item renders on its own. */
  slice: SliceGroup | null;
  /** Rows of the item that render as branch rows, not inside the slice row. */
  loose: AgentRow[];
}

/**
 * A plan head over the slice items of that plan one group holds.
 *
 * `start` draws the slices as unbegun work with a Start control; `progress`
 * draws each slice with its sole branch's status. A plan whose slices land in
 * several groups gets one head per group, each over that group's slices only.
 */
export interface PlanBlockView {
  kind: 'plan';
  /** Unique per group and plan: the key a fold override is stored under. */
  key: string;
  plan: string;
  planFile: string;
  /** Every row the head stands for: its own plan row, if placed here, and its slices' rows. */
  rows: AgentRow[];
  /** The plan's own row item, absorbed into the head; `null` where it sits elsewhere or does not exist. */
  head: PlacedItemView | null;
  slices: SliceBlockView[];
  /** Items of the plan that are neither its plan row nor a slice. */
  loose: PlacedItemView[];
  mode: 'start' | 'progress';
  /** How many slices of the plan sit under another head or no head. */
  elsewhere: number;
  /** The freshest age of the head's rows; `undefined` where none has one. */
  ageMinutes: number | undefined;
  /** Whether a plan row heads the slices. Being built lists its slice rows with no plan head: an agent's rows name their plan. */
  headed: boolean;
}

/** One item that renders on its own: a plan-less row, a Draft plan, or a plan with no slice here. */
export interface ItemBlockView {
  kind: 'item';
  key: string;
  item: PlacedItemView;
}

/**
 * The loose items of the You section as one row: the verb, the count of branches as the object, the age range as the
 * consequence, and each branch's loose item set in the row's `⋯`.
 */
export interface LooseGroupBlockView {
  kind: 'loose-group';
  key: string;
  items: PlacedItemView[];
  row: LooseGroupRow;
  menu: RowMenuView;
}

export type BlockView = PlanBlockView | ItemBlockView | LooseGroupBlockView;

export interface GroupView {
  key: string;
  label: string;
  hint: string;
  items: PlacedItemView[];
  agents: PlacedAgentView[];
  /** The group's items, nested: plan heads over their slices, then the rest. */
  blocks: BlockView[];
  /** Every payload row the group renders, for the heading's activity mark. */
  rows: AgentRow[];
  count: number;
  /** What the heading counts: the items, or `N plans · M slices` where plan heads and slices differ. */
  tally: string;
}

/** One count of a section's header line: a group, its number, and where the number links. */
export interface SectionCount {
  key: string;
  label: string;
  count: number;
  /** What the header prints for the count: `3 queued` in Work items, `Queued 3` elsewhere. */
  text: string;
  /** What follows the number in every section: `queued`, `Queued`. Holds no number. */
  words: string;
  /** The anchor of the group's heading; `null` where the group has no rows and so renders no body. */
  anchor: string | null;
}

export const groupAnchor = (key: string): string => deliveryGroupAnchor(key);

/**
 * The counts of a section's header line, one per group in layout order. A group with no rows keeps its count of 0
 * and links nowhere, because its heading and body are not rendered.
 */
export const summarise = (groups: readonly GroupView[], section?: DeliverySection): SectionCount[] =>
  groups.map((g) => ({
    key: g.key,
    label: g.label,
    count: g.count,
    text: section === 'work-items' ? workGroupCountText(g.label, g.count) : section === 'fleet' ? fleetCountText(g.key, g.count) : `${g.label} ${g.count}`,
    words: section === 'work-items' ? g.label.toLowerCase() : section === 'fleet' ? g.key : g.label,
    anchor: g.count > 0 ? groupAnchor(g.key) : null,
  }));

/** The path of a section's glyph in the board's glyph table. */
export const sectionGlyph = (section: SectionView): string => GLYPH_PATH[section.icon];

export interface SectionView {
  key: DeliverySection;
  icon: GlyphKind;
  /** The header line: one count per group, empty for a section with no groups. */
  summary: SectionCount[];
  /** `oldest waits <age>`: the oldest row of the whole section. `null` where no row has an age reading. */
  oldest: string | null;
  label: string;
  hint: string;
  groups: GroupView[];
  /** Every payload row the section renders, for the heading's activity mark. */
  rows: AgentRow[];
  count: number;
}

/** A subject the rule did not place, with the reason in words. */
export interface UnplacedView {
  id: string;
  subject: Unplaced['subject'];
  reason: Unplaced['reason'];
  label: string;
  note: string;
  /** The payload rows of an item subject, rendered beside the note; empty for an agent. */
  rows: AgentRow[];
}

export interface DeliveryView {
  sections: SectionView[];
  /** Subjects with a reading nobody took — shown in a note, never dropped. */
  notPlaced: UnplacedView[];
  /** The Release delivery blocks: one per target release, each holding one collapsed row per plan. */
  releaseBlocks: ReleaseBlockView[];
  /** The distinct plans the section lists, a plan under two sprint groups counted once. */
  releasePlanCount: number;
  /** The section's header line, which stays when the section folds. */
  releaseHeader: ReleaseHeaderView;
  /** Every payload row the plan rows hold, for the section's pace mark. */
  releaseRows: AgentRow[];
  delivered: UnplacedView[];
  /** The plans the section lists and the slices it counts per plan, for the release card no Active sprint names. */
  releaseCarried: ReleaseCarried;
}

/** One plan row of the Release delivery section, with the item anchors its In flight lines link to. */
export interface PlanRowView extends PlanRowFacts {
  /** Slice name → the anchor of its placed item, for the slices that have one. */
  anchors: Record<string, string>;
  /** Slice name → the item id, for the Start action. */
  itemIds: Record<string, string>;
  /** The plan's file, for the plan card Start acts on; `''` where no row names one. */
  planFile: string;
  /** The plan name's link target, `planRoute(planFile)`; `''` where no row names a plan file. */
  href: string;
  /** The plan name with its ticket keys, `planReference`'s label: the cell's `title`. */
  label: string;
  /** The plan's ticket keys, each linked to its ticket before the plan link, which prints `plan` alone. */
  keys: readonly PlanLinkKey[];
}

/** One figure of the Release delivery header line, with the anchor of the plan row its link scrolls to. */
export interface ReleaseHeaderCountView extends ReleaseDeliveryCount {
  /** `releasePlanAnchor(target)`, or `null` for a count of 0. */
  anchor: string | null;
}

/** The Release delivery section's header line: `releaseDeliveryHeader` with anchors. */
export interface ReleaseHeaderView {
  scope: string;
  /** The one block's full header wording, ticket wording included, or `''` where the section holds several blocks or none. */
  title: string;
  counts: ReleaseHeaderCountView[];
  /** `releaseDeliveryHeader`'s five-state bar and the plans with a blocked slice, for the folded summary. */
  bar: ReleaseDeliveryHeader['bar'];
  blockedPlans: number;
}

/** One target release's block. */
export interface ReleaseBlockView {
  release: string;
  /** The sprint a group belongs to under the `my-sprint` scope, `''` for a release block. */
  sprint: string;
  /** The sprint's name where the scope holds several sprints, `''` otherwise. */
  name: string;
  header: string;
  /** The header's figures, each with its words: the same figures `header` prints, apart from the ticket wording. */
  counts: HeaderCountPart[];
  plans: PlanRowView[];
  /** One card per sprint owner of the release; empty where no sprint names the release. */
  cards: PersonCard[];
}

export const itemAnchor = (id: string): string => `delivery-item-${id}`;
export const releasePlanAnchor = (plan: string): string => `delivery-plan-${plan}`;
export const agentAnchor = (id: string): string => `delivery-agent-${id}`;

const itemLabel = (id: string, rows: readonly AgentRow[], draft: DraftPlan | null, ticket: IssueRow | null = null, index: PlanIndex = new Map()): string => {
  if (ticket !== null) return `${ticket.number} ${ticket.title}`;
  const first = rows[0];
  if (first !== undefined) {
    if (first.wave !== '') {
      const plan = first.plan === '' ? '' : planReference({ file: first.planFile || undefined, slug: first.plan }, index).label;
      return `${plan} › ${first.wave}`;
    }
    return first.branch || first.plan || id;
  }
  return draft === null ? id : planReference({ file: draft.planFile || undefined, slug: draft.plan, issues: draft.issues ?? [] }, index).label;
};

const unreadNote = (subject: Unplaced['subject'], ticket = false): string =>
  subject === 'item'
    ? ticket
      ? 'not placed: the ticket\'s releases were not read, so the Sprint filter cannot place it'
      : 'not placed: a reading the scan did not take (CI, review or stage is unread)'
    : 'not placed: the process of this agent was not read';

const isPlanRow = (item: PlacedItemView): boolean =>
  item.rows.length > 0 && item.rows.every((r) => r.kind === 'plan' && r.wave === '' && r.plan !== '');

const planOfItem = (item: PlacedItemView): string => item.rows[0]?.plan ?? '';

const isSliceItem = (item: PlacedItemView): boolean => item.rows.length > 0 && rowInSlice(item.rows[0]!);

/**
 * The items of the You section with the slice items of a plan that has its own draft item dropped:
 * that row stands for the plan. A plan with no draft item keeps its slice items and their nesting.
 */
const oneRowPerDraftPlan = (items: readonly PlacedItemView[]): PlacedItemView[] => {
  const hasDraftRow = new Set(items.filter((i) => i.draft !== null).map(planOfItem));
  return items.filter((i) => !(isSliceItem(i) && i.placement?.reason === 'draft-plan' && hasDraftRow.has(planOfItem(i))));
};

/**
 * Nests a list of placed items: one plan head per plan that has a slice item in
 * the list, holding that plan's slice items, its plan row and its other items;
 * every other item on its own. Heads and lone items keep the order of their first
 * item.
 *
 * @param scope - prefix for the block keys, unique per group.
 * @param items - the items one group (or the delivered list) holds, in placement order.
 * @param slices - the payload's slices, for the count of slices under no head here.
 * @param inYou - where the items are the You section's: a Draft or Design plan is then one row and its slice items show as none. The other sections keep the nesting.
 * @returns the blocks, each item in exactly one.
 */
export const nestItems = (scope: string, rawItems: readonly PlacedItemView[], slices?: Slice[], inYou = false): BlockView[] => {
  const items = inYou ? oneRowPerDraftPlan(rawItems) : rawItems;
  const withSlice = new Set(items.filter(isSliceItem).map(planOfItem).filter((p) => p !== ''));
  const blocks: BlockView[] = [];
  const heads = new Map<string, PlanBlockView>();
  for (const item of items) {
    const plan = planOfItem(item);
    if (plan === '' || !withSlice.has(plan) || item.draft !== null) {
      blocks.push({ kind: 'item', key: item.anchor, item });
      continue;
    }
    let head = heads.get(plan);
    if (head === undefined) {
      const first = item.rows[0]!;
      head = {
        kind: 'plan', key: `${scope}\u0000${plan}`, plan, planFile: first.planFile,
        rows: [], head: null, slices: [], loose: [], mode: 'progress', elsewhere: 0, ageMinutes: undefined,
        headed: scope !== 'being-built',
      };
      heads.set(plan, head);
      blocks.push(head);
    }
    head.rows.push(...item.rows);
    if (scope !== 'being-built' && isPlanRow(item) && head.head === null) head.head = item;
    else if (isSliceItem(item)) head.slices.push({ item, slice: null, loose: [] });
    else head.loose.push(item);
  }
  for (const head of heads.values()) {
    head.planFile = head.rows.find((r) => r.planFile !== '')?.planFile ?? head.planFile;
    head.mode = head.rows.every((r) => r.group === 'not-started') ? 'start' : 'progress';
    for (const s of head.slices) {
      const rows = head.mode === 'start' ? s.item.rows.filter(isUnbegun) : s.item.rows;
      s.slice = groupBySlice(rows)[0] ?? null;
      s.loose = head.mode === 'start' ? s.item.rows.filter((r) => !isUnbegun(r)) : [];
    }
    head.elsewhere = slicesElsewhere(slices, head.plan, 'not-started', headSliceNames({ plan: head.plan, planFile: head.planFile, rows: head.rows }));
    const ages = head.rows.map((r) => r.ageMinutes).filter((a): a is number => a !== null && a !== undefined);
    head.ageMinutes = ages.length > 0 ? Math.min(...ages) : undefined;
  }
  return oldestFirst(blocks);
};

/** How long a block has waited: its oldest row's age, or its plan clock in minutes where no branch has an age. */
const blockWait = (block: BlockView): number => {
  const rows = block.kind === 'plan' ? block.rows : block.kind === 'loose-group' ? block.items.flatMap((i) => i.rows) : block.item.rows;
  return rows.reduce((n, r) => Math.max(n, r.ageMinutes ?? 0, (r.waitingDays ?? 0) * 1440), 0);
};

/** Orders blocks by what has waited longest first; blocks that tie keep their placement order. */
const oldestFirst = (blocks: BlockView[]): BlockView[] =>
  blocks.map((b, i) => ({ b, i, wait: blockWait(b) }))
    .sort((a, b) => b.wait - a.wait || a.i - b.i)
    .map((x) => x.b);

const isLoose = (item: PlacedItemView): boolean => item.placement?.section === 'you' && item.placement.reason === 'loose';

/**
 * Groups the lone loose items of a list of blocks into one row, at the place of the first; every other block keeps
 * its place. No plan block nests a loose item, so only lone items are read.
 *
 * @param scope - prefix for the grouped row's key, unique per group.
 * @param blocks - the blocks `nestItems` returned.
 * @returns the blocks with the loose items as one `loose-group` block; the blocks unchanged where none is loose.
 */
export const groupLooseItems = (scope: string, blocks: readonly BlockView[]): BlockView[] => {
  const loose = blocks.flatMap((b) => (b.kind === 'item' && isLoose(b.item) ? [b.item] : []));
  const row = looseGroupRow(loose.map((i) => ({ id: i.placement?.id ?? i.anchor, ageMinutes: i.rows[0]?.ageMinutes ?? undefined })));
  if (row === null) return [...blocks];
  const branches = loose.flatMap((i) => (i.menu.kind === 'items' && i.rows[0] !== undefined ? [{ branch: i.rows[0].branch, items: i.menu.items }] : []));
  const group: LooseGroupBlockView = {
    kind: 'loose-group', key: `${scope}\u0000loose`, items: loose, row,
    menu: { kind: 'branches', branches, trigger: branches.length > 0 ? 'enabled' : 'none' },
  };
  const at = blocks.findIndex((b) => b.kind === 'item' && isLoose(b.item));
  return blocks.flatMap((b, i) => (i === at ? [group] : b.kind === 'item' && isLoose(b.item) ? [] : [b]));
};

/**
 * Whether a plan head's slices are on the page, or `null` where the head has no fold.
 *
 * A head with an exception among its rows stays open. A `start` head over one
 * slice row has no fold; over several it is folded until opened. A `progress`
 * head over several slices is folded until opened, over one it is open until shut.
 *
 * @param block - the plan head.
 * @param overrides - the reader's fold overrides, keyed `open:<key>` and `shut:<key>`.
 */
export const planBlockShown = (block: PlanBlockView, overrides: ReadonlySet<string>): boolean | null => {
  if (block.mode === 'start') {
    if (!showsSliceFold({ plan: block.plan, planFile: block.planFile, rows: block.rows })) return null;
    return overrides.has(`open:${block.key}`) || hasExceptions(block.rows);
  }
  if (hasExceptions(block.rows)) return true;
  return block.slices.length > 1 ? overrides.has(`open:${block.key}`) : !overrides.has(`shut:${block.key}`);
};

/** The override a click on a plan head's caret toggles. */
export const planBlockToggleKey = (block: PlanBlockView): string =>
  block.mode === 'start' || block.slices.length > 1 ? `open:${block.key}` : `shut:${block.key}`;

/**
 * Orders the rule's placement as the tab renders it: sections and groups in
 * `DELIVERY_LAYOUT` order, each placed item and agent once, links named from
 * the rule's `agents` and `actsOn` fields.
 *
 * @param mapping - the readings and the payload rows each subject id stands for.
 * @param placement - what `placeDelivery` returned for `mapping`.
 * @param slices - the payload's slices, for each plan head's count of slices elsewhere.
 * @param planIndex - the board's plan index, which names each plan's ticket keys for its labels; an empty map labels a plan by its slug.
 * @returns the sections, the not-placed note rows and the Release delivery line.
 */
export const deliveryView = (
  mapping: DeliveryMapping,
  placement: DeliveryPlacement,
  slices?: Slice[],
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>[] = [],
  scope: DeliveryViewScope = { kind: 'release', sprints: [] },
  now?: Date,
  planIndex: PlanIndex = new Map(),
): DeliveryView => {
  const rowOf = (item: string): AgentRow | null => mapping.rowsByItem[item]?.[0] ?? null;
  const ownRow = (entry: RegistryAgent | null): AgentRow | null => {
    if (entry === null || entry.branch === '') return null;
    for (const rows of Object.values(mapping.rowsByItem)) {
      const own = rows.find((r) => r.branch === entry.branch);
      if (own !== undefined) return own;
    }
    return null;
  };
  const labelOfItem = (id: string): string =>
    itemLabel(id, mapping.rowsByItem[id] ?? [], mapping.draftsByItem[id] ?? null, mapping.ticketsByItem[id] ?? null, planIndex);
  const labelOfAgent = (id: string): string => agentLabel(id, mapping.agentsById[id] ?? null);
  const kindOfItem = (id: string): LinkIconKind | null => {
    const item = placement.items.find((i) => i.id === id);
    return item === undefined ? null : linkIconKind(item.kind);
  };

  const itemViews = placement.items.map((p): PlacedItemView => ({
    placement: p,
    rows: mapping.rowsByItem[p.id] ?? [],
    draft: mapping.draftsByItem[p.id] ?? null,
    ticket: mapping.ticketsByItem[p.id] ?? null,
    label: labelOfItem(p.id),
    anchor: itemAnchor(p.id),
    links: p.agents.map((a) => ({ label: labelOfAgent(a), anchor: agentAnchor(a), icon: linkIconKind('agent') })),
    menu: rowMenuOf({ kind: 'placed', placement: p, rows: mapping.rowsByItem[p.id] ?? [], actions: looseActions(mapping.readings.items.find((i) => i.id === p.id) ?? { kind: 'slice' }) }),
  }));
  const agentViews = placement.agents.map((p): PlacedAgentView => ({
    placement: p,
    entry: mapping.agentsById[p.id] ?? null,
    row: p.actsOn === null ? null : ownRow(mapping.agentsById[p.id] ?? null) ?? rowOf(p.actsOn),
    label: labelOfAgent(p.id),
    anchor: agentAnchor(p.id),
    links: p.actsOn !== null && p.linked
      ? [{ label: labelOfItem(p.actsOn), anchor: itemAnchor(p.actsOn), icon: kindOfItem(p.actsOn) }]
      : [],
  }));

  // A plan's own row (its idea-branch PR) heads the plan beside its slices, so a
  // plan row the rule put in Work items follows the plan's first slice there.
  const sliceHome = new Map<string, string>();
  for (const v of itemViews) {
    const at = v.placement;
    if (at !== null && at.section === 'work-items' && isSliceItem(v) && !sliceHome.has(planOfItem(v))) {
      sliceHome.set(planOfItem(v), at.group);
    }
  }
  const homeGroup = (v: PlacedItemView): string | null => {
    const at = v.placement;
    if (at === null || at.section !== 'work-items') return null;
    return isPlanRow(v) ? sliceHome.get(planOfItem(v)) ?? at.group : at.group;
  };

  // A slice that holds no branch (so no agent either) is a To do line of its plan row, never a Work items row.
  const leavesWorkItems = (v: PlacedItemView): boolean =>
    v.placement?.section === 'work-items' && v.placement.group === 'queued' && isSliceItem(v) && v.rows.every((r) => isUnbegun(r) && r.branch === '');
  const sections = DELIVERY_LAYOUT.map(({ section, groups }): SectionView => {
    const groupViews = groups.map((group): GroupView => {
      const grouped = itemViews.filter((v) => !leavesWorkItems(v)).filter((v) => (section === 'work-items'
        ? homeGroup(v) === group
        : v.placement?.section === section && v.placement.group === group));
      const items = section === 'you' ? oneRowPerDraftPlan(grouped) : grouped;
      const agents = agentViews.filter((v) => section === 'fleet' && v.placement.group === group);
      const meta = GROUP_LABELS[group] ?? { label: group, hint: '' };
      const rows = [...items.flatMap((v) => v.rows), ...agents.flatMap((v) => (v.row === null ? [] : [v.row]))];
      const nested = nestItems(group, items, slices, section === 'you');
      const blocks = section === 'you' ? groupLooseItems(group, nested) : nested;
      const heads = blocks.flatMap((b) => (b.kind === 'plan' ? [b] : []));
      const sliceCount = heads.reduce((n, b) => n + b.slices.length, 0);
      const loose = nested.length - heads.length;
      const count = items.length + agents.length;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const tally = heads.length > 0 && (heads.length !== sliceCount || loose > 0)
        ? [plural(heads.length, 'plan'), plural(sliceCount, 'slice'), ...(loose > 0 ? [`${loose} ${loose === 1 ? 'branch' : 'branches'}`] : [])].join(' · ')
        : String(count);
      return {
        key: group, ...meta, items, agents, blocks, rows, count,
        tally,
      };
    });
    return {
      key: section, ...SECTION_LABELS[section], groups: groupViews, summary: summarise(groupViews, section),
      oldest: section === 'work-items'
        ? oldestWaitsClause(groupViews.flatMap((g) => g.items.map((v) => itemRowFactsOf(mapping, v.placement?.id ?? '').ageMinutes)))
        : null,
      rows: groupViews.flatMap((g) => g.rows), count: groupViews.reduce((n, g) => n + g.count, 0),
    };
  });

  const view = (u: Unplaced): UnplacedView => ({
    id: u.id,
    subject: u.subject,
    reason: u.reason,
    label: u.subject === 'item' ? labelOfItem(u.id) : labelOfAgent(u.id),
    note: u.reason === 'delivered' ? 'delivered' : unreadNote(u.subject, mapping.ticketsByItem[u.id] !== undefined),
    rows: u.subject === 'item' ? mapping.rowsByItem[u.id] ?? [] : [],
  });
  const notPlaced = placement.unplaced.filter((u) => u.reason === 'unread').map(view);
  const delivered = placement.unplaced.filter((u) => u.reason === 'delivered').map(view);

  const placedItem = new Map(itemViews.filter((v) => v.placement !== null && !leavesWorkItems(v)).map((v) => [v.placement!.id, v]));
  const factsOf = (slice: Slice): PlanSliceFact => {
    const id = sliceItemId(slice.plan, slice.name);
    const delivered = mapping.wholeReadings.items.find((i) => i.id === id)?.delivered === true;
    const merge = slice.merge === 'none' ? 'open' : slice.merge ?? (slice.complete || delivered ? 'merged' : 'open');
    const state = sliceStateIn({ id, merge }, mapping.wholeReadings, mapping.input);
    const hold = notStartedHold(state, mapping.wholeReadings.items.find((i) => i.id === id));
    const rows = mapping.rowsByItem[id] ?? [];
    const first = rows.find((r) => r.blockedBy !== null && r.blockedBy !== undefined);
    const open = rows.find((r) => r.pr !== null && r.state !== 'merged' && r.pr.state !== 'closed' && r.pr.open !== false);
    const named = slice.branches.length > 0 ? slice.branches : [...new Set(rows.map((r) => r.branch).filter((b) => b !== ''))];
    return {
      name: slice.name,
      state,
      ...(slice.mergedFact === undefined ? {} : { merged: slice.mergedFact }),
      linked: placedItem.has(id),
      startable: rows.some(isStartable),
      waitsFor: first?.blockedBy ?? '',
      begun: rows.some((r) => !(isUnbegun(r) && r.branch === '')),
      ...(open?.pr ? { pr: open.pr.number } : {}),
      ...(named.length === 1 ? { branch: named[0]! } : {}),
      ...(hold === null ? {} : { hold }),
    };
  };
  // A delivered slice the pulse did not carry is still a slice of its plan: its row names both.
  const carried = new Set((slices ?? []).map((s) => sliceItemId(s.plan, s.name)));
  const strays = delivered.flatMap((d) => {
    const r = d.rows[0];
    return r === undefined || r.plan === '' || r.wave === '' || carried.has(d.id)
      ? []
      : [{ plan: r.plan, name: r.wave, branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1, merge: 'merged' } as unknown as Slice];
  });
  const counted = [...(slices ?? []), ...strays].filter((s) => s.merge !== 'none');
  const approved = [...new Set(counted.map((s) => s.plan))];
  const sprintOwnerOf = (plan: string): string => sprints.find((sp) => sp.members.some((m) => m.slug === plan) && sp.ownerHandle !== '')?.ownerHandle ?? '';
  const ownerOf = (plan: string, rows: readonly AgentRow[]): string => {
    const first = (field: 'assignee' | 'approver' | 'author'): string => rows.find((r) => (r[field] ?? '') !== '')?.[field] ?? '';
    return planOwner({ assignee: first('assignee'), sprintOwner: sprintOwnerOf(plan), approver: first('approver'), author: first('author') }, mapping.directory);
  };
  const planRow = (plan: string): PlanRowView => {
    const own = counted.filter((s) => s.plan === plan);
    const facts = own.map(factsOf);
    const ids = Object.fromEntries(own.map((s) => [s.name, sliceItemId(s.plan, s.name)]));
    const anchors = Object.fromEntries(own.flatMap((s) => (placedItem.has(ids[s.name]!) ? [[s.name, itemAnchor(ids[s.name]!)] as const] : [])));
    const rows = own.flatMap((x) => mapping.rowsByItem[ids[x.name]!] ?? []);
    const planFile = rows.find((r) => (r.planFile ?? '') !== '')?.planFile ?? '';
    const phase = rows.find((r) => r.phase !== null && r.phase !== '')?.phase ?? null;
    const href = planFile === '' ? '' : planRoute(planFile);
    const { label, keys } = planReference({ file: planFile || undefined, slug: plan }, planIndex);
    return { ...planRowFacts(plan, ownerOf(plan, rows), facts, { phase, ...(now === undefined ? {} : { now }) }), anchors, itemIds: ids, planFile, href, label, keys };
  };
  const DRAFT_ID_PREFIX = draftItemId('');
  // The person cards' bars read the counted slices per plan, as the sprint card does (`countedSlicesByPlan`).
  // A plan with a row, a Draft card or a slice the pulse carries has an entry, `[]` where it holds no counted
  // slice. A plan the payload read nothing for has no entry, so its bar reads missing.
  const draftPlans = mapping.wholeReadings.items.filter((i) => i.id.startsWith(DRAFT_ID_PREFIX)).map((i) => i.id.slice(DRAFT_ID_PREFIX.length));
  const slicesByPlan = countedSlicesByPlan({
    seen: [...Object.values(mapping.rowsByItem).flat().map((r) => r.plan), ...draftPlans, ...(slices ?? []).map((s) => s.plan)],
    slices: counted.map((s): PlanCountedSlice => {
      const id = sliceItemId(s.plan, s.name);
      const delivered = mapping.wholeReadings.items.find((i) => i.id === id)?.delivered === true;
      return { plan: s.plan, id, merge: s.merge === 'none' ? 'open' : s.merge ?? (s.complete || delivered ? 'merged' : 'open') };
    }),
    plans: mapping.plans,
  });
  const scopeFacts = { kind: scope.kind, sprints: scope.sprints.map((sp) => ({ slug: sp.slug, title: sp.title, members: (sp.members ?? []).map((m) => m.slug) })) };
  const sprintGroups = sprintDeliveryGroups(scopeFacts, approved);
  const sectionTitle = sprintDeliveryTitle(scopeFacts);
  for (const section of sections) if (section.key === 'release-delivery') section.label = sectionTitle;
  const sprintBlocks = sprintGroups.map((g): ReleaseBlockView => {
    const plans = g.plans.map(planRow);
    const strip = stripStateCounts(plans);
    const header = sprintGroupHeader(g.name, sprintGroups.length > 1, headerText(headerCounts(plans), '', strip));
    return { release: '', sprint: g.sprint, name: sprintGroups.length > 1 ? g.name : '', header, counts: headerCountParts(headerCounts(plans), strip), plans, cards: [] };
  });
  const releaseScoped = releaseBlocks(sprints.map((sp) => ({ release: sp.release, members: sp.members.map((m) => m.slug) })), approved).map((b): ReleaseBlockView => {
    const plans = b.plans.filter((p) => approved.includes(p)).map(planRow);
    const strip = stripStateCounts(plans);
    const target = mapping.releases.targets.find((t) => t.release === b.release);
    const tickets = mapping.releases.tickets;
    const wording = target === undefined || tickets === null ? null : releaseTicketWording(tickets, target.release, target.started);
    const header = headerText(headerCounts(plans), b.release, strip);
    const cards = releasePersonCards(sprints.map((sp) => ({ slug: sp.slug, title: sp.title ?? '', release: sp.release ?? '', ownerHandle: sp.ownerHandle ?? '', members: sp.members ?? [] })), b.release, mapping.directory ?? {}, slicesByPlan, mapping.wholeReadings, mapping.input);
    return { release: b.release, sprint: '', name: '', plans, counts: headerCountParts(headerCounts(plans), strip), header: wording === null ? header : `${header} · ${wording}`, cards };
  });
  const blocks = scope.kind === 'my-sprint' ? sprintBlocks : releaseScoped;
  const releasePlanCount = new Set(blocks.flatMap((b) => b.plans.map((p) => p.plan))).size;
  const head = releaseDeliveryHeader(sectionTitle, blocks.map((b) => ({ scope: b.sprint || b.release, rows: b.plans })));
  const releaseHeader: ReleaseHeaderView = {
    scope: head.scope,
    title: blocks.length === 1 ? blocks[0]!.header : '',
    counts: head.counts.map((c) => ({ ...c, anchor: c.target === null ? null : releasePlanAnchor(c.target) })),
    bar: head.bar,
    blockedPlans: head.blockedPlans,
  };
  const releaseRows = blocks.flatMap((b) => b.plans.flatMap((p) => Object.values(p.itemIds).flatMap((id) => mapping.rowsByItem[id] ?? [])));

  return { sections, notPlaced, releaseBlocks: blocks, releasePlanCount, releaseHeader, releaseRows, delivered, releaseCarried: { approved, slicesByPlan } };
};

/** The Delivery scope as the section reads it: its kind and the sprints in scope. */
export interface DeliveryViewScope {
  kind: DeliveryScopeKind;
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'members'>[];
}

/** Maps the payload and places it: the one call the tab makes. */
export const placeMapping = (
  mapping: DeliveryMapping,
  slices?: Slice[],
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>[] = [],
  scope?: DeliveryViewScope,
  now?: Date,
  planIndex?: PlanIndex,
): DeliveryView => deliveryView(mapping, placeDelivery(mapping.readings, mapping.input), slices, sprints, scope, now, planIndex);

/** The Delivery tab's sections: the five of `DELIVERY_LAYOUT`, then Tickets and Not placed. */
export type TabSection = DeliverySection | 'tickets' | 'not-placed';

const TAB_SECTIONS: readonly TabSection[] = [...DELIVERY_LAYOUT.map((l) => l.section), 'tickets', 'not-placed'];

/** The anchor of a section's header line. */
export const sectionAnchor = (key: TabSection): string => `delivery-section-${key}`;

/** The anchor of one Tickets row. */
export const ticketAnchor = (number: string | number): string => `delivery-ticket-${number}`;

/** The anchor of the Fleet switches in the Fleet header line. */
export const FLEET_CONTROLS_ANCHOR = 'fleet-controls';

/** The anchor of the Not placed section. */
export const UNPLACED_ANCHOR = 'unplaced-details';

/** Where an anchor sits: the section and group a jump must open first, and why it may stay hidden. */
export interface AnchorOwner {
  section: TabSection;
  /** The group inside the section; `null` where the anchor sits in no group. */
  group: string | null;
  /** The Release delivery plan row that holds the anchor; `null` outside one. */
  plan: string | null;
  /**
   * `filter`: the scope or Mine hides the anchor, and no open makes it mount.
   * `inner-fold`: a Tickets row behind `… n more · show`, which the jump opens too.
   */
  hidden: 'filter' | 'inner-fold' | null;
  /** The words of a disabled link, `hidden by Mine` or `hidden by the scope`; `null` unless `hidden` is `filter`. */
  reason: string | null;
}

/** A view wider than the shown one, and the filter whose removal gives it. */
export interface WiderView {
  view: DeliveryView;
  by: 'mine' | 'scope';
}

/** What `anchorOwner` reads beyond the shown view. */
export interface AnchorContext {
  /** The wider views, narrowest first: the view without Mine, then the view without the scope. */
  wider?: readonly WiderView[];
  /** The Tickets row anchors behind the inner fold. */
  foldedTickets?: ReadonlySet<string>;
}

const owner = (section: TabSection, group: string | null = null, plan: string | null = null): AnchorOwner =>
  ({ section, group, plan, hidden: null, reason: null });

const ownerInView = (anchor: string, view: DeliveryView): AnchorOwner | null => {
  const sectionKey = anchor.startsWith('delivery-section-') ? anchor.slice('delivery-section-'.length) : null;
  if (sectionKey !== null) return TAB_SECTIONS.includes(sectionKey as TabSection) ? owner(sectionKey as TabSection) : null;
  if (anchor === TICKETS_ANCHOR || anchor.startsWith('delivery-ticket-')) return owner('tickets');
  if (anchor === FLEET_CONTROLS_ANCHOR) return owner('fleet');
  if (anchor === UNPLACED_ANCHOR) return owner('not-placed');
  for (const layout of DELIVERY_LAYOUT) {
    const group = layout.groups.find((g) => groupAnchor(g) === anchor);
    if (group !== undefined) return owner(layout.section, group);
  }
  const branch = anchor.startsWith('agent-row-') ? anchor.slice('agent-row-'.length) : null;
  for (const section of view.sections) {
    for (const group of section.groups) {
      const item = group.items.find((i) => i.anchor === anchor || (branch !== null && i.rows.some((r) => r.branch === branch)));
      if (item !== undefined) return owner(section.key, group.key);
      const agent = group.agents.find((a) => a.anchor === anchor || (branch !== null && a.entry !== null && a.entry.branch === branch));
      if (agent !== undefined) return owner(section.key, group.key);
    }
  }
  // A delivered slice shows under its plan row; any other slice of the plan renders in its group or nowhere.
  const delivered = new Set(view.delivered.map((d) => itemAnchor(d.id)));
  for (const block of view.releaseBlocks) {
    for (const plan of block.plans) {
      if (releasePlanAnchor(plan.plan) === anchor || (delivered.has(anchor) && Object.values(plan.itemIds).some((id) => itemAnchor(id) === anchor))) {
        return owner('release-delivery', null, plan.plan);
      }
    }
  }
  const unplaced = view.notPlaced.find((u) => itemAnchor(u.id) === anchor || agentAnchor(u.id) === anchor || (branch !== null && u.rows.some((r) => r.branch === branch)));
  return unplaced === undefined ? null : owner('not-placed');
};

/**
 * The section, group and plan row that hold an anchor of the Delivery tab.
 *
 * @param anchor - an element id: a section, group, item, plan row, agent, `agent-row-<branch>`, Tickets row, `tickets`,
 *   `fleet-controls` or `unplaced-details` anchor.
 * @param view - the shown view.
 * @param context - the wider views and the Tickets rows behind the inner fold.
 * @returns the owner in the shown view; else the owner in the first wider view that holds the anchor, with
 *   `hidden: 'filter'`; else `null`, where no section owns the anchor and a jump only scrolls.
 */
export const anchorOwner = (anchor: string, view: DeliveryView, context: AnchorContext = {}): AnchorOwner | null => {
  const shown = ownerInView(anchor, view);
  if (shown !== null) {
    return shown.section === 'tickets' && context.foldedTickets?.has(anchor) === true ? { ...shown, hidden: 'inner-fold' } : shown;
  }
  for (const wider of context.wider ?? []) {
    const found = ownerInView(anchor, wider.view);
    if (found !== null) return { ...found, hidden: 'filter', reason: wider.by === 'mine' ? 'hidden by Mine' : 'hidden by the scope' };
  }
  return null;
};

/** How a jump finds and shows its target where the anchor's own element is not the target. */
export interface JumpOptions {
  /** The element to show; the anchor's element where absent. */
  find?: () => HTMLElement | null;
  /** Shows the found element; `scrollToAnchor` where absent. */
  show?: (el: HTMLElement) => void;
  /** Runs once the jump has scrolled to the target or to a fallback. */
  done?: () => void;
}

/** Opens the section, group and plan row that hold `anchor`, then scrolls to it once it is mounted. */
export type Jump = (anchor: string, options?: JumpOptions) => void;

/** What `sectionHiddenCounts` reads: the placements and the counts before and after Mine. */
export interface SectionHiddenInput {
  /** The items of the shown placement. */
  shown: readonly Pick<ItemPlacement, 'id' | 'section'>[];
  /** The items of the placement of `wholeReadings`, which Mine does not narrow. */
  whole: readonly Pick<ItemPlacement, 'id' | 'section'>[];
  /** `fleet.agents` and the agents `agentsForReader` keeps. */
  agents: { total: number; kept: number };
  /** The tickets `ticketsForReader` takes and the tickets it returns. */
  tickets: { before: number; after: number };
}

/** How many subjects Mine hides from each section that Mine narrows. */
export interface SectionHiddenCounts {
  you: number;
  'work-items': number;
  fleet: number;
  tickets: number;
}

/**
 * The Mine-hidden count of each section, counted from the subjects each section shows.
 *
 * For You and Work items, the count is the items the whole placement puts in
 * the section and the shown placement does not. For Fleet, it is the agents
 * Mine drops; for Tickets, the tickets Mine drops. `fleet.waiting.hidden`, the
 * tickets *show all* reveals, is not an input.
 *
 * @param input - the placements and the counts before and after Mine.
 * @returns one count per section; 0 where Mine hides nothing.
 */
export const sectionHiddenCounts = (input: SectionHiddenInput): SectionHiddenCounts => {
  const items = (section: DeliverySection): number => {
    const shown = new Set(input.shown.filter((p) => p.section === section).map((p) => p.id));
    return input.whole.filter((p) => p.section === section && !shown.has(p.id)).length;
  };
  return {
    you: items('you'),
    'work-items': items('work-items'),
    fleet: Math.max(0, input.agents.total - input.agents.kept),
    tickets: Math.max(0, input.tickets.before - input.tickets.after),
  };
};
