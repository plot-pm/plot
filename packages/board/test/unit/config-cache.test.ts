import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, resetConfigCache } from '../../src/server/board.js';

/**
 * The config lookup is cached, and the cache must never outlive an edit.
 *
 * ## Why it caches at all, measured 2026-08-31
 *
 * A miss spawns `bash plot-config.sh` SYNCHRONOUSLY. A `sample` of a wedged
 * board caught `node::SyncProcessRunner::Spawn` on the main thread inside
 * `on_headers_complete` — 4258 of 4262 samples — while a static file timed out
 * at 15 s beside it. One spawn measured 58 ms and `buildBoard` calls this five
 * times per request.
 *
 * ## What these tests are actually for
 *
 * A cache that is merely fast is easy; a cache that is fast AND correct is the
 * claim. Every test below is one an implementation that cached too eagerly
 * would fail: the config edited between reads, a repo with only AGENTS.md, two
 * callers asking one key with different defaults, and a repo whose config
 * cannot be read at all.
 */

const CONFIG = `# Repo

## Plot Config

- **Plan directory:** docs/plans/
- **Sprint directory:** docs/sprints/
`;

let repo: string;
const SCRIPTS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../skills/plot/scripts',
);

const opts = (repoRoot: string) =>
  ({ repoRoot, scriptsDir: SCRIPTS }) as unknown as Parameters<typeof readConfig>[0];

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-cache-'));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), CONFIG, 'utf8');
  resetConfigCache();
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
  resetConfigCache();
});

describe('the cached lookup answers what the file says', () => {
  it('reads a declared key', () => {
    expect(readConfig(opts(repo), 'Plan directory', 'fallback/')).toBe('docs/plans/');
  });

  it('answers the fallback for a key the file does not declare', () => {
    expect(readConfig(opts(repo), 'Nonexistent key', 'the-default')).toBe('the-default');
  });

  it('gives the same answer twice', () => {
    const first = readConfig(opts(repo), 'Plan directory', 'x');
    const second = readConfig(opts(repo), 'Plan directory', 'x');
    expect(second).toBe(first);
  });
});

describe('the cache invalidates on an EDIT, not on a clock', () => {
  it('sees a value changed between two reads', () => {
    // THE TEST THIS CACHE EXISTS TO SURVIVE. An operator edits `## Plot Config`
    // and reloads the board; a TTL would answer "was it recent?" when the
    // question is "did it change?", and serve the old value until it expired.
    expect(readConfig(opts(repo), 'Plan directory', 'x')).toBe('docs/plans/');

    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      CONFIG.replace('docs/plans/', 'planning/'),
      'utf8',
    );
    // mtime resolution is coarse enough that a same-millisecond rewrite can
    // look unchanged; stamp the file forward rather than sleep for it.
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(repo, 'CLAUDE.md'), later, later);

    expect(readConfig(opts(repo), 'Plan directory', 'x')).toBe('planning/');
  });

  it('drops EVERY key when the file changes, not only the one asked for', () => {
    // The stamp keys the whole map. A per-key invalidation would leave a
    // second key answering from before the edit, which is the shape where a
    // config change appears to half-apply.
    readConfig(opts(repo), 'Plan directory', 'x');
    readConfig(opts(repo), 'Sprint directory', 'y');

    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      CONFIG.replace('docs/sprints/', 'cycles/'),
      'utf8',
    );
    const later = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(repo, 'CLAUDE.md'), later, later);

    expect(readConfig(opts(repo), 'Sprint directory', 'y')).toBe('cycles/');
  });
});

describe('the cache keys on the fallback too', () => {
  it('does not hand one caller another caller default', () => {
    // `plot-config.sh` returns the FALLBACK for an absent key, so the answer
    // depends on who asked. Keying on the key alone would let the first
    // caller's default become every later caller's answer.
    expect(readConfig(opts(repo), 'Absent key', 'first-default')).toBe('first-default');
    expect(readConfig(opts(repo), 'Absent key', 'second-default')).toBe('second-default');
  });
});

describe('it degrades to today behaviour rather than caching a guess', () => {
  it('still answers when neither config file exists', () => {
    // The stamp is empty, so nothing is cached and every lookup spawns — which
    // is exactly what happened before this cache existed. Failing toward the
    // slow, correct path is the choice `plot-estate-changed.sh` makes too.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-bare-'));
    try {
      expect(readConfig(opts(bare), 'Plan directory', 'the-default')).toBe('the-default');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('reads AGENTS.md when CLAUDE.md is absent', () => {
    // Both files are in the stamp, so a repo carrying only the modern one must
    // still produce a stable key rather than reading as unstampable.
    const modern = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-agents-'));
    try {
      fs.writeFileSync(path.join(modern, 'AGENTS.md'), CONFIG, 'utf8');
      expect(readConfig(opts(modern), 'Plan directory', 'x')).toBe('docs/plans/');
    } finally {
      fs.rmSync(modern, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('does not leak one repo answers into another', () => {
    // Two repos, two configs, one process. The stamp differs, so the second
    // repo's read must not be served from the first repo's map — the board
    // serves one repo, but a test suite and a future multi-repo caller do not.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-config-other-'));
    try {
      fs.writeFileSync(
        path.join(other, 'CLAUDE.md'),
        CONFIG.replace('docs/plans/', 'elsewhere/'),
        'utf8',
      );
      // FORCE THE MTIMES EQUAL, which is what CI produces by accident: two
      // temp repos created in the same millisecond carry the same stamp. This
      // failed on CI and passed locally until the repo path joined the key —
      // so the test now creates the condition rather than hoping for it.
      const same = new Date(1_700_000_000_000);
      fs.utimesSync(path.join(repo, 'CLAUDE.md'), same, same);
      fs.utimesSync(path.join(other, 'CLAUDE.md'), same, same);

      expect(readConfig(opts(repo), 'Plan directory', 'x')).toBe('docs/plans/');
      expect(readConfig(opts(other), 'Plan directory', 'x')).toBe('elsewhere/');
    } finally {
      fs.rmSync(other, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
