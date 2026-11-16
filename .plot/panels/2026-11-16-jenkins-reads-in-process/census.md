Round: 2

# Census and measurement juror

Position: amend

Lens: whether the goal (an idle fleetd pass starts no `jen`; Jenkins reads run in-process) is proved by a CI census row on a fixture that reaches Jenkins through the stub server, with a strict or tolerance limit, a lower bound, a baseline, a report key that does not collide, and a cost the census step's cap can carry.

The amendment answers all seven of round 1's census edits. Three new gaps remain, and each one makes the census row red for the wrong reason or green without the proof. The first is that the existing census file asserts S4 and P10 zero on every fixture. The second is that recorded Jenkins answers cannot name the sandbox's runtime commit SHAs. The third is that the sandbox inherits the runner's `XDG_CONFIG_HOME` and `jen` variables. Two smaller edits cover the realm fallback and the cap threshold.

## Round 1 edits, checked against the plan at 3491292d8

1. Report key: answered. `ci` goes into `CensusFixture`, `entryKey`, `rowTitle` and `sizeLine` where set (plan line 95), with a `census-report.unit.test.ts` row (Done-when line 152). Keys of the three existing fixtures do not change, so the merge-base comparison of S4–P11 stays intact.
2. Injection: answered. `JEN_URL=http://127.0.0.1:<port>/jenkins` and `JEN_REALM_URL=http://127.0.0.1:<port>/realm` (line 94). The corpus row covers an `http://127.0.0.1:<port>` value (line 137). `jen:6` makes `JEN_URL_PATTERN` a constant, so `JEN_URL` is the right variable.
3. Lower bound: answered (lines 116, 158). The bound is at least one Jenkins request per PR beat, and the `checks` words must equal the shell run's.
4. Credentials: answered. The plan gives a file backend under the sandbox `HOME`, a blob past `expires_at`, a token route, and a route that refuses a request without either header (line 94).
5. Predicate: answered. `jen`, plus `plot-host.sh` with `pr-list`, `runs`, `run-for-sha`, `runs-for-sha` or `pr-state` (line 96). The plan says why S4 on the fixture is recorded and not asserted (line 117).
6. Inversion of `bitbucket-jenkins.census.test.ts:52-56`: answered (line 115).
7. Cost and tolerance reruns: answered (lines 97, 118). The threshold has a defect (edit 5 below).

## 1. Existing deliverables

None. `packages/domain/src/adapters/build/` holds `build-jenkins.ts` and no `jenkins-api.ts`. `rules/` holds `jenkins-pr-checks.ts` and no `jenkins-url.ts`, `jenkins-build-map.ts` or `jenkins-sha-runs.ts`. `census-rows.ts` ends at P11 and S8, and no P12 exists. The sandbox already takes `ci` (`sandbox.ts:30`, `:83`, which writes `CI: jenkins` and `Jenkins instance: census`), so Slice 1 needs no new sandbox option. The plan does not mention this, which is harmless.

## 2. Factual claims checked

I checked these with `sed -n` and `grep` on this checkout:

- `ci.yml:887-892`: the 20-minute cap, with the comment "830 s measured … 1.45 times that". True.
- `ci.yml:2850`: `validate`'s `needs:` does not include the census job. True.
- `fleetd.census.test.ts:223-245`: the shell-baseline block that sets `PLOT_HOST_TRANSPORT=shell`. True.
- `census-report.ts:144-145`: `entryKey` without `ci`. True. `:187` is the docstring of "the last entry counts". True.
- `bitbucket-jenkins.census.test.ts:52-56` (`bbOpenReads > 0`) and `:64-67` (the start line). True.
- `sandbox.ts:265-267`: stub `gh`, `bb` and `curl`, and no `jen`. True.
- `jen:150-155`: `expires_in // 300` is jq's alternative operator (default 300), and `− 30` is applied. True, although the plan's parenthesised form reads like integer division.

One claim is wrong. Line 96 says the Jenkins baseline "adds one traced run and no extra untraced run". The shell-baseline block runs inside the per-fixture `beforeAll` of `describe.each(FIXTURES)` (`fleetd.census.test.ts:154`, `:174`). A fourth fixture therefore adds one traced run and one untraced shell run. The 120 s estimate still holds, because the 358 s for three fixtures already includes their baselines. The cost figure is right and the sentence is wrong (non-blocking).

