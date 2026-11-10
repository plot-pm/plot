import { nodeMajor } from './stack.js';

/** The running Node major judged against the major `.nvmrc` pins. */
export interface NodePinReading {
  /** `true` only when both majors are read and equal. */
  readonly ok: boolean;
  /** The running major; `null` when the version names none. */
  readonly running: number | null;
  /** The pinned major; `null` when the pin names none. */
  readonly pinned: number | null;
}

/**
 * Whether the running Node is the major the pin names.
 *
 * The pin is an exact major and not a floor: a higher major refuses as a
 * lower one does. A pin or a version that names no major refuses.
 *
 * @param running - `process.versions.node`, `26.13.0`, or `node --version`'s `v26.13.0`.
 * @param pin - the text of `.nvmrc`, `26\n`.
 * @returns both majors and the verdict.
 */
export const nodePin = (running: string, pin: string): NodePinReading => {
  const have = nodeMajor(running);
  const want = nodeMajor(pin);
  return { ok: have !== null && want !== null && have === want, running: have, pinned: want };
};
