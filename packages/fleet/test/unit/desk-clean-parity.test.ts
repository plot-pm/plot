// The registry's cleanliness reading against the inline bash program it
// replaces. `INLINE_PROGRAM` is that program as `registry.ts` ran it until
// `desk-probes-in-domain`'s Registry slice, kept here verbatim so the
// comparison runs after the program left the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deskCleanliness } from '../../src/shared/registry.js';
import { removeTree } from '../rm-tree.mjs';

const INLINE_PROGRAM = `
    PLOT_WORKER_RECORD='\\.plot-worker\\.'
    PLOT_EDITOR_LEFTOVER='\\.(tmp[0-9]*|swp|orig|rej|bak)$'
    PLOT_TOOL_SCRATCH='(^|/)\\.(playwright-mcp|plot/agents|plot/state|omc/state)(/|$)'
    for wt in "$@"; do
      if [ ! -d "$wt" ]; then
        printf 'dirty\\0'
        continue
      fi
      # Check uncommitted changes (with exclusions)
      status=$(git -C "$wt" status --porcelain 2>/dev/null || echo "")
      build="$wt/packages/board/build.mjs"
      if [ -f "$build" ]; then
        bundles=$(grep -aoE "shipped[A-Za-z]* = path\\.join\\([^)]*'[^']*'\\)" "$build" 2>/dev/null \\
          | sed -E "s|.*'\\.\\./\\.\\./([^']*)'.*|\\1|" | sort -u)
      else
        bundles=""
      fi
      if [ -n "$bundles" ]; then
        status=$(printf '%s\\n' "$status" | while IFS= read -r line; do
          [ -n "\$line" ] || continue
          if printf '%s\\n' "\$bundles" | grep -qxF "\${line:3}"; then continue; fi
          printf '%s\\n' "\$line"
        done)
      fi
      filtered=$(printf '%s' "$status" \\
        | grep -vxF '?? PLOT-CORRECTION.md' \\
        | cut -c4- \\
        | grep -vE "(^|/)$PLOT_WORKER_RECORD" \\
        | grep -vE "$PLOT_EDITOR_LEFTOVER" \\
        | grep -vE "$PLOT_TOOL_SCRATCH" || true)
      if [ -n "$filtered" ]; then
        printf 'dirty\\0'
        continue
      fi
      # Check unpushed commits
      ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "0")
      case "$ahead" in
        ''|0|*[!0-9]*) printf 'clean\\0' ;;
        *) printf 'dirty\\0' ;;
      esac
    done
  `;

/** The inline program's answer for each worktree, in order. */
const inlineCleanliness = (worktrees: string[]): boolean[] => {
  const out = execFileSync('bash', ['-c', INLINE_PROGRAM, 'bash', ...worktrees], { encoding: 'utf8' });
  const parts = out.split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts.map((p) => p === 'clean');
};

const BUILD = "const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');\n";
const BUNDLE = path.join('skills', 'plot', 'scripts', 'board', 'board-server.mjs');

let box = '';

