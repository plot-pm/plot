// `scripts/count-fleet-turns.mjs` — the read-only measurement
// `the-sdk-is-the-default-runner` flips its default on, never compares
// against a threshold itself. Each test names the implementation it catches.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  POLL_REFUSAL_PREFIX,
  classifyPoll,
  compareBar,
  completedPolls,
  countWindow,
  median,
  readFleetSession,
  fleetTranscriptDirs,
  prNumberOfSubject,
  prNumbersFromPlans,
  readSpendRecord,
  refusedPolls,
  sdkSessionIdsOf,
  sealedSlices,
  sessionRunner,
  sideSlices,
  transcriptDirFor,
} from '../../scripts/count-fleet-turns.mjs';

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

/** One assistant turn's usage line. */
const usageLine = ({ entrypoint = 'sdk-cli', sessionId = 'sess-1', input = 100, cacheRead = 100, model = 'claude-sonnet-5' } = {}) =>
  line({
    type: 'assistant',
    entrypoint,
    sessionId,
    message: {
      role: 'assistant',
      model,
      content: [],
      usage: { input_tokens: input, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead },
    },
  });

/** One tool_use + tool_result pair, as a Bash call. */
const bashTurn = (command, resultText, { entrypoint = 'sdk-cli', sessionId = 'sess-1', id = 'toolu_1' } = {}) =>
  line({ type: 'assistant', entrypoint, sessionId, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } }) +
  line({ type: 'user', entrypoint, sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: resultText }] } });

/** One tool_use + tool_result pair for a non-Bash tool (e.g. ListAgents, ScheduleWakeup). */
const toolTurn = (toolName, resultText, { entrypoint = 'sdk-cli', sessionId = 'sess-1', id = 'toolu_1', input = {} } = {}) =>
  line({ type: 'assistant', entrypoint, sessionId, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: toolName, input }] } }) +
  line({ type: 'user', entrypoint, sessionId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: resultText }] } });

test('classifyPoll: distinguishes every named polling shape', () => {
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'true' } }), 'true');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'sleep 30' } }), 'sleep');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'cat .claude/tasks/abc123.output' } }), 'task-output cat');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'ps -p 1234' } }), 'ps');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'ScheduleWakeup', id: 'a', input: {} }), 'ScheduleWakeup');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'ListAgents', id: 'a', input: {} }), 'ListAgents');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'gh run watch 123' } }), 'CI read');
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'gh pr checks 9' } }), 'CI read');
});

test('classifyPoll: a plain cat of a non-task-output file is not conflated with every file read', () => {
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'cat README.md' } }), null);
});

test('classifyPoll: an unrelated Bash call is not polling-shaped', () => {
  assert.equal(classifyPoll({ type: 'tool_use', name: 'Bash', id: 'a', input: { command: 'pnpm test' } }), null);
});

test('a tool result carrying the fixed poll-refusal prefix is refused; every other polling-shaped call is completed', () => {
  const dir = scratch('plot-fleetturns-refusal-');
  const refused = bashTurn('sleep 30', `${POLL_REFUSAL_PREFIX}: \`sleep\` — end your turn`, { id: 'toolu_a' });
  const completed = bashTurn('ps -p 999', 'PID TTY', { id: 'toolu_b' });
  const text = refused + completed;
  fs.writeFileSync(path.join(dir, 'sess.jsonl'), text);
  const now = new Date();
  fs.utimesSync(path.join(dir, 'sess.jsonl'), now, now);

  const report = countWindow(dir, new Date(now.getTime() - 1000), new Date(now.getTime() + 1000), () => 'sdk');
  assert.equal(report.measured, true);
  assert.equal(refusedPolls(report.byRunner.sdk), 1);
  assert.equal(completedPolls(report.byRunner.sdk), 1);
});

test('readFleetSession: excludes a cli (master) session entirely', () => {
  const text = bashTurn('true', 'ok', { entrypoint: 'cli' });
  assert.equal(readFleetSession(text), null);
});

test('readFleetSession: includes an sdk-cli session', () => {
  const text = usageLine({ entrypoint: 'sdk-cli' });
  const session = readFleetSession(text);
  assert.ok(session !== null);
  assert.equal(session.turns.length, 1);
});

test('weighted tokens: cache-read tokens count at 1/10', () => {
  const dir = scratch('plot-fleetturns-weighted-');
  const text = usageLine({ input: 100, cacheRead: 100 });
  fs.writeFileSync(path.join(dir, 'sess.jsonl'), text);
  const now = new Date();
  fs.utimesSync(path.join(dir, 'sess.jsonl'), now, now);

  const report = countWindow(dir, new Date(now.getTime() - 1000), new Date(now.getTime() + 1000), () => 'sdk');
  // input 100 + output 10 + cacheCreate 0 + cacheRead 100/10 = 120
  assert.equal(report.byRunner.sdk.weightedTokens, 120);
});

