// Reading the session transcript — and, above all, NOT reading it.
//
// THE WAVE'S MAIN RISK IS ASSERTED HERE. The transcript is a private format
// belonging to the runtime, and the plan accepts that a change to it makes the
// panel show less. What must never happen is the other failure: a field read
// from somewhere it no longer means what it did, rendered as fact. So every
// malformed shape below has the same expected outcome — absence — and the
// positive case is asserted against the field paths as MEASURED, so a silent
// mis-read cannot pass.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  projectSlug,
  readTranscriptFacts,
  transcriptDir,
  transcriptFacts,
  transcriptFile,
} from '../../src/server/transcript.js';
import { rmTree } from '../helpers.mjs';

/** An assistant line shaped exactly as the runtime writes one. */
function assistantLine(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-19T08:23:10.298Z',
    sessionId: 'sess-1',
    version: '2.1.235',
    gitBranch: 'feature/x',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      usage: { cache_read_input_tokens: 103_619, output_tokens: 175 },
    },
    ...over,
  });
}

function withFile(contents: string, run: (file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-transcript-'));
  const file = path.join(dir, 'sess-1.jsonl');
  fs.writeFileSync(file, contents);
  try {
    run(file);
  } finally {
    rmTree(dir);
  }
}

describe('the path derivation', () => {
  it('replaces both slashes and dots — measured against a real worktree', () => {
    // The dots matter: worktree directories routinely contain them, and a slug
    // that kept them would point at a directory that does not exist — which,
    // because absence is silent here, would look exactly like a format change.
    assert.equal(
      projectSlug('/Users/j/Quatico/plot-wt-feature.x'),
      '-Users-j-Quatico-plot-wt-feature-x',
    );
  });

  it('puts the directory under <home>/.claude/projects', () => {
    assert.equal(
      transcriptDir('/tmp/wt', '/home/u'),
      path.join('/home/u', '.claude', 'projects', '-tmp-wt'),
    );
  });
});

describe('reading the last assistant turn', () => {
  it('reads model, context and last activity from the paths the runtime uses', () => {
    // The POSITIVE half of the wave's risk. `model` and `usage` are nested
    // under `message`; `timestamp` is top-level. Measured 2026-08-19 — the
    // plan's own summary put `model` at the top level, and reading it there
    // yields undefined on every line while raising no error at all.
    withFile(`${assistantLine()}\n`, (file) => {
      const facts = readTranscriptFacts(file);
      assert.equal(facts.model, 'claude-opus-5');
      assert.equal(facts.contextTokens, 103_619);
      assert.equal(facts.lastActivity, '2026-08-19T08:23:10.298Z');
    });
  });

  it('takes the LAST assistant turn, not the first', () => {
    const older = assistantLine({
      timestamp: '2026-08-19T07:00:00.000Z',
      message: { model: 'claude-haiku-4-5-20251001', usage: { cache_read_input_tokens: 10 } },
    });
    withFile(`${older}\n${assistantLine()}\n`, (file) => {
      const facts = readTranscriptFacts(file);
      assert.equal(facts.model, 'claude-opus-5', 'the current turn, not a superseded one');
      assert.equal(facts.contextTokens, 103_619);
    });
  });

  it('ignores user lines between assistant turns', () => {
    const user = JSON.stringify({ type: 'user', timestamp: '2026-08-19T09:00:00.000Z' });
    withFile(`${assistantLine()}\n${user}\n`, (file) => {
      assert.equal(readTranscriptFacts(file).model, 'claude-opus-5');
    });
  });

  it('ignores a subagent turn — it describes the wrong process', () => {
    // A sidechain's model and context are true statements about a helper the
    // worker spawned, not about the worker. Reporting them would be a wrong
    // answer delivered confidently, which is the one outcome this module rules
    // out everywhere else.
    const sidechain = assistantLine({
      isSidechain: true,
      message: { model: 'claude-haiku-4-5-20251001', usage: { cache_read_input_tokens: 7 } },
    });
    withFile(`${assistantLine()}\n${sidechain}\n`, (file) => {
      const facts = readTranscriptFacts(file);
      assert.equal(facts.model, 'claude-opus-5');
      assert.equal(facts.contextTokens, 103_619);
    });
  });
});

// THE OMISSION RULE, in every direction a private format can break.
//
// Each case below is a shape the runtime could plausibly start writing. None
// may throw, and none may produce a value: the panel's whole answer to an
// unrecognised transcript is to show less.
describe('an unreadable or unrecognised transcript omits rather than guesses', () => {
  const cases: [string, string][] = [
    ['a file that is not JSON at all', 'this is not json\nnor is this\n'],
    ['an empty file', ''],
    ['only whitespace', '\n\n  \n'],
    [
      'model moved back to the top level',
      JSON.stringify({ type: 'assistant', model: 'claude-opus-5', message: { role: 'assistant' } }),
    ],
    [
      'message is a string rather than an object',
      JSON.stringify({ type: 'assistant', message: 'hello' }),
    ],
    ['message absent entirely', JSON.stringify({ type: 'assistant' })],
    [
      'model is a number',
      JSON.stringify({ type: 'assistant', message: { model: 5 } }),
    ],
    [
      'model is an empty string',
      JSON.stringify({ type: 'assistant', message: { model: '' } }),
    ],
    [
      'no assistant line in the file',
      `${JSON.stringify({ type: 'user', message: { model: 'claude-opus-5' } })}\n`,
    ],
    ['a JSON array rather than an object', '[1,2,3]\n'],
    ['a bare null', 'null\n'],
  ];

  for (const [name, contents] of cases) {
    it(`omits every field when ${name}`, () => {
      withFile(contents, (file) => {
        const facts = readTranscriptFacts(file);
        assert.equal(facts.model, undefined, 'no model may be invented');
        assert.equal(facts.contextTokens, undefined, 'no context may be invented');
        assert.equal(facts.lastActivity, undefined, 'no activity may be invented');
      });
    });
  }

  it('omits context but keeps model when only usage moved', () => {
    // Fields omit INDEPENDENTLY. A format that relocated `usage` and kept
    // `model` should still show the model — all-or-nothing would discard a
    // readable fact for no reason.
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-19T08:23:10.298Z',
      message: { model: 'claude-opus-5' },
    });
    withFile(`${line}\n`, (file) => {
      const facts = readTranscriptFacts(file);
      assert.equal(facts.model, 'claude-opus-5');
      assert.equal(facts.contextTokens, undefined);
    });
  });

  it('omits a non-finite token count rather than rendering NaN', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { cache_read_input_tokens: 'lots' } },
    });
    withFile(`${line}\n`, (file) => {
      assert.equal(readTranscriptFacts(file).contextTokens, undefined);
    });
  });

  it('does not fall back to an OLDER turn when the newest is unrecognised', () => {
    // The subtle one. Scanning past an unreadable current turn to a readable
    // older one would report a superseded model as the agent's current one —
    // the stale-value failure, reached by trying harder. The first assistant
    // line from the end IS the answer, even when it yields nothing.
    const readable = assistantLine();
    const broken = JSON.stringify({ type: 'assistant', message: 'moved' });
    withFile(`${readable}\n${broken}\n`, (file) => {
      assert.equal(readTranscriptFacts(file).model, undefined);
    });
  });

  it('returns {} for a file that does not exist', () => {
    assert.deepEqual(readTranscriptFacts('/nonexistent/nope.jsonl'), {});
  });

  it('returns {} for a directory handed in as a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-transcript-dir-'));
    try {
      assert.deepEqual(readTranscriptFacts(dir), {});
    } finally {
      rmTree(dir);
    }
  });

  it('returns {} when no transcript directory exists for the worktree', () => {
    assert.deepEqual(transcriptFacts('/tmp/no-such-worktree', { home: '/tmp/no-such-home' }), {});
  });
});

