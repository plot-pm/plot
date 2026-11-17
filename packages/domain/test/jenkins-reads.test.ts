import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { buildJenkins } from '../src/adapters/build/build-jenkins.js';
import { buildFor, buildShell } from '../src/adapters/build/build-resolve.js';
import { jenkinsReads, type JenkinsAnswer, type JenkinsApi, type JenkinsRequest } from '../src/adapters/build/jenkins-api.js';
import type { ShellContext } from '../src/adapters/scripts.js';

const MULTI = 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject';
const PLAIN = 'org.jenkinsci.plugins.workflow.job.WorkflowJob';
const A = 'a'.repeat(40);

const ok = (body: unknown): JenkinsAnswer => ({ ok: true, reply: { status: 200, headers: {}, body } as never });
const refused = (said: string): JenkinsAnswer => ({ ok: false, refusal: { kind: 'failed', said }, reply: null });

/** A client answering by path prefix, and noting every path asked. */
const fake = (answers: Record<string, JenkinsAnswer>): { api: JenkinsApi; asked: string[] } => {
  const asked: string[] = [];
  const api = {
    url: 'http://jenkins.test',
    account: 'x',
    dir: null,
    ready: () => Promise.resolve({ ok: true }),
    request: (request: JenkinsRequest) => {
      const path = request.path.split('?')[0] as string;
      asked.push(path);
      return Promise.resolve(answers[path] ?? refused('nothing here'));
    },
  } as unknown as JenkinsApi;
  return { api, asked };
};

const build = (number: number, result: string | null, sha: string, branch = 'origin/main') => ({
  number,
  result,
  building: result === null,
  timestamp: 1_700_000_000_000 + number * 1000,
  url: `u${String(number)}`,
  actions: [{ lastBuiltRevision: { SHA1: sha, branch: [{ name: branch }] } }],
});

describe('jenkinsReads.colourMap', () => {
  it('lists a multibranch job`s children after reading its own class', async () => {
    const { api, asked } = fake({
      '/job/team/job/portal/api/json': ok({ _class: MULTI, jobs: [{ name: 'feature%2Fa', color: 'red' }] }),
    });
    expect(await jenkinsReads(api).colourMap('team/portal')).toEqual({ status: 'ok', map: { 'feature/a': { color: 'red', checks: 'failing', job: 'team/portal/feature/a' } } });
    expect(asked).toEqual(['/job/team/job/portal/api/json', '/job/team/job/portal/api/json']);
  });

  it('reads a plain job from its own answer, with no listing', async () => {
    const { api, asked } = fake({ '/job/team/job/deploy/api/json': ok({ _class: PLAIN, color: 'blue' }) });
    expect((await jenkinsReads(api).colourMap('team/deploy')).map.deploy?.checks).toBe('green');
    expect(asked).toHaveLength(1);
  });

  it('reads another class as unknown and a refusal as failed', async () => {
    expect((await jenkinsReads(fake({ '/job/x/api/json': ok({ _class: 'hudson.model.FreeStyleProject' }) }).api).colourMap('x')).status).toBe('unknown');
    expect((await jenkinsReads(fake({}).api).colourMap('x')).status).toBe('failed');
  });

  it('lists the root with no job read, and reads a refused listing as failed', async () => {
    const root = fake({ '/api/json': ok({ jobs: [{ name: 'main', color: 'blue' }] }) });
    expect((await jenkinsReads(root.api).colourMap('')).map.main?.job).toBe('main');
    expect(root.asked).toEqual(['/api/json']);
    const unreadable = fake({ '/job/x/api/json': ok('<html>') });
    expect((await jenkinsReads(unreadable.api).colourMap('x')).status).toBe('failed');
    const gone = fake({ '/job/x/api/json': { ok: false, refusal: { kind: 'auth', said: 'no' }, reply: null } });
    expect((await jenkinsReads(gone.api).colourMap('x')).status).toBe('failed');
  });
});

