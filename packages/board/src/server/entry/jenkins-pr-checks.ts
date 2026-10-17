import {
  bindChecks,
  rowsToBind,
  type BoundChecks,
  type JenkinsShaRun,
  type PrRowHead,
} from '@plot-pm/domain/rules/jenkins-pr-checks';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Binds Jenkins PR-row checks to head commits — the rules `rowsToBind` and
 * `bindChecks` reached from `plot-host.sh`, once per `pr-list` pass.
 *
 * ```
 * { jq -c . <<<"$colours"; jq -c . <<<"$rows"; } | plot-jenkins-pr-checks.mjs rows
 * <branch>\t<sha>\t<job>                      # one row to read by sha
 * printf '<branch>\t<sha>\t<job>\t<runs json>\n' | plot-jenkins-pr-checks.mjs bind
 * {"<branch>":{"checks":"green","job":"<job>","checksSha":"<sha>"}}
 * ```
 *
 * The shell keeps the transport: it makes the Jenkins call per listed row and
 * the branch-colour map. This entry reads stdin only and spawns nothing.
 *
 * `bind` answers only the rows whose `<runs json>` is a JSON array. A row whose
 * lookup could not ask Jenkins is left out or carries anything else, and the
 * branch colour stands for it.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered. */
  ok: 0,
  /** The caller named no verb, or one this does not have. */
  usage: 2,
} as const;

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/**
 * Answers the verb.
 *
 * @param argv - the arguments after the script name.
 * @param stdin - the readings.
 * @param write - where the answer goes.
 * @param warn - where a usage refusal goes.
 * @returns the process exit code.
 */
export const run = (
  argv: string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  const verb = argv[0];
  if (verb !== 'rows' && verb !== 'bind') {
    warn('plot-jenkins-pr-checks: usage: plot-jenkins-pr-checks.mjs <rows|bind> < readings\n');
    return EXIT.usage;
  }
  const lines = stdin.split('\n').filter((l) => l !== '');
  if (verb === 'rows') {
    const colours = parseLine(lines[0] ?? '');
    const rows = parseLine(lines[1] ?? '');
    if (colours === null || typeof colours !== 'object' || !Array.isArray(rows)) return EXIT.ok;
    for (const r of rowsToBind(rows as PrRowHead[], colours as Record<string, { checks?: string; job?: string }>)) {
      write(`${r.branch}\t${r.sha}\t${r.job}\n`);
    }
    return EXIT.ok;
  }
  const bound: Record<string, BoundChecks> = {};
  for (const line of lines) {
    const [branch, sha, job, runs] = line.split('\t');
    const parsed = parseLine(runs ?? '');
    if (branch === undefined || sha === undefined || job === undefined) continue;
    const hit = bindChecks(Array.isArray(parsed) ? (parsed as JenkinsShaRun[]) : null, job, sha);
    if (hit !== null) bound[branch] = hit;
  }
  write(`${JSON.stringify(bound)}\n`);
  return EXIT.ok;
};

// Only when RUN, never when imported; `pathToFileURL` for the macOS `/tmp`
// symlink reason `merge-subject.ts` records.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
