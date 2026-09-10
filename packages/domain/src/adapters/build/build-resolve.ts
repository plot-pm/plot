import type { BuildPort } from '../../ports/build.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { buildActions } from './build-actions.js';
import { buildJenkins } from './build-jenkins.js';
import { buildNone } from './build-none.js';

/** Where a repository declares which CI system it builds on. */
const CI_KEY = 'CI';

/**
 * Which connector a declared CI system names.
 *
 * A SYSTEM WITH NO CONNECTOR GETS NONE, never a fall-through to whichever
 * connector happens to be nearest. A repository building on a system Plot has
 * no connector for would otherwise be shown another vendor's runs under its
 * name — a history that is not wrong about any single row and is wrong about
 * all of them.
 *
 * The one word that means *there is no CI* resolves the same way an
 * unrecognised one does: to a connector that reaches nothing and says so.
 *
 * EVERY DECLARED SYSTEM WITH A CONNECTOR RESOLVES TO IT, and an undeclared or
 * unknown one resolves to `buildNone`, which answers `unaskable` on every
 * operation. This comment said `jenkins` had no connector until 2026-09-10; it
 * is `build-jenkins.ts` now. A third system is a file and one `case`, never a
 * branch inside a connector — the next slice's
 * one line here.
 *
 * Exported for test, because the mapping from a config word onto a connector is
 * where a silent fall-through would live.
 *
 * @param declared - the `CI` key's value.
 * @param context - where the scripts and the repository are.
 * @returns the connector that system names.
 */
export const buildFor = (declared: string, context: ShellContext): BuildPort => {
  switch (declared.trim().toLowerCase()) {
    case 'github-actions':
      return buildActions(context);
    case 'jenkins':
      return buildJenkins(context);
    default:
      return buildNone();
  }
};

/**
 * Reads which CI system a repository declared, and builds its connector.
 *
 * @param context - where the scripts and the repository are.
 * @returns the connector the repository's config names.
 */
export const buildShell = async (context: ShellContext): Promise<BuildPort> => {
  const said = await runProcess(
    'bash',
    [scriptPath(context, 'plot-config.sh'), 'get', CI_KEY, ''],
    { cwd: context.repoRoot },
  );
  // A CONFIG THAT COULD NOT BE READ IS NOT A CI SYSTEM. Guessing a connector
  // here would render another vendor's runs under a name nobody declared;
  // answering with the one that reaches nothing keeps the absence visible at
  // the call that needed it.
  return buildFor(said.code === 0 ? said.stdout : '', context);
};
