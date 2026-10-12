// `POST /api/approve` with `"spike": true` runs `plot-approve.sh --spike` on the
// script arm, with or without an `Approve command`. The script start is
// recorded rather than run, so the test reads the argv the route passes.
import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const starts = vi.hoisted(() => [] as { script: string; args: readonly string[]; entry: string | undefined }[]);

vi.mock('../../src/server/board.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/board.js')>();
  return {
    ...real,
    scriptsFor: (opts: Parameters<typeof real.scriptsFor>[0]) => ({
      ...real.scriptsFor(opts),
      start: (
        script: string,
        args: readonly string[],
        options: { env?: NodeJS.ProcessEnv; onExit?: (code: number | null, signal: NodeJS.Signals | null) => void } = {},
      ) => {
        starts.push({ script, args, entry: options.env?.PLOT_APPROVE_ENTRY });
        options.onExit?.(0, null);
        return { pid: 1, started: true };
      },
    }),
  };
});

import { handleApprove } from '../../src/server/approve.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'a-design-with-a-spike';
const PLAN = `2026-10-12-${SLUG}.md`;

const made: string[] = [];
afterEach(() => {
  starts.length = 0;
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

const repo = (command: boolean): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-spike-route-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    ['## Plot Config', '', ...(command ? ['- **Approve command:** claude -p --model haiku'] : []), ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'docs/plans', PLAN),
    ['# A design with a spike', '', '## Status', '', '- **State:** Design', '- **Review:** pr', ''].join('\n'),
    'utf8',
  );
  return dir;
};

const post = async (dir: string, body: unknown): Promise<number> => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  let status = 0;
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as http.ServerResponse;
  await handleApprove(req, res, { repoRoot: dir, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 });
  return status;
};

describe('approve spike on the script arm', () => {
  for (const command of [false, true]) {
    it(`runs plot-approve.sh --spike --who <who> <slug> ${command ? 'with' : 'without'} an Approve command`, async () => {
      const dir = repo(command);
      assert.equal(await post(dir, { slug: SLUG, spike: true, who: 'jwloka' }), 202);
      assert.deepEqual(starts, [{ script: 'plot-approve.sh', args: ['--spike', '--who', 'jwloka', SLUG], entry: 'board' }]);
    });
  }

  it('passes no --spike for a whole-plan approval on the script arm', async () => {
    const dir = repo(false);
    assert.equal(await post(dir, { slug: SLUG, who: 'jwloka' }), 202);
    assert.deepEqual(starts.map((s) => s.args), [['--who', 'jwloka', SLUG]]);
  });
});
