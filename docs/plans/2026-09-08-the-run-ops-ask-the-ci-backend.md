# The run ops ask the CI backend

> `plot-host.sh`'s `runs` and `run-for-sha` called `gh` with no CI branch at all, so a Jenkins repository asking the port for runs got GitHub's answer or nothing. **This plan is written after the work merged, and says so.**

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-08, Jan Wloka, in-session
- **Delivered:** 2026-09-11

## Changelog

- A repository's run history is asked of the CI system it declared, so a Jenkins team reaches Jenkins and a repository with no connector is told it cannot be asked.

<!-- Board impact: the check column on a Jenkins team fills from this op.
     Before it, the column was empty and the emptiness was indistinguishable
     from having no CI. -->

## Motivation

**This plan is a record, not a proposal.** The work merged as PR #837 on 2026-09-08 (`77ce9a50c`), +461/−72 across seven files, before any plan file existed. It is written on 2026-09-11 because the release gate refused 2.16.0 for exactly that absence, and the refusal was correct: a ticked sprint box is not a delivery record, and the estate held no evidence that anybody verified this slice.

**Writing it later means the `Done when` below is a statement of what was measured, not a promise.** That is the honest shape for a retrospective plan, and it is the reason this one carries no `Rounds:` — it was never challenged, because it was never a draft.

### The defect

`plot-host.sh`'s `runs` and `run-for-sha` arms gated on the **git host**, not the CI system. A repository whose code is on Bitbucket and whose builds run on Jenkins asked for runs and received an empty list — which reads to every caller as *this branch has never built*, rather than *this connector was never asked*.

**The empty list is the part that made it invisible.** An error would have been reported; an empty history is a legitimate answer for a branch that has genuinely never run, so nothing downstream could tell the two apart.

## What this is not

- **Not a Jenkins connector.** That is `the-ci-connector-is-jenkins`, and later `the-build-port-reaches-jenkins` (#880). This plan makes the *script* answer for the declared CI; the port reaching it is separate work.
- **Not sha-scoped gating on Jenkins.** `run-for-sha` gained a jenkins arm that **refuses** by name, because `jenkins_build_map` reports one state per branch and names no commit. See Notes.

## Slices

### The run ops dispatch on the CI key (Branch: bug/the-run-ops-ask-the-ci-backend, PR: #837)

`runs` and `run-for-sha` branch on `ci_scheme()` rather than calling `gh` unconditionally.

**Three arms, and the third is the one that changes behaviour for everybody.** `github-actions` keeps the existing call and adds a second condition — a GitHub remote is still required, because `gh run list` reads the runs of the repository its remote names, so `CI: github-actions` on a Bitbucket remote names runs nothing can reach; that exits 4. `jenkins` reaches `jenkins_build_map`. Anything else answers `ci_unaskable`.

**An unaskable connector exits 4 rather than printing nothing.** *Cannot be asked* and *has never built* are different answers, and only the exit code can carry the difference in an op whose success shape is a list.

**Done when** — all measured on `77ce9a50c`:

- `runs` on a `CI: jenkins` repository reaches `jenkins_build_map` and returns its `checks` word — measured.
- `runs` on `CI: github-actions` with a non-GitHub remote exits 4 and names why, rather than returning `[]` — measured.
- A repository declaring a CI with no connector exits 4 through `ci_unaskable` — measured.
- `run-for-sha` on Jenkins refuses by name rather than falling back to the branch's current state — measured; see Notes for why that fallback is the one answer that costs a merge.
- `test/reconcile/host.test.mjs` covers the three arms: +211/−7 in that file.

## Notes

### `run-for-sha` refuses on Jenkins, and the refusal is a measurement — 2026-09-08, amended 2026-09-10

`jenkins_build_map` answers `{color, checks, job}` per **branch** and carries no commit, so nothing in that transport can match a sha. The arm exits 4 and names three repairs rather than answering.

**Falling back to the branch's current state is the one answer that costs a merge.** This op exists because a run for a superseded commit reads identically to a run for the current one; reporting a branch-scoped state with no sha in it is exactly the guessing it was written to end.

**Amended 2026-09-10:** the sha *is* askable, over Jenkins' REST API at `actions[].lastBuiltRevision.SHA1`, using the Jenkins API token `jen` stores in the login keychain. Measured against a live instance: HTTP 200, and one `tree=` query returns a whole history with a distinct sha per build. **`jen` is not the transport** — it exposes no changesets subcommand, and the Keycloak bearer from `jen auth token` gets an HTML login redirect.

So the `exit 4` is now **a gap with a known fix rather than a transport limit**, and teaching this arm the REST route is the follow-up this plan hands on.

### Why this plan is dated 2026-09-08 and delivered 2026-09-11

The date in the filename is the date the work merged, so the plan sorts beside its siblings and `git log -S` finds them together. The `Delivered:` record is the date the record was written. **Both dates are true and they are not the same fact**, which is why the plan carries both rather than pretending the gap did not exist.
