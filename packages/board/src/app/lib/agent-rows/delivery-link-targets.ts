import type { LinkTarget } from '@plot-pm/domain';
import type { AgentRow } from '../../../contract/schema.js';
import type { RegistryAgent } from './delivery-readings.js';
import { sliceItemId } from './delivery-readings.js';
import { agentAnchor, itemAnchor } from './delivery-view.js';

/** What a click on a cell link does. `none` renders the value as plain text. */
export type ResolvedLink =
  | { kind: 'anchor'; id: string }
  | { kind: 'href'; href: string }
  | { kind: 'plan'; planFile: string }
  | { kind: 'reveal'; branch: string }
  | { kind: 'act'; action: string; id: string }
  | { kind: 'none' };

/** What the resolver needs to turn a target into a place. */
export interface LinkContext {
  /** The plan the row belongs to, for a link to one of its slices. */
  plan: string;
  /** The base of a branch URL on the host; empty where the host is unknown. */
  branchUrlBase: string;
  /** The URL of a PR by number, or `null` where no row carries it. */
  prUrl: (pr: number) => string | null;
  /** The plan's filename, or `''` where the plan has no file. */
  planFileOf: (plan: string) => string;
  /** The branch an agent works on, or `''`. */
  branchOfAgent: (id: string) => string;
}

/**
 * Turns one link target of a cell into the place it goes.
 *
 * A target the context cannot place resolves to `none`: the cell then shows its
 * value and no link, never a link that goes nowhere.
 *
 * @param target - the target the domain named.
 * @param ctx - the lookups the tab holds.
 */
export const resolveLink = (target: LinkTarget, ctx: LinkContext): ResolvedLink => {
  switch (target.to) {
    case 'plan': {
      const file = ctx.planFileOf(target.plan);
      return file === '' ? { kind: 'none' } : { kind: 'plan', planFile: file };
    }
    case 'plan-pr':
    case 'pr':
    case 'review': {
      const url = ctx.prUrl(target.pr);
      return url === null || url === '' ? { kind: 'none' } : { kind: 'href', href: url };
    }
    case 'branch':
    case 'compare':
      return ctx.branchUrlBase === ''
        ? { kind: 'none' }
        : { kind: 'href', href: `${ctx.branchUrlBase}${encodeURIComponent(target.branch)}` };
    case 'slice':
      return { kind: 'anchor', id: itemAnchor(sliceItemId(ctx.plan, target.id)) };
    case 'item':
      return { kind: 'anchor', id: itemAnchor(target.id) };
    case 'agent':
      return { kind: 'anchor', id: agentAnchor(target.id) };
    case 'question': {
      return { kind: 'reveal', branch: target.id };
    }
    case 'log': {
      const branch = ctx.branchOfAgent(target.id);
      return branch === '' ? { kind: 'none' } : { kind: 'reveal', branch };
    }
    case 'action':
      return { kind: 'act', action: target.action, id: target.id };
    case 'ci-run':
    case 'person':
      return { kind: 'none' };
  }
};

/** The short label a second or later link of one cell shows. */
export const linkLabel = (target: LinkTarget): string => {
  switch (target.to) {
    case 'pr':
    case 'plan-pr':
      return `#${target.pr}`;
    case 'review':
      return 'review';
    case 'ci-run':
      return `run ${target.run}`;
    default:
      return target.to;
  }
};

/**
 * What a DO click does, by the action the domain named, as a place to go: the
 * plan card holds the lifecycle controllers, and the PR holds the review.
 *
 * @param action - the action key from the DO cell.
 * @returns where the click leads.
 */
export const actionPlace = (action: string): 'plan' | 'pr' | 'branch' => {
  switch (action) {
    case 'review':
    case 'resolve-conflict':
    case 'release-approve':
      return 'pr';
    case 'continue':
    case 'unblock':
      return 'branch';
    default:
      return 'plan';
  }
};

/**
 * The lines the details popover of a row holds: what the one-line row left out.
 *
 * @param rows - the payload rows of the item.
 * @param agent - the registry entry of an agent row, or `null`.
 * @returns the lines, empty where nothing was left out.
 */
export const detailLines = (rows: readonly AgentRow[], agent: RegistryAgent | null): string[] => {
  const lines: string[] = [];
  if (agent !== null) {
    if (agent.pid !== '') lines.push(`pid ${agent.pid}`);
    if (agent.identity !== 'manifest') lines.push(`not from a manifest (${agent.identity})`);
    if (agent.worktree !== '') lines.push(`desk ${agent.worktree}`);
    if (agent.relaunches > 0) lines.push(`${agent.relaunches} relaunches`);
  }
  const branches = rows.map((r) => r.branch).filter((b) => b !== '');
  for (const extra of branches.slice(1)) lines.push(`branch ${extra}`);
  for (const row of rows) {
    for (const p of row.processes ?? []) if (p.pid !== '') lines.push(`pid ${p.pid}`);
  }
  return [...new Set(lines)];
};
