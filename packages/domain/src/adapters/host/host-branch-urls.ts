import type { BranchUrlScheme } from '../../rules/branch-url.js';

/** The hosts an origin URL names for Bitbucket Cloud: the web host and both SSH hosts. */
const BITBUCKET_CLOUD_HOSTS: ReadonlySet<string> = new Set([
  'bitbucket.org',
  'ssh.bitbucket.org',
  'altssh.bitbucket.org',
]);

/**
 * The git hosts whose branch pages `branchUrlBase` can link: GitHub (github.com
 * and any `github.*` host, `…/tree/<branch>`) and Bitbucket Cloud
 * (`…/branch/<branch>`, always on `bitbucket.org`). Any other host has no entry
 * and gets no link.
 */
export const HOST_BRANCH_URL_SCHEMES: readonly BranchUrlScheme[] = [
  {
    matches: (host) => host === 'github.com' || /(^|\.)github\./.test(host),
    base: (host, repoPath) => `https://${host}/${repoPath}/tree/`,
  },
  {
    matches: (host) => BITBUCKET_CLOUD_HOSTS.has(host),
    base: (_host, repoPath) => `https://bitbucket.org/${repoPath}/branch/`,
  },
];
