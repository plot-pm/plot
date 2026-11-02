import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scriptsShell } from '@plot-pm/domain/adapters';
import type { Scripts } from '@plot-pm/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { removeTree } from '../rm-tree.mjs';

/** Counts the `ticketLaneData` calls a request makes, and otherwise runs the real one. */
const lanes = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../src/server/fleet.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/fleet.js')>();
  return {
    ...real,
    ticketLaneData: (...a: Parameters<typeof real.ticketLaneData>) => {
      lanes.calls += 1;
      return real.ticketLaneData(...a);
    },
  };
});

import { boardAnswer } from '../../src/server/controllers/board-answer.js';
import { mockEstate } from '../../src/server/estate.js';
import { planMetasAtDefault, stopFleetRefresh } from '../../src/server/fleet.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const made: string[] = [];
const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
};

const PLAN = (title: string, phase: string): string =>
  `# ${title}\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n\n## Slices\n\n- \`feature/${title.toLowerCase().replace(/\s+/g, '-')}\`\n`;

/** A repository whose `origin/main` holds three plans, and the paths each parser start was given. */
const estate = () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-parse-held-'));
  made.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# P\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  const names = ['2026-10-01-alpha', '2026-10-02-beta', '2026-10-03-gamma'];
  for (const name of names) {
    fs.writeFileSync(path.join(repo, `docs/plans/${name}.md`), PLAN(name.slice(11), 'Delivered'));
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const parsed: string[][] = [];
  const real = scriptsShell({ repoRoot: repo, scriptDir: REAL_SCRIPTS });
  const config: Scripts = {
    ...real,
    planMeta: (files, options) => {
      parsed.push(files.map((f) => path.basename(f)));
      return real.planMeta(files, options);
    },
  };
  return { repo, parsed, opts: { repoRoot: repo, scriptsDir: REAL_SCRIPTS, config } };
};

afterEach(() => {
  stopFleetRefresh();
  lanes.calls = 0;
  for (const dir of made.splice(0)) removeTree(dir);
});

describe('a plan is parsed once per blob', () => {
  it('parses every plan once, then none, and only the edited plan after one changes', async () => {
    const { repo, parsed, opts } = estate();

    const first = await planMetasAtDefault(opts);
    expect(first?.map((m) => path.basename(m.file)).sort()).toEqual(
      ['2026-10-01-alpha.md', '2026-10-02-beta.md', '2026-10-03-gamma.md'],
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toHaveLength(3);

    const second = await planMetasAtDefault(opts);
    expect(parsed).toHaveLength(1);
    expect(second?.map((m) => m.title)).toEqual(first?.map((m) => m.title));

    fs.writeFileSync(path.join(repo, 'docs/plans/2026-10-02-beta.md'), PLAN('beta', 'Approved'));
    git(repo, 'commit', '-q', '-am', 'edit beta');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const third = await planMetasAtDefault(opts);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual(['2026-10-02-beta.md']);
    expect(third?.find((m) => path.basename(m.file) === '2026-10-02-beta.md')?.phase).toBe('approved');
  });
});

describe('the lanes run once per request', () => {
  it('asks ticketLaneData exactly once from boardAnswer', async () => {
    const { opts } = estate();
    await boardAnswer(opts, mockEstate(), 'localhost', 7777, false);
    expect(lanes.calls).toBe(1);
  });
});
