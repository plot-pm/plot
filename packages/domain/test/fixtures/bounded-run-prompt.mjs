// THE STAND-IN PROMPT. Spawns a grandchild (the stand-in for the harness a
// real prompt launches, e.g. `claude`) and reports both pids on stdout before
// sleeping — long enough that the test always has time to signal it.
//
// With `BOUNDED_RUN_PROMPT_IGNORES_SIGTERM=1` the prompt ignores SIGTERM, so a
// group SIGTERM leaves it running and only the caller's `killTreeSync` ends it.
import { spawn } from 'node:child_process';

if (process.env.BOUNDED_RUN_PROMPT_IGNORES_SIGTERM === '1') process.on('SIGTERM', () => {});

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);'], {
  stdio: 'ignore',
});

process.stdout.write(`PROMPT_CHILD ${process.pid} ${child.pid}\n`);

setInterval(() => {}, 1 << 30);
