/**
 * One program image that started: an `execve` or `execveat` that returned 0.
 *
 * `ppid` is the process that created `pid` through `clone`, `clone3`, `fork`
 * or `vfork`, resolved to its thread group leader. It is `null` for a process
 * whose creation the log does not hold, such as the traced root.
 */
export type ExecRecord = {
  pid: number;
  ppid: number | null;
  syscall: 'execve' | 'execveat';
  path: string;
  argv: string[];
};

/** A process created by a fork that never started an image of its own. */
export type ForkRecord = { pid: number; ppid: number };

export type StraceCensus = {
  /** Every successful `execve`/`execveat`, in log order. The gated figure. */
  execs: ExecRecord[];
  /** Every non-thread fork whose child never exec'd. A secondary figure. */
  forksWithoutExec: ForkRecord[];
};

type Call = { pid: number; name: string; args: string; result: string | null };

const PID_PREFIX = /^(?:\[pid\s+(\d+)\]|(\d+))\s+(.*)$/;
const UNFINISHED = ' <unfinished ...>';
const RESUMED = /^<\.\.\. (\w+) resumed>(.*)$/;
const CALL = /^(\w+)\((.*)$/;
const FORKS = new Set(['clone', 'clone3', 'fork', 'vfork']);

/** Splits `args) = result` at the last `) = `; `null` result means not seen. */
const splitResult = (rest: string): { args: string; result: string | null } => {
  const at = rest.lastIndexOf(') = ');
  return at < 0 ? { args: rest, result: null } : { args: rest.slice(0, at), result: rest.slice(at + 4).trim() };
};

/** Reads `strace -f` lines into calls, joining each `<unfinished ...>` with its `<... resumed>`. */
const readCalls = (text: string): Call[] => {
  const calls: Call[] = [];
  const pending = new Map<number, { name: string; args: string }>();
  for (const raw of text.split('\n')) {
    const m = PID_PREFIX.exec(raw.trim());
    if (!m) continue;
    const pid = Number(m[1] ?? m[2]);
    let body = m[3] ?? '';
    const resumed = RESUMED.exec(body);
    if (resumed) {
      const open = pending.get(pid);
      if (!open || open.name !== resumed[1]) continue;
      pending.delete(pid);
      body = `${open.name}(${open.args}${resumed[2] ?? ''}`;
    }
    const call = CALL.exec(body);
    if (!call) continue;
    const name = call[1] as string;
    const rest = call[2] as string;
    if (rest.endsWith(UNFINISHED)) {
      pending.set(pid, { name, args: rest.slice(0, -UNFINISHED.length) });
      continue;
    }
    calls.push({ pid, name, ...splitResult(rest) });
  }
  return calls;
};

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f', '"': '"', '\\': '\\' };

/** Reads one C string literal starting at `text[from] === '"'`; returns its value and the index after it. */
const readString = (text: string, from: number): { value: string; end: number } => {
  let value = '';
  let i = from + 1;
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') {
      const next = text[i + 1] ?? '';
      if (next === 'x') {
        value += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
        i += 4;
      } else if (/[0-7]/.test(next)) {
        const oct = /^[0-7]{1,3}/.exec(text.slice(i + 1))?.[0] ?? '0';
        value += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
      } else {
        value += ESCAPES[next] ?? next;
        i += 2;
      }
    } else {
      value += text[i];
      i += 1;
    }
  }
  return { value, end: i + 1 };
};

/** Reads the path string and the argv array of an `execve`/`execveat` argument list. */
const readExecArgs = (args: string): { path: string; argv: string[] } => {
  const pathAt = args.indexOf('"');
  const path = pathAt < 0 ? { value: '', end: 0 } : readString(args, pathAt);
  const argv: string[] = [];
  let i = args.indexOf('[', path.end);
  if (i < 0) return { path: path.value, argv };
  i += 1;
  while (i < args.length && args[i] !== ']') {
    if (args[i] === '"') {
      const s = readString(args, i);
      argv.push(s.value);
      i = s.end;
    } else {
      i += 1;
    }
  }
  return { path: path.value, argv };
};

const isThread = (call: Call): boolean => call.name.startsWith('clone') && call.args.includes('CLONE_THREAD');

/**
 * Turns an `strace -f` log into the census of started program images.
 *
 * Reads lines prefixed `<pid>  ` (`-o <file>`) or `[pid <pid>] ` (stderr).
 * Counts an `execve` or `execveat` only when it returned 0; a failed exec,
 * such as an `ENOENT` during a `PATH` search, starts no image. Attributes each
 * exec to the process that forked it, read from the `clone`/`clone3`/`fork`/
 * `vfork` return values anywhere in the log, and resolves a thread to the
 * process that owns it. A fork whose child never exec'd is listed in
 * `forksWithoutExec`; a thread is neither an exec nor a fork. Lines it does not
 * recognise (signals, exits, other syscalls) are ignored.
 */
export const parseStraceExecs = (text: string): StraceCensus => {
  const calls = readCalls(text);
  const parentOf = new Map<number, number>();
  const leaderOf = new Map<number, number>();
  const forked: ForkRecord[] = [];
  for (const call of calls) {
    if (!FORKS.has(call.name) || call.result === null) continue;
    const child = Number(call.result.split(/\s/)[0]);
    if (!Number.isInteger(child) || child <= 0) continue;
    const owner = leaderOf.get(call.pid) ?? call.pid;
    if (isThread(call)) {
      leaderOf.set(child, owner);
    } else {
      parentOf.set(child, owner);
      forked.push({ pid: child, ppid: owner });
    }
  }
  const execs: ExecRecord[] = [];
  for (const call of calls) {
    if ((call.name !== 'execve' && call.name !== 'execveat') || call.result !== '0') continue;
    const pid = leaderOf.get(call.pid) ?? call.pid;
    execs.push({ pid, ppid: parentOf.get(pid) ?? null, syscall: call.name, ...readExecArgs(call.args) });
  }
  const execed = new Set(execs.map((e) => e.pid));
  return { execs, forksWithoutExec: forked.filter((f) => !execed.has(f.pid)) };
};
