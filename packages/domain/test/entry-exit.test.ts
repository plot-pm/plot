import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HELPER = new URL('../src/adapters/entry-exit.ts', import.meta.url).pathname;

/**
 * `endEntry` calls the real `process.exit`, so the only honest way to assert
 * its effect is to run it in a child process and read that child's own exit
 * code and output — asserting on a stub inside this process would never
 * observe a real process end.
 *
 * The script is written to a temp FILE rather than passed to `node -e`: a
 * large string literal through `-e` overflows Node's own parser stack before
 * the script ever runs.
 */
const scriptFile = (body: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'entry-exit-test-'));
  const file = path.join(dir, 'script.mjs');
  writeFileSync(file, `import { endEntry } from ${JSON.stringify(HELPER)};\n${body}`);
  return file;
};

const run = (body: string): { code: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [scriptFile(body)], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('endEntry', () => {
  it('calls process.exit with the given code only after both stream callbacks fire', () => {
    const { code, stderr } = run(`
      let stdoutDone = false;
      let stderrDone = false;
      const realStdoutWrite = process.stdout.write.bind(process.stdout);
      const realStderrWrite = process.stderr.write.bind(process.stderr);
      process.stdout.write = (chunk, cb) => realStdoutWrite(chunk, () => { stdoutDone = true; cb(); });
      process.stderr.write = (chunk, cb) => {
        setTimeout(() => { stderrDone = true; realStderrWrite(chunk, cb); }, 20);
        return true;
      };
      const realExit = process.exit.bind(process);
      process.exit = (exitCode) => {
        realStderrWrite(JSON.stringify({ stdoutDone, stderrDone, exitCode }) + '\\n');
        realExit(exitCode);
      };
      void endEntry(4);
    `);
    const lines = stderr.trim().split('\n');
    const reading = JSON.parse(lines[lines.length - 1]);
    expect(reading).toEqual({ stdoutDone: true, stderrDone: true, exitCode: 4 });
    expect(code).toBe(4);
  });

  it('exits with the given code at once on an EPIPE from stdout', () => {
    const { code } = run(`
      process.stdout.write = (_chunk, _cb) => {
        process.nextTick(() => process.stdout.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' })));
        return true;
      };
      void endEntry(4);
    `);
    expect(code).toBe(4);
  });

  it('exits with the given code at once on an EPIPE from stderr', () => {
    const { code } = run(`
      process.stderr.write = (_chunk, _cb) => {
        process.nextTick(() => process.stderr.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' })));
        return true;
      };
      void endEntry(4);
    `);
    expect(code).toBe(4);
  });

  it('ignores a non-EPIPE stream error and still exits once both callbacks fire', () => {
    const { code } = run(`
      const realWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (chunk, cb) => {
        process.stdout.emit('error', Object.assign(new Error('boom'), { code: 'EOTHER' }));
        return realWrite(chunk, cb);
      };
      void endEntry(0);
    `);
    expect(code).toBe(0);
  });

  it('never runs code after await endEntry(...)', () => {
    const { code, stdout } = run(`
      async function main() {
        await endEntry(3);
        process.stdout.write('unreachable');
        process.exit(9);
      }
      void main();
    `);
    expect(code).toBe(3);
    expect(stdout).toBe('');
  });

  it('delivers a large write queued before it to a real pipe before exiting', () => {
    const file = scriptFile(`
      process.stdout.write('x'.repeat(1_000_000));
      void endEntry(7);
    `);
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'ignore'] });
    let received = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      received += chunk.length;
    });
    return new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => {
        try {
          expect(received).toBe(1_000_000);
          expect(code).toBe(7);
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      });
    });
  });
});
