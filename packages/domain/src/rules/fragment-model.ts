/**
 * Reads the model a command fragment names.
 *
 * A fragment naming no model answers `none`, never the string `''` taken as
 * a model name: the model precedence (charter, `Agent models`, the fragment,
 * the CLI's default) reads each step only where the one before it answered
 * none.
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
 * A flag or prefix value with surrounding quotes removed, or {@link NONE}
 * where the value is a shell expansion (`$NAME`, `${...}`) whose result the
 * fragment does not state.
 */
const modelValue = (raw: string): ModelReading => {
  const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2');
  if (unquoted === '' || unquoted.includes('$')) return NONE;
  return { named: true, model: unquoted };
};

/**
 * Reads the model one command fragment names.
 *
 * Checked in this order: a `--model` flag (either spelling) first, then the
 * `PLOT_MODEL=` prefix. Surrounding quotes are removed from the value.
 *
 * @param fragment - the command fragment, verbatim.
 * @returns the model named, or {@link NoModel} where the fragment names none
 *   or names it through a shell expansion such as `${PLOT_MODEL}`.
 */
export const fragmentModel = (fragment: string): ModelReading => {
  const flagged = FLAG_EQUALS.exec(fragment) ?? FLAG_SPACED.exec(fragment);
  if (flagged) {
    return modelValue(flagged[1]!);
  }

  const prefixed = PLOT_MODEL_PREFIX.exec(fragment);
  if (prefixed) {
    return modelValue(prefixed[1]!);
  }

  return NONE;
};
