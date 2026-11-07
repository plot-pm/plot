## Implementation brief — passkey-registration-moves-to-a-settings (wave 1: Foundations)

- **Plan (canonical):** docs/plans/2026-11-07-passkey-registration-moves-to-a-settings.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3215 merged
- **Branch:** `feature/passkey-registration-reads-the-attestation-object` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This branch shares wave 1 with `feature/the-board-has-a-settings-view`, and the two run in parallel. Nothing in this branch waits on the other. `feature/the-release-row-approves-itself` waits on the settings branch, not on this one.

### What to build

Registration fails today with "The authenticator returned no public key." when `response.getPublicKey()` returns null (`packages/board/src/app/components/PasskeyPanel.tsx:85-86`). Measured 2026-11-07: the operator's first registration through a password-manager authenticator failed this way, and a retry with the platform authenticator succeeded. The fix is a fallback, not a replacement: when `getPublicKey()` returns a key, the code path stays as it is.

Build two pure functions in `packages/board/src/app/lib/passkey.ts`, then call them from the register flow:

1. **`decodeAttestationPublicKey(attestationObject: ArrayBuffer)`** reads the CBOR map `{fmt, attStmt, authData}` and takes `authData`. It skips the 37-byte header (rpIdHash 32, flags 1, signCount 4), requires the AT flag (`0x40`), skips AAGUID (16 bytes) and the credential id (2-byte big-endian length, then that many bytes), and decodes the COSE key that follows. It returns `{ alg, spki }`, or refuses by throwing an `Error` whose message the panel shows.
2. **The COSE key to SPKI conversion.** An ES256 COSE key is a CBOR map with `1: 2` (EC2), `3: -7`, `-1: 1` (P-256), `-2: x` (32 bytes) and `-3: y` (32 bytes). The SPKI DER is the fixed 26-byte prefix `3059301306072a8648ce3d020106082a8648ce3d030107034200` followed by `04 ‖ x ‖ y`, 91 bytes in all.

In `PasskeyPanel.tsx`, replace the `if (!key) return …` line with the fallback: `key ?? decoded.spki`, and `alg` from the decoder when `getPublicKeyAlgorithm()` is also unavailable. Keep this diff to a few lines (see Scope guard).

### Decisions the plan settles — do not re-derive them

**The conversion happens in the browser, and `/api/passkey/register` does not change.** Open question 2 of the plan is settled by reading the server. `handlePasskeyRegister` (`packages/board/src/server/passkey.ts`) stores `body.publicKey` unchanged, and the verify adapter reads it with `createPublicKey({ format: 'der', type: 'spki' })` (`packages/domain/src/adapters/passkey/passkey-file.ts:19`). A COSE key sent to the route would register without error and fail every later assertion as `passkey-refused`. The plan promised no server change, and the `PasskeyRecord` doc says `publicKey` is SPKI DER.

**ES256 only; every other key refuses by name.** Open question 3 is settled: `pubKeyCredParams` requests `-7` alone, and the route refuses any other `alg` with `passkey-refused`. The decoder checks `kty = 2`, `alg = -7` and `crv = 1`, and refuses an RSA or Ed25519 key with the algorithm it found. It does not add support for them.

**This reverses one sentence of the earlier passkey brief, and the reversal is narrow.** `.plot/briefs/a-release-is-approved-with-a-passkey.md` said "A CBOR parser is a dependency and an attack surface the plan removed." The 2026-11-07 failure shows `getPublicKey()` is not universal, so the parser returns. Keep the cost it named small: no CBOR dependency, one hand-written reader of about 40 lines that handles only the types an attestation object holds (unsigned and negative integers, byte strings, text strings, maps; definite length). An indefinite length, a tag or a float throws. The decoder runs only in the browser on the response of the user's own authenticator, and the server never parses an attestation object.

