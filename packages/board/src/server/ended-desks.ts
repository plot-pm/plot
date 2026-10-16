import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { endedDeskPlacement, readEnding } from '@plot-pm/domain';
import type { AgentEntry, AgentRow } from '../contract/schema.js';

const ENDING_FILE = '.plot-worker.ending.json';

const readEndingText = (worktree: string): string | null => {
  try {
    return readFileSync(join(worktree, ENDING_FILE), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Attaches `endedDeskPlacement`'s answer to each registry entry that reads as a
 * broken agent and names a desk whose slice has a row.
 *
 * An entry with no desk, no row to join, or no ending record is returned
 * unchanged: a missing reading never reads as a clean end.
 *
 * @param agents - the registry's entries.
 * @param rows - the placed branch rows, joined to an entry by branch or checkout.
 * @param read - returns a desk's ending record text, or `null` where absent.
 * @returns the entries, each with `ended` set only where the rule answered.
 */
export const withEndedDesks = (
  agents: readonly AgentEntry[],
  rows: readonly AgentRow[],
  read: (worktree: string) => string | null = readEndingText,
): AgentEntry[] => {
  const byBranch = new Map(rows.map((row) => [row.branch, row] as const));
  return agents.map((agent) => {
    if (agent.worktree === '') return agent;
    const ending = readEnding(read(agent.worktree));
    if (ending.read === 'absent') return agent;
    const row = byBranch.get(agent.branch !== '' ? agent.branch : agent.checkout);
    const placement = endedDeskPlacement({
      ending,
      merged: row ? row.state === 'merged' || row.quietKind === 'merged' : null,
      dirty: row ? row.localDirty : null,
      unlanded: row ? row.localAhead > 0 : null,
      blockedQuestion: row ? row.question !== null && row.question !== undefined : null,
      boundSeconds: null,
    });
    return { ...agent, ended: placement };
  });
};
