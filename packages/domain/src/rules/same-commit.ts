/** The floor below which a prefix is too cheap to collide against to trust. */
const DEFAULT_MIN_HEX_LEN = 7;

/** Matches a hex string of at least `len` characters, start to end. */
const hexOfAtLeast = (len: number): RegExp => new RegExp(`^[0-9a-f]{${len},}$`, 'i');

/**
 * Answers whether two sha values name the same commit.
 *
 * True when both are hex strings of at least `minHexLen` characters, the
 * comparison ignoring case, and one is a prefix of the other. A host may
 * report a short head (Bitbucket's 12-character form) against a caller's
 * full 40-character sha, in either direction; a prefix shorter than the floor
 * collides across a repository's history too easily to pin a merge to it.
 *
 * The floor is the caller's to set, not this rule's: a host that always
 * reports and expects full 40-character shas (GitHub's `headRefOid`) can
 * raise it to close the collision window entirely, while a host that
 * legitimately reports a shorter head (Bitbucket) needs the lower default.
 *
 * @param a - a sha, of any length.
 * @param b - a sha, of any length.
 * @param minHexLen - the shortest hex prefix either side may use; defaults to 7.
 * @returns `true` when the two name one commit.
 */
export const sameCommit = (a: string, b: string, minHexLen: number = DEFAULT_MIN_HEX_LEN): boolean => {
  const floor = hexOfAtLeast(minHexLen);
  if (!floor.test(a) || !floor.test(b)) return false;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  return lowerA.startsWith(lowerB) || lowerB.startsWith(lowerA);
};