/** A committed repository at `box/<name>`, arranged by `arrange`. */
const desk = (name: string, arrange: (wt: string, git: (...a: string[]) => void) => void = () => {}): string => {
  const wt = path.join(box, name);
  fs.mkdirSync(wt);
  const git = (...a: string[]): void => {
    execFileSync('git', ['-C', wt, ...a], { stdio: 'ignore' });
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@e.x');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.excludesFile', '/dev/null');
  fs.mkdirSync(path.join(wt, 'docs'));
  fs.writeFileSync(path.join(wt, 'README.md'), 'r\n');
  fs.writeFileSync(path.join(wt, 'docs', 'a.md'), 'a\n');
  fs.mkdirSync(path.join(wt, 'packages', 'board'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'packages', 'board', 'build.mjs'), BUILD);
  fs.mkdirSync(path.dirname(path.join(wt, BUNDLE)), { recursive: true });
  fs.writeFileSync(path.join(wt, BUNDLE), 'original\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  arrange(wt, git);
  return wt;
};

/** Twenty desks, one shape each. */
const shapes: Array<[string, (wt: string, git: (...a: string[]) => void) => void]> = [
  ['clean', () => {}],
  ['modified', (wt) => fs.writeFileSync(path.join(wt, 'README.md'), 'changed\n')],
  ['untracked', (wt) => fs.writeFileSync(path.join(wt, 'new.ts'), 'x\n')],
  ['root-correction', (wt) => fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), '# c\n')],
  ['staged-correction', (wt, git) => {
    fs.writeFileSync(path.join(wt, 'PLOT-CORRECTION.md'), '# c\n');
    git('add', 'PLOT-CORRECTION.md');
  }],
  ['nested-correction', (wt) => fs.writeFileSync(path.join(wt, 'docs', 'PLOT-CORRECTION.md'), '# c\n')],
  ['worker-records', (wt) => {
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), '1\n');
    fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'l\n');
  }],
  ['nested-worker-record', (wt) => fs.writeFileSync(path.join(wt, 'docs', '.plot-worker.exit'), '0\n')],
  ['editor-leftovers', (wt) => {
    fs.writeFileSync(path.join(wt, 'a.ts.swp'), 'x\n');
    fs.writeFileSync(path.join(wt, 'b.tmp1'), 'x\n');
    fs.writeFileSync(path.join(wt, 'c.orig'), 'x\n');
  }],
  ['tool-scratch', (wt) => {
    fs.mkdirSync(path.join(wt, '.playwright-mcp'));
    fs.writeFileSync(path.join(wt, '.playwright-mcp', 's.png'), 'x\n');
    fs.mkdirSync(path.join(wt, '.plot', 'state'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot', 'state', 's.json'), '{}\n');
  }],
  ['nested-omc-state', (wt) => {
    fs.mkdirSync(path.join(wt, 'docs', '.omc', 'state'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'docs', '.omc', 'state', 's.json'), '{}\n');
  }],
  ['rebuilt-bundle', (wt) => fs.writeFileSync(path.join(wt, BUNDLE), 'rebuilt\n')],
  ['bundle-and-source', (wt) => {
    fs.writeFileSync(path.join(wt, BUNDLE), 'rebuilt\n');
    fs.writeFileSync(path.join(wt, 'docs', 'b.md'), 'b\n');
  }],
  ['renamed', (wt, git) => git('mv', 'docs/a.md', 'docs/renamed.md')],
  ['quoted-path', (wt) => fs.writeFileSync(path.join(wt, 'with space ü.md'), 'x\n')],
  ['ahead-of-upstream', (wt, git) => {
    git('branch', 'base');
    git('branch', '-u', 'base');
    fs.writeFileSync(path.join(wt, 'docs', 'c.md'), 'c\n');
    git('add', '-A');
    git('commit', '-qm', 'ahead');
  }],
  ['in-sync-with-upstream', (wt, git) => {
    git('branch', 'base');
    git('branch', '-u', 'base');
  }],
  ['no-upstream-with-commits', (wt, git) => {
    fs.writeFileSync(path.join(wt, 'docs', 'c.md'), 'c\n');
    git('add', '-A');
    git('commit', '-qm', 'local');
  }],
  ['own-build-names-another-bundle', (wt) => {
    fs.writeFileSync(
      path.join(wt, 'packages', 'board', 'build.mjs'),
      "const shippedOther = path.join(here, '../../docs/a.md');\n",
    );
    fs.writeFileSync(path.join(wt, 'docs', 'a.md'), 'rebuilt\n');
  }],
];

let worktrees: string[] = [];

beforeAll(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-desk-clean-parity-'));
  worktrees = shapes.map(([name, arrange]) => desk(name, arrange));
  // The twentieth: a path that is not a directory.
  worktrees.push(path.join(box, 'gone'));
});

afterAll(() => {
  if (box !== '') removeTree(box);
});

describe('deskCleanliness equals the inline program it replaces', () => {
  it('answers what the inline program answers on 20 constructed worktrees', async () => {
    expect(worktrees).toHaveLength(20);
    const inline = inlineCleanliness(worktrees);
    const rule = await deskCleanliness(worktrees);
    const disagreements = worktrees
      .map((wt, i) => ({ desk: path.basename(wt), inline: inline[i], rule: rule[i] }))
      .filter((row) => row.inline !== row.rule);
    expect(disagreements).toEqual([]);
    // Both answers are not one constant: the corpus holds both readings.
    expect(new Set(rule)).toEqual(new Set([true, false]));
  });
});
