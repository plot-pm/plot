import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { MergerAppReading } from '../../rules/merge-identity.js';
import type { ShellContext } from '../scripts.js';
import { mergerAppShell } from './merger-app-shell.js';

/** The `Merger app` reading, held for a process and read again on demand. */
export interface MergerAppReader {
  /** The held reading; read through the check on the first call and after the stamp moved. */
  held(context: ShellContext): MergerAppReading;
  /** A reading taken now, through the check; it replaces the held one. */
  fresh(context: ShellContext): MergerAppReading;
}

/** One path's shape, or `absent`. */
const shapeOf = (path: string): string => {
  try {
    const stat = statSync(path);
    return `${path}:${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return `${path}:absent`;
  }
};

/**
 * The shape of everything the `Merger app` check reads that a stat can see:
 * `CLAUDE.md` and `AGENTS.md`, which declare the key, the default key
 * directory `<config home>/plot`, and the directory of `PLOT_MERGER_APP_KEY`.
 * Starts no process.
 *
 * @param context - the checkout whose config declares the key.
 * @param env - the environment the check runs in; `process.env` by default.
 * @returns a string that differs whenever one of those paths changed.
 */
export const mergerKeyStamp = (context: ShellContext, env: Readonly<Record<string, string | undefined>> = process.env): string => {
  const configHome = env['XDG_CONFIG_HOME'] !== undefined && env['XDG_CONFIG_HOME'] !== '' ? env['XDG_CONFIG_HOME'] : join(env['HOME'] ?? homedir(), '.config');
  const fromEnv = env['PLOT_MERGER_APP_KEY'];
  const paths = [
    join(context.repoRoot, 'CLAUDE.md'),
    join(context.repoRoot, 'AGENTS.md'),
    join(configHome, 'plot'),
    ...(fromEnv === undefined || fromEnv === '' ? [] : [dirname(fromEnv)]),
  ];
  return paths.map(shapeOf).join('\n');
};

/**
 * Holds the `Merger app` reading for the life of the process.
 *
 * `held` runs the check on its first call and again only after
 * {@link mergerKeyStamp} moved; `fresh` runs it every time, for the moment
 * before a merge.
 *
 * @param read - the check; `mergerAppShell` by default.
 * @param stamp - the stamp of what the check reads; `mergerKeyStamp` by default.
 * @returns the reader.
 */
export const mergerAppHeld = (
  read: (context: ShellContext) => MergerAppReading = mergerAppShell,
  stamp: (context: ShellContext) => string = (context) => mergerKeyStamp(context),
): MergerAppReader => {
  let kept: { stamp: string; reading: MergerAppReading } | null = null;
  const fresh = (context: ShellContext): MergerAppReading => {
    const at = stamp(context);
    const reading = read(context);
    kept = { stamp: at, reading };
    return reading;
  };
  return {
    held: (context) => (kept !== null && kept.stamp === stamp(context) ? kept.reading : fresh(context)),
    fresh,
  };
};
