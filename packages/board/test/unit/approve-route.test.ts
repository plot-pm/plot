// `POST /api/approve` with an `Approve command` on the SDK runner: a refused
// outcome reads failed with its summary and leaves the plan as it was, and a
// done outcome reads done. The plan's state is never written by the route.
import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { approveStatus, handleApprove } from '../../src/server/approve.js';
import { boardRunsSettled } from '../../src/server/board-run.js';
import { rmTree } from '../helpers.mjs';
import { lastModel, settled, useFakeClaude } from './fake-claude.js';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'a-draft-to-approve';
const PLAN = `2026-10-06-${SLUG}.md`;

const made: string[] = [];
afterEach(async () => {
  await boardRunsSettled();
  vi.unstubAllEnvs();
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo one level down, so the agent log and state land inside the tree `afterEach` removes. */
const repo = (): string => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-approve-route-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    ['## Plot Config', '', '- **Approve command:** claude -p --model haiku', '- **Agent runner:** sdk', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'docs/plans', PLAN),
    ['# A draft to approve', '', '## Status', '', '- **State:** Draft', '- **Review:** pr', '', '## Changelog', '', '- a draft', ''].join('\n'),
    'utf8',
  );
  return dir;
};

const post = async (dir: string): Promise<number> => {
  const req = Readable.from([JSON.stringify({ slug: SLUG })]) as unknown as http.IncomingMessage;
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

describe('approve on the SDK runner', () => {
  it('reads a refused outcome as failed with the summary, and leaves the plan unchanged', async () => {
    const dir = repo();
    const before = fs.readFileSync(path.join(dir, 'docs/plans', PLAN), 'utf8');
    useFakeClaude(path.dirname(dir), { outcome: 'refused', summary: 'the plan PR has no approving review' });
    assert.equal(await post(dir), 202);
    const status = await settled(() => approveStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG));
    assert.equal(status.state, 'failed');
    assert.match(status.message, /the approve run refused: the plan PR has no approving review/);
    assert.equal(fs.readFileSync(path.join(dir, 'docs/plans', PLAN), 'utf8'), before);
  });

  it('reads a done outcome as done, on the model the fragment names', async () => {
    const dir = repo();
    const argvLog = useFakeClaude(path.dirname(dir), { outcome: 'done', summary: 'approved' });
    assert.equal(await post(dir), 202);
    const status = await settled(() => approveStatus({ repoRoot: dir, scriptsDir: SCRIPTS }, SLUG));
    assert.equal(status.state, 'done', status.message);
    assert.equal(lastModel(argvLog), 'haiku');
  });
});
