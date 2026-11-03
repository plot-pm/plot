import { execFileSync } from 'node:child_process';

import type { MergerAppReading } from '../../rules/merge-identity.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** `plot-merger-token.mjs`, the Merger App's half of `plot-host.sh pr-merge`. */
const MERGER_TOKEN_SCRIPT = 'plot-merger-token.mjs';

/**
 * Reads whether the `Merger app` key is usable, through `plot-merger-token.mjs
 * --check` — never `gh` directly, and never through `readConfig`, which cannot
 * tell an undeclared key from one `plot-config.sh` failed to read.
 *
 * Mints no token and makes no network call for a usable key: `--check` stops
 * at validation. Exit 0 reads `usable`; exit 4 reads `invalid` with the
 * reason `plot-merger-token.mjs` wrote to stderr; exit 5 reads `absent`. Any
 * other exit, or a process that could not start at all, reads `unread` — the
 * same hold {@link mergeIdentity} gives an absent reading, so a broken check
 * never merges in its place.
 *
 * @param context - where the scripts live.
 * @returns the reading `mergeIdentity` consumes.
 */
export const mergerAppShell = (context: ShellContext): MergerAppReading => {
  try {
    execFileSync('node', [scriptPath(context, MERGER_TOKEN_SCRIPT), '--check'], {
      cwd: context.repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { read: 'usable' };
  } catch (error) {
    const thrown = error as { status?: number | null; stderr?: string };
    if (thrown.status === 5) return { read: 'absent' };
    if (thrown.status === 4) return { read: 'invalid', reason: (thrown.stderr ?? '').trim() };
    return { read: 'unread' };
  }
};
