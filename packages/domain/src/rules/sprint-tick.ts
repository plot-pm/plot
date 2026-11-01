import { memberLineIndex } from './sprint-membership.js';

/**
 * Ticks a sprint item's checkbox: `[ ]` → `[x]` on the line naming `[<slug>]`.
 *
 * THE TICK ONLY, since `a-withdrawn-item-is-not-open`. A sprint file's
 * checkbox is a cache a delivery updates for display; the plan file's `State:`
 * and dated record are the fact a reader should trust. Nothing else on the
 * line is touched — a sprint item carries prose after its slug reference, and
 * this changes only the three characters that are the box.
 *
 * Finds the line with {@link memberLineIndex}, which is tier-aware: a slug
 * can also appear on a `### Deferred` or log line, which is never the member
 * line a delivery should tick.
 *
 * @concept sprint-tick
 */

/** Whether a tick changed the file, and its new content. */
export interface TickResult {
  /** Whether a box was flipped. */
  readonly changed: boolean;
  /** The file's content after the tick; identical to the input when `changed` is false. */
  readonly content: string;
}

/**
 * Ticks the first unchecked box on a line naming `[<slug>]`.
 *
 * @param content - the whole sprint file.
 * @param slug - the plan slug the line must name, exactly as `[slug]` appears.
 * @returns the edited content, and whether a box was flipped. `changed: false`
 *   where no line names the slug, or the line already reads `[x]`.
 */
export const tickSprintItem = (content: string, slug: string): TickResult => {
  const index = memberLineIndex(content, slug);
  if (index === -1) return { changed: false, content };

  const lines = content.split('\n');
  const line = lines[index]!;
  if (!line.includes('[ ]')) return { changed: false, content };

  lines[index] = line.replace('[ ]', '[x]');
  return { changed: true, content: lines.join('\n') };
};
