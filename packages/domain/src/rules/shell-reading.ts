/**
 * A reading of a shell command line that knows where each word, simple
 * command and heredoc body sits. The controller gate uses it to blank text the
 * shell never runs. It reads a subset of bash: quotes, backslash escapes,
 * `$( )`, backticks, `${ }`, comments, the list and pipeline operators,
 * subshell parentheses, redirections, here-strings and heredocs. Any input
 * outside that subset, or any unterminated quote, substitution or heredoc,
 * makes {@link readShell} return `null`, and a caller then blanks nothing.
 */

/** One word of a simple command, as the shell splits it. */
export interface ShellWord {
  /** The offset of the word's first character in the command line. */
  readonly start: number;
  /** The offset one past the word's last character. */
  readonly end: number;
  /** The word as written, quotes included. */
  readonly raw: string;
  /**
   * The word after quote removal, or `null` when the word holds an expansion
   * (`$name`, `${ }`, `$( )`, a backtick, `$'…'`), whose value this reading
   * does not know.
   */
  readonly value: string | null;
  /**
   * Whether the word holds text the shell can run, or text this reading does
   * not evaluate: `$( )`, a backtick, `${ }`, `$'…'`, or a backslash-newline.
   * A word with `executes: false` expands to data and runs nothing.
   */
  readonly executes: boolean;
}

/** One heredoc whose body this reading found. */
export interface ShellHeredoc {
  /** The delimiter after quote removal. */
  readonly delimiter: string;
  /** Whether the delimiter word holds any quote or backslash, which turns off expansion in the body. */
  readonly quoted: boolean;
  /** Whether the delimiter word starts with a single quote. */
  readonly singleQuoted: boolean;
  /** The offset of the body's first character: the line after the one that holds the operator. */
  readonly bodyStart: number;
  /** The offset of the terminator line's first character. */
  readonly bodyEnd: number;
}

/** One simple command: its words, in order, and the heredocs its redirections open. */
export interface ShellCommand {
  /** The words, with redirection operators and their targets left out. */
  readonly words: ShellWord[];
  /** The heredocs this command's own redirections open, in body order. */
  readonly heredocs: ShellHeredoc[];
}

/** What {@link readShell} found in a command line. */
export interface ShellReading {
  /** Every simple command, including those inside `$( )` and `<( )`. */
  readonly commands: readonly ShellCommand[];
  /** Every heredoc, in body order. */
  readonly heredocs: readonly ShellHeredoc[];
}

/** Thrown inside {@link readShell} to unwind on input it cannot read; never escapes it. */
const UNREADABLE = new Error('unreadable shell input');

/** The deepest nesting of `$( )`, `<( )` and `>( )` the reading follows. */
const MAX_DEPTH = 32;

/** Characters that end an unquoted word. */
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);

