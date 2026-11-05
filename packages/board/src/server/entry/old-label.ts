import {
  oldLabelAction,
  labelAction,
  type OldLabelReading,
  type OldLabelVerb,
  type LabelVerb,
} from '@plot-pm/domain/rules/old-label-migration';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point `plot-fleetctl.sh` runs to ask either domain rule in
 * `old-label-migration.ts` about the job loaded under a label.
 *
 * ```
 * printf 'this /work/plot\n' | node plot-old-label.mjs retire
 * unload-and-remove
 * printf 'another /work/other\n' | node plot-old-label.mjs stop com.plot-pm.fleetd launchd 'launchctl print gui/501/com.plot-pm.fleetd' /work/plot
 * refuse
 * ```
 *
 * The input is always `supervisor_checkout`'s own line: `this <path>`,
 * `another <path>` or `unknown`. The first argument is the verb.
 *
 * `retire` and `status` are `oldLabelAction`'s verbs and take no further
 * argument — unchanged from before this bundle grew the other four.
 *
 * `start`, `start-default` and `stop` are `labelAction`'s verbs; `serves`
 * prints `--status`'s `serves:` line, read from the same input. All four take
 * four more arguments: the label the reading was read for, the platform
 * (`launchd`, `systemd` or `none`), the command that would read the job by
 * hand, and the root the reading was compared against (this checkout for
 * `start`/`serves`, the main checkout for `stop` run from a desk). `start`,
 * `start-default` and `stop` print the rule's word (`proceed` or `refuse`) on
 * stdout, and, on `refuse`, the refusal text on stderr. `serves` prints its
 * line on stdout and never refuses.
 *
 * A bundle, because `plot-fleetctl.sh` ships in the plugin, where
 * `packages/` does not exist. A line the rule does not know, a verb it does
 * not know, or a `labelAction` verb missing one of its four arguments, is an
 * error with exit 2. The caller reads a non-zero exit as *not asked*, never
 * as `leave` or `proceed`.
 */

/**
 * Parses one `supervisor_checkout` line.
 *
 * @param line - the stdin document.
 * @returns the reading.
 * @throws when the line is none of `this <path>`, `another <path>`, `unknown`.
 */
export const readingFrom = (line: string): OldLabelReading => {
  const text = line.replace(/\n$/, '');
  if (text === 'unknown') return { kind: 'unknown' };
  const match = /^(this|another) (.+)$/.exec(text);
  if (!match) throw new Error(`expected 'this <path>', 'another <path>' or 'unknown', got '${text}'`);
  return { kind: match[1] as 'this' | 'another', path: match[2] as string };
};

/** All verbs this bundle answers. */
type Verb = OldLabelVerb | LabelVerb | 'serves';

/**
 * Parses the verb argument.
 *
 * @param arg - the first command-line argument.
 * @returns the verb.
 * @throws when the argument is none of the verbs this bundle answers.
 */
export const verbFrom = (arg: string | undefined): Verb => {
  if (
    arg === 'retire' ||
    arg === 'status' ||
    arg === 'start' ||
    arg === 'start-default' ||
    arg === 'stop' ||
    arg === 'serves'
  ) {
    return arg;
  }
  throw new Error(
    `expected the verb 'retire', 'status', 'start', 'start-default', 'stop' or 'serves', got '${arg ?? ''}'`,
  );
};

/** The four arguments `start`, `start-default`, `stop` and `serves` take, beyond the verb. */
interface LabelArgs {
  readonly label: string;
  readonly platform: string;
  readonly readCmd: string;
  readonly root: string;
}

/**
 * Parses the four arguments a `LabelVerb` or `serves` needs.
 *
 * @param args - the command-line arguments after the verb.
 * @returns the label, platform, read command and comparison root.
 * @throws when fewer than four arguments follow the verb.
 */
const labelArgsFrom = (args: readonly string[]): LabelArgs => {
  const [label, platform, readCmd, root] = args;
  if (label === undefined || platform === undefined || readCmd === undefined || root === undefined) {
    throw new Error(`expected <label> <platform> <read-cmd> <root>, got ${args.length} argument(s)`);
  }
  return { label, platform, readCmd, root };
};

/**
 * The refusal text for `start` and `start-default`, word for word as
 * `refuse_label` printed it — keyed by reading kind, same text for both verbs.
 *
 * @param reading - which checkout the job serves.
 * @param args - the label, platform, read command and root.
 * @returns the refusal text, with no trailing newline.
 */
