import type { DispatchInfo } from '../../contract/schema.js';
import { ImplementButton } from './ImplementButton.js';

/**
 * *Write brief* — the way out of the refusal, offered where the refusal is read.
 *
 * A row that needs a brief is an otherwise-startable branch missing the
 * specification a worker reads first. Auto-dispatch refuses to start it (#431),
 * and `/plot-implement` writes that brief as part of its preparation — so the
 * remedy already existed, on the plan head, under a different word.
 *
 * **This is a LABEL, not a second implementation.** It delegates wholly to
 * {@link ImplementButton}: same route, same POST body, same polling, same
 * refusal handling. The word differs because the reader's question differs —
 * a plan head is asked *implement this plan*, a refused row is asked *what is
 * missing here*. Answering the second with the first word makes the reader
 * translate; answering it with a second copy of the logic makes the two drift.
 *
 * It shipped once as 189 lines carrying its own `POLL_MS`, effects and fetch —
 * a near-copy of a 197-line control. Two implementations of one click is the
 * duplication `one-place-for-what-a-row-can-do` exists to prevent, and the
 * copies had nothing to keep them honest with each other.
 */
export interface WriteBriefButtonProps {
  /** The plan slug whose slice needs the brief — the POST body. */
  slug: string;
  /** The branch this row shows — named in the hover title, for context. */
  branch: string;
  /** Whether the server will act, and why not — the board's `implement`. */
  implement: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

export function WriteBriefButton({ slug, branch, implement, onActing }: WriteBriefButtonProps) {
  return (
    <ImplementButton
      slug={slug}
      implement={implement}
      onActing={onActing}
      label="Write brief"
      actingLabel="writing brief…"
      title={`Write brief for ${branch}`}
    />
  );
}
