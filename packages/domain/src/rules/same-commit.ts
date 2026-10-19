/** Matches a hex string of seven or more characters, start to end. */
const HEX_7_PLUS = /^[0-9a-f]{7,}$/i;

/**
 * Answers whether two sha values name the same commit.
 *
 * True when both are hex strings of at least seven characters, the comparison
 * ignoring case, and one is a prefix of the other. A host may report a short
 * head (Bitbucket's 12-character form) against a caller's full 40-character
 * sha, in either direction; a prefix shorter than seven characters collides
 * across a repository's history too easily to pin a merge to it.
 *
 * @param a - a sha, of any length.
 * @param b - a sha, of any length.
 * @returns `true` when the two name one commit.
 */
export const sameCommit = (a: string, b: string): boolean => {
  if (!HEX_7_PLUS.test(a) || !HEX_7_PLUS.test(b)) return false;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  return lowerA.startsWith(lowerB) || lowerB.startsWith(lowerA);
};
