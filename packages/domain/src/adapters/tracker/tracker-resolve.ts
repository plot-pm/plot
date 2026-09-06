import type { Tracker } from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { trackerGithub } from './tracker-github.js';
import { trackerJira } from './tracker-jira.js';
import { trackerNone } from './tracker-none.js';

/** Where a repository declares which tracker it uses. */
const TRACKER_KEY = 'Tracker';

/**
 * Which connector a declared scheme names, and what it was told.
 *
 * A SCHEME WITH NO CONNECTOR GETS NONE, never a fall-through to whichever
 * connector happens to be nearest. A repository tracking with a vendor Plot has
 * no connector for would otherwise be shown the git host's issues under that
 * vendor's name — a list that is not wrong about any single row and is wrong
 * about all of them.
 *
 * The one scheme that means *there is no tracker* is the repository's own
 * plans, and it resolves the same way an unrecognised one does: to a connector
 * that reaches nothing and says so.
 *
 * Exported for test, because the mapping from a config word onto a connector is
 * where a silent fall-through would live.
 *
 * @param declared - the `Tracker` key's value, scheme first.
 * @param context - where the scripts and the repository are.
 * @returns the connector that scheme names.
 */
export const trackerFor = (declared: string, context: ShellContext): Tracker => {
  const [scheme = '', baseUrl = ''] = declared.trim().split(/\s+/);
  switch (scheme.toLowerCase()) {
    case 'jira':
      return trackerJira(context, baseUrl.replace(/\/+$/, ''));
    case 'github-issues':
      return trackerGithub(context);
    default:
      return trackerNone();
  }
};

/**
 * Reads which tracker a repository declared, and builds its connector.
 *
 * @param context - where the scripts and the repository are.
 * @returns the connector the repository's config names.
 */
export const trackerShell = async (context: ShellContext): Promise<Tracker> => {
  const said = await runProcess(
    'bash',
    [scriptPath(context, 'plot-config.sh'), 'get', TRACKER_KEY, ''],
    { cwd: context.repoRoot },
  );
  // A CONFIG THAT COULD NOT BE READ IS NOT A TRACKER. Guessing a connector here
  // would send a status write to a vendor nobody named; answering with the one
  // that reaches nothing keeps the failure visible at the call that needed it.
  return trackerFor(said.code === 0 ? said.stdout : '', context);
};
