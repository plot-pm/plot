import { describe, expect, it } from 'vitest';

import type { JiraApi } from '../src/adapters/tracker/jira-api.js';
import { trackerReadsFor } from '../src/adapters/tracker/tracker-transport.js';
import { trackerFor } from '../src/adapters/tracker/tracker-resolve.js';
import { trackerTransportLine, trackerTransportOf, trackerTransportStatusLine } from '../src/rules/tracker-transport.js';

/** Every script path is absent: a read that started a process would fail, so an answer proves none started. */
const context = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

const DECLARED = 'jira https://jira.example';

const fakeApi = (source: ReturnType<JiraApi['credentialSource']>, base = 'https://jira.example'): JiraApi => ({
  base,
  credentialSource: () => source,
  account: () => 'jira:0123456789ab',
  request: async () => ({ ok: true, reply: { status: 200, headers: {}, body: { issues: [], isLast: true } } }),
});

describe('trackerTransportOf', () => {
  const ready = { hasClient: true, override: undefined, baseUrl: 'https://jira.example', credentialSource: 'the environment' };

  it('picks the in-process reads for Jira with credentials, and names their source', () => {
    expect(trackerTransportOf(ready)).toEqual({ transport: 'in-process', reason: 'the tracker has an in-process client', tokenSource: 'the environment' });
  });

  it('keeps the shell where PLOT_HOST_TRANSPORT is shell, whatever else resolved', () => {
    expect(trackerTransportOf({ ...ready, override: ' Shell ' })).toMatchObject({ transport: 'shell', reason: 'PLOT_HOST_TRANSPORT=shell' });
  });

  it('keeps the shell with no credentials, and says why', () => {
    expect(trackerTransportOf({ ...ready, credentialSource: null })).toMatchObject({ transport: 'shell', reason: expect.stringMatching(/^no credentials/) });
  });

  it('keeps the shell with no base URL', () => {
    expect(trackerTransportOf({ ...ready, baseUrl: '' })).toMatchObject({ transport: 'shell', reason: 'no base URL is configured' });
  });

  it('has no choice for a tracker that is not Jira', () => {
    expect(trackerTransportOf({ ...ready, hasClient: false })).toBeNull();
    expect(trackerTransportOf({ ...ready, hasClient: false })).toBeNull();
  });

  it('prints a line that names the source and no credential, and no line where none is published', () => {
    const line = trackerTransportLine({ transport: 'in-process', reason: 'the tracker has an in-process client', tokenSource: '/repo/.env' });
    expect(line).toBe('tracker reads: in-process (the tracker is jira; credentials from /repo/.env)');
    expect(trackerTransportStatusLine({ transport: 'shell', reason: 'PLOT_HOST_TRANSPORT=shell', tokenSource: null })).toBe(
      '  tracker reads: shell (PLOT_HOST_TRANSPORT=shell)\n',
    );
    expect(trackerTransportStatusLine(undefined)).toBe('');
  });
});

describe('trackerReadsFor', () => {
  it('gives a Jira tracker with credentials the in-process reads', () => {
    const reads = trackerReadsFor(context, DECLARED, 'AB', { env: {}, client: () => fakeApi({ kind: 'environment' }) });
    expect(reads.choice).toMatchObject({ transport: 'in-process', tokenSource: 'the environment' });
    expect(reads.jira).toMatchObject({ ticketPrefixes: 'AB' });
  });

  it('names the .env file the credentials came from', () => {
    const reads = trackerReadsFor(context, DECLARED, '', { env: {}, client: () => fakeApi({ kind: '.env', path: '/repo/.env', source: 'worktree' }) });
    expect(reads.choice?.tokenSource).toBe('/repo/.env');
  });

  it('gives the shell where no credentials resolve', () => {
    const reads = trackerReadsFor(context, DECLARED, '', { env: {}, client: () => fakeApi(null) });
    expect(reads.choice).toMatchObject({ transport: 'shell' });
    expect(reads.jira).toBeNull();
  });

  it('gives the shell under PLOT_HOST_TRANSPORT=shell without resolving credentials', () => {
    let resolved = false;
    const api = { ...fakeApi({ kind: 'environment' }), credentialSource: () => ((resolved = true), null) };
    const reads = trackerReadsFor(context, DECLARED, '', { env: { PLOT_HOST_TRANSPORT: 'shell' }, client: () => api });
    expect(reads.choice).toMatchObject({ transport: 'shell', reason: 'PLOT_HOST_TRANSPORT=shell' });
    expect(reads.jira).toBeNull();
    expect(resolved).toBe(false);
  });

  it('gives no choice for a tracker that is not Jira', () => {
    const reads = trackerReadsFor(context, 'github-issues', '', { env: {}, client: () => fakeApi({ kind: 'environment' }) });
    expect(reads).toEqual({ choice: null, jira: null });
  });
});

describe('trackerFor with the in-process reads', () => {
  it('answers the open read with no process where the in-process reads are given, and starts the shell where they are not', async () => {
    const reads = trackerReadsFor(context, DECLARED, 'AB', { env: {}, client: () => fakeApi({ kind: 'environment' }) });
    const inProcess = await trackerFor(DECLARED, context, undefined, reads.jira ?? undefined).issueListOpen(10);
    expect(inProcess.ok).toBe(true);
    const shell = await trackerFor(DECLARED, context).issueListOpen(10);
    expect(shell.ok).toBe(false);
  });
});
