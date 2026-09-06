import { derivedStanding, statusDrift, STORY_LIFECYCLE }
  from '@plot-pm/domain/transitions/story';
import type { StoryStatus } from '@plot-pm/domain/entities/story';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-story-lint.sh` runs, once per story.
 *
 * ```
 * printf 'draft\tapproved approved\n' | node plot-standing.mjs
 * active	Has approved plans
 * ```
 *
 * **An artifact for the reason every other one gives.** `plot-ask.mjs` answers
 * by RUNNING a scan, so a lint asking it would start a whole fleet scan per
 * story. This bundle spawns nothing and reads nothing.
 *
 * **Vendored beside `plot-story-lint.sh`**, which resolves it from its own
 * `${BASH_SOURCE[0]}` directory. That script is shipped in the published npm
 * package, where `packages/` does not exist, so an inline import of the domain
 * source would resolve only in the plot checkout.
 *
 * **It imports the transition directly rather than through the barrel**, which
 * carries every entity's `zod` schema — validators no line here calls.
 *
 * **Tab-separated in, tab-separated out.** The caller is bash inside a
 * per-story loop, and a JSON round trip would mean `jq` per story.
 */

/** A story's declared status and the phases of the plans naming it. */
export interface StandingReadings {
  /** The status the story's frontmatter carries, lower-cased by the caller. */
  declared: string;
  /** Each plan's phase, as `plot-plan-meta.sh` spells it. */
  phases: readonly string[];
}

/**
 * Parse one story's readings: `declared<TAB>phase phase …`.
 *
 * The phase field is space-separated because a plan phase is one word, and an
 * EMPTY field means the story has no plans — which is not the same as a story
 * whose plans are all draft, though both drift nowhere.
 *
 * A malformed line is NOT skipped. A missing field would silently become a
 * story with no plans, which reports nothing — so the lint would go quiet
 * about exactly the stories it could not read.
 *
 * @param line the stdin document, one story's readings
 * @returns what was read of the story
 * @throws when the line is not two tab-separated fields
 */
export const readingsFrom = (line: string): StandingReadings => {
  const fields = line.replace(/\n$/, '').split('\t');
  if (fields.length !== 2) {
    throw new Error(`expected '<declared>\\t<phases>', got '${line.replace(/\n$/, '')}'`);
  }
  const [declared, phaseText] = fields as [string, string];
  return { declared, phases: phaseText.split(/\s+/).filter((p) => p !== '') };
};

/**
 * Decide one story.
 *
 * A status the domain does not admit is read as `draft`, which is what
 * `deriveStoryStatus` does and for the same reason: frontmatter is a file a
 * person edits, and `derivedStanding` takes a `StoryStatus`. The unreadable
 * status is still handed to {@link statusDrift} unchanged, which ranks it
 * nowhere and so reports nothing — an unreadable status is S2's finding, not
 * this one's.
 *
 * @param line the stdin document, one story's readings
 * @returns `<derived>\t<drift>`, where drift is empty when the two agree
 */
export const answer = (line: string): string => {
  const { declared, phases } = readingsFrom(line);
  const known = (STORY_LIFECYCLE as readonly string[]).includes(declared)
    ? (declared as StoryStatus)
    : 'draft';
  const derived = derivedStanding(known, phases.map((phase) => ({ phase })));
  return `${derived}\t${statusDrift(declared, derived) ?? ''}`;
};

/**
 * Read stdin, print the answer.
 *
 * @param text the whole of stdin
 * @param write where the answer goes
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    write(answer(text));
    return 0;
  } catch (err) {
    process.stderr.write(`plot-standing: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
