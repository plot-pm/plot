# Bitbucket: an scp-style remote with a numeric workspace keeps its slug

> The Bitbucket slug parse in `plot-host.sh` reads a remote URL once, as a domain rule, and keeps a numeric workspace in an scp-style remote.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2055
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2064 merged
- **Started:** 2026-10-18, Jan Wloka, `bug/an-scp-style-remote-with-a`

## Changelog

- Fix: `commit-status` on Bitbucket no longer exits 4 for an scp-style remote with a numeric workspace, such as `git@bitbucket.org:12345/repo.git`.

<!-- Board impact: none. The plan format, template, and docs/plans layout do not change. -->

## Motivation

`plot-host.sh:5369` derives the Bitbucket `<workspace>/<repo>` slug from `remote.origin.url` with a sed pipeline. Its port strip, `s#(bitbucket\.org):[0-9]+/#\1/#`, has no anchor for the URL form. It matches the scp-style remote `git@bitbucket.org:12345/repo.git` as if `12345` were a port, removes the workspace, and `commit-status` exits 4. Found in a review of the Bitbucket parity work, tracked on #1848.

An scp-style remote has no port. The colon separates host from path. A URL with a scheme, such as `ssh://git@bitbucket.org:22/<workspace>/<repo>.git`, has a port after the colon. The sed pipeline cannot tell the two apart.

## Design

### Approach

Replace the sed pipeline with one domain rule that parses a remote URL into a slug, reached from the shell through a shipped bundle. This follows *A Shell Script Asks The Domain* in `CLAUDE.md`: the call runs once per operator command, and a bundle answers in about 39 ms.

The rule distinguishes two forms by the presence of a scheme:

- A URL with a scheme (`https://`, `ssh://`): the port, if present, follows the host. The rule strips it.
- An scp-style remote (`user@host:path`): the colon starts the path. The rule keeps the first path segment as the workspace.

`scripts/check-shell-lines.sh` ratchets shipped shell lines. The change removes the sed pipeline and adds only the bundle call, so the line count must not grow.

Unit tests cover one case per remote form:

| Form | Example | Slug |
|---|---|---|
| https | `https://bitbucket.org/acme/repo.git` | `acme/repo` |
| ssh URL, no port | `ssh://git@bitbucket.org/acme/repo.git` | `acme/repo` |
| ssh URL, port | `ssh://git@bitbucket.org:22/acme/repo.git` | `acme/repo` |
| scp-style, named workspace | `git@bitbucket.org:acme/repo.git` | `acme/repo` |
| scp-style, numeric workspace | `git@bitbucket.org:12345/repo.git` | `12345/repo` |

Board impact: none.

### Open Questions

- [ ] Does another script or adapter parse a Bitbucket remote with its own pattern? A search for `bitbucket\.org` in `skills/plot/scripts` finds only line 5369, but `packages/fleet/src/shared/fleet-scan.ts:199` handles origin hosts and needs a read before the slice starts.
- [ ] Does the rule belong in an existing domain module or a new one under `packages/domain/src/rules/`?

## Slices

### Slug parse

- `bug/an-scp-style-remote-with-a` — add the remote-to-slug domain rule with one unit test per remote form, ship it as a bundle, and call it from `plot-host.sh` in place of the sed pipeline <!-- builds: a remote-to-slug rule for Bitbucket remotes -->

## Notes

- Created from tracker issue #2055 by `/plot-idea`. Stops at Draft; nothing is written to the tracker.
