import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { endedDeskPlacement, readEnding } from '@plot-pm/domain';
import { isBrokenState, type AgentEntry, type AgentRow } from '../contract/schema.js';

const readDeskFile = (worktree: string, name: string): string | null => {
  try {
    return readFileSync(join(worktree, name), 'utf8');
  } catch {
    return null;
  }
};

/**
 * Attaches `endedDeskPlacement`'s answer to each registry entry that reads as a
 * broken agent and names a desk with an ending record.
 *
 * A live entry, an entry with no desk, and an entry whose desk holds no ending
 * record are returned unchanged. A row whose `worker` reads `elsewhere` was
 * not observed from this checkout, so its tree, commit and question readings
 * pass as `null`; an entry no row joins passes every reading as `null`.
 *
 * @param agents - the registry's entries.
 * @param rows - the placed branch rows, joined to an entry by branch or checkout.
 * @param read - returns one desk file's text, or `null` where absent.
 * @returns the entries, each with `ended` set only where the rule answered.
 */
export const withEndedDesks = (
  agents: readonly AgentEntry[],
  rows: readonly AgentRow[],
  read: (worktree: string, name: string) => string | null = readDeskFile,
): AgentEntry[] => {
  const byBranch = new Map(rows.map((row) => [row.branch, row] as const));
  return agents.map((agent) => {
    if (agent.worktree === '' || !isBrokenState(agent.state)) return agent;
    const ending = readEnding(read(agent.worktree, '.plot-worker.ending.json'));
    if (ending.read === 'absent') return agent;
    const row = byBranch.get(agent.branch !== '' ? agent.branch : agent.checkout) ?? null;
    const local = row !== null && row.worker !== 'elsewhere' ? row : null;
    const placement = endedDeskPlacement({
      ending,
      exit: read(agent.worktree, '.plot-worker.exit'),
      merged: row ? row.state === 'merged' || row.quietKind === 'merged' : null,
      dirty: local ? local.localDirty : null,
      unlanded: local ? local.localAhead > 0 : null,
      blockedQuestion: local ? local.question !== null && local.question !== undefined : null,
      boundSeconds: null,
    });
    return { ...agent, ended: placement };
  });
};
