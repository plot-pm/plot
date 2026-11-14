import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Scripts } from '@plot-pm/domain';
import { run } from '../../src/server/entry/dispatch-command.js';
import { IMPLEMENT_COMMAND_KEY } from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// `plot-dispatch-command.mjs` for a plan whose file only
// `origin/sprint/two-weeks` holds: the implement run's prompt names that sprint
// branch as `--branch`, so `/plot-implement` reads and books the plan there.

const SCRIPT_DIR = path.resolve(__dirname, '../../../../skills/plot/scripts');
const SLUG = 'a-sprint-only-plan';
const SLICE = 'feature/the-sprint-slice';

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop() as string);
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A clone whose `origin/main` holds no plan and whose `origin/sprint/two-weeks` holds one. */
const sprintEstate = (): { repoRoot: string; marker: string; stub: string } => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-home-')));
  made.push(parent);
  const origin = path.join(parent, 'origin.git');
  const repoRoot = path.join(parent, 'repo');
  git(parent, 'init', '--bare', '-q', '-b', 'main', origin);
  git(parent, 'clone', '-q', origin, repoRoot);
  git(repoRoot, 'config', 'user.email', 'test@example.invalid');
  git(repoRoot, 'config', 'user.name', 'Plot Test');
  git(repoRoot, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repoRoot, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'docs', 'plans', '.keep'), '');
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'init');
  git(repoRoot, 'push', '-q', 'origin', 'main');
  git(repoRoot, 'remote', 'set-head', 'origin', 'main');
  git(repoRoot, 'checkout', '-q', '-b', 'sprint/two-weeks');
  fs.writeFileSync(
    path.join(repoRoot, 'docs', 'plans', `2099-01-01-${SLUG}.md`),
    `# A sprint-only plan\n\n## Status\n\n- **State:** Approved\n- **Sprint:** two-weeks\n\n## Branches\n\n### Slice\n\n- \`${SLICE}\` — the work\n`,
  );
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'plan on the sprint branch');
  git(repoRoot, 'push', '-q', 'origin', 'sprint/two-weeks');
  git(repoRoot, 'checkout', '-q', 'main');
  git(repoRoot, 'branch', '-q', '-D', 'sprint/two-weeks');
  git(repoRoot, 'fetch', '-q', 'origin');
  const marker = path.join(parent, 'implement-prompt.txt');
  const stub = path.join(parent, 'stub-implement.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  return { repoRoot, marker, stub };
};

/** A `Scripts` port that starts nothing. */
const quietScripts = { start: () => ({ pid: 1, started: true }) } as unknown as Scripts;

describe('the dispatch entry for a plan only a sprint branch holds', () => {
  it('names the sprint branch as --branch in the implement prompt', async () => {
    const { repoRoot, marker, stub } = sprintEstate();
    const code = await run([SLUG], repoRoot, SCRIPT_DIR, {
      scripts: quietScripts,
      readCfg: (_o, key, fallback) => (key === IMPLEMENT_COMMAND_KEY ? stub : fallback),
      pulse: () => null,
    }, () => {}, () => {});
    expect(code).toBe(0);
    expect(fs.readFileSync(marker, 'utf8').trim()).toBe(`Run /plot-implement ${SLUG} --brief-only --branch sprint/two-weeks and follow it.`);
  });
});