describe('jenkinsReads.builds', () => {
  const query = { job: 'team/portal', branch: 'main', sha: A, limit: 10 };

  it('reads the branch path first and filters after the fetch', async () => {
    const { api, asked } = fake({ '/job/team/job/portal/job/main/api/json': ok({ builds: [build(2, 'SUCCESS', A), build(1, 'FAILURE', 'b'.repeat(40))] }) });
    const read = await jenkinsReads(api).builds(query);
    expect(read.ok && read.runs.map((run) => run.conclusion)).toEqual(['SUCCESS']);
    expect(asked).toEqual(['/job/team/job/portal/job/main/api/json']);
  });

  it('falls back to the job root as a plain job and keeps only the branch`s builds', async () => {
    const { api } = fake({ '/job/team/job/portal/api/json': ok({ builds: [build(3, 'SUCCESS', A), build(2, 'SUCCESS', A, 'origin/other')] }) });
    const read = await jenkinsReads(api).builds({ ...query, sha: '' });
    expect(read.ok && read.runs).toHaveLength(1);
  });

  it('reads a multibranch root with no builds as an empty answer', async () => {
    const { api } = fake({ '/job/team/job/portal/api/json': ok({ _class: MULTI }) });
    expect(await jenkinsReads(api).builds(query)).toEqual({ ok: true, runs: [] });
  });

  it('says a branch is not indexed where the branch path answered with no builds', async () => {
    const { api } = fake({ '/job/team/job/portal/job/main/api/json': ok({ _class: PLAIN }), '/job/team/job/portal/api/json': ok({ _class: PLAIN }) });
    expect(await jenkinsReads(api).builds(query)).toEqual({ ok: false, said: "Jenkins has no branch 'main' indexed for 'team/portal'" });
  });

  it('carries the refusal`s words, or its own where the answers held nothing', async () => {
    expect(await jenkinsReads(fake({}).api).builds(query)).toEqual({ ok: false, said: 'nothing here' });
    const html = fake({ '/job/team/job/portal/job/main/api/json': ok('<html>'), '/job/team/job/portal/api/json': ok(null) });
    expect(await jenkinsReads(html.api).builds(query)).toEqual({ ok: false, said: "Jenkins did not answer for 'team/portal'" });
  });
});

