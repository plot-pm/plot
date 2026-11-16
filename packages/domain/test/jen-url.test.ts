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

describe('jenUrlFor', () => {
  it('passes a URL through and strips one trailing slash', () => {
    expect(jenUrlFor('http://127.0.0.1:8080/jenkins/')).toBe('http://127.0.0.1:8080/jenkins');
    expect(jenUrlFor('https://j.example.org')).toBe('https://j.example.org');
  });

  it('gives a host the https scheme', () => {
    expect(jenUrlFor('j.example.org/')).toBe('https://j.example.org');
  });

  it('names no URL for a bare slug', () => {
    expect(jenUrlFor('portal')).toBeNull();
  });
});

describe('jenInstanceUrl', () => {
  it('prefers JEN_URL, and falls back to the slug where it is unset or empty', () => {
    expect(jenInstanceUrl('http://x:1/j/', 'portal')).toBe('http://x:1/j');
    expect(jenInstanceUrl(undefined, 'j.example.org')).toBe('https://j.example.org');
    expect(jenInstanceUrl('', 'portal')).toBeNull();
  });
});

describe('jenUrlHost and jenKeyFor', () => {
  it('reads the lower-case host[:port], up to a path, query or fragment', () => {
    expect(jenUrlHost('https://J.Example.org:8443/a/b')).toBe('j.example.org:8443');
    expect(jenUrlHost('http://h?q=1')).toBe('h');
    expect(jenUrlHost('http://h#f')).toBe('h');
    expect(jenUrlHost('http://h')).toBe('h');
  });

  it('answers the empty string for a relative or empty value', () => {
    expect(jenUrlHost('/relative')).toBe('');
    expect(jenUrlHost('')).toBe('');
  });

  it('keys an instance by its host, and a bare slug by nothing', () => {
    expect(jenKeyFor('https://j.example.org/x')).toBe('j.example.org');
    expect(jenKeyFor('portal')).toBeNull();
  });
});

describe('jenSecretFile', () => {
  it('replaces : and / in the key', () => {
    expect(jenSecretFile('/d', 'a:b/c')).toBe('/d/a_b_c.secret');
  });
});

describe('jenSaveToken', () => {
  it('stamps the expiry from expires_in, minus 30 s', () => {
    expect(JSON.parse(jenSaveToken({ access_token: 'a', expires_in: 100 }, 1000))).toEqual({ access_token: 'a', expires_in: 100, expires_at: 1070 });
  });

  it('takes 300 s where expires_in is absent or not a number', () => {
    expect(JSON.parse(jenSaveToken({ access_token: 'a' }, 1000))).toMatchObject({ expires_at: 1270 });
    expect(JSON.parse(jenSaveToken({ expires_in: '5' }, 1000))).toMatchObject({ expires_at: 1270 });
  });
});

describe('jenUrlencode and jenJobPath', () => {
  it('encodes every byte but the unreserved set, in upper case', () => {
    expect(jenUrlencode('a/b c~é')).toBe('a%2Fb%20c~%C3%A9');
  });

  it('turns a job path into /job segments, with one optional trailing branch', () => {
    expect(jenJobPath('team/portal')).toBe('/job/team/job/portal');
    expect(jenJobPath('/team/portal/', 'docs/foo')).toBe('/job/team/job/portal/job/docs%2Ffoo');
    expect(jenJobPath('', 'main')).toBe('/job/main');
    expect(jenJobPath('/')).toBe('');
  });
});

describe('jenStatusClass', () => {
  const realm = 'https://sso.example.org/realms/x';
  const cls = (status: number, location = ''): string => jenStatusClass(status, location, realm, 'j.example.org');

  it('reads a redirect to the realm or to /oauth2/ as a dead session', () => {
    expect(cls(302, 'https://sso.example.org/auth')).toBe('auth');
    expect(cls(302, 'https://j.example.org/oauth2/start')).toBe('auth');
  });

  it('reads a redirect to the instance itself as an answer', () => {
    expect(cls(302, 'https://j.example.org/login')).toBe('ok');
  });

  it('reads a redirect elsewhere, or with no Location, as foreign', () => {
    expect(cls(302, 'https://other.example.org/')).toBe('foreign');
    expect(cls(301)).toBe('foreign');
    expect(jenStatusClass(302, 'https://sso.example.org/', '', 'j.example.org')).toBe('foreign');
  });

  it('reads 401 and 403 as auth, other 4xx and 5xx as failed, and the rest as ok', () => {
    expect(cls(401)).toBe('auth');
    expect(cls(403)).toBe('auth');
    expect(cls(404)).toBe('failed');
    expect(cls(500)).toBe('failed');
    expect(cls(200)).toBe('ok');
  });
});

describe('jenJobsOf', () => {
  it('reads the jobs of a container, and null for anything else', () => {
    expect(jenJobsOf({ jobs: [1] })).toEqual([1]);
    expect(jenJobsOf({ name: 'x' })).toBeNull();
    expect(jenJobsOf(null)).toBeNull();
    expect(jenJobsOf([])).toBeNull();
    expect(jenJobsOf('s')).toBeNull();
  });
});
