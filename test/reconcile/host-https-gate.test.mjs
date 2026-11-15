// Contract test for scripts/check-host-https-callers.sh: the gate that keeps
// packages/domain/src/adapters/host/ the one place that opens an HTTPS
// connection to a git host.
//
// Each pattern is refused once, in a fixture tree, at the path production
// code lives; the exemptions and comment lines pass; and the gate passes on
// this repository's own tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const gate = path.join(repoRoot, 'scripts', 'check-host-https-callers.sh');

const run = (root) => spawnSync('bash', [gate, root], { encoding: 'utf8' });

/** A throwaway tree holding the given files, keyed by relative path. */
const treeWith = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-hosthttps-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
};

const VIOLATIONS = {
  'node:https': "import https from 'node:https';\n",
  undici: "import { request } from 'undici';\n",
  'api.github.com': "const base = 'https://api.github.com';\n",
  GITHUB_API_URL: 'const base = process.env.GITHUB_API_URL;\n',
  'fetch(': "const answer = await fetch('https://example.test/x');\n",
  'api.bitbucket.org': "const base = 'https://api.bitbucket.org/2.0';\n",
  BITBUCKET_API_BASE: 'const base = process.env.BITBUCKET_API_BASE;\n',
};

for (const [pattern, body] of Object.entries(VIOLATIONS)) {
  test(`host HTTPS gate: refuses ${pattern} outside adapters/host/`, () => {
    const dir = treeWith({ 'packages/fleet/src/shared/reach.ts': `// a reader\n${body}` });
    try {
      const got = run(dir);
      assert.equal(got.status, 1, `${pattern} must fail the build:\n${got.stdout}`);
      assert.match(got.stdout, /packages\/fleet\/src\/shared\/reach\.ts:2:/, `and name the line:\n${got.stdout}`);
      assert.match(got.stdout, /github-api\.ts/, `and name the client to use:\n${got.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('host HTTPS gate: refuses a shipped script outside the named exceptions', () => {
  const dir = treeWith({ 'skills/plot/scripts/plot-reach.mjs': "const r = await fetch('https://api.github.com/user');\n" });
  try {
    const got = run(dir);
    assert.equal(got.status, 1, got.stdout);
    assert.match(got.stdout, /skills\/plot\/scripts\/plot-reach\.mjs:1:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('host HTTPS gate: passes the client, the exemptions, member calls, longer names and comments', () => {
  const dir = treeWith({
    'packages/domain/src/adapters/host/github-api.ts': "import https from 'node:https';\nconst base = 'https://api.github.com';\n",
    'packages/domain/src/adapters/host/bitbucket-api.ts': "const base = process.env.BITBUCKET_API_BASE || 'https://api.bitbucket.org/2.0';\n",
    'packages/board/src/app/api.ts': "const r = await fetch('/api/board');\n",
    'packages/domain/src/ports/trees.ts': '  fetch(path: string, branch: string): Promise<void>;\n',
    'packages/fleet/src/shared/trees.ts': "await trees.fetch('a', 'b');\nconst refetch = prefetch(x);\nconst a = do_fetch(1);\n",
    'packages/fleet/src/shared/notes.ts': '// GITHUB_API_URL names the base\n * fetch( is a comment\n',
    'skills/plot/scripts/plot-github-app.mjs': "const res = await fetch(`${api}/x`);\n",
    'skills/plot/scripts/plot-bitbucket-commit-status.mjs': 'response = await fetch(url, {});\n',
    'skills/plot/scripts/board/bundle.mjs': "await fetch('https://api.github.com');\n",
  });
  try {
    const got = run(dir);
    assert.equal(got.status, 0, `the exemptions must pass:\n${got.stdout}`);
    assert.match(got.stdout, /exempted paths: 7/, got.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('host HTTPS gate: passes on this repository', () => {
  const got = run(repoRoot);
  assert.equal(got.status, 0, `the repository must pass its own gate:\n${got.stdout}`);
  assert.match(got.stdout, /Host HTTPS callers: clean\./);
});
