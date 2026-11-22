import type { ItemKind } from './delivery-placement.js';
import type { LinkTarget } from './delivery-row-form.js';

/** The kinds of place a link's icon names. */
export type LinkIconKind =
  | 'plan' | 'slice' | 'branch' | 'pr' | 'ticket' | 'story' | 'sprint' | 'release' | 'worktree' | 'agent' | 'build' | 'external';

/**
 * The words the board names a link's target with: a cell link's `to`, a placed item's kind, a card `Ref`'s kind,
 * a tuple link's `what`, and the few words that name a place no other vocabulary holds.
 */
export type LinkTargetWord =
  | LinkTarget['to'] | ItemKind
  | 'story' | 'sprint' | 'wave' | 'worktree' | 'desk' | 'build' | 'issue' | 'external';

const LINK_ICON: Readonly<Record<LinkTargetWord, LinkIconKind | null>> = {
  plan: 'plan',
  slice: 'slice',
  wave: 'slice',
  branch: 'branch',
  compare: 'branch',
  pr: 'pr',
  'plan-pr': 'pr',
  review: 'pr',
  ticket: 'ticket',
  issue: 'ticket',
  story: 'story',
  sprint: 'sprint',
  release: 'release',
  worktree: 'worktree',
  desk: 'worktree',
  agent: 'agent',
  person: 'agent',
  build: 'build',
  checks: 'build',
  'ci-run': 'build',
  url: 'external',
  external: 'external',
  item: null,
  question: null,
  log: null,
  action: null,
  menu: null,
};

/**
 * The icon kind of the place a link leads to.
 *
 * @param target - the target's word, or a cell link target.
 * @returns the icon kind, or `null` for a target that names no kind of place: an action, a question, a log, or an
 *   item anchor whose kind the target does not carry.
 */
export const linkIconKind = (target: LinkTargetWord | LinkTarget): LinkIconKind | null =>
  LINK_ICON[typeof target === 'string' ? target : target.to];
