// Contract test for PROCESS-OWNED LOG ROTATION — `registryd.log` and
// `board.log`.
//
// WHY THE WRITER ROTATES, and why an external rotator cannot. launchd opens
// `registryd.log` through the unit's `StandardOutPath`, `plot-boardctl.sh` opens
// `board.log` with `>>`, and a hand-started `nohup … >> registryd.log` loop
// exists too. A writer that inherited its descriptor FOLLOWS THE INODE across a
// rename and never creates the new name — so `newsyslog`, `logrotate` and a
// person's `mv` all leave the process writing into the renamed file. Measured
// 2026-09-30: `registryd.log` reached 131 MB in 13 days and a person rotated it
// by hand, after which the daemon kept filling the renamed file.
//
// BOTH WRITER SHAPES ARE COVERED, and that is the point of this file. With only
// one, the inherited-descriptor defect goes unseen:
//
// 1. a **unit-shaped redirect**, where stdout is an inherited `>>` descriptor on
//    the very file the writer owns — launchd's shape and `plot-boardctl.sh`'s;
// 2. a **hand start**, where stdout is a pipe and the writer opens the file
//    itself.
//
// The bound is on BYTES, not ticks or days: tick size ranged from 290 bytes to
// 10 KB with the estate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const artifact = path.join(root, 'skills', 'plot', 'scripts', 'board', 'plot-registryd.mjs');

/** A sandbox nothing else writes to. */
function sandbox() {
  return mkdtempSync(path.join(tmpdir(), 'plot-log-rot-'));
}

/**
 * The rotating writer, driven directly out of the built artifact's own source.
 *
 * DRIVEN THROUGH `node -e` AGAINST THE SOURCE MODULE rather than by starting a
 * daemon: a test that ran `registryd` would be measuring a supervisor's tick,
 * and what is asserted here is the WRITER. The daemon's own wiring is asserted
 * by the unit test beside it.
 */
function driver(script) {
  const res = spawnSync(
    'node',
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script],
    { encoding: 'utf8', cwd: root },
  );
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** How many bytes a file holds; a missing file holds none. */
function size(file) {
  return existsSync(file) ? statSync(file).size : 0;
}

const MODULE = path
  .join(root, 'packages', 'board', 'src', 'server', 'process-log.ts')
  .replace(/\\/g, '/');

test('log-rotation: the writer rotates at the bound and keeps three files', () => {
  // THE WHOLE CONTRACT IN ONE ASSERTION SET: at the bound the live file is
  // renamed to `.1`, older files shift up to `.3`, and the fourth is deleted.
  const dir = sandbox();
  const log = path.join(dir, 'registryd.log');

  const res = driver(`
    import { processLog } from '${MODULE}';
    const log = processLog('${log.replace(/\\/g, '/')}', { maxBytes: 200, kept: 3 });
    // Each line is 50 bytes, so every fourth write crosses the 200-byte bound.
    for (let i = 0; i < 40; i += 1) log.write('x'.repeat(49) + '\\n');
    log.close();
  `);
  assert.equal(res.code, 0, res.stderr);

  assert.ok(existsSync(log), 'the live log was not reopened after a rotation');
  assert.ok(existsSync(`${log}.1`), 'no generation was kept');
  assert.ok(existsSync(`${log}.2`), 'the second generation was not kept');
  assert.ok(existsSync(`${log}.3`), 'the third generation was not kept');
  // THE FOURTH IS DELETED, which is the bound: three generations plus the live
  // file, against the 131 MB one unrotated file reached.
  assert.equal(existsSync(`${log}.4`), false, 'a fourth generation was kept');

  // AND EVERY KEPT FILE IS AT OR UNDER THE BOUND, which is what makes the total
  // bounded rather than merely renamed.
  for (const file of [log, `${log}.1`, `${log}.2`, `${log}.3`]) {
    assert.ok(size(file) <= 250, `${path.basename(file)} is ${size(file)} bytes, over the bound`);
  }
});

