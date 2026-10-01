import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { performerShell } from '../src/adapters/performer/performer-shell.js';
import type { ShellContext } from '../src/adapters/scripts.js';

/**
 * `startFreeAgent` against a stub `plot-dispatch.sh`.
 *
 * Only the script is replaced: the adapter, `runProcess`, the pipe and the exit
 * code are production's. Each stub prints a footer the real script documents.
 */

const shells: string[] = [];

/** Builds a context whose `plot-dispatch.sh` is the given script body. */
const dispatchThat = (body: string): ShellContext => {
  const root = mkdtempSync(join(tmpdir(), 'plot-performer-mock-'));
  shells.push(root);
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir);
  const file = join(scriptDir, 'plot-dispatch.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return { repoRoot: root, scriptDir };
};

afterAll(() => {
  for (const dir of shells) rmSync(dir, { recursive: true, force: true });
});

describe('performerShell.startFreeAgent', () => {
  it('answers the count the summary line reports', async () => {
    const context = dispatchThat(
      "echo 'summary: agents=1 requested=1 running=0 headroom=clear worker=configured'",
    );
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: true, value: 1 });
  });

  it('answers unaskable when the Worker command is not the loop', async () => {
    // #1124: the script refuses with exit 1 and `worker=no-loop`. That is a
    // configuration a person must change, so the supervisor reports it as an
    // absence rather than as a failure to retry.
    const context = dispatchThat(
      "echo 'summary: agents=0 requested=1 running=0 headroom=clear worker=no-loop'; exit 1",
    );
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: false, why: 'unaskable' });
  });

  it('answers failed on any other non-zero exit', async () => {
    const context = dispatchThat('echo broken >&2; exit 1');
    expect(await performerShell(context).startFreeAgent('')).toEqual({ ok: false, why: 'failed' });
  });
});
