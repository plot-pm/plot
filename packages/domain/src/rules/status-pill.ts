import type { LinkTarget } from './delivery-row-form.js';

/**
 * The colour of a status pill's dot. `green`, `amber` and `red` read a gate's outcome; `blue` marks an open
 * PR; `grey` marks a state that asks nothing of anyone; `quiet` marks a fact beside the state.
 */
export type PillTone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'quiet';

/**
 * One status pill: whole words, the tone of its dot, and the place it links to.
 *
 * `href` is a link target the board resolves to an address, or `null` where the pill links nowhere.
 */
export interface StatusPill {
  word: string;
  tone: PillTone;
  href: LinkTarget | null;
}

/** The status pill whose word is `word`, with no link. */
export const pill = (word: string, tone: PillTone, href: LinkTarget | null = null): StatusPill => ({ word, tone, href });
