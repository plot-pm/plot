## Implementation brief — passkey-registration-moves-to-a-settings (wave 1: Foundations)

- **Plan (canonical):** docs/plans/2026-11-07-passkey-registration-moves-to-a-settings.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3215 merged
- **Branch:** `feature/the-board-has-a-settings-view` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This branch shares wave 1 with `feature/passkey-registration-reads-the-attestation-object`, and the two run in parallel. Nothing here waits on that branch. `feature/the-release-row-approves-itself` (wave 2) waits on this branch, because its disabled state points the operator at Settings.

### What to build

The operator could not find the passkey panel on 2026-11-07. `PasskeyPanel` (`packages/board/src/app/components/PasskeyPanel.tsx`) renders in the agent sidebar (`AgentList.tsx:1034`) and holds registration, done once per browser, next to release approval, done once per release. Registration moves to a settings view behind a gear icon in the board header. Release approval stays in the sidebar panel until the wave-2 branch removes it.

Build four things:

1. **A gear button in the header** (`App.tsx`, the `<header>` at line 1229, after the `Views` nav) with `aria-label="Settings"`. It opens the settings view. It carries a marker while `GET /api/passkey` answers `registered: false`.
2. **`SettingsView`** (new component). It reads `GET /api/passkey` (`registered`, `credentialId`, `registeredAt`) and shows "Passkey registered on <local date and time>" with a shortened credential id and a Replace action, or "No passkey registered" with a Register action. The `originNotice` behaviour for a page not on `localhost` moves here with registration: a notice and no controls.
3. **A domain rule for what the view shows.** The wording of the registration line, the action label (`Register` or `Replace`), the shortened credential id and the gear marker are decided in `packages/domain/src/rules/` (new file, for example `passkey-settings.ts`, with a unit test in `packages/domain/test/`). The `.tsx` renders the answer. Follow `rules/board-tab.ts` and its test as the model, including TSDoc that states behaviour and nothing of the history.
4. **Registration moves out of `PasskeyPanel`.** The `register` flow (challenge, `navigator.credentials.create`, `POST /api/passkey/register`) lives in `SettingsView`. `PasskeyPanel` loses its Register button and shows "Register a passkey in Settings" in its place while none is registered. Its approval form is unchanged: wave 2 owns it.

### Decisions the plan settles — do not re-derive them

**The settings view is a route, and it is not a fourth tab.** The plan's open question 1 (modal, route or tab) is settled here, because the plan leaves it to the first slice. `BoardTab` (`rules/board-tab.ts`) is `discovery | planning | delivery`, and `App.tsx` maps it to the `Views` nav and to `parseTab`. A `settings` member would put Settings in that nav, where the plan wants a gear. Use a separate URL parameter, `?settings=1`, read and written the way `?lanes=1` and `?released=1` already are (`App.tsx:208` and `:213`, `history.replaceState`). The `tab` parameter stays untouched, so closing Settings returns the operator to the tab they left, and a reload stays on Settings. A modal fails the plan's own test: the board keeps view state in the URL.

**Registration logic is extracted, not copied.** The `post` and `challenge` helpers and the `register` flow exist once today, in `PasskeyPanel.tsx`. Both `PasskeyPanel` (approval) and `SettingsView` (registration) need the challenge call. Put the shared client code in a new file, `packages/board/src/app/lib/passkey-client.ts`, and do not add to `lib/passkey.ts`. The sibling branch owns `lib/passkey.ts` and adds the attestation decoder there; a second writer in that file makes the merge a conflict for no benefit.

**The server does not change.** `GET /api/passkey`, `POST /api/passkey/challenge`, `POST /api/passkey/register` and `POST /api/release-approve` keep their shapes. The settings view is a second caller of routes that exist.

**The marker reads one answer, and absent is not "unregistered".** `held === null` means the read has not finished or failed. The gear shows no marker in that state. A marker that appears while the board is still loading, or while `/api/passkey` is unreachable, tells the operator to register a passkey that may already exist. Only `registered: false` from the server marks the gear. The domain rule takes `Registration | null` and its test covers `null`.

**The `rp.id` stays `'localhost'`.** Registration is bound to `localhost` (`PASSKEY_HOST`), and a page on any other host gets the notice and no controls. Do not generalise it.

### Done when

The plan has no `## Done when` list. Its `## Changelog` line "The board has a gear icon in the upper right that opens a settings view with passkey registration, its state and a Replace or Register action; the icon carries a marker while no passkey is registered" is the specification. Lift these assertions, each of which a naive implementation passes without:

- **The domain rule has a unit test per state.** Cases: `null` (no marker, wording says the read is pending), `registered: false` (marker, Register), `registered: true` (no marker, Replace, credential id shortened, local date), and a non-`localhost` hostname (the notice and no action). This catches a marker computed in the `.tsx`, which only a browser test could then reach.
- **One browser test proves the gear is seen.** With `/api/passkey` stubbed to `registered: false`, the gear carries its marker and opens Settings, the URL holds `settings=1`, and the page shows "No passkey registered" and a Register button. Stub with a synchronous Playwright route callback. Do not call WebAuthn: the test asserts what is shown and does not register.
- **Closing Settings keeps the tab.** Open Settings from `?tab=delivery`, close it, and assert `tab=delivery` is still in the URL. This catches a close that resets to `planning`.
- **The sidebar panel still approves.** `PasskeyPanel`'s approval form works as before, and its Register button is gone. Existing tests that name "Register passkey" in the panel move to the settings view or change; none is deleted without its assertion moving.

Plus: add a changeset for `@plot-pm/board` (`minor`, description first and the `bumps:` block last) and run `./scripts/check-changeset-packages.sh`. Do not commit a rebuilt board artifact (`scripts/check-no-bundle-diff.sh`). Rebuild it locally only if a shipped bundle imports your new domain export, and restore it before the push. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs`, with the path resolved from the repo root, before each push, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. A local `test:board` takes down an operator's open board, so run the browser test by name only. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it. Every function you write is an arrow, in the board too (`CLAUDE.md`, *Arrow functions*).

### Bookkeeping

When the PR opens, run `skills/plot/scripts/plot-open-pr.sh` and not `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the gear in `App.tsx`'s header, the new `SettingsView` component, `app/lib/passkey-client.ts` (new), one new rule and test in `packages/domain`, and the `register` flow in `PasskeyPanel.tsx`, which it removes from there.

`feature/passkey-registration-reads-the-attestation-object` (same wave, brief on `origin/main`) adds `decodeAttestationPublicKey` to `lib/passkey.ts` and a two-line fallback around `getPublicKey()` in `PasskeyPanel.tsx`. Both branches touch the register flow. Its brief says that on a rebase conflict in `PasskeyPanel.tsx` this branch's structure wins and its fallback moves onto `SettingsView`. Import its decoder from `lib/passkey.ts` unchanged once it merges; do not write a second one.

`feature/the-release-row-approves-itself` (wave 2, no branch yet) owns `releaseApprovable`, the release row and the removal of `PasskeyPanel`. Leave the approval form and the `PasskeyPanel` mount in `AgentList.tsx` as they are.

Do not touch `packages/board/src/server/passkey.ts`, the `/api/passkey/*` routes or `release-approve`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
