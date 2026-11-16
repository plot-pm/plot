import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeTree } from '../rm-tree.mjs';
import { productRoot, type CensusFixture, type CensusHost } from './census-report.js';
import {
  BITBUCKET_ROUTE, CENSUS_BB_EMAIL, CENSUS_JENKINS_REFRESH, CENSUS_JENKINS_STALE, CENSUS_JIRA_EMAIL, CENSUS_JIRA_TOKEN, JENKINS_ROUTE, REALM_ROUTE,
  hostCliStub, jenkinsKey, jenStub, jiraCurlStub, startStubApi, type StubApi,
} from './stub-host.js';
import { startStubWorker, type StubWorker } from './stub-worker.js';

/**
 * The variables systemd sets for the unit a process runs in. The census
 * environment drops them, so a fleetd the test starts by hand cannot inherit
 * the CI runner's own unit and read as supervised.
 */
export const SYSTEMD_UNIT_VARS = ['INVOCATION_ID', 'JOURNAL_STREAM', 'SYSTEMD_EXEC_PID', 'MANAGERPID', 'NOTIFY_SOCKET'] as const;

/** The fixture token the sandbox sets as `GH_TOKEN` and the stub API accepts. */
export const CENSUS_TOKEN = 'census';

/** What a scenario states beside its number: desks, open PRs, host. */
export type FixtureSize = CensusFixture;

export type SandboxOptions = FixtureSize & {
  /** The checkout whose `skills/plot/scripts` the sandbox runs; `productRoot()` by default. */
  productRoot?: string;
  /** The directory the sandbox's root is made in; `tmpdir()` by default. A test that binds `.plot/fleet.sock` passes `SOCKET_TEMP_ROOT`. */
  tempRoot?: string;
  /** The `CI` key of a Bitbucket fixture; the key is absent where this is. */
  ci?: string;
};

/** One desk: a worktree on a slice branch, with a stub worker's pid in `.plot-worker.pid`. */
export type Desk = { branch: string; worktree: string; worker: StubWorker };

export type Sandbox = {
  /** The `mkdtempSync` directory; everything below lives under it. */
  root: string;
  repo: string;
  origin: string;
  fixtures: string;
  /** The file every stub appends its argv to. */
  stubLog: string;
  /** The stub API server: GitHub's API on a GitHub fixture; the Bitbucket route and Jira's REST API on a Bitbucket fixture. */
  api: StubApi | null;
  scriptsDir: string;
  size: FixtureSize;
  desks: Desk[];
  /** The environment a process under test runs with. */
  env: NodeJS.ProcessEnv;
  /** Runs `git` in `cwd` with the sandbox's environment. */
  git: (cwd: string, ...args: string[]) => string;
  /** Rewrites one stub answer file, for example to turn a PR's checks green. */
  answer: (cli: 'gh' | 'bb', key: string, body: unknown) => void;
  /** Stops every stub worker, waits for each pid, and removes `root` by its exact name. */
  remove: () => Promise<void>;
};

/** Prints a fixture size the way every census line states it. */
export const describeSize = ({ host, desks, openPrs, ci }: FixtureSize): string =>
  `host=${host}${ci === undefined ? '' : ` ci=${ci}`} desks=${desks} open-prs=${openPrs}`;

/** The slice branches of the census plan: one per desk and one per open PR, shared from the first. */
export const sliceBranches = (size: FixtureSize): string[] =>
  Array.from({ length: Math.max(size.desks, size.openPrs) }, (_, i) => `feature/census-slice-${i + 1}`);

const PLAN_SLUG = '2026-01-01-census-fixture';

/** The multibranch job the Jenkins fixture's builds live in. */
export const CENSUS_JENKINS_JOB = 'team/portal';

/** The `Jenkins instance` key a Jenkins fixture declares: a slug and the job path, as the shell's sha read needs. */
export const CENSUS_JENKINS_INSTANCE = `census/${CENSUS_JENKINS_JOB}`;