/** Characters that start a special parameter or a name after `$`. */
const PARAMETER = /[A-Za-z0-9_@*#?$!-]/;

interface Pending {
  readonly owner: ShellCommand;
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly singleQuoted: boolean;
  readonly stripTabs: boolean;
}

/**
 * Reads a command line into its simple commands and heredoc bodies.
 *
 * @param src - the command line.
 * @returns the reading, or `null` when the line holds syntax outside the
 *   subset this module reads (`case`, `;;`, a function definition, `$[ ]`,
 *   an array assignment, a nested quote inside `${ }`), or an unterminated
 *   quote, substitution or heredoc.
 */
export const readShell = (src: string): ShellReading | null => {
  const commands: ShellCommand[] = [];
  const heredocs: ShellHeredoc[] = [];
  let pending: Pending[] = [];
  let pos = 0;

  const fail: () => never = () => {
    throw UNREADABLE;
  };

  /** Reads the bodies of the pending heredocs, starting at `pos`, which is the start of a line. */
  const readBodies = (): void => {
    for (const doc of pending) {
      const bodyStart = pos;
      for (;;) {
        if (pos >= src.length) fail();
        const nl = src.indexOf('\n', pos);
        const lineEnd = nl === -1 ? src.length : nl;
        const line = src.slice(pos, lineEnd);
        const next = nl === -1 ? src.length : nl + 1;
        if ((doc.stripTabs ? line.replace(/^\t+/, '') : line) === doc.delimiter) {
          const heredoc: ShellHeredoc = {
            delimiter: doc.delimiter,
            quoted: doc.quoted,
            singleQuoted: doc.singleQuoted,
            bodyStart,
            bodyEnd: pos,
          };
          doc.owner.heredocs.push(heredoc);
          heredocs.push(heredoc);
          pos = next;
          break;
        }
        pos = next;
      }
    }
    pending = [];
  };

  /** Skips a backtick substitution starting at `pos`. Its content is not read as commands. */
  const skipBackticks = (): void => {
    let i = pos + 1;
    while (i < src.length && src[i] !== '`') i += src[i] === '\\' ? 2 : 1;
    if (i >= src.length) fail();
    const content = src.slice(pos + 1, i);
    if (content.includes('\n') || content.includes('<<')) fail();
    pos = i + 1;
  };

  /** Reads one word starting at `pos`. */
  const readWord = (depth: number): ShellWord => {
    const start = pos;
    let value: string | null = '';
    let executes = false;
    const add = (text: string): void => {
      if (value !== null) value += text;
    };
    const unknown = (): void => {
      value = null;
    };

    /** Reads what follows a `$` at `pos`. */
    const dollar = (inDouble: boolean): void => {
      const next = src[pos + 1];
      if (next === '(') {
        executes = true;
        unknown();
        pos += 2;
        parseList(true, depth + 1);
      } else if (next === '{') {
        executes = true;
        unknown();
        const close = src.indexOf('}', pos + 2);
        if (close === -1 || /["'`$(){\\\n]/.test(src.slice(pos + 2, close))) fail();
        pos = close + 1;
      } else if (next === '[') {
        fail();
      } else if (next === "'" && !inDouble) {
        executes = true;
        unknown();
        let i = pos + 2;
        while (i < src.length && src[i] !== "'") i += src[i] === '\\' ? 2 : 1;
        if (i >= src.length) fail();
        pos = i + 1;
      } else if (next === '"' && !inDouble) {
        unknown();
        pos += 1;
      } else if (next !== undefined && PARAMETER.test(next)) {
        unknown();
        pos += 1;
        if (/[A-Za-z_]/.test(next)) {
          while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos])) pos += 1;
        } else {
          pos += 1;
        }
      } else {
        add('$');
        pos += 1;
      }
    };

    const readDoubleQuoted = (): void => {
      pos += 1;
      for (;;) {
        if (pos >= src.length) fail();
        const c = src[pos];
        if (c === '"') {
          pos += 1;
          return;
        }
        if (c === '\\') {
          const next = src[pos + 1];
          if (next === undefined) fail();
          if (next === '\n') executes = true;
          else add('$`"\\'.includes(next) ? next : `\\${next}`);
          pos += 2;
        } else if (c === '`') {
          executes = true;
          unknown();
          skipBackticks();
        } else if (c === '$') {
          dollar(true);
        } else {
          add(c);
          pos += 1;
        }
      }
    };

    while (pos < src.length && !WORD_END.has(src[pos])) {
      const c = src[pos];
      if (c === '\\') {
        const next = src[pos + 1];
        if (next === undefined) fail();
        if (next === '\n') executes = true;
        else add(next);
        pos += 2;
      } else if (c === "'") {
        const close = src.indexOf("'", pos + 1);
        if (close === -1) fail();
        add(src.slice(pos + 1, close));
        pos = close + 1;
      } else if (c === '"') {
        readDoubleQuoted();
      } else if (c === '`') {
        executes = true;
        unknown();
        skipBackticks();
      } else if (c === '$') {
        dollar(false);
      } else {
        add(c);
        pos += 1;
      }
    }
    if (pos === start) fail();
    return { start, end: pos, raw: src.slice(start, pos), value, executes };
  };

  /** Reads the word a redirection operator takes, after any blanks. */
  const readTarget = (depth: number): ShellWord => {
    while (src[pos] === ' ' || src[pos] === '\t') pos += 1;
    if (pos >= src.length || WORD_END.has(src[pos])) fail();
    return readWord(depth);
  };

  /** Reads a redirection starting at `pos` (a `<` or `>`), recording a heredoc on `owner`. */
  const readRedirect = (owner: ShellCommand, depth: number): void => {
    if (src.startsWith('<<<', pos)) {
      pos += 3;
      readTarget(depth);
      return;
    }
    if (src.startsWith('<<', pos)) {
      pos += 2;
      const stripTabs = src[pos] === '-';
      if (stripTabs) pos += 1;
      const word = readTarget(depth);
      if (word.executes || word.value === null) fail();
      pending.push({
        owner,
        delimiter: word.value,
        quoted: /['"\\]/.test(word.raw),
        singleQuoted: word.raw.startsWith("'"),
        stripTabs,
      });
      return;
    }
    if (src.startsWith('<(', pos) || src.startsWith('>(', pos)) {
      const start = pos;
      pos += 2;
      parseList(true, depth + 1);
      owner.words.push({ start, end: pos, raw: src.slice(start, pos), value: null, executes: true });
      return;
    }
    const op = src[pos];
    pos += 1;
    if (op === '>' && (src[pos] === '>' || src[pos] === '|' || src[pos] === '&')) pos += 1;
    else if (op === '<' && (src[pos] === '&' || src[pos] === '>')) pos += 1;
    readTarget(depth);
  };

  /**
   * Reads simple commands from `pos` until the end of input, or — inside a
   * substitution — until the `)` that closes it, which it consumes.
   */
  const parseList = (inSubstitution: boolean, depth: number): void => {
    if (depth > MAX_DEPTH) fail();
    let command: ShellCommand = { words: [], heredocs: [] };
    let opened = false;
    let parens = 0;
    const endCommand = (): void => {
      if (command.words.length > 0 || opened) commands.push(command);
      command = { words: [], heredocs: [] };
      opened = false;
    };
    while (pos < src.length) {
      const c = src[pos];
      if (c === ' ' || c === '\t') {
        pos += 1;
      } else if (c === '\\' && src[pos + 1] === '\n') {
        pos += 2;
      } else if (c === '#') {
        const nl = src.indexOf('\n', pos);
        pos = nl === -1 ? src.length : nl;
      } else if (c === '\n') {
        endCommand();
        pos += 1;
        if (pending.length > 0) readBodies();
      } else if (c === ';') {
        if (src[pos + 1] === ';' || src[pos + 1] === '&') fail();
        endCommand();
        pos += 1;
      } else if (c === '&') {
        if (src[pos + 1] === '>') {
          pos += 1;
          opened = true;
          readRedirect(command, depth);
        } else {
          endCommand();
          pos += src[pos + 1] === '&' ? 2 : 1;
        }
      } else if (c === '|') {
        endCommand();
        pos += src[pos + 1] === '|' || src[pos + 1] === '&' ? 2 : 1;
      } else if (c === '(') {
        if (command.words.length > 0 || opened) fail();
        parens += 1;
        pos += 1;
      } else if (c === ')') {
        endCommand();
        pos += 1;
        if (parens > 0) {
          parens -= 1;
        } else if (inSubstitution) {
          if (pending.length > 0) fail();
          return;
        } else {
          fail();
        }
      } else if (c === '<' || c === '>') {
        opened = true;
        readRedirect(command, depth);
      } else {
        const word = readWord(depth);
        if (/^\d+$/.test(word.raw) && (src[pos] === '<' || src[pos] === '>')) {
          opened = true;
          readRedirect(command, depth);
        } else {
          command.words.push(word);
        }
      }
    }
    if (inSubstitution || parens > 0) fail();
    endCommand();
  };

  try {
    parseList(false, 0);
    if (pending.length > 0) fail();
  } catch (error) {
    if (error === UNREADABLE) return null;
    throw error;
  }
  return { commands, heredocs };
};

/**
 * Replaces every character of the given spans with a space, keeping new
 * lines, so word boundaries and line numbers are unchanged.
 *
 * @param src - the command line.
 * @param spans - `[start, end)` offsets into `src`; they may overlap.
 * @returns the command line with those spans blanked.
 */
export const blankSpans = (src: string, spans: readonly (readonly [number, number])[]): string => {
  if (spans.length === 0) return src;
  const chars = src.split('');
  for (const [start, end] of spans) {
    for (let i = start; i < end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
};