## 3. Done-when rows: fail before, pass after

- **P12 green** (line 157): fails before, because the shell rich read runs `plot-host.sh pr-list` and `jen` each beat. It passes after. With the lower bound (line 158), a client that never reaches the stub now fails. This is sound, subject to edit 2. If edit 2 is not made, the `checks` equality compares `unknown` with `unknown`.
- **Census measures Jenkins** (line 153): a baseline above 0 under `it.fails` (`census-rows.ts:20-21`). Before the slice, the row is absent. This is acceptable for a baseline slice.
- **Request count** (line 163): `≤` beside the lower bound. It now cannot pass on 0 requests. The shell side has to count stub `jen` invocations from the stub log, because the replaying stub `jen` sends no request to the stub server. The plan implies this and does not name it (non-blocking).
- **Census key** (line 152): fails before, because the two keys are equal. Passes after.
- **Removed processes are counted** (line 165): a record in *Measures* and not a check. It cannot fail. This is acceptable as a record.
- **GitHub and Bitbucket without Jenkins are unchanged** (line 166): a regression guard. It cannot fail before, by design.

## 4. Missing or wrong

a. **S4 and P10 already assert zero on every census fixture, and the Jenkins fixture fails both until cutover.** `fleetd.census.test.ts:279-283` asserts `expect(each).toEqual([0, 0])` for S4 on every member of `FIXTURES`. `:341-350` does the same for P10 on every Bitbucket member ("no plot-host.sh pr-list and no bb"). Since #3452, S4 is a required pass (story *Measures*, S4 row). On the Jenkins fixture in Slices 1 and 2, `SHELL_RICH_CI` sends the rich read through `plot-host.sh pr-list --rich` every beat, so P10 and S4 go red. After cutover, the plan itself expects S4 to be above 0 there (line 117), because `CI: jenkins` lets the default-branch read reach `git ls-remote` over `census-ssh`, so S4 stays red. The plan says P12 runs "in the existing shell-baseline block". It does not say whether the fixture joins `FIXTURES`, which rows run on it, or how S4 is "recorded, not asserted" when the row it shares asserts zero. As written, Slice 1 turns the census job red.

b. **Recorded Jenkins answers cannot match the fixture's commits.** The sandbox commits at run time with no fixed `GIT_AUTHOR_DATE` or `GIT_COMMITTER_DATE` (`sandbox.ts:209-214`, `:278-286`). Every PR head is `mainSha`, read by `rev-parse` (`:281`, `:286`). The `gh` and `bb` answers are written per run from those SHAs (`answer(...)`, `:296-330`), and the stub server serves them from the same files, so both transports read one fixture (`stub-host.ts:340-350`). The plan has the Jenkins route serve *recorded* `api/json?tree=builds[…]` answers and the stub `jen` replay *recorded* `jen` output (lines 94, 153). A recorded build's `lastBuiltRevision` can never equal this run's `mainSha`. So `bindChecks` answers `unknown` with `checksSha: ''` for every row (`jenkins-pr-checks.ts:118`). If the recorded colours are `pending` or `none`, `rowsToBind` asks for no SHA at all (`:84-86`). In both cases the census never runs the bind path. The lower bound "`checks` words equal the shell run's" then compares `unknown` with `unknown`, and the SHA-lookup half of the read (up to 10 of 13 `jen` calls per beat) is not measured as it would run.

c. **The sandbox inherits the runner's `jen` configuration.** The sandbox env starts from `...process.env` (`sandbox.ts:199-200`) and deletes only the Bitbucket, Plot and systemd keys (`:232-236`). It keeps `XDG_CONFIG_HOME`, `JEN_CONFIG_DIR`, `JEN_SECRET_BACKEND`, `JEN_TOKEN`, `JENKINS_USER` and `JENKINS_API_TOKEN`. The client probes `${JEN_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/jen}` (line 86). Where the runner image sets `XDG_CONFIG_HOME` (GitHub's Ubuntu images commonly do), the probe looks outside the sandbox `HOME`, finds no token file, and keeps the shell. P12 then stays red with the reason "no credentials" rather than the reason under test. An inherited `JEN_TOKEN` would instead skip the refresh that the fixture blob sets up.

