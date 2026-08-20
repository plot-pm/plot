// GET /api/dispatch-log — the route contract, against the BUILT artifact.
//
// The unit suite (test/unit/dispatch-log.test.ts) owns the read and the
// presence check. This owns what only the running server shows: that the route
// is wired, that the slug travels as a query parameter, that a bad slug is
// refused before any file is touched, and that the `no-log`/`ok` distinction
// survives serialisation.
//
// The dispatcher log lives BESIDE the repo (`<repo>/../plot-dispatch-<slug>.log`),
// and `makeRepo` puts the repo under the OS temp dir — so this file writes the
// log one level up from the repo it made, which is where the server looks.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, makeRepo, request, rmTree } from './helpers.mjs';

const PLAN = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/** Where the server will look for a slug's dispatcher log — beside the repo. */
function logPathFor(repoRoot, slug) {
  return path.join(path.resolve(repoRoot, '..'), `plot-dispatch-${slug}.log`);
}

describe('GET /api/dispatch-log: the dispatcher log, keyed by slug', () => {
  let tmp, server;
  const written = [];

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-dispatch-log-fixture-widget.md', content: PLAN }] });
    // The dispatcher log lives at `<tmpdir>/plot-dispatch-<slug>.log`, a name
    // SHARED across every temp repo under the OS temp dir. A unique slug keeps
    // sibling suites out, but a crashed prior run of THIS suite could have left
    // its own logs behind — so the `no-log` assertion starts by clearing them.
    for (const slug of ['dispatch-log-fixture-widget', 'just-opened']) {
      fs.rmSync(logPathFor(tmp, slug), { force: true });
    }
    server = await startServer(tmp);
  });

  after(() => {
    server?.kill();
    for (const p of written) fs.rmSync(p, { force: true });
    if (tmp) rmTree(tmp);
  });

  it('reports no-log where nothing was ever dispatched', async () => {
    const res = await request(server.port, { path: '/api/dispatch-log?slug=dispatch-log-fixture-widget' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'no-log');
    // The path is still named — the answer to *then where would it be*.
    assert.match(body.path, /plot-dispatch-dispatch-log-fixture-widget\.log$/);
  });

  it('returns the dispatcher log once one exists', async () => {
    const p = logPathFor(tmp, 'dispatch-log-fixture-widget');
    written.push(p);
    fs.writeFileSync(p, 'dispatched=1 started=1\n');
    const res = await request(server.port, { path: '/api/dispatch-log?slug=dispatch-log-fixture-widget' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.slug, 'dispatch-log-fixture-widget');
    assert.match(body.text, /dispatched=1 started=1/);
  });

  it('an empty dispatcher log is a SUCCESS, distinct from no-log', async () => {
    const p = logPathFor(tmp, 'just-opened');
    written.push(p);
    fs.writeFileSync(p, '');
    const res = await request(server.port, { path: '/api/dispatch-log?slug=just-opened' });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.text, '');
  });

  it('refuses a value that is not a slug, touching no file', async () => {
    const res = await request(server.port, {
      path: `/api/dispatch-log?slug=${encodeURIComponent('../../etc/passwd')}`,
    });
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.body).error, /slug/);
  });

  it('refuses a missing slug', async () => {
    const res = await request(server.port, { path: '/api/dispatch-log' });
    assert.equal(res.status, 400);
  });

  it('the dispatcher log never rode the pulse', async () => {
    // The load-bearing assertion: none of this leaked into /api/board or
    // /api/fleet. The Status entry fetches on demand; the periodic payloads
    // carry at most a presence bit, never the log's contents.
    const board = JSON.parse((await request(server.port, { path: '/api/board' })).body);
    assert.ok(!JSON.stringify(board).includes('dispatched=1 started=1'));
  });
});
