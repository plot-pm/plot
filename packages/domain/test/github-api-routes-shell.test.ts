import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { githubApi } from '../src/adapters/host/github-api.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';

/**
 * A client-written ledger line routes `plot-host.sh`.
 *
 * `gh pr list` records basis `unknown` for `graphql`, so `graphql_budget_spent`
 * had no `actual` line to read from fleetd's reads. The client records
 * `actual` with the real remaining value; at remaining 0 the shell's
 * `pr-state` takes REST.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');

let root = '';
let server: http.Server | null = null;

afterEach(async () => {
  if (server !== null) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

const REST_PR = JSON.stringify({
  number: 7,
  state: 'open',
  draft: false,
  html_url: 'https://example.test/pr/7',
  merged: false,
  base: { ref: 'main' },
  merge_commit_sha: null,
});

describe('a client actual line routes the shell', () => {
  it('sends pr-state to REST after the client records graphql remaining 0', async () => {
    root = mkdtempSync(join(tmpdir(), 'plot-github-api-route-'));
    const budgetHome = join(root, 'budget');
    const bin = join(root, 'bin');
    const repo = join(root, 'repo');
    for (const dir of [budgetHome, bin, repo]) mkdirSync(dir, { recursive: true });

    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const body = req.url === '/user' ? { login: 'someone' } : { data: {} };
        const bucket = req.url === '/graphql' ? 'graphql' : 'core';
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-RateLimit-Resource': bucket,
          'X-RateLimit-Limit': '5000',
          'X-RateLimit-Remaining': bucket === 'graphql' ? '0' : '4990',
          'X-RateLimit-Reset': String(Math.trunc(Date.now() / 1000) + 600),
        });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const api = githubApi({
      origin: 'git@github.com:owner/repo.git',
      env: { GITHUB_API_URL: url, GH_TOKEN: 'fixture-token' },
      budget: budgetFile({ home: budgetHome }),
      slots: slotsFile({ home: budgetHome }),
    });
    expect((await api.request({ method: 'POST', path: '/graphql', body: { query: '{}' }, label: 'graphql' })).ok).toBe(true);
    expect(readFileSync(join(budgetHome, 'budget.tsv'), 'utf8')).toMatch(/\tgithub\tsomeone\tgraphql\t\d+\t1\t5000\t0\t\d+\tactual$/m);

    const calls = join(root, 'gh.calls');
    writeFileSync(
      join(bin, 'gh'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$*" >> '${calls}'`,
        'case "$1" in',
        `  api) case "$2" in */check-runs*) printf '%s' '{"total_count":0,"check_runs":[]}' ;; */status*) printf '%s' '{"total_count":0,"statuses":[]}' ;; *) printf '%s' '${REST_PR}' ;; esac ;;`,
        `  pr) printf '%s' '{"number":7,"state":"OPEN","isDraft":false,"url":"https://example.test/pr/7"}' ;;`,
        `  *) printf '%s' '{}' ;;`,
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'gh'), 0o755);
    execFileSync('git', ['init', '-q', '.'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], { cwd: repo });

    const run = spawnSync('bash', [HOST, 'pr-state', '7'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        PLOT_HOST: 'github',
        PLOT_BUDGET_HOME: budgetHome,
        PLOT_BUDGET_ACCOUNT: 'someone',
      },
      timeout: 30_000,
    });

    expect(run.status, run.stderr).toBe(0);
    const made = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
    expect(made.some((c) => c.startsWith('api repos/'))).toBe(true);
    expect(made.some((c) => c.startsWith('pr view'))).toBe(false);
  });
});
