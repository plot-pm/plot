import { describe, it, expect } from 'vitest';

import {
  asJson,
  asJsonLines,
  asLines,
  asText,
  resultOf,
  runProcess,
  runScript,
  type ScriptRun,
} from '../src/adapters/run-script.js';

/**
 * The exit-code contract, asserted in the one place it is written.
 *
 * Every other adapter delegates here, so these assertions are what stop exit 3
 * and exit 4 from collapsing into each other — a collapse that turns a
 * permanent configuration fact into a transient incident.
 */

const run = (code: number, stdout = ''): ScriptRun => ({ code, stdout, stderr: '' });

describe('the exit code is the result type', () => {
  it('reads exit 0 as answered', () => {
    expect(resultOf(run(0, '7'), Number)).toEqual({ ok: true, value: 7 });
  });

  it('reads an empty payload on exit 0 as an answer', () => {
    // `NONE` is a payload. A branch with no PR and a host that could not be
    // asked are different facts, and only the second is a failure.
    expect(resultOf(run(0, ''), asLines)).toEqual({ ok: true, value: [] });
  });

  it('reads exit 1 as failed', () => {
    expect(resultOf(run(1), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 3 as failed — asked, and it broke', () => {
    expect(resultOf(run(3), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads exit 4 as unaskable — this source has no answer at all', () => {
    expect(resultOf(run(4), asText)).toEqual({ ok: false, why: 'unaskable' });
  });

  it('keeps 3 and 4 apart', () => {
    // The whole reason the mapping is written once. An expired token will
    // succeed once somebody logs in; a Bitbucket repo with no tracker never
    // will, and a caller told to retry it retries forever.
    expect(resultOf(run(3), asText)).not.toEqual(resultOf(run(4), asText));
  });

  it('reads an unrecognised exit code as failed, never as unaskable', () => {
    // Guessing `unaskable` would turn a broken call into a confident
    // "there is none" — wrong in the reassuring direction.
    expect(resultOf(run(2), asText)).toEqual({ ok: false, why: 'failed' });
    expect(resultOf(run(127), asText)).toEqual({ ok: false, why: 'failed' });
  });

  it('reads malformed output on exit 0 as failed, not unaskable', () => {
    // The script was asked and answered nonsense: that is a break, and a
    // caller must keep retrying it rather than give the source up.
    expect(resultOf(run(0, 'not json'), asJson)).toEqual({ ok: false, why: 'failed' });
  });
});

describe('a process reports its exit code rather than throwing', () => {
  it('answers a command that succeeded', async () => {
    const result = await runScript('bash', ['-c', 'echo hello'], asText);
    expect(result).toEqual({ ok: true, value: 'hello' });
  });

  it('does not reject when the command exits non-zero', async () => {
    // `execFile` rejects on ANY non-zero exit, which would deliver 1, 3 and 4
    // as one indistinguishable Error — the collapse above, arriving through
    // the runtime instead of through a copied line.
    await expect(runProcess('bash', ['-c', 'exit 4'])).resolves.toMatchObject({ code: 4 });
    await expect(runProcess('bash', ['-c', 'exit 3'])).resolves.toMatchObject({ code: 3 });
  });

  it('maps a real exit 4 through to unaskable', async () => {
    const result = await runScript('bash', ['-c', 'exit 4'], asText);
    expect(result).toEqual({ ok: false, why: 'unaskable' });
  });

  it('reports a command that could not be started as failed', async () => {
    const result = await runScript('plot-no-such-binary-xyz', [], asText);
    expect(result.ok).toBe(false);
  });

  it('keeps stderr apart from stdout', async () => {
    const finished = await runProcess('bash', ['-c', 'echo out; echo err >&2']);
    expect(finished.stdout.trim()).toBe('out');
    expect(finished.stderr.trim()).toBe('err');
  });
});

describe('the parsers read what the scripts print', () => {
  it('reads one JSON document', () => {
    expect(asJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON lines, ignoring blank ones', () => {
    expect(asJsonLines<{ n: number }>('{"n":1}\n\n{"n":2}\n')).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('reads plain lines, dropping empties', () => {
    expect(asLines('a\n\n b \n')).toEqual(['a', 'b']);
  });

  it('trims one line of text', () => {
    expect(asText('  main \n')).toBe('main');
  });
});
