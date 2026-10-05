// THE STAND-IN PROMPT. Spawns a grandchild (the stand-in for the harness a
// real prompt launches, e.g. `claude`) and reports both pids on stdout before
// sleeping — long enough that the test always has time to signal it.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);'], {
  stdio: 'ignore',
});

process.stdout.write(`PROMPT_CHILD ${process.pid} ${child.pid}\n`);

setInterval(() => {}, 1 << 30);