describe('choosing which transcript to read', () => {
  function makeDir(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tdir-'));
    let t = Date.now() - 60_000;
    for (const [name, body] of Object.entries(files)) {
      const f = path.join(dir, name);
      fs.writeFileSync(f, body);
      // Explicit, increasing mtimes — a test that relied on write order would
      // race the filesystem's timestamp granularity.
      t += 10_000;
      fs.utimesSync(f, t / 1000, t / 1000);
    }
    return dir;
  }

  it('prefers the exact session id when one is known', () => {
    const dir = makeDir({ 'old.jsonl': '', 'sess-9.jsonl': '' });
    try {
      assert.equal(transcriptFile(dir, 'sess-9'), path.join(dir, 'sess-9.jsonl'));
    } finally {
      rmTree(dir);
    }
  });

  it('returns null for a session id with no file, rather than falling back', () => {
    // A named session that is absent is a specific miss. Falling back to "some
    // other transcript" would answer about a different agent.
    const dir = makeDir({ 'other.jsonl': '' });
    try {
      assert.equal(transcriptFile(dir, 'sess-missing'), null);
    } finally {
      rmTree(dir);
    }
  });

  it('skips agent-*.jsonl sidechains when picking the newest', () => {
    // Measured: a worktree holds eleven of these beside the session's own
    // transcript, and they are routinely the newest files in the directory.
    const dir = makeDir({ 'sess-1.jsonl': '', 'agent-abc.jsonl': '' });
    try {
      assert.equal(transcriptFile(dir, undefined), path.join(dir, 'sess-1.jsonl'));
    } finally {
      rmTree(dir);
    }
  });

  it('returns null for a directory holding only sidechains', () => {
    const dir = makeDir({ 'agent-abc.jsonl': '' });
    try {
      assert.equal(transcriptFile(dir, undefined), null);
    } finally {
      rmTree(dir);
    }
  });
});
