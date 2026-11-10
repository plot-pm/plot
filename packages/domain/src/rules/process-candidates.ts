/**
 * Which `ps` rows are Plot processes — the classification behind the second
 * `plot-fleetctl.sh --status` block and `--stop`'s first refusal.
 *
 * The rows are `ps axww -o pid=,ppid=,uid=,args=` output. A row is a candidate
 * when argv[0] is `node`, `bash` or `sh` and the first argument holding a `/`
 * names a Plot artefact: the board, the supervisor (`plot-fleetd.mjs`, or the
 * old `plot-registryd.mjs`), or a scan (`plot-scan-walk.mjs`, or the fleet
 * scan script under a shell). The caller names the scan script: the shell that
 * ships beside it knows its filename, and this rule matches only what it is
 * given. A `-e`/`-p`/`--eval`/`--print` node
 * option or a shell `-c` option makes the row no candidate: its text is code,
 * not a path.
 *
 * NOTHING READ HERE REACHES AN EVALUATOR. Every user's command line is in the
 * snapshot; this rule returns text, and the shell tests each path as a
 * variable.
 *
 * @concept fleetctl-processes
 */

/**
 * The 1-based index of the last character of the first `name` in `s` that a
 * space or the end of `s` follows, or 0. With `bare`, `name` must also start
 * `s` or follow a `/`.
 *
 * @param s - the text searched.
 * @param name - the artefact's path suffix or file name.
 * @param bare - true when `name` must be a whole path segment.
 * @returns the end index, or 0 when no occurrence qualifies.
 */
const artEnd = (s: string, name: string, bare: boolean): number => {
  let off = 0;
  for (;;) {
    const i = s.indexOf(name, off);
    if (i < 0) return 0;
    const j = i + name.length;
    const c = s.charAt(j);
    if ((c === '' || c === ' ') && (!bare || i === 0 || s.charAt(i - 1) === '/')) return j;
    off = i + 1;
  }
};

/** The kind of a Plot process and the 1-based end of its artefact path in the argument text. */
const kindOf = (interp: string, p: string, scanScript: string): { kind: string; end: number } | undefined => {
  if (interp !== 'node') {
    const e = scanScript === '' ? 0 : artEnd(p, scanScript, true);
    return e ? { kind: 'scan', end: e } : undefined;
  }
  const b = artEnd(p, '/board/board-server.mjs', false);
  let r = artEnd(p, '/board/plot-fleetd.mjs', false);
  const r2 = artEnd(p, '/board/plot-registryd.mjs', false);
  if (!r || (r2 && r2 < r)) r = r2;
  if (b && (!r || b < r)) return { kind: 'board', end: b };
  if (r) return { kind: 'supervisor', end: r };
  const e = artEnd(p, '/board/plot-scan-walk.mjs', false);
  return e ? { kind: 'scan', end: e } : undefined;
};

/**
 * The start of the first argument holding a `/` (or a bare scan script name)
 * in `rest`, or -1 when there is none or an option makes the text code.
 *
 * @param interp - `node`, `bash` or `sh`.
 * @param rest - the arguments after argv[0].
 * @param scanScript - the fleet scan script's file name.
 * @returns the 0-based start of the path argument, or -1.
 */
const pathStart = (interp: string, rest: string, scanScript: string): number => {
  let pos = 0;
  while (pos < rest.length) {
    while (rest.charAt(pos) === ' ') pos++;
    if (pos >= rest.length) return -1;
    const k = rest.indexOf(' ', pos);
    const tok = k < 0 ? rest.slice(pos) : rest.slice(pos, k);
    let bad = false;
    if (/^-[^-]/.test(tok)) bad = interp === 'node' ? /[ep]/.test(tok.slice(1)) : tok.slice(1).includes('c');
    else if (interp === 'node' && /^--(eval|print)(=|$)/.test(tok)) bad = true;
    if (bad) return -1;
    if (tok.includes('/') || tok === scanScript) return pos;
    if (k < 0) return -1;
    pos = k + 1;
  }
  return -1;
};

/**
 * Classifies one `ps axww -o pid=,ppid=,uid=,args=` row.
 *
 * @param row - one row, with no trailing newline.
 * @param scanScript - the fleet scan script's file name; `''` matches no shell scan.
 * @returns `S<TAB>pid` for a `systemd --user` process (the Linux subreaper an
 *   orphan reparents to); `C<TAB>pid<TAB>ppid<TAB>uid<TAB>kind<TAB>argv0<TAB>path`
 *   for a candidate, where argv0 is `-` unless it holds a space (then the
 *   caller must find an executable regular file there); `undefined` otherwise.
 */
export const processCandidate = (row: string, scanScript: string): string | undefined => {
  const head = /^ *[0-9]+ +[0-9]+ +[0-9]+ /.exec(row);
  if (!head) return undefined;
  const [pid, ppid, uid] = head[0].trim().split(/ +/);
  const s = `/${row.slice(head[0].length)}`;
  if (/\/systemd --user$/.test(s)) return `S\t${pid}`;
  const m = /\/(node|bash|sh) /.exec(s);
  if (!m) return undefined;
  const interp = m[1] ?? '';
  const argv0 = s.slice(1, m.index + m[0].length - 1);
  const rest = s.slice(m.index + m[0].length);
  const start = pathStart(interp, rest, scanScript);
  if (start < 0) return undefined;
  const p = rest.slice(start);
  const art = kindOf(interp, p, scanScript);
  if (!art) return undefined;
  return `C\t${pid}\t${ppid}\t${uid}\t${art.kind}\t${argv0.includes(' ') ? argv0 : '-'}\t${p.slice(0, art.end)}`;
};

/**
 * Classifies every row of a `ps axww -o pid=,ppid=,uid=,args=` snapshot.
 *
 * @param snapshot - the whole snapshot, rows separated by newlines.
 * @param scanScript - the fleet scan script's file name.
 * @returns one line per classified row, each ending in a newline, in row order.
 */
export const processCandidates = (snapshot: string, scanScript: string): string =>
  snapshot
    .split('\n')
    .map((row) => processCandidate(row, scanScript))
    .filter((line): line is string => line !== undefined)
    .map((line) => `${line}\n`)
    .join('');
