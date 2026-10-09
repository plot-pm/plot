// Contract test for scripts/check-temp-paths.sh — the gate that keeps every
// shipped script's temp path under TMPDIR through plot-tmp.sh, and that refuses
// a delete by glob in a shared temp directory.
//
// The glob fixtures exist because a naive gate passes the wrong ones: a gate
// that does not strip quotes fires on `rm -rf "$TMPDIR/tmp.*"`, where the `*` is
// literal, and misses the incident's own `"$(getconf …)"tmp.*`; one that does
// not join lines misses the continuation form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-temp-paths.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

const treeWith = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-tempgate-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
};

const script = (...lines) => ['#!/usr/bin/env bash', ...lines, ''].join('\n');

const refuses = (name, body, rule, rel = 'skills/plot/scripts/demo.sh') => {
  test(`temp-paths gate: refuses ${name}`, () => {
    const dir = treeWith({ [rel]: body });
    const got = run(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(got.status, 1, `must fail the build:\n${got.stdout}`);
    assert.match(got.stdout, new RegExp(`${path.basename(rel).replace('.', '\\.')}:\\d+: \\[${rule}\\]`),
      `and name the file, line and rule:\n${got.stdout}`);
  });
};

const passes = (name, body, rel = 'skills/plot/scripts/demo.sh') => {
  test(`temp-paths gate: passes ${name}`, () => {
    const dir = treeWith({ [rel]: body });
    const got = run(dir);
    rmSync(dir, { recursive: true, force: true });
    assert.equal(got.status, 0, `must pass:\n${got.stdout}`);
  });
};

refuses('a template-less mktemp', script('d=$(mktemp -d)'), 'mktemp');
refuses('a templated mktemp inside quotes', script('f="$(mktemp "${TMPDIR:-/tmp}/plot-x.XXXXXX")"'), 'mktemp');
refuses('a fixed /tmp path in a redirection', script('out=$(gh pr list 2>/tmp/plot-host-err.$$)'), 'tmp-literal');
refuses('a fixed /tmp path assigned first and written through later', script(
  'pr_list_call() {',
  '  local out rc err tmp="/tmp/plot-host-prlist-err.$$"',
  '  out="$("$@" 2>"$tmp")"',
  '}',
), 'tmp-literal');
refuses('the substitution form of the helper', script('d=$(plot_tmpdir x)'), 'substitution');
refuses('a raw EXIT trap', script("trap 'rm -rf \"$d\"' EXIT"), 'trap');
refuses('a raw TERM trap after &&', script('[ -n "$d" ] && trap cleanup INT TERM'), 'trap');
refuses('a trap on a continuation line', script('[ -n "$d" ] \\', "  && trap 'rm -rf \"$d\"' EXIT INT TERM"), 'trap');

refuses('rm -rf "$TMPDIR"/tmp.*', script('rm -rf "$TMPDIR"/tmp.*'), 'rm-glob');
refuses('the incident form, rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*',
  script('rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*'), 'rm-glob');
refuses('a glob rm continued onto the next line', script('rm -rf \\', '  "$TMPDIR"/tmp.*'), 'rm-glob');
refuses('an unquoted /tmp glob', script('rm -f /tmp/plot-*'), 'rm-glob', 'scripts/demo.sh');
refuses("find \"$TMPDIR\" -name 'tmp.*' -delete", script('find "$TMPDIR" -name \'tmp.*\' -delete'), 'find-delete');
refuses('find … -exec rm', script('find . -name x -exec rm {} \\;'), 'find-exec-rm', 'scripts/demo.sh');
refuses('xargs rm', script('printf "%s\\n" a b | xargs -n 1 rm -f'), 'xargs-rm');

passes('rm -rf "$TMPDIR/tmp.*", where the quoted * is literal', script('rm -rf "$TMPDIR/tmp.*"'));
passes('rm -rf "${TMPDIR:?}/plot-foo.$$"', script('rm -rf "${TMPDIR:?}/plot-foo.$$"'));
passes('an unquoted ${TMPDIR:?} guard', script('rm -rf ${TMPDIR:?}/plot-foo.$$'));
passes('the helper in its assignment form', script('plot_tmpdir d fleet-ref', 'plot_on_exit cleanup'));
passes('a comment naming mktemp, /tmp/ and trap EXIT', script('# was: d=$(mktemp -d); trap "rm -rf /tmp/x" EXIT'));
passes('an ALRM or ERR trap', script('trap _on_alarm ALRM', "trap 'exit 0' ERR"));
passes('a heredoc body that mentions the forbidden words', script(
  "cat <<'EOF'",
  "don't run: rm -rf /tmp/* ; trap x EXIT ; mktemp",
  'EOF',
));
passes('${TMPDIR:-/tmp} in a template the helper would build', script('echo "${TMPDIR:-/tmp}/plot-x"'));
passes('mktemp in scripts/, which is outside the mktemp rule', script('d=$(mktemp -d)'), 'scripts/demo.sh');
passes('mktemp inside plot-tmp.sh itself', script('x=$(mktemp -d "${TMPDIR:-/tmp}/plot-$2.XXXXXX")', 'trap _plot_tmp_on_exit EXIT'),
  'skills/plot/scripts/plot-tmp.sh');

// THE LIVE LIST IS EMPTY TODAY. It was one entry, `plot-reap.sh`'s own
// `/private/tmp` normalisation; `the-reaper-becomes-a-command` moved that
// logic into `packages/board/src/server/entry/reap.ts`, outside the trees
// this gate scans, and the shell file left behind carries no exception-worthy
// line at all. So these two tests — proving an exception can pass AND that a
// stale one is refused — run the gate's OWN body with the real `EXCEPTIONS`
// value spliced out and a constructed one substituted; the mechanism they
// prove does not depend on any exception currently being live.
const fixtureGateWith = (exceptions) => {
  const body = readFileSync(gate, 'utf8').replace(/^EXCEPTIONS='.*'$/m, `EXCEPTIONS='${exceptions}'`);
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-tempgate-fixture-'));
  const fixtureGate = path.join(dir, 'check-temp-paths.sh');
  writeFileSync(fixtureGate, body);
  return fixtureGate;
};

test('temp-paths gate: the named exception passes, and a stale one fails', () => {
  const fixtureGate = fixtureGateWith('skills/plot/scripts/plot-reap.sh\ttmp-literal\t/private/tmp/*|');
  const dir = treeWith({
    'skills/plot/scripts/plot-reap.sh': script('case "$p" in', '  /private/tmp/*|/private/var/*|/private/etc/*) p=${p#/private} ;;', 'esac'),
  });
  let got = spawnSync('bash', [fixtureGate, dir], { encoding: 'utf8' });
  assert.equal(got.status, 0, got.stdout);
  assert.match(got.stdout, /exception list: 1/);

  // THE EXCEPTION'S OWN LINE CHANGES, so the entry matches nothing and the gate
  // refuses it. This is the property that makes the list able only to shrink.
  writeFileSync(
    path.join(dir, 'skills/plot/scripts/plot-reap.sh'),
    script('case "$p" in', '  /var/*) p=${p} ;;', 'esac'),
  );
  got = spawnSync('bash', [fixtureGate, dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.dirname(fixtureGate), { recursive: true, force: true });
  assert.equal(got.status, 1, got.stdout);
  assert.match(got.stdout, /matches nothing; delete it/);
});

test('temp-paths gate: an exception covers only its own line', () => {
  const fixtureGate = fixtureGateWith('skills/plot/scripts/plot-reap.sh\ttmp-literal\t/private/tmp/*|');
  const dir = treeWith({
    'skills/plot/scripts/plot-reap.sh': script('case "$p" in', '  /private/tmp/*|/private/var/*) p=${p#/private} ;;', 'esac', 'echo x > /tmp/plot-reap.log'),
  });
  const got = spawnSync('bash', [fixtureGate, dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  rmSync(path.dirname(fixtureGate), { recursive: true, force: true });
  assert.equal(got.status, 1, got.stdout);
  assert.match(got.stdout, /plot-reap\.sh:5: \[tmp-literal\]/);
});

test('temp-paths gate: passes on the repository itself', () => {
  const got = run(repoRoot);
  assert.equal(got.status, 0, got.stdout + got.stderr);
  assert.match(got.stdout, /Temp paths: clean\./);
});

test('temp-paths gate: CI runs it beside the host CLI gate', () => {
  const ci = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /run: \.\/scripts\/check-temp-paths\.sh/);
});
