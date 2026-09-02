// Resume availability: whether a correction can reach the agent's own
// conversation, decided by looking for the transcript rather than by trusting
// that the contract was honoured.
//
// **The configuration Plot cannot control is the one under test.** Plot exports
// the session id as `PLOT_SESSION_ID`; the adopting project's
// `.plot/worker-prompt.sh` decides whether to pass it on as `--session-id`. A
// project that does not is the field's likeliest state, and the answer must be
// *unavailable* rather than a resume that silently does nothing.
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readResumeAvailability } from '../../src/server/resume.js';
import { parseManifest } from '../../src/server/registry.js';
import { projectSlug } from '../../src/server/transcript.js';
import { rmTree } from '../helpers.mjs';

const SESSION = '3f7a1c88-2b4e-4d61-9a03-5e7c8f1b2d64';

let home = '';
let worktree = '';

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resume-home-'));
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-resume-wt-'));
});
afterEach(() => {
  for (const d of [home, worktree]) rmTree(d);
});

/** Write the transcript the runtime would leave for `id` in this worktree. */
function writeTranscript(id: string): string {
  const dir = path.join(home, '.claude', 'projects', projectSlug(worktree));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' } })}\n`);
  return file;
}

describe('readResumeAvailability', () => {
  it('is available when the runtime wrote a transcript under the asserted id', () => {
    writeTranscript(SESSION);
    const actual = readResumeAvailability({ resumeId: SESSION, worktree }, home);
    assert.deepEqual(actual, { available: true, resumeId: SESSION });
  });

  // THE FIELD CASE. The prompt file ran `claude -p "…"` with no `--session-id`,
  // so the runtime chose its own id and Plot's names no file. Resume must report
  // itself unavailable — the caller then starts a fresh worker with the gate
  // failures in its brief.
  it('is unavailable when the prompt file did not pass --session-id', () => {
    // The runtime wrote a transcript, under an id of its own choosing.
    writeTranscript('a0000000-0000-4000-8000-000000000000');
    const actual = readResumeAvailability({ resumeId: SESSION, worktree }, home);
    assert.equal(actual.available, false);
    assert.equal(actual.available === false && actual.why, 'no-transcript');
  });

  // A NEWER TRANSCRIPT IS NOT THIS AGENT'S. `transcriptFile` falls back to the
  // newest file only when it has NO session id; with one it joins on exact
  // string equality. The distinction matters here because a fallback would make
  // resume look available for an id the runtime never saw.
  it('does not fall back to the newest transcript in the directory', () => {
    writeTranscript('b0000000-0000-4000-8000-000000000000');
    writeTranscript('c0000000-0000-4000-8000-000000000000');
    const actual = readResumeAvailability({ resumeId: SESSION, worktree }, home);
    assert.equal(actual.available, false);
  });

  it('is unavailable when the manifest carries no handle', () => {
    writeTranscript(SESSION);
    const actual = readResumeAvailability({ resumeId: '', worktree }, home);
    assert.equal(actual.available, false);
    assert.equal(actual.available === false && actual.why, 'no-id');
  });

  // A SYNTHESIZED ENTRY — a worktree no manifest names — has no worktree-keyed
  // transcript to find because it was never handed an id. Unavailable, and not
  // a throw.
  it('is unavailable when no worktree is recorded', () => {
    const actual = readResumeAvailability({ resumeId: SESSION, worktree: '' }, home);
    assert.equal(actual.available, false);
    assert.equal(actual.available === false && actual.why, 'no-transcript');
  });

  it('reads a missing transcript directory as no transcript', () => {
    const actual = readResumeAvailability(
      { resumeId: SESSION, worktree: path.join(worktree, 'nowhere') },
      home,
    );
    assert.equal(actual.available, false);
  });
});

describe('parseManifest: the resume handle and the attempt count', () => {
  // TWO FIELDS, NOT ONE. A dispatch writes the same value into both, and the
  // parse must not treat that as licence to derive one from the other: the
  // session is the transcript join key and stays fixed across a branch hop,
  // while the resume handle has its own lifetime.
  it('reads resumeId and session as separate fields', () => {
    const entry = parseManifest(
      JSON.stringify({ session: SESSION, resumeId: 'a-different-handle', attempts: 2 }),
    );
    assert.ok(entry);
    assert.equal(entry.session, SESSION);
    assert.equal(entry.resumeId, 'a-different-handle');
    assert.equal(entry.attempts, 2);
  });

  // An older manifest asserted no handle. Filling one in from `session` would
  // invent a claim the file never made, and `readResumeAvailability` would then
  // go looking for a transcript on the strength of it.
  it('does not default resumeId to the session id', () => {
    const entry = parseManifest(JSON.stringify({ session: SESSION }));
    assert.ok(entry);
    assert.equal(entry.resumeId, '');
    assert.equal(entry.attempts, 0);
  });

  it('reads junk in attempts as none rather than carrying it into a bound', () => {
    for (const attempts of [-1, 1.5, '3', null]) {
      const entry = parseManifest(JSON.stringify({ session: SESSION, attempts }));
      assert.ok(entry);
      assert.equal(entry.attempts, 0, `attempts: ${JSON.stringify(attempts)}`);
    }
  });
});
