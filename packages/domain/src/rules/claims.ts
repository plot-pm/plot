/**
 * The claims a plan makes about what it delivered: its `## Changelog` entries
 * in file order, then its `## Acceptance` items where it has that section.
 */

import { fencedLines } from './fences.js';

/** Matches a `## ` heading and captures its title. */
const HEADING = /^##[ \t]+(.*?)[ \t]*$/;

/** Matches a list item at column 0 and captures its text. */
const TOP_ITEM = /^(?:[-*]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/;

/**
 * Reads the top-level list items of one `##` section.
 *
 * An indented line continues the item above it and joins to it with one space.
 * A top-level line that is not a list item, such as a `###` heading or a
 * paragraph, ends the item above it and is not a claim. A line inside a fenced
 * code block is neither a heading nor a claim.
 *
 * @param text - the plan file's contents.
 * @param title - the section's heading text, compared case-insensitively.
 * @returns the items in file order; empty where the section is absent.
 */
const itemsOf = (text: string, title: string): string[] => {
  const items: string[] = [];
  let inside = false;
  let open = false;
  const lines = text.split('\n');
  const fenced = fencedLines(lines);
  for (const [i, line] of lines.entries()) {
    if (fenced[i]) continue;
    const heading = HEADING.exec(line);
    if (heading !== null) {
      inside = heading[1]!.toLowerCase() === title.toLowerCase();
      open = false;
      continue;
    }
    if (!inside) continue;
    const item = TOP_ITEM.exec(line);
    if (item !== null) {
      items.push(item[1]!.trim());
      open = true;
    } else if (open && /^[ \t]+\S/.test(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }
  return items.filter((item) => item !== '');
};

/**
 * Numbers the claims a plan makes.
 *
 * The list order is the claim number: a claim's label is its 1-based position.
 *
 * @param text - the plan file's contents.
 * @returns the `## Changelog` entries in file order, then the `## Acceptance`
 *   items.
 */
export const claimsOf = (text: string): readonly string[] => [
  ...itemsOf(text, 'Changelog'),
  ...itemsOf(text, 'Acceptance'),
];

/**
 * Renders the claims as the numbered list a juror reads.
 *
 * The format is `<n>. <claim>` and never `Claim-<n>: <claim>`. A juror that
 * pastes the list into its verdict file then writes no line that
 * `readJuror` reads as a commitment.
 *
 * @param claims - what {@link claimsOf} answered.
 * @returns one line per claim, each ending in a newline.
 */
export const renderClaims = (claims: readonly string[]): string =>
  claims.map((claim, i) => `${i + 1}. ${claim}\n`).join('');

/**
 * The label a juror's commitment line carries for one claim.
 *
 * @param n - the claim's 1-based number.
 * @returns `Claim-<n>`.
 */
export const claimLabel = (n: number): string => `Claim-${n}`;
