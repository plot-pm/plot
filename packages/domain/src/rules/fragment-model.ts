/**
 * Reads the model a command fragment names, the same reading the board roles
 * use.
 *
 * **ABSENT IS NOT FALSE.** A fragment naming no model answers `none`, never
 * the string `''` taken as a model name — the charter precedence this plan
 * states (`charter.ts:104-118`, then `Agent models`, then the fragment, then
 * the CLI's default) reads each step only where the one before it answered
 * none, and a `''` read as a model would short-circuit that chain on every
 * fragment that simply does not set one.
 */

/** No model was named. */
export type NoModel = { readonly named: false };

/** The model a fragment or a prefix named. */
export type NamedModel = { readonly named: true; readonly model: string };

export type ModelReading = NoModel | NamedModel;

const NONE: NoModel = { named: false };

/** `--model <value>`, with the value in a following token. */
const FLAG_SPACED = /(?:^|\s)--model\s+(\S+)/;

/** `--model=<value>`, the value joined to the flag. */
const FLAG_EQUALS = /(?:^|\s)--model=(\S+)/;

/** The `PLOT_MODEL=<value>` prefix a `Worker command` sets. */
const PLOT_MODEL_PREFIX = /(?:^|\s)PLOT_MODEL=(\S+)/;

/**
 * Reads the model one command fragment names.
 *
 * Checked in this order: a `--model` flag (either spelling) first, because it
 * is the harness's own option and the more specific reading; the
 * `PLOT_MODEL=` prefix second, because `Worker command` sets it ahead of the
 * harness invocation and a fragment naming both would have the flag win on
 * the harness's own command line regardless.
 *
 * @param fragment - the command fragment, verbatim.
 * @returns the model named, or {@link NoModel} where the fragment names none.
 */
export const fragmentModel = (fragment: string): ModelReading => {
  const flagged = FLAG_EQUALS.exec(fragment) ?? FLAG_SPACED.exec(fragment);
  if (flagged) {
    return { named: true, model: flagged[1]! };
  }

  const prefixed = PLOT_MODEL_PREFIX.exec(fragment);
  if (prefixed) {
    return { named: true, model: prefixed[1]! };
  }

  return NONE;
};
