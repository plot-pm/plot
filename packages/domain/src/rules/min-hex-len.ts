/**
 * The hex-prefix floor {@link merge} enforces for a given host backend.
 * GitHub's `headRefOid` is always a full 40-character sha, so a shorter
 * caller sha is never legitimate there and the floor rises to close the
 * collision window; Bitbucket can legitimately report a shorter head, so it
 * keeps the 7+ default, and so does an unresolved backend.
 *
 * @param backend - the git host's backend word, or `''` where it did not answer.
 * @returns 40 for GitHub; 7 otherwise.
 */
export const minHexLenFor = (backend: string): number => (backend === 'github' ? 40 : 7);
