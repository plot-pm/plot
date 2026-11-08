import { execFileSync } from 'node:child_process';

import type { AppKeyReading } from '../../rules/app-key-start-lines.js';
import { scriptPath, type ShellContext } from '../scripts.js';

const APP_KEY_SCRIPT = 'plot-merger-token.mjs';

/**
 * Reads whether one declared App key is usable, through `plot-merger-token.mjs
 * --check-app <config key>`. Mints no token and makes no network call.
 *
 * Exit 0 reads `usable`; exit 4 reads `invalid` with the reason the script
 * wrote to stderr, which names the key path the resolver tried; exit 5 reads
 * `absent`. Any other exit, or a process that could not start, reads `unread`.
 *
 * @param context - where the scripts live.
 * @param configKey - the `## Plot Config` key, such as `Review app`.
 * @returns the reading of that key.
 */
export const appKeyShell = (context: ShellContext, configKey: string): AppKeyReading => {
  try {
    execFileSync('node', [scriptPath(context, APP_KEY_SCRIPT), '--check-app', configKey], {
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
