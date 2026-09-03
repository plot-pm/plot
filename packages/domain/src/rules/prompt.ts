import type { CharterReading } from '../entities/charter.js';

/**
 * The prompt file a repo falls back to, relative to the repo root.
 *
 * `plot-worker-loop.sh:526` hardcodes it, which is why there is one prompt per
 * repo and not one per agent. It stays the answer for every agent that declared
 * nothing, so an estate with no charters runs exactly as it did.
 */
export const FALLBACK_PROMPT = '.plot/worker-prompt.sh';

/**
 * Which prompt an agent runs, and on whose authority.
 *
 * THREE OUTCOMES, AND THE THIRD REFUSES. `declared` is a charter naming its own
 * prompt; `fallback` is the repo's one prompt, for an agent that named no
 * charter or whose charter is not on this clone; `refused` is a charter that
 * exists and cannot be believed.
 *
 * The refusal is the point. A charter with a typo in it must not resolve to the
 * fallback, because the fallback runs — successfully — under a prompt the
 * operator did not ask for, and nothing in the log would say so.
 */
export type PromptResolution =
  | { resolve: 'declared'; prompt: string; charter: string }
  | { resolve: 'fallback'; prompt: string; why: string }
  | { resolve: 'refused'; why: string };

/**
 * Resolves which prompt file an agent's loop should source.
 *
 * RESOLUTION, NEVER MATCHING. The name comes from the caller — the environment
 * the dispatcher or operator set — and this looks up what was named. Nothing
 * here reads a plan, ranks a candidate or chooses among agents; choosing is a
 * question declaring makes askable and does not answer.
 *
 * @param reading - what the caller read at the named charter's path.
 * @returns the prompt to source, or the refusal that stops the launch.
 */
export const resolvePrompt = (reading: CharterReading): PromptResolution => {
  switch (reading.read) {
    case 'declared':
      return { resolve: 'declared', prompt: reading.charter.prompt, charter: reading.charter.name };
    case 'unnamed':
      return { resolve: 'fallback', prompt: FALLBACK_PROMPT, why: 'no agent named' };
    case 'absent':
      return {
        resolve: 'fallback',
        prompt: FALLBACK_PROMPT,
        why: `no charter for '${reading.name}'`,
      };
    case 'unreadable':
      return { resolve: 'refused', why: `charter '${reading.name}' ${reading.why}` };
  }
};
