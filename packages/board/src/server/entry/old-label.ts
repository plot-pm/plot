import {
  oldLabelAction,
  type OldLabelReading,
  type OldLabelVerb,
} from '@plot-pm/domain/rules/old-label-migration';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-fleetctl.sh` runs when an old-label unit is loaded.
 *
 * ```
 * printf 'this /work/plot\n' | node plot-old-label.mjs retire
 * unload-and-remove
 * ```
 *
 * The one argument is the verb that asks: `retire` or `status`. The input is
 * `supervisor_checkout`'s own line: `this <path>`, `another <path>` or
 * `unknown`. A bundle, because `plot-fleetctl.sh` ships in the plugin, where
 * `packages/` does not exist. A line the rule does not know is an error with
 * exit 2, and so is a verb it does not know. The caller reads a non-zero exit
 * as *not asked*, never as `leave`.
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

/**
 * Parses the verb argument.
 *
 * @param arg - the first command-line argument.
 * @returns the verb.
 * @throws when the argument is neither `retire` nor `status`.
 */
export const verbFrom = (arg: string | undefined): OldLabelVerb => {
  if (arg === 'retire' || arg === 'status') return arg;
  throw new Error(`expected the verb 'retire' or 'status', got '${arg ?? ''}'`);
};

/**
 * Reads stdin, prints the action.
 *
 * @param text - the whole of stdin.
 * @param arg - the verb argument.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 answered, 2 unreadable input or verb.
 */
export const run = (
  text: string,
  arg: string | undefined,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  try {
    write(`${oldLabelAction(readingFrom(text), verbFrom(arg))}\n`);
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
  process.exit(run(Buffer.concat(chunks).toString('utf8'), process.argv[2]));
}
