import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { notifierCommand, NOTIFY_MESSAGE_ENV } from '../src/adapters/notifier/notifier-command.js';

/**
 * `notifierCommand` against a stub command, run through `sh -c`. A message
 * holding shell metacharacters must run nothing.
 */

const dirs: string[] = [];

/** Builds a path to an executable script with the given body. */
const scriptThat = (body: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'plot-notifier-mock-'));
  dirs.push(root);
  const file = join(root, 'notify.sh');
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('notifierCommand', () => {
  it('answers ok on a zero exit', async () => {
    const command = scriptThat('exit 0');
    expect(await notifierCommand(command).notify('hello')).toEqual({ ok: true });
  });

  it('passes the message through the environment, not through argv or shell source', async () => {
    const outFile = join(mkdtempSync(join(tmpdir(), 'plot-notifier-out-')), 'captured.txt');
    dirs.push(dirname(outFile));
    const command = scriptThat(`printf '%s' "$${NOTIFY_MESSAGE_ENV}" > "${outFile}"`);
    await notifierCommand(command).notify('plain message');
    expect(readFileSync(outFile, 'utf8')).toBe('plain message');
  });

  it('runs nothing for a message holding shell metacharacters', async () => {
    const canary = join(mkdtempSync(join(tmpdir(), 'plot-notifier-canary-')), 'should-not-exist');
    dirs.push(dirname(canary));
    const outFile = `${canary}.out`;
    const command = scriptThat(`printf '%s' "$${NOTIFY_MESSAGE_ENV}" > "${outFile}"`);
    const malicious = `$(touch ${canary})\`touch ${canary}\`; touch ${canary}`;
    await notifierCommand(command).notify(malicious);
    expect(existsSync(canary)).toBe(false);
    // The bytes still arrive verbatim in the environment variable — only
    // interpretation as shell source is refused, not the message itself.
    expect(readFileSync(outFile, 'utf8')).toBe(malicious);
  });

  it('runs a command that carries arguments', async () => {
    const outFile = join(mkdtempSync(join(tmpdir(), 'plot-notifier-args-')), 'captured.txt');
    dirs.push(dirname(outFile));
    const command = scriptThat(`printf '%s|%s|%s' "$1" "$2" "$${NOTIFY_MESSAGE_ENV}" > "${outFile}"`);
    expect(await notifierCommand(`${command} -u critical`).notify('msg')).toEqual({ ok: true });
    expect(readFileSync(outFile, 'utf8')).toBe('-u|critical|msg');
  });

  it('answers failed with the exit code on a non-zero exit', async () => {
    const command = scriptThat('exit 7');
    expect(await notifierCommand(command).notify('x')).toEqual({
      ok: false,
      why: 'failed',
      code: 7,
    });
  });
});
