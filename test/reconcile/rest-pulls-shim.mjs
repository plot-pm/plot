// Lets a `gh` stub that answers `gh pr list --head <branch> --json …` from a
// table also answer the REST read `plot-host.sh` makes for the `pr-merged`
// family: `gh api repos/<owner>/<repo>/pulls?head=<owner>:<branch>&state=…&per_page=…&page=… --include`.

/**
 * JS source for a node `gh` stub, placed right after the stub's own
 * `const argv = process.argv.slice(2);` (and after any argv log, so the log
 * holds the real call). On a REST `pulls?` call it rewrites `argv` in place to
 * the equivalent `pr list --head <branch> --state <state> --limit <page × per_page>`,
 * lets the stub answer that, and on exit prints the asked page as REST rows
 * after a header block, as `gh api --include` does. A non-zero exit passes the
 * stub's own output through unchanged.
 */
export const restPullsAsPrList = `
if (argv[0] === 'api' && /\\/pulls\\?/.test(argv[1] || '')) {
  const q = new URLSearchParams(argv[1].slice(argv[1].indexOf('?') + 1));
  const page = Number(q.get('page') || 1);
  const per = Number(q.get('per_page') || 30);
  const head = (q.get('head') || '').replace(/^[^:]*:/, '');
  argv.splice(0, argv.length, 'pr', 'list', ...(head ? ['--head', head] : []), '--state', q.get('state') || 'open',
    '--limit', String(page * per), '--json', 'number,state,mergedAt,headRefName,headRefOid,mergeCommit,baseRefName,updatedAt');
  const fd1 = process.getBuiltinModule('node:fs');
  let held = '';
  process.stdout.write = (chunk) => { held += chunk; return true; };
  process.on('exit', (code) => {
    if (code) { fd1.writeSync(1, held); return; }
    const rows = (held.trim() === '' ? [] : JSON.parse(held)).map((r) => ({
      number: r.number ?? 0,
      state: r.mergedAt || r.state === 'CLOSED' || r.state === 'MERGED' ? 'closed' : 'open',
      merged_at: r.mergedAt ?? null,
      merge_commit_sha: r.mergeCommit ? r.mergeCommit.oid : null,
      updated_at: r.updatedAt || '2026-01-01T00:00:00Z',
      html_url: r.url ?? '',
      draft: r.isDraft ?? false,
      title: r.title ?? '',
      user: { login: (r.author && r.author.login) || '' },
      head: { ref: r.headRefName ?? head, sha: r.headRefOid ?? null },
      base: { ref: r.baseRefName ?? '' },
    }));
    fd1.writeSync(1, 'HTTP/2 200\\r\\n\\r\\n' + JSON.stringify(rows.slice((page - 1) * per, page * per)));
  });
}
`;
