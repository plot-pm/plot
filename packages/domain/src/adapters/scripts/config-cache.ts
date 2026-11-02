import fs from 'node:fs';
import path from 'node:path';

import type { PortResult } from '../../port-result.js';
import type { Scripts } from '../../ports/scripts.js';

/** The files whose shape decides whether a held config-sh answer still applies. */
const STAMPED_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * One file's shape, or its absence, as a stamp ingredient.
 *
 * @param repoRoot - the repository root the file is resolved under.
 * @param file - the filename, relative to repoRoot.
 * @returns a string distinguishing every (mtimeMs, size, ino) triple and
 *   absence from one another.
 */
const fileStamp = (repoRoot: string, file: string): string => {
  try {
    const stat = fs.statSync(path.join(repoRoot, file));
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return 'absent';
  }
};

/**
 * Fingerprints the inputs a config-sh read depends on.
 *
 * Read fresh on every call, never on a timer, so a cache keyed on this value
 * sees an edit on the very next read. repoRoot is part of the stamp because
 * two repositories can carry files with equal mtimeMs; size and ino are part
 * of it because a same-size rewrite within one mtime tick would otherwise be
 * indistinguishable from the file it replaced.
 *
 * @param repoRoot - the repository whose CLAUDE.md/AGENTS.md decide the config.
 * @returns a string equal for two reads iff every stamped file's presence,
 *   mtimeMs, size and ino are equal.
 */
const configStamp = (repoRoot: string): string =>
  repoRoot + ' ' + STAMPED_FILES.map((file) => fileStamp(repoRoot, file)).join(' ');

/** One held plot-config.sh answer, keyed by everything it could depend on. */
const cacheKey = (stamp: string, key: string, fallback: string): string =>
  `${stamp} ${key} ${fallback}`;

/**
 * Decorates a Scripts port so repeated config/configSync reads of an
 * unchanged repository cost one inner call instead of one per caller.
 *
 * Every other operation passes through unchanged. The held answers live in
 * the returned closure, keyed by {@link configStamp} plus the key and
 * fallback, so a changed stamp (an edit, a create, a delete, touching either
 * CLAUDE.md or AGENTS.md) is a cache miss rather than a value to evict, and
 * two repositories with equal file shapes never share an answer because
 * repoRoot is part of the stamp.
 *
 * A failed or timed-out read is never held: only { ok: true } results are
 * stored, so a caller that reads again after a failure pays for a real
 * retry and can observe a later success.
 *
 * @param inner - the Scripts implementation to cache config/configSync over.
 * @param repoRoot - the repository whose CLAUDE.md/AGENTS.md the stamp reads.
 * @returns a Scripts whose config/configSync are held per stamp, key and fallback.
 */
export const scriptsConfigCached = (inner: Scripts, repoRoot: string): Scripts => {
  const held = new Map<string, PortResult<string>>();

  const remember = (cacheId: string, answer: PortResult<string>): PortResult<string> => {
    if (answer.ok) held.set(cacheId, answer);
    return answer;
  };

  return {
    ...inner,
    config: async (key, fallback, options) => {
      const cacheId = cacheKey(configStamp(repoRoot), key, fallback);
      const existing = held.get(cacheId);
      if (existing !== undefined) return existing;
      return remember(cacheId, await inner.config(key, fallback, options));
    },
    configSync: (key, fallback, options) => {
      const cacheId = cacheKey(configStamp(repoRoot), key, fallback);
      const existing = held.get(cacheId);
      if (existing !== undefined) return existing;
      return remember(cacheId, inner.configSync(key, fallback, options));
    },
  };
};