describe('buildJenkins given a client', () => {
  const roots: string[] = [];
  const saved = { ...process.env };

  afterEach(() => {
    for (const name of ['JENKINS_INSTANCE', 'PLOT_JENKINS_JOB']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  /** A context whose `plot-config.sh` answers the given keys and whose `plot-host.sh` records its starts. */
  const context = (config: Record<string, string>): { context: ShellContext; starts: () => number } => {
    const root = mkdtempSync(join(tmpdir(), 'plot-jenkins-reads-'));
    roots.push(root);
    const scriptDir = join(root, 'scripts');
    mkdirSync(scriptDir);
    const cases = Object.entries(config).map(([key, value]) => `'${key}') echo '${value}';;`).join(' ');
    writeFileSync(join(scriptDir, 'plot-config.sh'), `#!/usr/bin/env bash\ncase "$2" in ${cases} esac\n`);
    writeFileSync(join(scriptDir, 'plot-host.sh'), `#!/usr/bin/env bash\necho x >> '${join(root, 'starts')}'\necho '[]'\n`);
    chmodSync(join(scriptDir, 'plot-config.sh'), 0o755);
    chmodSync(join(scriptDir, 'plot-host.sh'), 0o755);
    writeFileSync(join(root, 'starts'), '');
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    return { context: { repoRoot: root, scriptDir }, starts: () => execFileSync('wc', ['-l', join(root, 'starts')], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)[0] as number };
  };

  const answers = { '/job/team/job/portal/job/main/api/json': ok({ builds: [build(5, 'SUCCESS', A), build(4, 'ABORTED', A)] }) };

  it('reads all three in-process, starts no plot-host.sh, and leaves the raw word on `runs`', async () => {
    const { context: ctx, starts } = context({ 'Jenkins instance': 'jenkins.example.org/team/portal' });
    const port = buildJenkins(ctx, fake(answers).api);
    const runs = await port.runs('main');
    expect(runs.ok && runs.value.map((run) => run.conclusion)).toEqual(['SUCCESS']);
    const one = await port.runForSha('main', A);
    expect(one.ok && one.value?.conclusion).toBe('success');
    const many = await port.runsForSha('main', A);
    expect(many.ok && many.value.map((run) => run.conclusion)).toEqual(['success']);
    expect(port.lastRefusal()).toBeNull();
    expect(starts()).toBe(0);
  });

  it('answers null for no run, and starts one plot-host.sh for a read it keeps', async () => {
    const { context: ctx, starts } = context({ 'Jenkins instance': 'jenkins.example.org/team/portal' });
    const port = buildJenkins(ctx, fake({ '/job/team/job/portal/job/main/api/json': ok({ builds: [] }) }).api);
    expect(await port.runForSha('main', A)).toEqual({ ok: true, value: null });
    await port.rerunFailed('main', A);
    await port.rerunAll('main', A);
    await port.limit();
    expect(starts()).toBe(3);
    expect(port.lastRefusal()).toBeNull();
  });

  it('refuses with the client`s words as unaskable', async () => {
    const { context: ctx } = context({ 'Jenkins instance': 'jenkins.example.org/team/portal' });
    const port = buildJenkins(ctx, fake({}).api);
    expect(await port.runsForSha('main', A)).toEqual({ ok: false, why: 'unaskable', reason: 'nothing here' });
    expect(port.lastRefusal()).toBe('nothing here');
    expect(await port.runForSha('main', A)).toMatchObject({ ok: false, why: 'unaskable' });
  });

  it('answers failed with no instance, and unaskable where the instance names no job', async () => {
    const none = buildJenkins(context({}).context, fake(answers).api);
    delete process.env.JENKINS_INSTANCE;
    expect(await none.runs('main')).toEqual({ ok: false, why: 'failed' });
    expect(none.lastRefusal()).toBe('plot-host: CI is jenkins but no Jenkins instance is configured');
    process.env.JENKINS_INSTANCE = 'jenkins.example.org';
    const bare = buildJenkins(context({}).context, fake(answers).api);
    expect(await bare.runs('main')).toMatchObject({ ok: false, why: 'unaskable' });
  });

  it('applies the default-branch job, and PLOT_JENKINS_JOB over it', async () => {
    const config = { 'Jenkins instance': 'jenkins.example.org/team/portal', 'Default branch job': 'team/deploy' };
    const { api, asked } = fake({ '/job/team/job/deploy/job/trunk/api/json': ok({ builds: [] }) });
    const port = buildJenkins(context(config).context, api);
    await port.runs('trunk');
    await port.runs('main');
    expect(asked[0]).toBe('/job/team/job/deploy/job/trunk/api/json');
    expect(asked[1]).toBe('/job/team/job/portal/job/main/api/json');
    process.env.PLOT_JENKINS_JOB = 'other/job';
    await buildJenkins(context(config).context, api).runs('trunk');
    expect(asked.at(-2)).toBe('/job/other/job/job/job/trunk/api/json');
  });

  it('reads the instance from JENKINS_INSTANCE where the config names none', async () => {
    process.env.JENKINS_INSTANCE = 'jenkins.example.org/team/portal';
    const port = buildJenkins(context({}).context, fake(answers).api);
    expect((await port.runs('main')).ok).toBe(true);
  });

  it('passes the client through buildFor and buildShell', () => {
    const { context: ctx } = context({});
    const api = fake(answers).api;
    expect(buildFor('jenkins', ctx, undefined, api).system()).toBe('jenkins');
    expect(buildShell(ctx, undefined, api)).toBeDefined();
  });
});