test('countWindow: an empty window is unmeasured, never zero', () => {
  const dir = scratch('plot-fleetturns-empty-');
  const report = countWindow(dir, new Date('2026-10-01'), new Date('2026-10-02'), () => 'command');
  assert.equal(report.measured, false);
});

test('countWindow: a missing transcript directory is unmeasured', () => {
  const dir = path.join(os.tmpdir(), 'plot-fleetturns-does-not-exist-xyz');
  const report = countWindow(dir, new Date('2026-10-01'), new Date('2026-10-02'), () => 'command');
  assert.equal(report.measured, false);
});

test('a session this script cannot place on either runner is counted as unknown, never folded into command or sdk', () => {
  const dir = scratch('plot-fleetturns-unknown-');
  const text = usageLine({ sessionId: 'sess-unplaced' });
  fs.writeFileSync(path.join(dir, 'sess.jsonl'), text);
  const now = new Date();
  fs.utimesSync(path.join(dir, 'sess.jsonl'), now, now);

  const report = countWindow(dir, new Date(now.getTime() - 1000), new Date(now.getTime() + 1000), () => null);
  assert.equal(report.byRunner.command.sessions, 0);
  assert.equal(report.byRunner.sdk.sessions, 0);
  assert.equal(report.byRunner.unknown.sessions, 1);
});

test('transcriptDirFor mirrors the slice-spend adapter\'s slug', () => {
  const dir = transcriptDirFor('/Users/jwloka/Quatico/Agentic-Tools/plot', '/home/op');
  assert.equal(dir, '/home/op/.claude/projects/-Users-jwloka-Quatico-Agentic-Tools-plot');
});

test('median: even and odd counts, and empty', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([1, 2, 3]), 2);
});

test('sealedSlices: a seal-only branch is sealed under command', () => {
  const lines = [
    JSON.stringify({
      branch: 'command/x',
      at: '2026-09-01T00:00:00.000Z',
      tokens: { inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 100 },
      turns: 1,
      models: ['claude-opus-5'],
    }),
  ];
  const { sealed, straddling } = sealedSlices(lines);
  assert.equal(sealed.get('command/x').runner, 'command');
  // 10 + 10 + 0 + 100/10 = 30
  assert.equal(sealed.get('command/x').weightedTokens, 30);
  assert.deepEqual(straddling, []);
});

test('sealedSlices: a run-only branch is sealed under sdk', () => {
  const lines = [
    JSON.stringify({
      kind: 'run',
      branch: 'sdk/y',
      at: '2026-10-01T00:00:00.000Z',
      sessionId: 'sess-1',
      role: 'worker',
      models: { 'claude-sonnet-5': { inputTokens: 20, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 50, costUsd: 1 } },
      costUsd: 1,
      turns: 2,
    }),
  ];
  const { sealed, straddling } = sealedSlices(lines);
  assert.equal(sealed.get('sdk/y').runner, 'sdk');
  // 20 + 5 + 0 + 50/10 = 30
  assert.equal(sealed.get('sdk/y').weightedTokens, 30);
  assert.deepEqual(straddling, []);
});

test('sealedSlices: a branch with both a seal and a run line straddles, named rather than double-counted', () => {
  const lines = [
    JSON.stringify({
      branch: 'infra/both',
      at: '2026-09-01T00:00:00.000Z',
      tokens: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 },
      turns: 1,
      models: ['claude-opus-5'],
    }),
    JSON.stringify({
      kind: 'run',
      branch: 'infra/both',
      at: '2026-10-01T00:00:00.000Z',
      sessionId: 'sess-1',
      role: 'worker',
      models: { 'claude-sonnet-5': { inputTokens: 5, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 1 } },
      costUsd: 1,
      turns: 1,
    }),
  ];
  const { sealed, straddling } = sealedSlices(lines);
  assert.deepEqual(straddling, ['infra/both']);
  // attributed to the NEWEST contribution — the run line, so runner = sdk.
  assert.equal(sealed.get('infra/both').runner, 'sdk');
  assert.equal(sealed.size, 1);
});

