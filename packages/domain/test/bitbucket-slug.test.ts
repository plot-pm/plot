import { describe, expect, it } from 'vitest';
import { bitbucketSlug } from '../src/rules/bitbucket-slug.js';

describe('bitbucketSlug', () => {
  it.each([
    ['https://bitbucket.org/acme/repo.git', 'acme/repo'],
    ['ssh://git@bitbucket.org/acme/repo.git', 'acme/repo'],
    ['ssh://git@bitbucket.org:22/acme/repo.git', 'acme/repo'],
    ['ssh://git@altssh.bitbucket.org:443/myws/myrepo.git', 'myws/myrepo'],
    ['git@bitbucket.org:acme/repo.git', 'acme/repo'],
    ['git@ssh.bitbucket.org:myws/myrepo.git', 'myws/myrepo'],
    ['git@bitbucket.org:12345/repo.git', '12345/repo'],
    ['https://bitbucket.org/Acme/Repo/', 'Acme/Repo'],
  ])('%s -> %s', (url, slug) => {
    expect(bitbucketSlug(url)).toBe(slug);
  });

  it.each([
    '',
    '/srv/git/repo.git',
    'git@github.com:acme/repo.git',
    'https://example.com/bitbucket.org/acme/repo',
    'git@bitbucket.org:repo.git',
  ])('%j -> null', (url) => {
    expect(bitbucketSlug(url)).toBeNull();
  });
});
