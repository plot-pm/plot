import type { UnmergedValue } from '../entities/view-readings.js';
import { answered, failed, type PortResult } from '../port-result.js';
import type { Refs } from '../ports/refs.js';
import { claimOnly } from '../rules/empty-claim.js';

const REMOTE = 'refs/remotes/origin/';

/**
 * The version each release branch would ship, read from its own `package.json`.
 *
 * @param refs - the ref reader.
 * @returns release branch → the `version` its root `package.json` names. A
 *   branch whose file is missing, unparseable or names no version is absent.
 *   Fails where the release branches cannot be listed.
 */
export const readReleaseVersions = async (refs: Refs): Promise<PortResult<Record<string, string>>> => {
  const tips = await refs.branchTips([`${REMOTE}changeset-release/`]);
  if (!tips.ok) return failed();
  const found: Record<string, string> = {};
  for (const { branch, sha } of tips.value) {
    const raw = await refs.showFile(sha, 'package.json');
    if (!raw.ok) continue;
    try {
      const version = (JSON.parse(raw.value) as { version?: unknown }).version;
      if (typeof version === 'string' && version !== '') found[branch] = version;
    } catch {
      continue;
    }
  }
  return answered(found);
};

/**
 * The remote branches with commits `origin/<main>` lacks, and those of them
 * whose only commits are claim markers.
 *
 * A branch is unmerged where `origin/<main>..origin/<branch>` holds a commit:
 * the set `git branch -r --no-merged origin/<main>` lists.
 *
 * @param refs - the ref reader.
 * @param main - the default branch's name.
 * @returns both sets, in ref order. A branch whose range cannot be read is in
 *   neither. Fails where the remote branches cannot be listed.
 */
export const readUnmerged = async (refs: Refs, main: string): Promise<PortResult<UnmergedValue>> => {
  const tips = await refs.branchTips([REMOTE]);
  if (!tips.ok) return failed();
  const branches: string[] = [];
  const claims: string[] = [];
  for (const { branch } of tips.value) {
    if (branch === main || branch === 'HEAD' || branch === 'origin') continue;
    const range = await refs.commitSubjects(`origin/${main}..origin/${branch}`);
    if (!range.ok || range.value.length === 0) continue;
    branches.push(branch);
    if (claimOnly(range.value)) claims.push(branch);
  }
  return answered({ branches, claimOnly: claims });
};
