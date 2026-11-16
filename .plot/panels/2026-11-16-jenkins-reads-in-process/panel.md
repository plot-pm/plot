# Panel: jenkins-reads-in-process, round 2

- **Date:** 2026-11-16
- **Subject:** `docs/plans/2026-11-16-jenkins-reads-in-process.md` at `3491292d8`
- **Commitment:** `Position: proceed|amend|reject`
- **Reconcile:** `unanimous amend` — estate, security, census
- **Round 1:** unanimous amend at `cfd3a3ae0`; its files are in this directory's history at `8c61e9fe6`

## What each juror looked at

- **estate** checked its 11 round-1 edits against the plan, grepped the vendor gate (`ci.yml:1667`) against an import line, and read `fleetd.census.test.ts`, `registryd-main.ts` and `connector-https.ts`. It ran no tests.
- **security** checked its 10 round-1 edits, read `connector-https.ts:50` and `jen` 0.4.0 for its write and claim code, and read no secret. It ran no tests.
- **census** checked its 7 round-1 edits and read `fleetd.census.test.ts` and `sandbox.ts`. It ran no census.

## Where the jurors agree

Every juror found every round-1 edit of its own lens answered. Every juror found the five design choices added in the amendment sound: the realm from `JEN_REALM_URL` else the stored token's `iss`, a bare slug keeping the shell, credentials only to `https:` or loopback, the `token` bucket, and the census cap rule. The remaining edits are narrower than round 1's: each names a check, a path or a figure.

## Findings that two jurors reached separately

- **The `iss` fallback has no Done-when row.** security (edit 2) and census (edit 4) both found that fleetd under launchd has no `JEN_REALM_URL`, so `iss` is the realm source it uses, and that the census sets `JEN_REALM_URL` and so never exercises the fallback. Both ask for rows: `JEN_REALM_URL` wins over `iss`; an unreadable `iss` keeps the shell; a non-loopback `http:` instance, realm or `iss` keeps the shell and sends nothing.
- **The census cost figure is wrong.** estate (edit 2) found that the shell baseline builds one sandbox per fixture, so the Jenkins fixture adds an untraced run as well as a traced one. census (edit 5) found that 1.45 times the measured time keeps the 20-minute cap only up to about 828 s, below the plan's 1,000 s threshold.

## Findings one juror holds alone

- **estate:** the vendor gate *The domain names no vendor* (`ci.yml:1667`) matches an import path such as `./jenkins-pr-checks.js`, so new `rules/jenkins-*.ts` files that import each other fail it.
- **security:** the refresh lock needs a per-user path keyed by `jen`'s store directory, because two fleetds for two repositories share one store; the plan must state the consequence if reuse of a rotated refresh token revokes the session.
- **census:** the census requires S4 and P10 to be zero on every fixture (`fleetd.census.test.ts:279-283`, `:341-350`), which a pre-cutover Jenkins fixture breaks; recorded Jenkins answers cannot name per-run head SHAs (`sandbox.ts:281`, `:286`), so the stub must write its answers per run; the sandbox inherits `XDG_CONFIG_HOME`, `JEN_CONFIG_DIR`, `JEN_TOKEN` and `JENKINS_*` (`sandbox.ts:199-200`) and must pin or delete them.

## What the lenses had in common

The three lenses again read code and ran nothing. Two of census's findings (the S4/P10 list and the per-run SHAs) and estate's vendor-gate finding are facts a single CI run of a draft Slice 1 would show at once. The jurors agree on design; what remains is the class of defect that a first slice's CI finds faster than a third round of reading.
