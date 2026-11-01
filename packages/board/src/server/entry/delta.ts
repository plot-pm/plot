import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { held, run } from './delta-core.js';
import { logToPlan } from './pulse-log.js';

export * from './delta-core.js';

// Only when RUN, never when imported.
//
// `pathToFileURL` rather than a template, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
//
// `--log <line> <plan>...` appends the pulse line to each plan through
// `logToPlan`, reads no stdin, and exits 0; a plan that cannot be written is
// named on stderr and the rest are still written.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] === '--log') {
    const [line = '', ...plans] = process.argv.slice(3);
    for (const plan of plans) {
      try {
        logToPlan(plan, line);
      } catch (err) {
        process.stderr.write(`plot-delta: ${plan}: ${(err as Error).message}\n`);
      }
    }
    void endEntry(0);
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    // `--held` prints nothing: exit 0 means the fleet holds the bridge, 1 that it does not.
    void endEntry(process.argv[2] === '--held' ? (held(text, Date.now()) ? 0 : 1) : run(text));
  }
}