test('compareBar: a group with fewer than 5 slices on either side reports "too few", never a computed ratio', () => {
  const baseline = Array.from({ length: 5 }, (_, i) => ({ branch: `b${i}`, weightedTokens: 100, changedLines: 50, endedAtPerson: false }));
  const sdk = Array.from({ length: 3 }, (_, i) => ({ branch: `s${i}`, weightedTokens: 50, changedLines: 50, endedAtPerson: false }));
  const compare = compareBar(baseline, sdk, 0, false);
  assert.equal(compare.byGroup.small.tooFew, true);
  assert.equal(compare.byGroup.small.sdkPctOfBaseline, null);
  assert.equal(compare.byGroup.small.met, null);
});

test('compareBar: evaluated PER GROUP — a fixture where pooled median passes but one group fails must report "not met"', () => {
  // small group: sdk median is 90% of baseline (fails the <=85% bar)
  const smallBase = Array.from({ length: 5 }, (_, i) => ({ branch: `sb${i}`, weightedTokens: 100, changedLines: 50, endedAtPerson: false }));
  const smallSdk = Array.from({ length: 5 }, (_, i) => ({ branch: `ss${i}`, weightedTokens: 90, changedLines: 50, endedAtPerson: false }));
  // large group: sdk median is 10% of baseline (comfortably passes)
  const largeBase = Array.from({ length: 5 }, (_, i) => ({ branch: `lb${i}`, weightedTokens: 1000, changedLines: 500, endedAtPerson: false }));
  const largeSdk = Array.from({ length: 5 }, (_, i) => ({ branch: `ls${i}`, weightedTokens: 100, changedLines: 500, endedAtPerson: false }));

  const baseline = [...smallBase, ...largeBase];
  const sdk = [...smallSdk, ...largeSdk];

  // pooled median would mix both groups together and could look like it passes;
  // the per-group evaluation must independently fail the small group.
  const compare = compareBar(baseline, sdk, 0, false);
  assert.equal(compare.byGroup.small.met, false);
  assert.equal(compare.byGroup.large.met, true);
  assert.equal(compare.barHolds, false);
});

test('compareBar: an empty SDK window reports "no SDK window", never "0 completed polls" as evidence', () => {
  const baseline = Array.from({ length: 5 }, (_, i) => ({ branch: `b${i}`, weightedTokens: 100, changedLines: 50, endedAtPerson: false }));
  const compare = compareBar(baseline, [], 0, true);
  assert.equal(compare.sdkWindowEmpty, true);
  assert.equal(compare.sdkPollsCompleted, null);
  assert.equal(compare.pollsMet, null);
  assert.equal(compare.barHolds, false);
});

test('compareBar: the bar holds only when every group passes, polls are zero, and share-at-person does not worsen', () => {
  const base = Array.from({ length: 10 }, (_, i) => ({ branch: `b${i}`, weightedTokens: 100, changedLines: 50, endedAtPerson: i === 0 }));
  const sdk = Array.from({ length: 10 }, (_, i) => ({ branch: `s${i}`, weightedTokens: 50, changedLines: 50, endedAtPerson: false }));
  const baseLarge = Array.from({ length: 10 }, (_, i) => ({ branch: `bl${i}`, weightedTokens: 1000, changedLines: 500, endedAtPerson: false }));
  const sdkLarge = Array.from({ length: 10 }, (_, i) => ({ branch: `sl${i}`, weightedTokens: 500, changedLines: 500, endedAtPerson: false }));
  const compare = compareBar([...base, ...baseLarge], [...sdk, ...sdkLarge], 0, false);
  assert.equal(compare.barHolds, true);
});

/** One response's line: Claude Code writes one per content block, each repeating `message.id` and `usage`. */
const responseLine = ({ id, entrypoint = 'sdk-cli', sessionId = 'sess-1', at = '2026-10-07T10:00:00Z', branch = 'main', content = [] } = {}) =>
  line({
    type: 'assistant',
    entrypoint,
    sessionId,
    gitBranch: branch,
    timestamp: at,
    message: {
      id,
      role: 'assistant',
      model: 'claude-sonnet-5',
      content,
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
    },
  });

/** Writes one transcript into `dir` and returns its path. */
const writeSession = (dir, name, text) => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, text);
  return file;
};

