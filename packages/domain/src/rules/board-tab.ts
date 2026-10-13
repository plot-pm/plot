/** The board's three tabs, in display order: discovery → planning → delivery. */
export type BoardTab = 'discovery' | 'planning' | 'delivery';

/** The answer to a `?tab=` value: the tab to open and, for a legacy value, the value to replace it with. */
export interface BoardTabAnswer {
  tab: BoardTab;
  /** The current `?tab=` value that replaces a legacy one; `null` when the URL needs no rewrite. */
  redirect: BoardTab | null;
}

const LEGACY: Readonly<Record<string, BoardTab>> = {
  stories: 'discovery',
  plans: 'planning',
  board: 'planning',
  agents: 'delivery',
};

const CURRENT: readonly BoardTab[] = ['discovery', 'planning', 'delivery'];

/**
 * Resolves the `?tab=` URL parameter to a tab.
 *
 * @param param - the raw parameter value, or `null` when absent.
 * @returns the tab, and the replacement value for a legacy name (`stories`, `plans`, `board`, `agents`).
 * An absent or unknown value answers `planning` with no redirect.
 */
export const boardTabOf = (param: string | null): BoardTabAnswer => {
  if (param !== null && (CURRENT as readonly string[]).includes(param)) {
    return { tab: param as BoardTab, redirect: null };
  }
  if (param !== null && Object.prototype.hasOwnProperty.call(LEGACY, param)) {
    const tab = LEGACY[param]!;
    return { tab, redirect: tab };
  }
  return { tab: 'planning', redirect: null };
};
