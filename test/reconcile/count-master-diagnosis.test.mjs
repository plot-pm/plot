// `scripts/count-master-diagnosis.mjs` — the read-only measurement the
// JS-is-the-default-loop gate reports from, never compares against a
// threshold. Each test names the implementation it catches.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DIAGNOSIS_PATTERNS,
  countSession,
  countWindow,
  transcriptDirFor,
} from '../../scripts/count-master-diagnosis.mjs';

const made = [];
const scratch = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const line = (obj) => JSON.stringify(obj) + '\n';

/** A minimal `cli` session line pair: one Bash call, one result. */
const cliTurn = (command, resultText, { entrypoint = 'cli' } = {}) =>
  line({
    type: 'assistant',
    entrypoint,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }] },
  }) +
  line({
    type: 'user',
    entrypoint,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: resultText }] },
  });

test('counts a Bash call matching plot-worker-loop.sh, with its result characters', () => {
  const text = cliTurn('bash skills/plot/scripts/plot-worker-loop.sh', 'started');
  const result = countSession(text);
  assert.equal(result.calls, 1);
  assert.equal(result.chars, 'started'.length);
});

test('counts ps, pgrep and lsof only as the command word, not as a substring elsewhere', () => {
  assert.equal(countSession(cliTurn('ps aux | grep claude', 'x')).calls, 1);
  assert.equal(countSession(cliTurn('pgrep -f worker', 'x')).calls, 1);
  assert.equal(countSession(cliTurn('lsof -i :3000', 'x')).calls, 1);
  // "ps" appears in the path, not as the command word — must not match.
  assert.equal(countSession(cliTurn('cat packages/board/src/ps-helper.ts', 'x')).calls, 0);
});

test('counts a .plot-worker. file reference and a git worktree list call', () => {
  assert.equal(countSession(cliTurn('cat .plot-worker.a1b2.json', 'x')).calls, 1);
  assert.equal(countSession(cliTurn('git worktree list', 'x')).calls, 1);
});

test('does not count an unrelated Bash call', () => {
  assert.equal(countSession(cliTurn('pnpm test', 'ok')).calls, 0);
});

test('excludes an sdk-cli session entirely — Plot\'s own unattended runs are not master diagnosis', () => {
  const text = cliTurn('bash skills/plot/scripts/plot-worker-loop.sh', 'started', { entrypoint: 'sdk-cli' });
  assert.equal(countSession(text), null);
});

test('DIAGNOSIS_PATTERNS carries no (ps|pgrep|lsof) entry — that one is command-word-scoped, tested separately', () => {
  assert.ok(DIAGNOSIS_PATTERNS.every((p) => !p.source.includes('pgrep')));
});

test('transcriptDirFor mirrors the slice-spend adapter\'s slug: "/" and "." both become "-"', () => {
  const dir = transcriptDirFor('/Users/jwloka/Quatico/Agentic-Tools/plot', '/home/op');
  assert.equal(dir, '/home/op/.claude/projects/-Users-jwloka-Quatico-Agentic-Tools-plot');
});

test('countWindow: a directory with no session at all reads as unmeasured, never zero', () => {
  const dir = scratch('plot-countdiag-empty-');
  const report = countWindow(dir, new Date('2026-10-01'), new Date('2026-10-02'), 5);
  assert.equal(report.measured, false);
});

test('countWindow: a missing transcript directory reads as unmeasured', () => {
  const dir = path.join(os.tmpdir(), 'plot-countdiag-does-not-exist-xyz');
  const report = countWindow(dir, new Date('2026-10-01'), new Date('2026-10-02'), 5);
  assert.equal(report.measured, false);
});

test('countWindow: sums matching calls and result characters across sessions in range, excludes sdk-cli and out-of-range files', () => {
  const dir = scratch('plot-countdiag-window-');
  const inRange = new Date('2026-10-05T12:00:00Z');
  const outOfRange = new Date('2026-09-01T00:00:00Z');

  const master = cliTurn('bash skills/plot/scripts/plot-worker-loop.sh', 'abcd');
  fs.writeFileSync(path.join(dir, 'master-session.jsonl'), master);
  fs.utimesSync(path.join(dir, 'master-session.jsonl'), inRange, inRange);

  const worker = cliTurn('bash skills/plot/scripts/plot-worker-loop.sh', 'abcdefgh', { entrypoint: 'sdk-cli' });
  fs.writeFileSync(path.join(dir, 'worker-session.jsonl'), worker);
  fs.utimesSync(path.join(dir, 'worker-session.jsonl'), inRange, inRange);

  const old = cliTurn('bash skills/plot/scripts/plot-worker-loop.sh', 'zzzzzzzzzzzz');
  fs.writeFileSync(path.join(dir, 'old-session.jsonl'), old);
  fs.utimesSync(path.join(dir, 'old-session.jsonl'), outOfRange, outOfRange);

  const report = countWindow(dir, new Date('2026-10-05T00:00:00Z'), new Date('2026-10-06T00:00:00Z'), 2);
  assert.equal(report.measured, true);
  assert.equal(report.sessions, 1);
  assert.equal(report.calls, 1);
  assert.equal(report.chars, 4);
  assert.equal(report.tokenEstimate, 1);
  assert.equal(report.slices, 2);
});
