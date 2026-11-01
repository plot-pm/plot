import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { held, run } from './delta-core.js';

export * from './delta-core.js';

// Only when RUN, never when imported.
//
// `pathToFileURL` rather than a template, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  // `--held` prints nothing: exit 0 means the fleet holds the bridge, 1 that it does not.
  void endEntry(process.argv[2] === '--held' ? (held(text, Date.now()) ? 0 : 1) : run(text));
}
