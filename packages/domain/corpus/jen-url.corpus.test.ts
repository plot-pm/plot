import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  jenInstanceUrl,
  jenJobPath,
  jenJobsOf,
  jenKeyFor,
  jenSaveToken,
  jenSecretFile,
  jenStatusClass,
  jenUrlFor,
  jenUrlHost,
  jenUrlencode,
} from '../src/rules/jen-url.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Do the Jenkins URL rules answer what `jen` 0.4.0 answers?
 *
 * Reads the recordings `record-jenkins-reads.mjs` took from the real `jen`
 * and needs no `jen` installed. The recorder runs once per `jen` version.
 * One declared difference: a bare slug has no URL in the rule, where `jen`
 * expands it through a host pattern that names one organisation's hosts.
 */

const DIR = new URL('./fixtures/jenkins-reads/', import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as T;
const report = describingAs({ left: 'rule', right: 'shell' });
const PATTERN = '.pattern.invalid';

interface Recorded {
  readonly jen: string;
  readonly urlFor: readonly { input: string; output: string }[];
  readonly keyFor: readonly { input: string; output: string }[];
  readonly instanceUrl: readonly { jenUrl: string; slug: string; output: string }[];
  readonly urlHost: readonly { input: string; output: string }[];
  readonly secretFile: readonly { key: string; dir: string; output: string }[];
  readonly saveToken: readonly { response: Record<string, unknown>; now: number; stored: string }[];
  readonly jobPath: readonly { input: string; branch: string; output: string }[];
  readonly urlencode: readonly { input: string; output: string }[];
  readonly checkHttp: readonly { status: number; location: string; realm: string; instanceKey: string; class: string }[];
}

interface Outputs {
  readonly jen: string;
  readonly cases: readonly { name: string; answers: Record<string, unknown>; stdout: string }[];
}

const recorded = read<Recorded>('url-functions.json');
const outputs = read<Outputs>('jen-outputs.json');

/** The rule's answer, or the shell's pattern arm where the rule declares a bare slug has no URL. */
const sameUrl = (rule: string | null, shell: string): string => (rule === null && shell.includes(PATTERN) ? shell : (rule ?? ''));

describe('the Jenkins URL rules agree with the recorded jen', () => {
  it('was recorded from jen 0.4.0 and covers a loopback URL, so this is not vacuous', () => {
    expect(recorded.jen).toBe('jen 0.4.0');
    expect(outputs.jen).toBe('jen 0.4.0');
    expect(recorded.urlFor.some((one) => one.input.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(recorded.urlFor.some((one) => one.output.includes(PATTERN))).toBe(true);
    expect(recorded.checkHttp.map((one) => one.class)).toEqual(expect.arrayContaining(['ok', 'auth', 'foreign', 'failed']));
  });

  it('resolves an instance identifier as jen_url_for does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.urlFor) compareField(found, one.input, 'url', sameUrl(jenUrlFor(one.input), one.output), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('reads the instance URL as jen_instance_url does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.instanceUrl) {
      const rule = jenInstanceUrl(one.jenUrl === '' ? undefined : one.jenUrl, one.slug);
      compareField(found, `${one.jenUrl}|${one.slug}`, 'url', sameUrl(rule, one.output), one.output);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('reads the host of a URL as jen_url_host does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.urlHost) compareField(found, one.input, 'host', jenUrlHost(one.input), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('names the secret key as jen_key_for does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.keyFor) compareField(found, one.input, 'key', sameUrl(jenKeyFor(one.input), one.output), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('names the secret file as jen_secret_file does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.secretFile) compareField(found, `${one.dir}|${one.key}`, 'file', jenSecretFile(one.dir, one.key), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('stamps a token as jen_save_token does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.saveToken) {
      compareField(found, JSON.stringify(one.response), 'stored', jenSaveToken(one.response, one.now), one.stored);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('builds a job path as jen_job_path does, with a branch holding a slash', () => {
    expect(recorded.jobPath.some((one) => one.branch === 'docs/foo')).toBe(true);
    const found: Disagreement[] = [];
    for (const one of recorded.jobPath) compareField(found, `${one.input}|${one.branch}`, 'path', jenJobPath(one.input, one.branch), one.output);
    expect(found.map(report)).toEqual([]);
  });

  it('encodes as jen_urlencode does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.urlencode) compareField(found, one.input, 'encoded', jenUrlencode(one.input), one.output.replace(/\n$/, ''));
    expect(found.map(report)).toEqual([]);
  });

  it('classifies each status and Location as jen_check_http does', () => {
    const found: Disagreement[] = [];
    for (const one of recorded.checkHttp) {
      compareField(found, `${one.status} ${one.location}`, 'class', jenStatusClass(one.status, one.location, one.realm, one.instanceKey), one.class);
    }
    expect(found.map(report)).toEqual([]);
  });

  it('projects the job list as jen job list --json does', () => {
    const found: Disagreement[] = [];
    for (const [name, path] of [
      ['list-multibranch', '/jenkins/job/team/job/portal/api/json'],
      ['list-plain', '/jenkins/job/team/job/deploy/api/json'],
    ] as const) {
      const one = outputs.cases.find((c) => c.name === name);
      if (one === undefined) throw new Error(`no recording named ${name}`);
      compareField(found, name, 'jobs', JSON.stringify(jenJobsOf(one.answers[path])), JSON.stringify(JSON.parse(one.stdout)));
    }
    expect(found.map(report)).toEqual([]);
  });
});
