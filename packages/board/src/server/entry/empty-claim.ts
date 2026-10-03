// THROUGH THE NARROW PATH, not the package root, for the reason
// `agent-settings.ts` gives: the root import bundles every entity and rule.
import { type CommitReading, realCommits } from '@plot-pm/domain/rules/empty-claim';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * How many of each branch's commits are real work — the rule `realCommits`
 * reached without HTTP, for `plot-worker-loop.sh` and `plot-reap.sh`.
 *
 * ```
 * git log --boundary \
 *   --format="<key>%x09%m%x09%H%x09%T%x09%P%x09%s" origin/main..<branch> |
 *   plot-empty-claim.mjs
 * <key>	<real>            # exit 0 — one line per key, in first-seen order
 * # exit 2 — a line could not be read
 * ```
 *
 * One line per commit, six tab-separated fields: the caller's key, git's
 * boundary mark, the commit id, its tree, its parent ids and its subject. The
 * subject is the last field and keeps any tab it holds. A `-` mark is a
 * boundary commit: it supplies its tree to the commits above it and is not
 * counted. Lines for several keys may arrive in one call.
 *
 * A key with no counted commit gets no answer line. A commit whose first
 * parent's tree is not on stdin counts as real work.
 *
 * READ THE EXIT CODE, NOT THE OUTPUT'S EMPTINESS. Exit 2 prints nothing, and a
 * caller reading only stdout would take that for a key with no commits.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** Every line was read and answered. */
  ok: 0,
  /** A line could not be read. */
  usage: 2,
} as const;

/** Git's `%m` for a commit inside the range, and for a boundary commit. */
const IN_RANGE = '>';
const BOUNDARY = '-';

interface Line {
  readonly key: string;
  readonly boundary: boolean;
  readonly tree: string;
  readonly parent: string;
  readonly subject: string;
}

/**
 * Answers for the commit lines that arrived on stdin.
 *
 * @param stdin - one `git log --boundary` line per commit, as above.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = (stdin: string, write: (s: string) => void = (s) => process.stdout.write(s)): number => {
  const lines: Line[] = [];
  const trees = new Map<string, string>();
  for (const raw of stdin.split(/\r?\n/)) {
    if (raw === '') continue;
    const [key = '', mark = '', sha = '', tree = '', parents = '', ...subject] = raw.split('\t');
    if (subject.length === 0 || key === '' || sha === '' || (mark !== IN_RANGE && mark !== BOUNDARY)) {
      return EXIT.usage;
    }
    trees.set(sha, tree);
    lines.push({ key, boundary: mark === BOUNDARY, tree, parent: parents.split(' ')[0] ?? '', subject: subject.join('\t') });
  }
  const byKey = new Map<string, CommitReading[]>();
  for (const line of lines) {
    if (line.boundary) continue;
    const commits = byKey.get(line.key) ?? [];
    commits.push({ subject: line.subject, tree: line.tree, parentTree: trees.get(line.parent) ?? null });
    byKey.set(line.key, commits);
  }
  for (const [key, commits] of byKey) write(`${key}\t${realCommits(commits)}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: on macOS `/tmp` is a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