test('log-rotation: a writer under a unit-shaped redirect rotates its own file', () => {
  // SHAPE ONE: stdout is an INHERITED `>>` descriptor on the very file the
  // writer owns — launchd's shape, and `plot-boardctl.sh`'s. This is the shape
  // an external rotator cannot serve, because the inherited descriptor follows
  // the inode across the rename.
  //
  // The assertion is that rotation still happens and the live file exists again
  // afterwards: a writer that merely wrote to its inherited stdout would leave
  // ONE file growing past the bound and no `.1` at all.
  const dir = sandbox();
  const log = path.join(dir, 'board.log');

  const res = spawnSync(
    'bash',
    [
      '-c',
      `node --experimental-strip-types --no-warnings --input-type=module -e "
        import { processLog } from '${MODULE}';
        const log = processLog('${log.replace(/\\/g, '/')}', { maxBytes: 200, kept: 3 });
        for (let i = 0; i < 20; i += 1) log.write('y'.repeat(49) + '\\\\n');
        log.close();
      " >> "${log}" 2>&1`,
    ],
    { encoding: 'utf8', cwd: root },
  );
  assert.equal(res.status, 0, res.stderr);

  assert.ok(existsSync(log), 'the live log is missing after rotation');
  assert.ok(existsSync(`${log}.1`), 'the writer did not rotate under an inherited descriptor');
  assert.ok(
    size(log) <= 250,
    `the live log is ${size(log)} bytes — the writer followed the inode instead of reopening`,
  );
});

test('log-rotation: a hand-started writer rotates its own file', () => {
  // SHAPE TWO: stdout is a PIPE and the writer opens the file itself — the
  // `nohup bash -c 'while true; do node … ' ` loop in the operator's history.
  const dir = sandbox();
  const log = path.join(dir, 'registryd.log');

  const res = driver(`
    import { processLog } from '${MODULE}';
    const log = processLog('${log.replace(/\\/g, '/')}', { maxBytes: 200, kept: 3 });
    for (let i = 0; i < 20; i += 1) log.write('z'.repeat(49) + '\\n');
    log.close();
  `);
  assert.equal(res.code, 0, res.stderr);

  assert.ok(existsSync(`${log}.1`), 'a hand-started writer did not rotate');
  assert.ok(size(log) <= 250, `the live log is ${size(log)} bytes, over the bound`);
});

test('log-rotation: no line is lost across a rotation', () => {
  // A ROTATION THAT DROPPED LINES would bound the file by losing the log, which
  // is what the size bound must not buy. Every line written is present across
  // the live file and its generations.
  const dir = sandbox();
  const log = path.join(dir, 'registryd.log');

  const res = driver(`
    import { processLog } from '${MODULE}';
    const log = processLog('${log.replace(/\\/g, '/')}', { maxBytes: 200, kept: 3 });
    for (let i = 0; i < 12; i += 1) log.write(String(i).padStart(49, '.') + '\\n');
    log.close();
  `);
  assert.equal(res.code, 0, res.stderr);

  const seen = [log, `${log}.1`, `${log}.2`, `${log}.3`]
    .filter((file) => existsSync(file))
    .flatMap((file) => readFileSync(file, 'utf8').split('\n'))
    .filter((line) => line !== '')
    .map((line) => Number(line.replace(/^\.+/, '')));

  for (let i = 0; i < 12; i += 1) {
    assert.ok(seen.includes(i), `line ${i} was lost across a rotation`);
  }
});

