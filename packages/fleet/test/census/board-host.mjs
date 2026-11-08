// The census root for a board scenario: starts the board server as its child,
// and starts a mark image when the test asks, so `strace -f` over this process
// sees both the board's tree and the window marks in one log.
//
// argv: <board-server.mjs>. The environment is the board's.
// stdout: `census: board <pid> <port>` once the board listens;
//         `census: marked <label>` after each mark; `census: stopped <code>`.
// stdin:  `mark <label>` starts `/usr/bin/true census-mark <label>`;
//         `stop` sends SIGTERM to the board's process group, waits for the
//         board to exit (SIGKILL after 10 s), and exits.
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

const stop = async () => {
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 10_000);
  const code = await exited;
  clearTimeout(timer);
  // WHAT THE BOARD LEFT IN ITS GROUP: a script still running gets the same end.
  signal('SIGKILL');
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
