/**
 * What one entry of a git tree object names.
 *
 * `kind` follows from the mode: `40000` is a subtree, `160000` a submodule
 * commit, and a mode starting `10` or `12` a blob (a file or a symlink).
 */
export interface TreeRecord {
  /** The mode, padded to six digits as `git ls-tree` prints it — `100644`, `040000`. */
  mode: string;
  /** What the mode names. */
  kind: 'blob' | 'tree' | 'commit';
  /** The entry's name inside its tree; never empty, never holding `/`. */
  name: string;
  /** The object id, in lower-case hex. */
  oid: string;
}

/** The byte that ends an entry's mode. */
const SPACE = 0x20;

/** The byte that ends an entry's name. */
const NUL = 0x00;

/** An octal mode of five or six digits. */
const MODE = /^[0-7]{5,6}$/;

/** Decodes an entry name; a byte sequence that is not UTF-8 decodes with U+FFFD, as git's own output does when read as UTF-8. */
const NAMES = new TextDecoder('utf-8');

/**
 * Names what a mode points at.
 *
 * @param mode - the six-digit mode.
 * @returns the kind, or null for a mode git does not write.
 */
const kindOf = (mode: string): TreeRecord['kind'] | null => {
  if (mode === '040000') return 'tree';
  if (mode === '160000') return 'commit';
  return /^1[02]/.test(mode) ? 'blob' : null;
};

/**
 * Renders bytes as lower-case hex.
 *
 * @param bytes - the raw object id.
 * @returns two hex digits per byte.
 */
const hexOf = (bytes: Uint8Array): string => {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
};

/**
 * Parses the body of a git tree object.
 *
 * The format is `<mode> <name>\0<oid>`, repeated, where `<oid>` is the raw
 * object id of `oidBytes` bytes (20 for SHA-1, 32 for SHA-256). The entries
 * keep the order the tree stores them in, which is the order `git ls-tree`
 * prints.
 *
 * @param body - the tree object's bytes, as `cat-file` answers `contents`.
 * @param oidBytes - the length of one raw object id.
 * @returns every entry, or null when the body does not parse: a missing space
 *   or NUL, a truncated object id, an unknown mode, or an empty name or one
 *   holding `/`.
 */
export const parseTree = (body: Uint8Array, oidBytes: number): readonly TreeRecord[] | null => {
  const records: TreeRecord[] = [];
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(SPACE, at);
    if (space === -1) return null;
    const nul = body.indexOf(NUL, space + 1);
    if (nul === -1 || nul + 1 + oidBytes > body.length) return null;
    const rawMode = NAMES.decode(body.subarray(at, space));
    if (!MODE.test(rawMode)) return null;
    const mode = rawMode.padStart(6, '0');
    const kind = kindOf(mode);
    const name = NAMES.decode(body.subarray(space + 1, nul));
    if (kind === null || name === '' || name.includes('/')) return null;
    records.push({ mode, kind, name, oid: hexOf(body.subarray(nul + 1, nul + 1 + oidBytes)) });
    at = nul + 1 + oidBytes;
  }
  return records;
};