test('one response written as two block lines with one message.id is one turn, and its tokens count once', () => {
  const text = responseLine({ id: 'msg_1', content: [{ type: 'thinking' }] }) + responseLine({ id: 'msg_1', content: [{ type: 'text' }] });
  const session = readFleetSession(text);
  assert.equal(session.turns.length, 1);

  const dir = scratch('plot-fleetturns-dedupe-');
  writeSession(dir, 'sess', text);
  const report = countWindow(dir, new Date('2026-10-07T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), () => 'command');
  assert.equal(report.byRunner.command.turns, 1);
  assert.equal(report.byRunner.command.weightedTokens, 120);
});

test('readFleetSession: an sdk-ts session, the Agent SDK default entrypoint, is a fleet session', () => {
  const session = readFleetSession(responseLine({ id: 'msg_1', entrypoint: 'sdk-ts' }));
  assert.ok(session !== null);
  assert.equal(session.entrypoint, 'sdk-ts');
});

test('sessionRunner: a run-line session id reads sdk, sdk-ts reads sdk, sdk-cli reads command', () => {
  const ids = sdkSessionIdsOf([
    JSON.stringify({ kind: 'run', branch: 'infra/x', at: '2026-10-07T10:00:00Z', sessionId: 'sess-run', role: 'worker', models: {}, costUsd: 0, turns: 0 }),
    JSON.stringify({ branch: 'infra/y', at: '2026-10-07T10:00:00Z', tokens: {}, turns: 1, models: [] }),
  ]);
  assert.equal(sessionRunner({ sessionId: 'sess-run', entrypoint: 'sdk-cli' }, ids), 'sdk');
  assert.equal(sessionRunner({ sessionId: 'other', entrypoint: 'sdk-ts' }, ids), 'sdk');
  assert.equal(sessionRunner({ sessionId: 'other', entrypoint: 'sdk-cli' }, ids), 'command');
});

test('countWindow: sessions on two days give one row per day, each on its runner', () => {
  const dir = scratch('plot-fleetturns-days-');
  writeSession(dir, 'a', responseLine({ id: 'm1', at: '2026-10-07T10:00:00Z' }));
  writeSession(dir, 'b', responseLine({ id: 'm2', at: '2026-10-08T10:00:00Z', entrypoint: 'sdk-ts', sessionId: 'sess-2' }));
  const ids = new Set();
  const report = countWindow(dir, new Date('2026-10-07T00:00:00Z'), new Date('2026-10-09T00:00:00Z'), (s) => sessionRunner(s, ids));
  assert.deepEqual(Object.keys(report.byDay).sort(), ['2026-10-07', '2026-10-08']);
  assert.equal(report.byDay['2026-10-07'].command.sessions, 1);
  assert.equal(report.byDay['2026-10-08'].sdk.sessions, 1);
  assert.equal(report.byRunner.unknown.sessions, 0);
});

test('fleetTranscriptDirs: reads the checkout and its desks, never a sibling checkout', () => {
  const home = scratch('plot-fleetturns-home-');
  const checkout = '/work/plot';
  const projects = path.join(home, '.claude', 'projects');
  for (const name of ['-work-plot', '-work-plot--worktrees-free-1', '-work-plot-other']) fs.mkdirSync(path.join(projects, name), { recursive: true });
  const dirs = fleetTranscriptDirs(checkout, home).map((d) => path.basename(d));
  assert.deepEqual(dirs, ['-work-plot', '-work-plot--worktrees-free-1']);
});

test('readSpendRecord: a linked worktree finds the record under the common git dir, not its own', () => {
  const repo = scratch('plot-fleetturns-repo-');
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const desk = path.join(repo, '.worktrees', 'desk');
  git(['worktree', 'add', '-q', '--detach', desk]);
  fs.mkdirSync(path.join(repo, '.git', '.plot', 'state'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', '.plot', 'state', 'slice-spend.jsonl'), '{"branch":"infra/x"}\n');
  const record = readSpendRecord(desk, {});
  assert.equal(fs.realpathSync(record.path), fs.realpathSync(path.join(repo, '.git', '.plot', 'state', 'slice-spend.jsonl')));
  assert.equal(record.lines[0], '{"branch":"infra/x"}');
});

test('sealedSlices: a sealed slice carries its turns, and an sdk slice its run count', () => {
  const { sealed } = sealedSlices([
    JSON.stringify({ branch: 'infra/cmd', at: '2026-10-07T10:00:00Z', tokens: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0 }, turns: 42, models: [] }),
    JSON.stringify({ kind: 'run', branch: 'infra/sdk', at: '2026-10-07T10:00:00Z', sessionId: 's1', role: 'worker', models: { m: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 1 } }, costUsd: 1, turns: 30 }),
    JSON.stringify({ kind: 'run', branch: 'infra/sdk', at: '2026-10-07T11:00:00Z', sessionId: 's2', role: 'worker', models: { m: { inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 1 } }, costUsd: 1, turns: 20 }),
  ]);
  assert.equal(sealed.get('infra/cmd').turns, 42);
  assert.equal(sealed.get('infra/cmd').runs, null);
  assert.equal(sealed.get('infra/sdk').turns, 50);
  assert.equal(sealed.get('infra/sdk').runs, 2);
});

test('compareBar: every group met still fails the bar when a window holds fewer than 20 slices', () => {
  const side = (prefix, tokens) => [
    ...Array.from({ length: 5 }, (_, i) => ({ branch: `${prefix}s${i}`, weightedTokens: tokens, changedLines: 50, endedAtPerson: false })),
    ...Array.from({ length: 5 }, (_, i) => ({ branch: `${prefix}l${i}`, weightedTokens: tokens * 10, changedLines: 500, endedAtPerson: false })),
  ];
  const compare = compareBar(side('b', 100), side('s', 50), 0, false);
  assert.equal(compare.byGroup.small.met, true);
  assert.equal(compare.byGroup.large.met, true);
  assert.equal(compare.baselineTooSmall, true);
  assert.equal(compare.barHolds, false);
});

test('sideSlices: a slice whose session wrote PLOT-BLOCKED.md ends at a person; an unsized slice is named, not grouped', () => {
  const sealed = new Map([
    ['infra/a', { runner: 'command', weightedTokens: 10, at: '2026-10-07T10:00:00Z' }],
    ['infra/b', { runner: 'command', weightedTokens: 10, at: '2026-10-07T10:00:00Z' }],
    ['infra/c', { runner: 'sdk', weightedTokens: 10, at: '2026-10-07T10:00:00Z' }],
  ]);
  const text = responseLine({ id: 'm1', branch: 'infra/a', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/desk/PLOT-BLOCKED.md' } }] });
  const session = readFleetSession(text);
  const side = sideSlices(sealed, 'command', new Date('2026-10-07T00:00:00Z'), new Date('2026-10-08T00:00:00Z'), new Map([['infra/a', 30]]), [
    { branch: session.gitBranch, blocked: session.blocked },
  ]);
  assert.deepEqual(side.slices, [{ branch: 'infra/a', weightedTokens: 10, changedLines: 30, endedAtPerson: true }]);
  assert.deepEqual(side.unsized, ['infra/b']);
});

test('prNumbersFromPlans and prNumberOfSubject read both forms a slice size is found by', () => {
  const plans = '- `infra/a` → #12 — first\n- `infra/b` → #13\n- `infra/c` — no PR yet\n';
  assert.deepEqual([...prNumbersFromPlans(plans)], [['infra/a', 12], ['infra/b', 13]]);
  assert.equal(prNumberOfSubject('JS is the default loop (#1330)'), 1330);
  assert.equal(prNumberOfSubject('Merge pull request #77 from org/infra/a'), 77);
  assert.equal(prNumberOfSubject('plot: build the board artifact'), null);
});

test('the CLI: report classifies each session by runner and compare prints the bar with its windows named', () => {
  const home = scratch('plot-fleetturns-cli-home-');
  const spend = scratch('plot-fleetturns-cli-spend-');
  const checkout = '/work/plot';
  const projects = path.join(home, '.claude', 'projects');
  writeSession(path.join(projects, '-work-plot--worktrees-desk'), 'a', responseLine({ id: 'm1', branch: 'infra/a', sessionId: 'cmd-1' }));
  writeSession(path.join(projects, '-work-plot--worktrees-desk'), 'b', responseLine({ id: 'm2', branch: 'infra/b', sessionId: 'sdk-1', entrypoint: 'sdk-cli' }));
  fs.writeFileSync(
    path.join(spend, 'slice-spend.jsonl'),
    JSON.stringify({ kind: 'run', branch: 'infra/b', at: '2026-10-07T11:00:00Z', sessionId: 'sdk-1', role: 'worker', models: {}, costUsd: 0, turns: 1 }) + '\n',
  );
  const script = path.resolve(import.meta.dirname, '../../scripts/count-fleet-turns.mjs');
  const env = { ...process.env, PLOT_TRANSCRIPT_HOME: home, PLOT_SLICE_SPEND_HOME: spend };
  const out = execFileSync('node', [script, 'report', '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z', checkout], { encoding: 'utf8', env });
  assert.match(out, /\| 2026-10-07 \| command \| 1 \|/);
  assert.match(out, /\| 2026-10-07 \| sdk \| 1 \|/);
  assert.doesNotMatch(out, /\| unknown \|/);
  const compared = execFileSync('node', [script, 'compare', '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z', '2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z', checkout], { encoding: 'utf8', env });
  assert.match(compared, /bar comparison:/);
  assert.match(compared, /no SDK window/);
  assert.match(compared, /bar holds: false/);
});