**Read the COSE key by its own length, never "to the end of `authData`".** Bytes may follow the credential public key: the ED flag (`0x80`) adds an extensions map. A reader that takes the remainder as the key fails on exactly those authenticators.

**Absent is not false, and an unreadable object is not "no key".** A decoder that returns `null` on a malformed object collapses "this authenticator gives no key" into "this object is corrupt", and the panel's message then lies about which. Throw with the failed step named (`AT flag not set`, `unsupported COSE algorithm -8`, `attestationObject is not a CBOR map`).

**No key leaves the browser unless it parsed fully.** The register call happens only after the decoder returned an SPKI of exactly 91 bytes. A shorter key must not reach the store, because the store has no way to detect a wrong key until the person's first release approval fails.

### Done when

The plan's `## Done when` list is not present in this plan; its `## Changelog` line "Passkey registration succeeds with a password-manager authenticator by reading the public key from the attestation object" is the specification. Lift these assertions, each of which a naive implementation passes without:

- **The decoder's SPKI equals Node's own export.** In a unit test, generate a P-256 key with `node:crypto`, build the attestation object around its COSE form, decode it, and assert the result equals `publicKey.export({ type: 'spki', format: 'der' })` byte for byte. This catches a wrong prefix, a swapped `x` and `y`, and a dropped leading zero. A test that compares the output with a constant copied from the code's own prefix catches none of these.
- **The round trip verifies a signature.** Sign a message with the private key, then verify it with `createPublicKey` over the decoded SPKI. This is the check the real adapter makes, so it proves the key is usable and not merely well-formed.
- **A trailing extensions map does not shift the key.** One fixture sets the ED flag and appends an extensions map after the COSE key. Catches the read-to-the-end defect above.
- **A credential id of 0 and one of 255 bytes both decode.** Catches a one-byte length read in place of the 2-byte one.
- **Refusals name the step.** One test each for AT flag clear, a non-map attestation object, an RSA COSE key (`alg: -257`), an indefinite-length item and a truncated buffer. Each asserts the message, because a test asserting only "throws" passes when the throw comes from an out-of-range read.
- **`getPublicKey()` non-null still wins.** A test over the register helper (extract the choice into a small pure function if the panel is the only place it lives) asserts the browser's key is used when present. Catches a fallback that always decodes.

Build the fixtures with arrow-function helpers inside the test file. No attestation object from a real password manager is available to this branch; the Node-built fixtures prove the format, and the plan's wording "recorded attestation objects" is met by also adding one hand-checked hex fixture of a real `none`-format object if you can obtain one from the platform authenticator, and by saying in the PR if you could not.

Plus: add a changeset for `@plot-pm/board` (`patch`, description first and the `bumps:` block last), and run `./scripts/check-changeset-packages.sh`. Do not commit a rebuilt board artifact (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs`, with the path resolved from the repo root, before each push, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it. Every function you write is an arrow, in the board too (`CLAUDE.md`, *Arrow functions*).

### Bookkeeping

When the PR opens, run `skills/plot/scripts/plot-open-pr.sh` and not `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/app/lib/passkey.ts`, `packages/board/test/unit/passkey-*.test.ts` (new files for the decoder, for example `passkey-attestation.test.ts`) and the `register` function in `packages/board/src/app/components/PasskeyPanel.tsx`.

`feature/the-board-has-a-settings-view` (same wave, no branch or brief on `origin/main` at dispatch) moves registration out of `PasskeyPanel.tsx` into a settings view. Both branches touch the register flow, so keep your edit in `PasskeyPanel.tsx` to the lines around `getPublicKey()` and put the logic in `lib/passkey.ts`, where the settings branch can import it unchanged. If a rebase conflicts in `PasskeyPanel.tsx`, the settings branch's structure wins and your two-line fallback moves onto it.

Do not touch `packages/board/src/server/passkey.ts`, `packages/domain/**` or the `/api/passkey/*` routes. `feature/the-release-row-approves-itself` owns the `releaseApprovable` rule and the release row.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
