// own-process.mjs sends a signal only to a pid that still names the process
// the test recorded: same command, started no later than the record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { identityOf, isOwn, record, signalOwn, signalRecorded } from './own-process.mjs';

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

test('own-process: a pid with nothing to check it against throws rather than guessing', () => {
  assert.throws(() => isOwn(process.pid), /no recordedAt and no command/);
});

test('own-process: a missing pid file and a gone pid send nothing', () => {
  assert.equal(signalRecorded('/nonexistent/plot-own-process.pid', 'SIGKILL'), false);
  assert.equal(signalOwn(2 ** 22 + 12345, 'SIGKILL', { command: 'sleep' }), false);
  assert.equal(signalOwn('x1', 'SIGKILL', { command: 'sleep' }), false);
});
