// The census root for a board scenario: starts the board server as its child,
// and starts a mark image when the test asks, so `strace -f` over this process
// sees both the board's tree and the window marks in one log.
//
// argv: <board-server.mjs>. The environment is the board's.
// stdout: `census: board <pid> <port>` once the board listens;
//         `census: marked <label>` after each mark; `census: stopped <code>`.
// stdin:  `mark <label>` starts `/usr/bin/true census-mark <label>`;
//         `stop` lists the board's descendants by pid, sends SIGTERM to the
//         board's process group and to each descendant, waits until the board
//         and every listed descendant have exited (SIGKILL after 10 s), and
//         exits. A descendant in its own process group, such as the PR reader
//         the board starts detached, outlives a signal to the board's group.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const say = (line) => process.stdout.write(`census: ${line}\n`);

const board = spawn(process.execPath, [process.argv[2]], {
  env: { ...process.env, PORT: '0', PLOT_EXIT_WITH_PARENT: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
  detached: true,
});
const exited = new Promise((resolve) => board.once('exit', (code, signal) => resolve(code ?? signal)));

let out = '';
let ready = false;
board.stdout.on('data', (chunk) => {
  if (ready) return;
  out += chunk.toString();
  const m = /http:\/\/localhost:(\d+)/.exec(out);
  if (m === null) return;
  ready = true;
  say(`board ${board.pid} ${m[1]}`);
});

const signal = (sig) => {
  try {
    process.kill(-board.pid, sig);
  } catch {
    // the group is gone
  }
};

/** Every descendant of `root` that `ps` lists now, by its parent pid. */
const descendantsOf = (root) => {
  const listed = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout ?? '';
  const children = new Map();
  for (const line of listed.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m === null) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Signals `pid` and the process group it leads, where it leads one. */
const signalPid = (pid, sig) => {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, sig);
    } catch {
      // gone, or not a group leader
    }
  }
};

/** Resolves once none of `pids` is alive, or with the ones still alive after `ms`. */
const awaitGone = (pids, ms) =>
  new Promise((resolve) => {
    const until = Date.now() + ms;
    const check = () => {
      const left = pids.filter(alive);
      if (left.length === 0 || Date.now() >= until) resolve(left);
      else setTimeout(check, 50);
    };
    check();
  });

const stop = async () => {
  const descendants = new Set();
  const terminate = () => {
    for (const pid of descendantsOf(board.pid)) {
      if (descendants.has(pid)) continue;
      descendants.add(pid);
      signalPid(pid, 'SIGTERM');
    }
  };
  terminate();
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 10_000);
  // A child the board starts while it shuts down is listed on the next read.
  let done = false;
  const code = await new Promise((resolve) => {
    void exited.then((c) => {
      done = true;
      resolve(c);
    });
    const poll = () => {
      if (done) return;
      terminate();
      setTimeout(poll, 50);
    };
    poll();
  });
  clearTimeout(timer);
  // WHAT THE BOARD LEFT IN ITS GROUP: a script still running gets the same end.
  signal('SIGKILL');
  const left = await awaitGone([...descendants], 10_000);
  for (const pid of left) signalPid(pid, 'SIGKILL');
  await awaitGone(left, 10_000);
  say(`stopped ${code}`);
  process.exit(0);
};

let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, label] = line.trim().split(/\s+/);
  queue = queue.then(async () => {
    if (command === 'mark' && label) {
      spawnSync('/usr/bin/true', ['census-mark', label], { stdio: 'ignore' });
      say(`marked ${label}`);
    }
    if (command === 'stop') await stop();
  });
});
process.stdin.on('end', () => {
  queue = queue.then(stop);
});
void exited.then((code) => {
  if (!ready) {
    say(`stopped ${code}`);
    process.exit(1);
  }
});