test('log-rotation: an inherited descriptor past the bound is truncated at start', () => {
  // SAFE ONLY BECAUSE EVERY OPENER USES `O_APPEND`, measured with `lsof +fg` on
  // all four live descriptors. An `O_APPEND` writer re-seeks to the end on every
  // write, so a truncated file is simply short; under a plain `>` writer the
  // offset survives and the next write leaves a hole of NUL bytes — 415 of them,
  // measured in round 2.
  const dir = sandbox();
  const inherited = path.join(dir, 'registryd.err');
  writeFileSync(inherited, 'o'.repeat(5000));

  const res = spawnSync(
    'bash',
    [
      '-c',
      `node --experimental-strip-types --no-warnings --input-type=module -e "
        import { truncateInherited } from '${MODULE}';
        truncateInherited(1, 1000);
      " >> "${inherited}"`,
    ],
    { encoding: 'utf8', cwd: root },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.ok(size(inherited) < 5000, 'an oversized inherited descriptor was not truncated');

  // AND NO HOLE OF NUL BYTES, which is what a truncate under a non-append writer
  // leaves behind.
  const text = readFileSync(inherited, 'utf8');
  assert.equal(text.includes(' '), false, 'the truncate left a hole of NUL bytes');
});

test('log-rotation: an inherited descriptor under the bound is left alone', () => {
  // IT TRUNCATES AT THE BOUND AND NOT AT START. The unit keeps
  // `StandardOutPath` and `StandardErrorPath` precisely because they catch what
  // is printed before the writer opens, and a start that always emptied them
  // would throw that away.
  const dir = sandbox();
  const inherited = path.join(dir, 'registryd.err');
  writeFileSync(inherited, 'kept\n');

  const res = spawnSync(
    'bash',
    [
      '-c',
      `node --experimental-strip-types --no-warnings --input-type=module -e "
        import { truncateInherited } from '${MODULE}';
        truncateInherited(1, 1000);
      " >> "${inherited}"`,
    ],
    { encoding: 'utf8', cwd: root },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(readFileSync(inherited, 'utf8'), /kept/, 'a small inherited log was emptied');
});

test('log-rotation: a pipe is never truncated', () => {
  // ONLY A REGULAR FILE HAS A SIZE THIS BOUND DESCRIBES. Truncating a pipe or a
  // terminal is meaningless, and attempting it must not end the process.
  const res = driver(`
    import { truncateInherited } from '${MODULE}';
    truncateInherited(1, 1);
    process.stderr.write('survived\\n');
  `);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stderr, /survived/, 'truncating a pipe ended the process');
});

test('log-rotation: the daemon and the board both open their own log', () => {
  // THE WIRING, asserted on the source rather than by starting either process.
  // A rotating writer nothing calls bounds nothing — measured across this
  // estate repeatedly, a rule with no caller is the defect this slice's plan
  // names in its own motivation.
  const registryd = readFileSync(
    path.join(root, 'packages', 'board', 'src', 'server', 'entry', 'registryd-main.ts'),
    'utf8',
  );
  assert.match(registryd, /processLog\(/, 'registryd does not open its own log');
  assert.match(registryd, /truncateInherited\(1\)/, 'registryd does not truncate inherited stdout');
  assert.match(registryd, /truncateInherited\(2\)/, 'registryd does not truncate inherited stderr');
  assert.match(registryd, /registryd\.log/, 'registryd names no log file');
  assert.match(registryd, /registryd\.err/, 'registryd names no error file');

  const board = readFileSync(
    path.join(root, 'packages', 'board', 'src', 'server', 'index.ts'),
    'utf8',
  );
  assert.match(board, /processLog\(/, 'the board does not open its own log');
  assert.match(board, /board\.log/, 'the board names no log file');
  assert.match(board, /truncateInherited\(1\)/, 'the board does not truncate inherited stdout');
});

test('log-rotation: the built artifact carries the writer', () => {
  // THE ARTIFACT IS WHAT RUNS. A source change that never reached
  // `plot-registryd.mjs` leaves the daemon writing to an unbounded inherited
  // descriptor while every test above passes.
  assert.ok(existsSync(artifact), 'plot-registryd.mjs is not built');
  const built = readFileSync(artifact, 'utf8');
  assert.ok(
    built.includes('registryd.log') && built.includes('registryd.err'),
    'the built daemon names no log file — rebuild with pnpm build:board',
  );
});