/** The variables that would hand a Jenkins credential or instance to a process by the environment, and so hide a missing store. */
export const JENKINS_ENV_VARS = ['JEN_TOKEN', 'JEN_SECRET_BACKEND', 'JENKINS_USER', 'JENKINS_API_TOKEN', 'JENKINS_INSTANCE', 'PLOT_JENKINS_JOB'] as const;

/** One PR branch's Jenkins state: its head and the colour of its job. */
export type JenkinsBranch = { branch: string; sha: string; color: 'blue' | 'red' | 'notbuilt' };

const jobPath = (job: string): string => job.split('/').map((segment) => `/job/${segment}`).join('');

/**
 * Writes the Jenkins answers under `<fixtures>/jenkins/`, one file per request
 * path the in-process client and the stub `jen` read, from the run's head SHAs.
 *
 * A `blue` branch has a `SUCCESS` build of its head; a `red` one a `FAILURE`
 * build; a `notbuilt` one an empty history. The root job lists every branch
 * with its colour, as `jen job list` prints it.
 *
 * @param fixtures - the sandbox's fixtures directory.
 * @param branches - the PR branches with their head SHAs and colours.
 */
export const writeJenkinsAnswers = (fixtures: string, branches: readonly JenkinsBranch[]): void => {
  const dir = join(fixtures, 'jenkins');
  mkdirSync(dir, { recursive: true });
  const put = (path: string, body: unknown): void => {
    writeFileSync(join(dir, `${jenkinsKey(path)}.json`), `${JSON.stringify(body)}\n`);
  };
  const root = jobPath(CENSUS_JENKINS_JOB);
  const jobs = branches.map((b) => ({ _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', name: encodeURIComponent(b.branch), color: b.color }));
  put(`${root}/api/json`, {
    _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
    name: CENSUS_JENKINS_JOB.split('/').at(-1),
    fullName: CENSUS_JENKINS_JOB,
    color: null,
    jobs,
  });
  writeFileSync(join(dir, `view_${CENSUS_JENKINS_JOB.replaceAll('/', '_')}.json`), `${JSON.stringify({ _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject', name: 'portal', fullName: CENSUS_JENKINS_JOB, url: 'http://stub/', color: null, description: '' }, null, 2)}\n`);
  writeFileSync(join(dir, `list_${CENSUS_JENKINS_JOB.replaceAll('/', '_')}.json`), `${JSON.stringify(jobs, null, 2)}\n`);
  branches.forEach((b, i) => {
    const builds =
      b.color === 'notbuilt'
        ? []
        : [
            {
              number: i + 1,
              result: b.color === 'blue' ? 'SUCCESS' : 'FAILURE',
              building: false,
              timestamp: 1_767_225_600_000 + i,
              url: `http://stub/job/${CENSUS_JENKINS_JOB}/${i + 1}/`,
              actions: [{}, { lastBuiltRevision: { SHA1: b.sha, branch: [{ name: `origin/${b.branch}` }] } }],
            },
          ];
    put(`${root}/job/${encodeURIComponent(b.branch)}/api/json`, { _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob', builds });
  });
};

const configFor = (host: CensusHost, ci?: string): string =>
  [
    '# Census fixture',
    '',
    '## Plot Config',
    '',
    '- **Branch prefixes:** feature/, bug/, infra/',
    '- **Plan directory:** docs/plans/',
    '- **Active index:** docs/plans/active/',
    '- **Delivered index:** docs/plans/delivered/',
    '- **Worktree root:** .worktrees',
    `- **Git host:** ${host}`,
    ...(host === 'github'
      ? ['- **CI:** github-actions', '- **Default branch checks:** CI']
      : ['- **Tracker:** jira https://jira.census.invalid', ...(ci === undefined ? [] : [`- **CI:** ${ci}`, ...(ci === 'jenkins' ? [`- **Jenkins instance:** ${CENSUS_JENKINS_INSTANCE}`] : [])])]),
    '- **Auto-review:** false',
    '- **Auto-verify:** false',
    '- **Auto-design:** false',
    '',
  ].join('\n');

const planFor = (branches: readonly string[]): string =>
  [
    '# Census fixture plan',
    '',
    '> The plan the census desks work on.',
    '',
    '## Status',
    '',
    '- **State:** Approved',
    '- **Type:** infra',
    '- **Review:** pr',
    '- **Impl:** own branches',
    '- **Approved:** 2026-01-01, census, fixture',
    '',
    '## Changelog',
    '',
    '- Nothing ships.',
    '',
    '## Design',
    '',
    '### Approach',
    '',
    'A fixture.',
    '',
    '## Slices',
    '',
    '### Census',
    '',
    ...branches.map((b) => `- \`${b}\` — census slice`),
    '',
  ].join('\n');

const ISO = '2026-01-01T00:00:00Z';

/** A GitHub `pr list --json` row for one open PR, with its checks. */
export const githubPr = (n: number, branch: string, sha: string, checks: 'PENDING' | 'SUCCESS', updatedAt = ISO) => ({
  number: n,
  title: `Census slice ${n}`,
  state: 'OPEN',
  headRefName: branch,
  headRefOid: sha,
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: checks === 'SUCCESS' ? 'CLEAN' : 'BLOCKED',
  reviewDecision: '',
  url: `https://github.com/census/fixture/pull/${n}`,
  updatedAt,
  author: { login: 'census' },
  mergedAt: null,
  baseRefName: 'main',
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'CI',
      status: checks === 'SUCCESS' ? 'COMPLETED' : 'IN_PROGRESS',
      conclusion: checks === 'SUCCESS' ? 'SUCCESS' : '',
      startedAt: updatedAt,
    },
  ],
});

/** A Bitbucket pull request row for one open PR. */
export const bitbucketPr = (n: number, branch: string, sha: string, updatedOn = ISO) => ({
  id: n,
  title: `Census slice ${n}`,
  state: 'OPEN',
  draft: false,
  source: { branch: { name: branch }, commit: { hash: sha } },
  destination: { branch: { name: 'main' } },
  author: { nickname: 'census', display_name: 'census' },
  links: { html: { href: `https://bitbucket.org/census/fixture/pull-requests/${n}` } },
  updated_on: updatedOn,
  created_on: ISO,
  merge_commit: null,
});

const writeStub = (bin: string, name: string, text: string): void => {
  writeFileSync(join(bin, name), text);
  chmodSync(join(bin, name), 0o755);
};

/**
 * Builds a census sandbox: a bare `origin`, a clone with a `## Plot Config`
 * and one Approved plan, `M` open PRs answered by a stub host CLI, `N` desks
 * each held by a stub worker, and stub `gh`, `bb` and Jira `curl` on `PATH`.
 *
 * Every path lives under one `mkdtempSync` directory, and `remove` deletes it
 * by that exact name after it stops and waits for each stub worker.
 *
 * @param options - the fixture size and, optionally, the checkout whose scripts run.
 * @returns the sandbox.
 */
export const buildSandbox = async (options: SandboxOptions): Promise<Sandbox> => {
  const root = realpathSync(mkdtempSync(join(options.tempRoot ?? tmpdir(), 'plot-census-')));
  const desks: Desk[] = [];
  let api: StubApi | null = null;
  try {
    const jenkins = options.host === 'bitbucket' && options.ci === 'jenkins';
    const size: FixtureSize = { host: options.host, desks: options.desks, openPrs: options.openPrs, ...(jenkins ? { ci: 'jenkins' as const } : {}) };
    const scriptsDir = join(options.productRoot ?? productRoot(), 'skills/plot/scripts');
    const home = join(root, 'home');
    const tmp = join(root, 'tmp');
    const bin = join(root, 'bin');
    const fixtures = join(root, 'fixtures');
    for (const dir of [home, tmp, bin, join(fixtures, 'gh'), join(fixtures, 'bb'), join(fixtures, 'jira'), join(fixtures, 'jenkins')]) {
      mkdirSync(dir, { recursive: true });
    }
    const stubLog = join(root, 'stub.log');
    const origin = join(root, 'origin.git');
    const repo = join(root, 'repo');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
      HOME: home,
      TMPDIR: tmp,
      PLOT_BUDGET_HOME: home,
      PLOT_REPO_ROOT: repo,
      PLOT_SCRIPTS_DIR: scriptsDir,
      CENSUS_FIXTURES: fixtures,
      CENSUS_STUB_LOG: stubLog,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      GIT_AUTHOR_NAME: 'census',
      GIT_AUTHOR_EMAIL: 'census@census.invalid',
      GIT_COMMITTER_NAME: 'census',
      GIT_COMMITTER_EMAIL: 'census@census.invalid',
      GH_TOKEN: CENSUS_TOKEN,
      // ONE BUDGET KEY FOR BOTH TRANSPORTS: the in-process client charges the
      // login `GET /user` names (the stub answers `census`), and the shell's
      // `budget_account` reads this variable, as it reads `hosts.yml` for a
      // person signed in to `gh`.
      PLOT_BUDGET_ACCOUNT: CENSUS_TOKEN,
      JIRA_EMAIL: CENSUS_JIRA_EMAIL,
      JIRA_API_TOKEN: CENSUS_JIRA_TOKEN,
    };
    // NO INDEX OVERRIDE: the PR index, the reader lock and the issue index
    // resolve from the sandbox repository's common git dir, as on an
    // operator's machine. An override skips the `git rev-parse --git-common-dir`
    // that P3 and P4 count.
    // NO INHERITED UNIT: a CI runner that systemd started passes its own
    // `INVOCATION_ID` to every step, and a fleetd started by hand would read it
    // as `supervised: systemd`. Only `startFleetd`'s `supervisor: 'systemd'`
    // gives fleetd a unit of its own.
    for (const key of [
      'BITBUCKET_API_BASE', 'BB_EMAIL', 'BB_TOKEN',
      'PLOT_HOST', 'PLOT_HOST_TRANSPORT', 'PLOT_TRACKER', 'PLOT_UNATTENDED', 'PLOT_BOARD_PORT', 'PORT', 'PLOT_PR_INDEX_HOME', 'PLOT_ISSUE_INDEX_HOME',
      ...SYSTEMD_UNIT_VARS,
    ]) {
      delete env[key];
    }
    // THE PINNED JENKINS ENVIRONMENT: the client and the shell read one
    // instance and one token store, both under the sandbox root. No credential
    // arrives by the environment, so a read that finds none shows as a refusal.
    for (const key of JENKINS_ENV_VARS) delete env[key];
    // THE IN-PROCESS CLIENT'S HOST: a local server over the same fixtures as
    // the stub `gh`, so a census row can count the requests a PATH stub
    // cannot see.
    if (size.host === 'github') {
      api = await startStubApi(join(fixtures, 'gh'), CENSUS_TOKEN);
      env['GITHUB_API_URL'] = api.url;
    } else {
      delete env['GITHUB_API_URL'];
      api = await startStubApi(join(fixtures, 'gh'), CENSUS_TOKEN);
      env['BITBUCKET_API_BASE'] = `${api.url}${BITBUCKET_ROUTE}`;
      env['BB_EMAIL'] = CENSUS_BB_EMAIL;
      env['BB_TOKEN'] = CENSUS_TOKEN;
    }
    if (jenkins && api !== null) {
      const xdg = join(root, 'xdg');
      const store = join(xdg, 'jen');
      mkdirSync(store, { recursive: true });
      env['XDG_CONFIG_HOME'] = xdg;
      env['JEN_CONFIG_DIR'] = store;
      env['JEN_URL'] = `${api.url}${JENKINS_ROUTE}`;
      env['JEN_REALM_URL'] = `${api.url}${REALM_ROUTE}`;
      // A BLOB PAST ITS EXPIRY: the first read refreshes, so the token route is in the count.
      writeFileSync(
        join(store, 'keycloak-token.secret'),
        `${JSON.stringify({ access_token: CENSUS_JENKINS_STALE, refresh_token: CENSUS_JENKINS_REFRESH, expires_at: 1 })}\n`,
        { mode: 0o600 },
      );
    } else {
      for (const key of ['XDG_CONFIG_HOME', 'JEN_CONFIG_DIR', 'JEN_URL', 'JEN_REALM_URL']) delete env[key];
    }
    // THE IN-PROCESS JIRA CLIENT'S HOST: the Bitbucket fixture's tracker is
    // Jira, and the same server answers its requests from the `curl` stub's
    // answer files, so a census row can count them.
    if (size.host === 'bitbucket') {
      api ??= await startStubApi(join(fixtures, 'gh'), CENSUS_TOKEN);
      env['PLOT_JIRA_BASE_URL'] = api.url;
    } else {
      delete env['PLOT_JIRA_BASE_URL'];
    }
    writeFileSync(join(home, '.gitconfig'), '[init]\n\tdefaultBranch = main\n');
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

    writeStub(bin, 'gh', hostCliStub('gh'));
    writeStub(bin, 'bb', hostCliStub('bb'));
    if (size.host === 'bitbucket') writeStub(bin, 'curl', jiraCurlStub());
    if (jenkins) writeStub(bin, 'jen', jenStub());

    git(root, 'init', '--bare', '--quiet', origin);
    git(root, 'init', '--quiet', repo);
    git(repo, 'remote', 'add', 'origin', origin);
    const branches = sliceBranches(size);
    mkdirSync(join(repo, 'docs/plans/active'), { recursive: true });
    writeFileSync(join(repo, 'CLAUDE.md'), configFor(size.host, jenkins ? 'jenkins' : options.ci));
    writeFileSync(join(repo, '.gitignore'), '.plot/state/\n.plot/agents/\n.plot/fleet.sock\n.plot-worker*\n.worktrees/\n');
    writeFileSync(join(repo, `docs/plans/${PLAN_SLUG}.md`), planFor(branches));
    symlinkSync(`../${PLAN_SLUG}.md`, join(repo, `docs/plans/active/${PLAN_SLUG}.md`));
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'census: the fixture');
    git(repo, 'push', '--quiet', '-u', 'origin', 'main');
    const mainSha = git(repo, 'rev-parse', 'HEAD');

    const shas = new Map<string, string>();
    for (const branch of branches) {
      git(repo, 'branch', branch, 'main');
      git(repo, 'push', '--quiet', 'origin', branch);
      shas.set(branch, mainSha);
    }
    git(repo, 'fetch', '--quiet', 'origin');
    // A BITBUCKET ORIGIN THE IN-PROCESS CLIENT CAN READ: `remoteSlug` accepts
    // only a host URL, and a local path gives the client no slug, so every read
    // would fall to the shell. The remote names the workspace and repository
    // over ssh; `GIT_SSH_COMMAND` answers that transport from the local bare
    // repository, so fetches reach no network; pushes keep the local path.
    if (size.host === 'bitbucket') {
      writeStub(bin, 'census-ssh', `#!/bin/sh\nfor last; do :; done\nexec "\${last%% *}" '${origin}'\n`);
      env['GIT_SSH_COMMAND'] = join(bin, 'census-ssh');
      git(repo, 'remote', 'set-url', '--push', 'origin', origin);
      git(repo, 'remote', 'set-url', 'origin', 'ssh://git@bitbucket.org/census/fixture.git');
    }

    const answer = (cli: 'gh' | 'bb', key: string, body: unknown): void => {
      writeFileSync(join(fixtures, cli, `${key}.json`), `${typeof body === 'string' ? body : JSON.stringify(body)}\n`);
    };
    const prBranches = branches.slice(0, size.openPrs);
    if (size.host === 'github') {
      const rows = prBranches.map((b, i) => githubPr(i + 1, b, shas.get(b) ?? mainSha, 'PENDING'));
      answer('gh', 'pr-list-open', rows);
      answer('gh', 'pr-list-all', rows);
      answer('gh', 'pr-list-merged', []);
      answer('gh', 'pr-list-closed', []);
      rows.forEach((row) => {
        answer('gh', `pr-list-open-head-${row.headRefName.replaceAll('/', '_')}`, [row]);
        answer('gh', `pr-list-all-head-${row.headRefName.replaceAll('/', '_')}`, [row]);
      });
      answer('gh', 'run-list', [
        {
          databaseId: 1,
          headSha: mainSha,
          headBranch: 'main',
          name: 'CI',
          workflowName: 'CI',
          status: 'completed',
          conclusion: 'success',
          createdAt: ISO,
          updatedAt: ISO,
          event: 'push',
        },
      ]);
      answer('gh', 'issue-list-open', []);
      answer('gh', 'api-graphql', { data: { viewer: { login: 'census' } } });
      answer('gh', 'api-rate_limit', {
        resources: { core: { limit: 5000, remaining: 5000, reset: 0 }, graphql: { limit: 5000, remaining: 5000, reset: 0 } },
      });
      writeFileSync(join(fixtures, 'gh', 'repo-view.jq.txt'), 'census/fixture\n');
    } else {
      const rows = prBranches.map((b, i) => bitbucketPr(i + 1, b, shas.get(b) ?? mainSha));
      answer('bb', 'pr-list', rows);
      answer('bb', 'api-pullrequests-OPEN', { values: rows, size: rows.length, pagelen: 50 });
      rows.forEach((row) => {
        answer('bb', `api-pullrequests-OPEN-branch-${row.source.branch.name.replaceAll('/', '_')}`, {
          values: [row],
          size: 1,
          pagelen: 50,
        });
      });
      answer('bb', 'repo-view', { mainbranch: { name: 'main' }, full_name: 'census/fixture' });
      // PER-RUN JENKINS ANSWERS, from this run's head SHAs: the first PR branch
      // is `blue` with a SUCCESS build of its head, the rest are not built.
      if (jenkins) {
        writeJenkinsAnswers(fixtures, prBranches.map((b, i) => ({ branch: b, sha: shas.get(b) ?? mainSha, color: i === 0 ? 'blue' : 'notbuilt' })));
      }
    }

    for (const branch of branches.slice(0, size.desks)) {
      const worktree = join(repo, '.worktrees', branch.replace(/^feature\//, ''));
      git(repo, 'worktree', 'add', '--quiet', worktree, branch);
      git(worktree, 'branch', '--quiet', '--set-upstream-to', `origin/${branch}`);
      const worker = await startStubWorker(join(root, `${branch.replace(/\//g, '_')}.fifo`));
      writeFileSync(join(worktree, '.plot-worker.pid'), `${worker.pid}\n`);
      // THE MANIFEST A DISPATCH WRITES: fleetd's tick reads the registry, and
      // only a registered desk reaches the liveness question P2 counts.
      const session = `census-${desks.length + 1}`;
      mkdirSync(join(repo, '.plot/agents'), { recursive: true });
      writeFileSync(
        join(repo, '.plot/agents', `${session}.json`),
        `${JSON.stringify({ session, resumeId: session, branch, worktree, command: 'stub-worker', startedAt: ISO, pid: String(worker.pid) })}\n`,
      );
      desks.push({ branch, worktree, worker });
    }

    return {
      root,
      repo,
      origin,
      fixtures,
      stubLog,
      api,
      scriptsDir,
      size,
      desks,
      env,
      git,
      answer,
      remove: async () => {
        await Promise.all(desks.map((d) => d.worker.stop()));
        await api?.close();
        removeTree(root);
      },
    };
  } catch (e) {
    await Promise.all(desks.map((d) => d.worker.stop()));
    await api?.close();
    removeTree(root);
    throw e;
  }
};