const startRefusalText = (reading: OldLabelReading, { label, platform, readCmd, root }: LabelArgs): string => {
  switch (reading.kind) {
    case 'this':
      return `plot-fleetctl: '${label}' is already loaded, serving THIS repository (${reading.path})\n  The fleet is already supervised here. See it: /plot-fleet --status\n  To restart it: /plot-fleet --stop, then /plot-fleet --start`;
    case 'another':
      return `plot-fleetctl: '${label}' is already loaded, serving ANOTHER checkout (${reading.path})\n  This repository is ${root}. That supervisor is not yours to stop.\n  Give this checkout its own label — skills/plot/units/README.md`;
    case 'unknown':
      return `plot-fleetctl: '${label}' is already loaded, and which checkout it serves cannot be determined\n  ${platform} names no working directory for it, so it may be another checkout's.\n  Read it before stopping it: ${readCmd}\n  Or, for a second checkout, give it its own label — skills/plot/units/README.md`;
  }
};

/**
 * The refusal text for `stop` — new wording, never shown by `--start`.
 *
 * @param reading - which checkout the job serves.
 * @param args - the label, platform, read command and root.
 * @returns the refusal text, with no trailing newline.
 */
const stopRefusalText = (reading: OldLabelReading, { label, platform, readCmd, root }: LabelArgs): string => {
  switch (reading.kind) {
    case 'another':
      return `plot-fleetctl: '${label}' serves ANOTHER checkout (${reading.path}), not this repository (${root}) — it was not unloaded.\n  Run --stop in that checkout, or give this checkout its own label — skills/plot/units/README.md`;
    case 'unknown':
      return `plot-fleetctl: '${label}' is loaded, and which checkout it serves cannot be determined — it was not unloaded.\n  ${platform} names no working directory for it, so it may be another checkout's.\n  Read it: ${readCmd}\n  Or, for a second checkout, give it its own label — skills/plot/units/README.md`;
    case 'this':
      // labelAction never refuses `stop` on `this`; unreachable in practice.
      return `plot-fleetctl: '${label}' serves this repository (${reading.path}) — it was not unloaded.`;
  }
};

/**
 * The `--status` `serves:` line for a reading, never a refusal.
 *
 * @param reading - which checkout the job serves.
 * @param args - the label, platform, read command and root.
 * @returns the line, with no trailing newline.
 */
const servesLine = (reading: OldLabelReading, { label, platform, root }: LabelArgs): string => {
  switch (reading.kind) {
    case 'this':
      return `  serves:  THIS repository (${reading.path})`;
    case 'another':
      return `  serves:  ANOTHER checkout (${reading.path}) — this repository is ${root}`;
    case 'unknown':
      return `  serves:  cannot determine — ${platform} names no working directory for ${label}`;
  }
};

/**
 * Reads stdin, prints the action.
 *
 * @param text - the whole of stdin.
 * @param argv - the command-line arguments after the script path: the verb,
 *   then (for `start`, `start-default`, `stop` and `serves`) the label,
 *   platform, read command and root.
 * @param write - where the stdout answer goes.
 * @param writeErr - where a refusal's text goes.
 * @returns the process exit code — 0 answered, 2 unreadable input, verb or
 *   arguments.
 */
export const run = (
  text: string,
  argv: readonly (string | undefined)[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  writeErr: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  try {
    const verb = verbFrom(argv[0]);
    const reading = readingFrom(text);
    if (verb === 'retire' || verb === 'status') {
      write(`${oldLabelAction(reading, verb)}\n`);
      return 0;
    }
    if (verb === 'serves') {
      const args = labelArgsFrom(argv.slice(1).filter((a): a is string => a !== undefined));
      write(`${servesLine(reading, args)}\n`);
      return 0;
    }
    const args = labelArgsFrom(argv.slice(1).filter((a): a is string => a !== undefined));
    const decision = labelAction(reading, verb);
    write(`${decision}\n`);
    if (decision === 'refuse') {
      const refusalText = verb === 'stop' ? stopRefusalText(reading, args) : startRefusalText(reading, args);
      writeErr(`${refusalText}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`plot-old-label: ${(err as Error).message}\n`);
    return 2;
  }
};

// Only when RUN, never when imported; `pathToFileURL` over `realpathSync` as in `movable.ts`.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  void endEntry(run(Buffer.concat(chunks).toString('utf8'), process.argv.slice(2)));
}
