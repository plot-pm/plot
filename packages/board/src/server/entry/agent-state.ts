import {
  agentState,
  type AgentStateReadings,
  type PidLiveness,
} from '@plot-pm/domain/rules/agent-state';
import type { UnpushedReading } from '@plot-pm/domain/rules/task';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point that scores a desk's readings, one line per desk.
 *
 * ```
 * printf '1\t1\tdead\t0\t0\t0\t\n' | node plot-agent-state.mjs
 * finished
 * ```
 *
 * **AN EIGHTH artifact, for the reason the seventh gives.** `plot-ask.mjs`
 * answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`, and the scan
 * SOURCES `plot-worker-state.sh` — so a deriver asking `plot-ask.mjs` would be
 * a script calling an artifact that calls the script. This bundle spawns
 * nothing and reads nothing.
 *
 * **IT IS NOT ON ANY HOT PATH, AND THAT IS THE POINT.**
 * `docs/shell-and-domain.md` puts a script running once per agent per pass on
 * the duplicating side of the cost rule, and `plot-worker-state.sh` is sourced
 * by `plot-worker-loop.sh` — the agent's own loop. So the shell keeps deciding
 * for its five callers and pays no hop. This bundle exists for the callers
 * already in node that would otherwise fork bash to ask a question the domain
 * can answer, and for the corpus test that holds the pair together.
 *
 * **BATCHED, unlike `plot-task.mjs`.** One line in, one word out, for as many
 * desks as the caller has — the registry classifies every desk on the machine
 * per pulse, and a fork per desk would be the cost the batch was built to
 * avoid.
 */

/**
 * Parse one desk's readings:
 * `here<TAB>pid<TAB>liveness<TAB>exit<TAB>blocked<TAB>dirty<TAB>unpushed`.
 *
 * `here`, `pid`, `blocked` and `dirty` are `1` for true and anything else for
 * false, which is what a shell test writes. `liveness` is one of the three
 * words `plot_worker_readings` prints; anything else reads as `dead`, the
 * answer that cannot invent a running worker.
 *
 * `exit` distinguishes the two records that reach `ended` by different routes:
 * the literal `-` means no record was found, and an empty field means one was
 * found and said nothing. `unpushed` is the string a
 * `git rev-list --count '@{upstream}..HEAD'` produced, so an empty or
 * non-numeric field means the branch has no upstream and the question has no
 * answer — `null`, which is not `false` and must not become `stalled`.
 *
 * A malformed line is NOT skipped. A missing field would silently become the
 * permissive reading, and the permissive direction here reports `finished`
 * about work nobody can see.
 *
 * @param line one desk's readings
 * @returns what was measured of the desk
 * @throws when the line is not seven tab-separated fields
 */
export const readingsFrom = (line: string): AgentStateReadings => {
  const fields = line.split('\t');
  if (fields.length !== 7) {
    throw new Error(
      `expected 7 tab-separated fields, got ${fields.length} in '${line}'`,
    );
  }
  const [here, pid, liveness, exit, blocked, dirty, aheadText] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const count = Number(aheadText);
  const unpushed: UnpushedReading =
    aheadText !== '' && Number.isInteger(count) && count >= 0 ? count > 0 : null;
  const live: PidLiveness =
    liveness === 'live' ? 'live' : liveness === 'stale' ? 'stale' : 'dead';
  return {
    worktreeHere: here === '1',
    pidRecorded: pid === '1',
    liveness: live,
    // `-` is the absent record; everything else is the record's own text,
    // including the empty string an unreadable one leaves.
    exit: exit === '-' ? null : exit,
    task: {
      // THE PR FACT IS NEVER IN THE READINGS. It comes from the caller, which
      // is what `plot_worker_state`'s own contract says: a caller that cannot
      // know says nothing, and the tree then answers. This entry point's
      // callers are the registry and the corpus test, and neither asks a host.
      hasPr: false,
      blocked: blocked === '1',
      dirty: dirty === '1',
      unpushed,
    },
  };
};

/**
 * Score every line handed in.
 *
 * @param text the whole of stdin, one desk per line
 * @returns one state per line, newline-terminated
 */
export const answer = (text: string): string => {
  const lines = text.replace(/\n$/, '').split('\n');
  return lines.map((line) => agentState(readingsFrom(line))).join('\n') + '\n';
};

/**
 * Read stdin, print the answers.
 *
 * @param text the whole of stdin
 * @param write where the answers go
 * @returns the process exit code — 0 answered, 2 unreadable input
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    write(answer(text));
    return 0;
  } catch (err) {
    process.stderr.write(`plot-agent-state: ${(err as Error).message}\n`);
    return 2;
  }
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
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
