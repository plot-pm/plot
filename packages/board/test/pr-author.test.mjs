// GET /api/board carries a PR's author on the card that names the PR.
//
// Wave 2 of docs/plans/2026-09-24-the-board-shows-me-only-my-work.md. This
// drives the built artifact over HTTP against a `plot-host.sh` that answers
// `pr-list`. It catches a field that the server reads from the host and the
// card map at `board.ts` drops before the wire.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, fetchBoard, makeRepo, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const PLAN = `# Ship the widget

## Status
- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/widget-core\` → #113
- \`feature/widget-ui\` → #114
`;

/** One `pr-list --rich` line, as `plot-host.sh` emits it. */
const line = (number, head, author) => JSON.stringify({
  number, title: head, state: 'OPEN', head, draft: false, checks: 'green', mergeable: 'mergeable',
  review: '', url: `https://example.invalid/pull/${number}`, updatedAt: '2026-09-25T10:00:00Z',
  failing_checks: [], ...(author === undefined ? {} : { author }),
});

/**
 * A scripts directory whose `plot-host.sh` answers `pr-list` with two PRs, one
 * with an author and one without. Every other script is the real one.
 */
const scriptsWithHost = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-author-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  const rows = [line(113, 'feature/widget-core', 'octo-reader'), line(114, 'feature/widget-ui')];
  fs.writeFileSync(
    path.join(dir, 'plot-host.sh'),
    '#!/usr/bin/env bash\n'
    + 'case "$1" in\n'
    + '  backend) echo github ;;\n'
    + `  pr-list) ${rows.map((r) => `printf '%s\\n' ${JSON.stringify(r)}`).join('; ')} ;;\n`
    + 'esac\nexit 0\n',
    { mode: 0o755 },
  );
  return dir;
};

describe('/api/board carries whose a card\'s PR is', () => {
  let tmp;
  let scripts;
  let server;
  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-09-25-ship-the-widget.md', content: PLAN }] });
    scripts = scriptsWithHost();
    server = await startServer(tmp, {
      PLOT_SCRIPTS_DIR: scripts,
      PLOT_HOST: 'github',
      PLOT_PR_INDEX_HOME: path.join(tmp, '.pr-index'),
      PLOT_BUDGET_HOME: path.join(tmp, '.budget'),
    });
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
    if (scripts) rmTree(scripts);
  });

  it('carries the host\'s author, and \'\' where the host named none', async () => {
    // The PR map fills in the background, so the card links once it lands.
    let prs = [];
    for (let i = 0; i < 60; i += 1) {
      const board = await fetchBoard(server.port);
      const card = board.columns.flatMap((c) => c.cards).find((c) => c.slug === 'ship-the-widget');
      prs = card?.prs ?? [];
      if (prs.length === 2 && prs.every((p) => p.url !== '')) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.deepEqual(prs.map((p) => p.url), [
      'https://example.invalid/pull/113', 'https://example.invalid/pull/114',
    ], 'the host answered and the card linked both PRs');
    assert.deepEqual(prs.map((p) => p.author), ['octo-reader', '']);
  });
});
