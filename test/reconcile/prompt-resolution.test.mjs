// WHICH PROMPT AN AGENT RUNS — resolved through its charter, or the repo's one.
//
// This is `an-agent-declares-what-it-is`, the first slice of
// docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md. Measured on
// that day: `prompt_file` was hardcoded at `plot-worker-loop.sh:526`, so there
// was one prompt per REPO and every dispatched agent ran the same instructions.
//
// BOTH ARMS ARE ASSERTED, and the fallback is the load-bearing one: the estate
// holds zero charters, so `PLOT_AGENT` unset is the path every existing worker
// takes and it must reach exactly the file the hardcoded line named.
//
// THE FUNCTION IS EXERCISED DIRECTLY, sourced out of the loop rather than
// driven through a launch — `deskreset.test.mjs` states the idiom this file
// follows, and `resolve_prompt_file` sits above the `PLOT_WORKER_LOOP_SOURCED`
// guard for exactly this reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const loop = path.join(scripts, 'plot-worker-loop.sh');

/** A repo root holding a repo prompt, a declared prompt, and four charters. */
const sandbox = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-prompt-'));
  fs.mkdirSync(path.join(root, '.plot', 'charters'), { recursive: true });
  fs.mkdirSync(path.join(root, '.plot', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.plot', 'worker-prompt.sh'), 'echo REPO\n');
  fs.writeFileSync(path.join(root, '.plot', 'prompts', 'reviewer.sh'), 'echo REVIEWER\n');
  const charter = (name, body) =>
    fs.writeFileSync(path.join(root, '.plot', 'charters', `${name}.json`), body);
  charter('reviewer', JSON.stringify({ name: 'reviewer', prompt: '.plot/prompts/reviewer.sh' }));
  charter('carries-a-run-fact', JSON.stringify({ name: 'x', prompt: 'p', pid: '4242' }));
  charter('typo', JSON.stringify({ name: 'x', prompt: 'p', modle: 'opus' }));
  charter('broken', 'not json {');
  return root;
};

/**
 * Source the loop for its definitions, resolve, and report what it decided.
 *
 * `PLOT_WORKER_LOOP_SOURCED` stops the script before it launches anything, so
 * this takes `resolve_prompt_file` and nothing else.
 */
const resolve = (root, agent) => {
  const script = `
    PLOT_WORKER_LOOP_SOURCED=1
    . "${loop}"
    if resolve_prompt_file "${root}" "${agent}"; then
      printf 'ok\\t%s\\t%s\\n' "$prompt_verb" "$prompt_file"
    else
      printf 'refused\\t%s\\t\\n' "$prompt_why"
    fi
  `;
  let stdout = '';
  try {
    stdout = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    stdout = err.stdout ?? '';
  }
  const [verdict, detail, file] = stdout.trim().split('\t');
  return { verdict, detail, file };
};

test('an agent that named no charter keeps the repo prompt — the estate today', () => {
  const root = sandbox();
  const got = resolve(root, '');

  assert.equal(got.verdict, 'ok');
  assert.equal(got.detail, 'fallback');
  assert.equal(got.file, `${root}/.plot/worker-prompt.sh`);
  // The exact path the hardcoded line named, so nothing on the estate moves.
  assert.equal(fs.readFileSync(got.file, 'utf8'), 'echo REPO\n');
});

test('an agent whose charter is not on this clone keeps the repo prompt', () => {
  const root = sandbox();
  const got = resolve(root, 'nobody-declared-this');

  assert.equal(got.verdict, 'ok');
  assert.equal(got.detail, 'fallback');
  assert.equal(got.file, `${root}/.plot/worker-prompt.sh`);
});

test('a declared agent runs the prompt its charter names', () => {
  const root = sandbox();
  const got = resolve(root, 'reviewer');

  assert.equal(got.verdict, 'ok');
  assert.equal(got.detail, 'declared');
  assert.equal(got.file, `${root}/.plot/prompts/reviewer.sh`);
  assert.equal(fs.readFileSync(got.file, 'utf8'), 'echo REVIEWER\n');
});

test('a charter carrying a run fact refuses, rather than falling back', () => {
  // The fallback would RUN — successfully — under instructions nobody asked
  // for, and nothing in .plot-worker.log would say so.
  const root = sandbox();
  const got = resolve(root, 'carries-a-run-fact');

  assert.equal(got.verdict, 'refused');
  assert.match(got.detail, /run facts/);
  assert.match(got.detail, /pid/);
});

test('a charter with an unknown key refuses, because a charter is a person typing', () => {
  const root = sandbox();
  const got = resolve(root, 'typo');

  assert.equal(got.verdict, 'refused');
  assert.match(got.detail, /typo/);
});

test('bytes that are not JSON refuse, never fall back', () => {
  const root = sandbox();
  const got = resolve(root, 'broken');

  assert.equal(got.verdict, 'refused');
  assert.match(got.detail, /not JSON/);
});
