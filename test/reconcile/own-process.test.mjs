// own-process.mjs sends a signal only to a pid that still names the process
// the test recorded: same command, started no later than the record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupMembers, identityOf, isOwn, ownMembers, record, signalOwn, signalRecorded } from './own-process.mjs';

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const launch = () => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { child, exited };
};

const waitStarted = async (pid) => {
  for (let i = 0; i < 100 && identityOf(pid) === null; i += 1) await new Promise((r) => setTimeout(r, 10));
};

test('own-process: identityOf reads the command and a start time no later than now', async () => {
  const { child, exited } = launch();
  try {
    await waitStarted(child.pid);
    const id = identityOf(child.pid);
    assert.ok(id, 'a live pid has an identity');
    assert.match(id.command, /^sleep 30$/);
    assert.ok(id.startedAt <= Date.now(), `start ${id.startedAt} is not in the future`);
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  assert.equal(identityOf(child.pid), null, 'a reaped pid has no identity');
});

test('own-process: a pid whose command does not match is refused and left running', async () => {
  const { child, exited } = launch();
  try {
    await waitStarted(child.pid);
    assert.equal(signalOwn(child.pid, 'SIGKILL', { command: 'plot-brief-name-gate.sh' }), false,
      'a command mismatch sends nothing');
    assert.ok(alive(child.pid), 'the refused process still runs');
    assert.equal(signalOwn(child.pid, 'SIGKILL', { command: /^bash / }), false,
      'a RegExp mismatch sends nothing');
    assert.ok(alive(child.pid), 'the refused process still runs');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
});

test('own-process: a pid that started after the record is refused and left running', async () => {
  const before = Date.now() - 5_000;
  const { child, exited } = launch();
  try {
    await waitStarted(child.pid);
    assert.equal(isOwn(child.pid, { recordedAt: before }), false,
      'a process younger than the record is a different process under the same pid');
    assert.equal(signalOwn(child.pid, 'SIGKILL', { recordedAt: before, command: 'sleep' }), false);
    assert.ok(alive(child.pid), 'the refused process still runs');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
});

test('own-process: a matching pid is signalled', async () => {
  const { child, exited } = launch();
  record(child.pid);
  await waitStarted(child.pid);
  assert.equal(signalOwn(child.pid, 'SIGKILL', { command: 'sleep 30' }), true);
  const code = await exited;
  assert.equal(code, null, 'the process ended by the signal');
});

test('own-process: signalRecorded stamps the pid with the file mtime', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-own-process-'));
  const { child, exited } = launch();
  try {
    await waitStarted(child.pid);
    const file = path.join(dir, 'pid');
    fs.writeFileSync(file, `${child.pid}\n`);

    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(file, past, past);
    assert.equal(signalRecorded(file, 'SIGKILL'), false, 'a file older than the process is refused');
    assert.ok(alive(child.pid), 'the refused process still runs');

    const now = new Date();
    fs.utimesSync(file, now, now);
    assert.equal(signalRecorded(file, 'SIGKILL', { command: 'sleep' }), true);
    await exited;
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A detached `sh` that leads its own group, starts `sleep <secs>` in it and
// exits: the leader's pid is gone and the sleep stays in group `pid`.
const orphanGroup = async (secs) => {
  const recordedAt = Date.now();
  const leader = spawn('sh', ['-c', `sleep ${secs} & exit 0`], { stdio: 'ignore', detached: true });
  const pid = leader.pid;
  await new Promise((resolve) => leader.on('exit', resolve));
  let child;
  for (let i = 0; i < 100 && child === undefined; i += 1) {
    child = (groupMembers(pid) ?? []).find((m) => m.command === `sleep ${secs}`);
    if (child === undefined) await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(child, `the orphaned sleep ${secs} is in group ${pid}`);
  return { pid, recordedAt, child };
};

// Ends a process this file started, only while it still has the start time
// and command the test read.
const endOrphan = (m) => {
  const id = identityOf(m.pid);
  if (id !== null && id.startedAt === m.startedAt && id.command === m.command) {
    try { process.kill(m.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
};

const waitDead = async (pid) => {
  for (let i = 0; i < 200 && alive(pid); i += 1) await new Promise((r) => setTimeout(r, 10));
  return !alive(pid);
};

// Puts a `ps` on PATH that runs `body`, for the duration of `fn`.
const withFakePs = (body, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-own-process-ps-'));
  fs.writeFileSync(path.join(dir, 'ps'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved}`;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('own-process: groupMembers lists the processes of one group with start time and command', async () => {
  const g = await orphanGroup(3101);
  try {
    const rows = groupMembers(g.pid);
    assert.ok(Array.isArray(rows), 'ps answers');
    assert.ok(rows.every((r) => r.pgid === g.pid), 'only members of the group are listed');
    assert.equal(rows.length, 1, `the orphaned sleep is the only member: ${JSON.stringify(rows)}`);
    assert.ok(rows[0].startedAt >= g.recordedAt - 1_000, 'the start time is the sleep\'s own');
  } finally {
    endOrphan(g.child);
  }
});

test('own-process: a gone leader\'s group is ended member by proven member', async () => {
  const g = await orphanGroup(3102);
  try {
    assert.equal(identityOf(g.pid), null, 'the leader itself is gone');
    assert.equal(signalOwn(g.pid, 'SIGTERM', { recordedAt: g.recordedAt }), false,
      'the non-group form refuses a pid nothing holds');
    assert.equal(signalOwn(g.pid, 'SIGKILL', { recordedAt: g.recordedAt, group: true }), false,
      'the group form with no member expectation sends nothing');
    assert.ok(alive(g.child.pid), 'the member still runs after both refusals');
    assert.equal(signalOwn(g.pid, 'SIGKILL', { recordedAt: g.recordedAt, group: true, member: /^sleep 3102$/ }), true,
      'a proven member of a gone leader\'s group is signalled');
    assert.ok(await waitDead(g.child.pid), 'the signal reached the member');
  } finally {
    endOrphan(g.child);
  }
});

test('own-process: a gone leader\'s group whose members predate the record is refused and left running', async () => {
  const g = await orphanGroup(3103);
  try {
    const later = Date.now() + 10_000;
    assert.equal(signalOwn(g.pid, 'SIGKILL', { recordedAt: later, group: true, member: /^sleep 3103$/ }), false,
      'a member older than the record belongs to another group under a reused number');
    assert.deepEqual(ownMembers(g.pid, { recordedAt: later, member: /^sleep 3103$/ }), []);
    assert.ok(alive(g.child.pid), 'the refused member still runs');
  } finally {
    endOrphan(g.child);
  }
});

test('own-process: a gone leader\'s group whose members run another command is refused and left running', async () => {
  const g = await orphanGroup(3104);
  try {
    assert.equal(signalOwn(g.pid, 'SIGKILL', { recordedAt: g.recordedAt, group: true, member: ['monitor.sh', /^sleep 9$/] }), false,
      'a member that matches no expectation is not this test\'s');
    assert.ok(alive(g.child.pid), 'the refused member still runs');
  } finally {
    endOrphan(g.child);
  }
});

test('own-process: a ps that fails or prints an unreadable line refuses the gone leader\'s group', async () => {
  const g = await orphanGroup(3105);
  try {
    const expect = { recordedAt: g.recordedAt, group: true, member: /^sleep 3105$/ };
    withFakePs('exit 1', () => {
      assert.equal(groupMembers(g.pid), null, 'a failing ps lists nothing');
      assert.equal(signalOwn(g.pid, 'SIGKILL', expect), false, 'a failing ps sends nothing');
    });
    withFakePs('echo "not a ps line"', () => {
      assert.equal(groupMembers(g.pid), null, 'an unreadable ps line lists nothing');
      assert.equal(signalOwn(g.pid, 'SIGKILL', expect), false, 'an unreadable ps line sends nothing');
    });
    assert.ok(alive(g.child.pid), 'the member still runs after both refusals');
  } finally {
    endOrphan(g.child);
  }
});

test('own-process: a live leader that is not own is refused even with group and member', async () => {
  const leader = spawn('sleep', ['3106'], { stdio: 'ignore', detached: true });
  const exited = new Promise((resolve) => leader.on('exit', resolve));
  try {
    await waitStarted(leader.pid);
    const before = Date.now() - 10_000;
    assert.equal(signalOwn(leader.pid, 'SIGKILL', { recordedAt: before, group: true, member: /sleep 3106/ }), false,
      'a leader younger than the record is a reused pid, and its group is not this test\'s');
    assert.ok(alive(leader.pid), 'the refused leader still runs');
  } finally {
    leader.kill('SIGKILL');
    await exited;
  }
});

test('own-process: a pid with nothing to check it against throws rather than guessing', () => {
  assert.throws(() => isOwn(process.pid), /no recordedAt and no command/);
});

test('own-process: a missing pid file and a gone pid send nothing', () => {
  assert.equal(signalRecorded('/nonexistent/plot-own-process.pid', 'SIGKILL'), false);
  assert.equal(signalOwn(2 ** 22 + 12345, 'SIGKILL', { command: 'sleep' }), false);
  assert.equal(signalOwn('x1', 'SIGKILL', { command: 'sleep' }), false);
});
