// THROUGH THE NARROW PATH, not the package root: the root import bundles every
// entity and rule, and this entry needs one rule.
import { checksVerdict, evidenceSha, type BuildFinding } from '@plot-pm/domain/rules/checks-verdict';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Whether an agent still waits for its pull request's checks — `checksVerdict`
 * reached without HTTP, for `plot-worker-loop.sh`.
 *
 * ```
 * plot-checks-verdict.mjs <branch> <head> <pushed> <pr-open> <waited> <bound> < last-finding.jsonl
 * wait
 * ```
 *
 * The arguments are the branch, the desk's HEAD sha, `1`/`0` for whether HEAD
 * is on the remote, `1`/`0` for whether an open PR carries the branch, the
 * seconds waited and the bound in seconds. Stdin holds the BuildMonitor's
 * latest line from the desk, or nothing. One word goes out: `none`, `wait`,
 * `settled` or `expired`.
 *
 * The loop asks once a minute while an agent waits, so one `node` start per
 * minute per waiting agent is the cost. The entry reads stdin, spawns nothing
 * and opens nothing.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** An answer was written. */
  ok: 0,
  /** The arguments could not be read. */
  unreadable: 2,
} as const;

/**
 * Reads one BuildMonitor line.
 *
 * @param text - the line, or an empty string.
 * @returns the finding, or `null` when the line is empty or not a BuildMonitor finding.
 */
export const parseFinding = (text: string): BuildFinding | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed.split('\n').pop() ?? '');
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  if (record.monitor !== 'BuildMonitor') return null;
  if (typeof record.finding !== 'string' || typeof record.branch !== 'string') return null;
  const evidence = typeof record.evidence === 'string' ? record.evidence : '';
  return { finding: record.finding, branch: record.branch, sha: evidenceSha(evidence) };
};

/**
 * Answers one question from the six arguments and the monitor line.
 *
 * @param argv - branch, head, pushed, pr-open, waited, bound.
 * @param stdin - the BuildMonitor's latest line, or nothing.
 * @param write - where the answer goes.
 * @param warn - where a usage error goes.
 * @returns the process exit code.
 */
export const run = (
  argv: readonly string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  if (argv.length < 6) {
    warn('plot-checks-verdict: usage: <branch> <head> <pushed> <pr-open> <waited-seconds> <bound-seconds>\n');
    return EXIT.unreadable;
  }
  const [branch, head, rawPushed, rawPrOpen, rawWaited, rawBound] = argv;
  const waited = Number(rawWaited);
  const bound = Number(rawBound);
  if (!Number.isFinite(waited) || !Number.isFinite(bound)) {
    warn('plot-checks-verdict: the waited and bound seconds must be numbers\n');
    return EXIT.unreadable;
  }
  write(
    `${checksVerdict({
      branch,
      head,
      pushed: rawPushed === '1',
      prOpen: rawPrOpen === '1',
      last: parseFinding(stdin),
      waitedSeconds: waited,
      boundSeconds: bound,
    })}\n`,
  );
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` on the realpath, because
// `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