d. **The `iss` fallback has no Done-when row, and the census bypasses it.** Under fleetd's unit, `JEN_REALM_URL` is never set (line 68), so the `iss` claim is the only realm source fleetd uses on an operator's machine. The census sets `JEN_REALM_URL` (line 94). No client or composition row tests a refresh with `JEN_REALM_URL` unset, and no row tests an `iss` that is absent, malformed, or neither `https:` nor loopback. The rotation measurement (line 151) records whether `iss` equals the realm URL, but that is a fact for a person, not a check.

e. **The P12 lower bound's unit.** "At least one request per PR beat" needs a count of beats per pass. P5, P10 and P11 deliberately sum over both idle passes, because "a periodic read falls in either pass" (`fleetd.census.test.ts:331-334`). The plan should use the same sum: in-process Jenkins requests summed over both idle passes are above 0 and at most the shell's (non-blocking, wording).

## 5. The eight decisions and the five added design choices

The eight decisions agree with the census design. Decision 5 (one switch) fits the baseline block. Decision 7 is proved by a fleet row, not the census, which is right: the board's PR reader is not a census subject. Decision 4 (GitHub) is proved by a corpus row only, and the plan says so (line 112).

The five added choices:

- **Realm from `JEN_REALM_URL`, else `iss`:** consistent, but only the first arm is tested. See 4d and edit 4.
- **Bare slug with no `JEN_URL` keeps the shell:** consistent. The census fixture is the bare slug `census` with `JEN_URL` set, so it resolves. The composition row (line 139) covers the no-`JEN_URL` arm. The consequence belongs in the operator note at cutover: on the operator's machine, the saving needs a `Jenkins instance` that names a host.
- **Credentials only to `https:` or loopback:** consistent. The census stub is `http://127.0.0.1`.
- **Refresh POST under connector `jenkins`, bucket `token`:** consistent. Line 163 counts token-route requests apart, and the ledger row (line 150) holds the bucket.
- **Cap rises to 1.45× the measured HEAD time where HEAD exceeds 1,000 s:** inconsistent with the derivation it cites. The comment sets cap = 1.45 × measured (830 s → 20 min). The 20-minute cap keeps that margin only while HEAD is at most 1,200 / 1.45 ≈ 828 s. The plan's own estimate is about 950 s, which leaves 1.26×. A HEAD of 1,000 s leaves 1.2×. The threshold that follows the comment is 828 s.

## Required edits

1. Name the Jenkins fixture's place in the census file. One option is a separate `describe` on the Bitbucket 3-desk 5-PR `ci: 'jenkins'` fixture that runs P12 and records S4 as a measured count. The other option is a `FIXTURES` entry whose S4 and P10 are skipped or recorded only. Either way, list which existing rows (P3, P4, P7, P8, P11) run on it. Without this, the S4 and P10 zero asserts (`fleetd.census.test.ts:279-283`, `:341-350`) turn the census red from Slice 1.
2. Write the stub Jenkins answers per run from the sandbox's SHAs, as the `gh` and `bb` answers are written (`sandbox.ts:296-330`). Include at least one PR branch whose colour is `green` and whose head `mainSha` has a `SUCCESS` build, so `rowsToBind` and `bindChecks` run and the `checks` equality compares a bound word. Have the stub `jen` derive its output from the same answer files. Use the real-`jen` recording to prove the stub's output shape in a corpus row, and not to supply census bytes.
3. In the sandbox, set `JEN_CONFIG_DIR` (or `XDG_CONFIG_HOME`) inside the sandbox root. Delete the inherited `JEN_TOKEN`, `JENKINS_USER`, `JENKINS_API_TOKEN` and `JEN_SECRET_BACKEND` before you set the census values.
4. Add a client row for the `iss` fallback. With `JEN_REALM_URL` unset, the refresh grant must post to `<iss>/protocol/openid-connect/token`. An absent `iss`, an unparseable `iss`, or an `iss` that is neither `https:` nor loopback must keep the shell with a named reason.
5. Set the census cap threshold to the derivation it cites: raise `timeout-minutes` to 1.45 × the measured HEAD time where that exceeds the present 20 minutes, which means a HEAD above about 828 s. Alternatively, state why 1,000 s is the threshold.

Non-blocking notes: line 96's "no extra untraced run" (see section 2); the P12 bound summed over both idle passes (see 4e); and naming the stub log as the shell side's `jen` count (see section 3).
