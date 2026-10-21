// THROUGH THE NARROW PATHS, not the package root. `@plot-pm/domain` re-exports
// every entity and rule, and esbuild bundles what it is given: measured
// 2026-09-03, the root import produced a 334 KB artifact against
// `plot-movable.mjs`'s 1.2 KB. `tracker-listers.ts` exists for the same
// measurement one layer down — `tracker-resolve.ts` re-exports the list and
// imports three connectors, so importing it here would ship them.
import { TRACKER_LISTERS } from '@plot-pm/domain/adapters/tracker/tracker-listers';
import { bbIssueCommandMissing, issueSource } from '@plot-pm/domain/rules/issue-source';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Who answers a repository's open-issue list — the rule `issueSource` reached
 * without HTTP, for `plot-host.sh`'s `issue-list` and `issue-view`.
 *
 * ```
 * plot-issue-source.mjs github < <(echo jira)
 * tracker	jira
 * plot-issue-source.mjs github < /dev/null
 * git-host
 * plot-issue-source.mjs github < <(echo linear)
 * nobody	no connector lists issues from the declared tracker `linear`, and ...
 * # exit 0 for all three
 * # exit 2 — no git host named
 *
 * plot-issue-source.mjs --bb-issue-missing < <(echo plot)
 * lists no issue command — Quatico bb has none, unlike craftamap/bb — ...; declare `Tracker: jira <base URL>` with `Sprint owner: plot`
 * # an empty stdin instead gets the advice to declare the `Tracker` key
 * # the caller prepends its own `bb ${version}` ahead of this sentence
 * ```
 *
 * **Its own bundle, for the reason the ones before it give.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh` — 18.3 s — so a
 * script asking who lists its issues would start a fleet scan to read one
 * config key. This entry reads stdin, spawns nothing and opens nothing.
 *
 * **The cost rule permits it.** A shipped bundle answers in about 39 ms, and
 * `plot-host.sh` runs once per operator command or once per board PR refresh,
 * never once per agent per pass — the case *A Shell Script Asks The Domain*
 * names as the domain's to answer.
 *
 * **THE TRACKER VALUE ARRIVES ON STDIN**, where the git host is an argument.
 * The value can carry a base URL after its scheme, and a URL on a command line
 * is a quoting hazard the shell that read the key should not have to re-solve.
 *
 * **READ THE EXIT CODE, NOT STDOUT'S EMPTINESS.** Empty stdin is a COMPLETE
 * answer — a repository that declared no tracker asks its git host — so it
 * prints `git-host` and exits 0. Absent is not false.
 *
 * **`nobody` exits 0.** The rule answered: no connector lists this tracker
 * here. Whether that is a refusal the caller reports is the caller's to
 * decide, and `plot-host.sh` turns it into exit 4 — *this cannot be asked at
 * all*. A non-zero exit here would say the question failed instead.
 */

/**
 * The tracker scheme the `--bb-issue-missing` sentence suggests: the first
 * shipped lister that does not need a particular git host, so a Bitbucket
 * repository is never told to use a tracker only GitHub can list.
 */
export const SUGGESTED_TRACKER = TRACKER_LISTERS.find((l) => l.onlyOnHost === undefined)?.scheme ?? '';

/** The exit codes the caller reads. */
export const EXIT = {
  /** The rule answered: one of `tracker`, `git-host` or `nobody`. */
  ok: 0,
  /** The caller named no git host. */
  usage: 2,
} as const;

/**
 * Answers who lists the issues of a repository with this tracker and host.
 *
 * @param args - the git host's backend word, as `plot-host.sh backend` reports it.
 * @param stdin - the `Tracker` key's value, verbatim; empty where none is declared.
 * @param write - where the answer line goes.
 * @returns the process exit code.
 */
export const run = (
  args: readonly string[],
  stdin: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  const [first = ''] = args;
  // A second question this bundle answers, routed by flag rather than a
  // second entry point: `bb_assert_issue_version` needs to know whether
  // `Tracker` is declared before it can word its own refusal, and that
  // reads the same `declared` value this entry already takes on stdin.
  if (first === '--bb-issue-missing') {
    write(`${bbIssueCommandMissing(stdin, SUGGESTED_TRACKER)}\n`);
    return EXIT.ok;
  }
  const gitHost = first;
  if (gitHost.trim() === '') return EXIT.usage;
  const source = issueSource({
    declared: stdin,
    gitHost: gitHost.trim(),
    listers: TRACKER_LISTERS,
  });
  // Tab-separated out. The caller is bash, and JSON would mean a `jq`
  // dependency on a path that has none.
  if (source.ask === 'tracker') write(`tracker\t${source.scheme}\n`);
  else if (source.ask === 'nobody') write(`nobody\t${source.reason}\n`);
  else write('git-host\n');
  return EXIT.ok;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8')));
}
