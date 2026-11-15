// The census root for a board scenario: starts the board server as its child,
// and starts a mark image when the test asks, so `strace -f` over this process
// sees both the board's tree and the window marks in one log.
//
// argv: <board-server.mjs>. The environment is the board's.
// stdout: `census: board <pid> <port>` once the board listens;
//         `census: marked <label>` after each mark; `census: stopped <code>`.
// stdin:  `mark <label>` starts `/usr/bin/true census-mark <label>`;
//         `stop` sends SIGSTOP to the board's group and to each descendant
//         until a listing finds no unstopped one, sends SIGKILL to every
//         stopped group and pid, waits until each has exited, and exits.
//         A stopped process starts nothing, so the last listing holds every
//         process the board started. A descendant in its own process group,
//         such as a `runProcess` child or the PR reader the board starts
//         detached, outlives a signal to the board's group and is reparented
//         to pid 1 once its parent exits, where no listing by parent pid finds
//         it.
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
  // FREEZE FIRST, THEN LIST: a listing of a running tree misses a child
  // started after it, and that child outlives the board in a group of its own.
  const frozen = new Set();
  signalPid(board.pid, 'SIGSTOP');
  for (;;) {
    const found = descendantsOf(board.pid).filter((pid) => !frozen.has(pid));
    if (found.length === 0) break;
    for (const pid of found) {
      frozen.add(pid);
      signalPid(pid, 'SIGSTOP');
    }
  }
  signalPid(board.pid, 'SIGKILL');
  for (const pid of frozen) signalPid(pid, 'SIGKILL');
  const code = await exited;
  const left = await awaitGone([...frozen], 10_000);
  say(`stopped ${code}`);
  process.exit(left.length === 0 ? 0 : 1);
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
