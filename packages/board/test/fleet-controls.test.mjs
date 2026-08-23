// `POST /api/fleet-controls` and the shared state behind it — the two
// section-header controls (auto-dispatch switch, parallel-agent cap).
//
// These tests exercise the SHIPPED artifact against a scratch repo, the way the
// rest of the server suite does. The whole point of the state being shared
// rather than per-viewer is that it survives a process and a second board reads
// it, so the assertions are about a file on disk under `.plot/state/` and about
// what a fresh server returns having read it — never about a browser's memory.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, makeRepo, request, fetchRaw, rmTree } from './helpers.mjs';

const CONTROLS_PATH = ['.plot', 'state', 'fleet-controls.json'];

function controlsFile(repo) {
  return path.join(repo, ...CONTROLS_PATH);
}

/** Read the fleet controls off /api/fleet, the field the client renders from. */
async function fleetControls(port) {
  const res = await fetchRaw(port, '/api/fleet');
  return JSON.parse(res.body).fleetControls;
}

/** POST a partial change with the headers a same-origin browser sends. */
function postControls(port, patch) {
  return request(port, {
    method: 'POST',
    path: '/api/fleet-controls',
    headers: { 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(patch),
  });
}

describe('fleet controls: defaults come from Plot Config, off and 3', () => {
  let tmp, server;

  before(async () => {
    // A repo with no `Auto-dispatch`/`Parallel agents` keys: the defaults are
    // the switch OFF and the cap 3, and a board that has never been told to
    // serve the queue must not begin serving it.
    tmp = makeRepo({ plans: [] });
    server = await startServer(tmp);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('a repo that has never touched a control reads switch off, cap 3', async () => {
    const controls = await fleetControls(server.port);
    assert.equal(controls.autoDispatch, false);
    assert.equal(controls.parallelAgents, 3);
  });

  it('writes no state file until a control is actually changed', () => {
    // The defaults are computed, not persisted: a board that only READS the
    // controls leaves `.plot/state/` untouched, so the file's existence means a
    // person set something.
    assert.equal(fs.existsSync(controlsFile(tmp)), false);
  });
});

describe('fleet controls: Plot Config seeds a different starting point', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [] });
    // A real `## Plot Config` block, the way `plot-config.sh` reads it.
    fs.writeFileSync(
      path.join(tmp, 'CLAUDE.md'),
      '# Scratch\n\n## Plot Config\n\n- **Auto-dispatch:** true\n- **Parallel agents:** 5\n',
      'utf8',
    );
    server = await startServer(tmp);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('reads the switch and cap the config declares', async () => {
    const controls = await fleetControls(server.port);
    assert.equal(controls.autoDispatch, true);
    assert.equal(controls.parallelAgents, 5);
  });
});

describe('POST /api/fleet-controls: a partial write returns the resulting state', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [] });
    server = await startServer(tmp);
  });
  beforeEach(() => {
    // Each test starts from the config defaults — no leftover file.
    fs.rmSync(controlsFile(tmp), { force: true });
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('toggling the switch returns the new controls, not a bare ack', async () => {
    const res = await postControls(server.port, { autoDispatch: true });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    // The /api/claim contract: a caller never asks a second endpoint whether its
    // write landed.
    assert.equal(body.autoDispatch, true);
    assert.equal(body.parallelAgents, 3, 'the untouched field keeps its value');
  });

  it('stepping the cap leaves the switch alone — a partial write merges', async () => {
    await postControls(server.port, { autoDispatch: true });
    const res = await postControls(server.port, { parallelAgents: 7 });
    const body = JSON.parse(res.body);
    assert.equal(body.parallelAgents, 7);
    assert.equal(body.autoDispatch, true, 'the switch set by an earlier write survives');
  });

  it('persists the write to a file under .plot/state/', async () => {
    await postControls(server.port, { autoDispatch: true, parallelAgents: 4 });
    const onDisk = JSON.parse(fs.readFileSync(controlsFile(tmp), 'utf8'));
    assert.equal(onDisk.autoDispatch, true);
    assert.equal(onDisk.parallelAgents, 4);
  });

  it('a change is visible on the next /api/fleet poll', async () => {
    await postControls(server.port, { parallelAgents: 6 });
    const controls = await fleetControls(server.port);
    assert.equal(controls.parallelAgents, 6);
  });
});

describe('POST /api/fleet-controls: the cap refuses to go below 1', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [] });
    server = await startServer(tmp);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('clamps a sub-floor value to 1 and returns the clamped result', async () => {
    // A cap of zero is a stopped fleet expressed as a number, which the switch
    // says better. The server floors it whatever door the value came through.
    const res = await postControls(server.port, { parallelAgents: 0 });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).parallelAgents, 1);
    const onDisk = JSON.parse(fs.readFileSync(controlsFile(tmp), 'utf8'));
    assert.equal(onDisk.parallelAgents, 1, 'the floored value is what persists');
  });
});

describe('POST /api/fleet-controls: shared, not per-viewer', () => {
  let tmp, first, second;

  before(async () => {
    tmp = makeRepo({ plans: [] });
    first = await startServer(tmp);
  });
  after(async () => {
    await first?.stop();
    await second?.stop();
    if (tmp) rmTree(tmp);
  });

  it('a SECOND board process reads the values the first wrote', async () => {
    // This is the whole reason the state is a file rather than localStorage: two
    // boards on one repo must not disagree about whether the fleet is running.
    await postControls(first.port, { autoDispatch: true, parallelAgents: 8 });
    second = await startServer(tmp);
    const controls = await fleetControls(second.port);
    assert.equal(controls.autoDispatch, true);
    assert.equal(controls.parallelAgents, 8);
  });
});

describe('POST /api/fleet-controls: refuses a cross-origin write', () => {
  let tmp, server;

  before(async () => {
    tmp = makeRepo({ plans: [] });
    server = await startServer(tmp);
  });
  after(async () => {
    await server?.stop();
    if (tmp) rmTree(tmp);
  });

  it('a cross-site request is refused with 403 and writes nothing', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/fleet-controls',
      headers: { 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ autoDispatch: true }),
    });
    assert.equal(res.status, 403);
    assert.equal(
      fs.existsSync(controlsFile(tmp)),
      false,
      'a refused write must touch no state file',
    );
  });

  it('rejects a field of the wrong type without writing', async () => {
    const res = await postControls(server.port, { parallelAgents: 'lots' });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(controlsFile(tmp)), false);
  });
});
