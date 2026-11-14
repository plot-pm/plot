import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { DispatchReadingFor } from '@plot-pm/domain/rules/auto-dispatch';
import { IMPLEMENT_COMMAND_KEY } from '@plot-pm/fleet/shared/implement-run';
import { rmTree } from '../helpers.mjs';
import { handleDispatch } from '../../src/server/dispatch.js';

// `POST /api/dispatch` for a plan whose file only `origin/sprint/<sprint>`
// holds. The implement run's prompt names that sprint branch as `--branch`.
// The stub implement exits 1 after it records its prompt, so the route starts
// no `plot-dispatch.sh`.

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
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
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 });
  return { repoRoot, marker, stub };
};

/** Posts `body` to the route and answers the status. */
const post = async (repoRoot: string, stub: string, body: unknown, reading: DispatchReadingFor): Promise<number> => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  let status = 0;
  const res = {
    headersSent: false,
    writeHead(s: number) { status = s; return this; },
    end() { return this; },
  } as unknown as http.ServerResponse;
  await handleDispatch(req, res, { repoRoot, scriptsDir: SCRIPTS, host: 'localhost', port: 7777 }, {
    config: (_o, key, fallback) => (key === IMPLEMENT_COMMAND_KEY ? stub : fallback),
    startReading: () => reading,
  });
  return status;
};

/** The prompt the stub received, once it has run. */
const promptOf = async (marker: string): Promise<string> => {
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  return fs.readFileSync(marker, 'utf8').trim();
};

describe('POST /api/dispatch for a plan only a sprint branch holds', () => {
  it('names the sprint branch as --branch where the reading names the slice', async () => {
    const { repoRoot, marker, stub } = sprintEstate();
    expect(await post(repoRoot, stub, { slug: SLUG }, { kind: 'branch', branch: SLICE })).toBe(202);
    expect(await promptOf(marker)).toBe(`Run /plot-implement ${SLUG} --brief-only --branch sprint/two-weeks and follow it.`);
  });

  it('names the sprint branch as --branch where the pulse holds no reading of the plan', async () => {
    const { repoRoot, marker, stub } = sprintEstate();
    expect(await post(repoRoot, stub, { slug: SLUG }, { kind: 'no-reading' })).toBe(202);
    expect(await promptOf(marker)).toBe(`Run /plot-implement ${SLUG} --brief-only --branch sprint/two-weeks and follow it.`);
  });
});
