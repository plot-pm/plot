# Passkey registration moves to a settings menu; release approval moves to the release PR

> The passkey panel sits in the agent sidebar and holds two unrelated jobs; registration moves to a settings view behind a gear icon, release approval moves to the release PR's own row, and registration reads the public key from the attestation object when `getPublicKey()` returns null.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #3214
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3215 merged

## Changelog

- The board has a gear icon in the upper right that opens a settings view with passkey registration, its state and a Replace or Register action; the icon carries a marker while no passkey is registered.
- The release PR's row shows "Approve release" while the release PR is ready; the PR number and head SHA come from the board's own reading and the sidebar fields leave.
- Passkey registration succeeds with a password-manager authenticator by reading the public key from the attestation object.

Board impact: board only (`packages/board`, plus one rule in `packages/domain`). No change to the plan format, the template, the helper scripts or `docs/plans`. The server routes `POST /api/release-approve`, `/api/passkey` and the assertion checks do not change, so no board artifact contract moves; rebuild the artifact only if a shipped bundle imports a changed domain export.

## Motivation

`PasskeyPanel` (`packages/board/src/app/components/PasskeyPanel.tsx`) renders in the agent sidebar under `StatusPanel` (`AgentList.tsx:1034`). It holds registration, done once per browser, and release approval, done once per release. Neither helps orient on the fleet, and the operator could not find the panel on 2026-11-06.

The approval form asks the operator to type a PR number and a head SHA that the board already knows. A typed SHA can also disagree with the head the board shows, which the server then refuses as `head-moved`.

On 2026-11-07 the operator's first registration failed with "The authenticator returned no public key." because `response.getPublicKey()` (`PasskeyPanel.tsx:85`) returns null for some authenticators, including password-manager extensions. A retry with the platform authenticator succeeded.

## Design

### Approach

**Settings view.** A gear icon in the board header opens a settings view. It reads `GET /api/passkey` (`registered`, `credentialId`, `registeredAt`) and shows "Passkey registered on <local date and time>" with a shortened credential id and a Replace action, or "No passkey registered" with a Register action. The gear carries a marker while `registered` is false. The `originNotice` behaviour for a non-`localhost` page moves with registration.

**Approve on the release PR.** The release row (`rowSubject` returns `release` for `changeset-release/*`, `rows.tsx:122`) shows "Approve release" only while the release PR is ready: `plot/review` passed on its head and the head's CI passed. The row supplies `pr` and `sha`. While no passkey is registered the action is disabled with "Register a passkey in Settings first". The free-form PR and SHA inputs leave the sidebar, and the sidebar `PasskeyPanel` is removed.

**Readiness is a domain property.** Per *Every rendered state is a domain property*, "release PR is ready" and the approve button's enabled, disabled or hidden state are computed in `packages/domain` from the indexed `plotReview`, `plotReviewSha` and `ciChecks` fields and unit-tested. The `.tsx` renders the answer. The server still re-reads the head and `plot/review` before it merges (`release-approve` refusals `head-moved` and `review-missing`), so the row's reading is a convenience and never the gate.

**Public key from the attestation object.** When `getPublicKey()` returns null, registration decodes `response.attestationObject` (CBOR), reads `authData`, skips the 37-byte header and the attested-credential header (AAGUID, credential id length and id), and takes the COSE credential public key. The board converts it to the same SPKI form `/api/passkey/register` receives today, or the server-side contract stays unchanged by sending the form the route already accepts. The decoder lives in `app/lib/passkey.ts` as a pure function with tests over recorded attestation objects.

### Open Questions

- [ ] Where does the settings view live: a modal, a route, or a tab beside Agents? The board keeps view state in the URL, which favours a route.
- [ ] Does the route accept the COSE key as is (with `alg`), or must the client convert it to SPKI? Reading `server/passkey.ts` decides this in the first slice.
- [ ] Is a COSE ES256 key the only algorithm to support? `pubKeyCredParams` requests `-7` only.

## Slices

### Foundations

- `feature/passkey-registration-reads-the-attestation-object` — decode `attestationObject` when `getPublicKey()` returns null <!-- builds: decodeAttestationPublicKey, a CBOR authData reader -->
- `feature/the-board-has-a-settings-view` — gear icon, registration state, Register and Replace, no-passkey marker <!-- builds: SettingsView, the board's settings surface -->

### Release approval

- `feature/the-release-row-approves-itself` — `releaseApprovable` domain rule, "Approve release" on the release row, sidebar panel and free-form fields removed <!-- builds: releaseApprovable, the release PR's readiness rule -->

## Notes

- Source: tracker issue #3214. The plan reads the issue as a brain dump and does not copy it.
- The release row slice follows the settings slice because its disabled state points the operator at Settings.
