# Stable macOS permissions across updates

macOS stores an app's designated code requirement with its privacy approvals.
Ad-hoc signatures are tied to a particular build's hash. Keeping the same name,
install path and bundle ID alone does not preserve those approvals.

Talio releases must use Developer ID Application signing under team `37R3XLT7BG`,
bundle ID `in.talio.desktop`, and stable helper IDs defined in
`desktop-app/src/macSigningPolicy.js`. The local installed certificate was verified during
diagnosis. Do not switch teams or use an Apple Development/ad-hoc identity for a
release. Certificate renewal within the same team retains the standard Apple DR.

## Release credentials

Configure these GitHub Actions repository secrets using an administrator account:

- `MAC_CSC_LINK`: base64-encoded password-protected Developer ID Application P12,
  including its private key (electron-builder imports it into a temporary keychain).
- `MAC_CSC_KEY_PASSWORD`: P12 password.
- `APPLE_ID`, `APPLE_ID_PASSWORD`: notarization account and app-specific password.
- `APPLE_TEAM_ID`: `37R3XLT7BG`.

Never put certificate exports, private keys, passwords or secret values in source,
logs or chat. The workflow fails before building if credentials are absent. Both
Mac architecture jobs must pass signing and notarization before publication.

For the account owner, the local command `npm run setup:notary-profile -- --github`
from `desktop-app` validates Apple notarization credentials, saves the Keychain
profile and uploads only APPLE_ID, APPLE_ID_PASSWORD and APPLE_TEAM_ID to this
repository's Actions secrets. Password entry is hidden. It uses the Git credential
helper (which may differ from the active `gh` account); that identity must have
repository administrator access. The certificate/P12 secrets are separate.

The release workflow builds artifacts without publishing by default. Enable
`desktop_acceptance_verified` only after the hands-on checks below pass; do not
use it merely because automated tests or packaging passed.

`mac.notarize: false` disables only electron-builder's duplicate automatic notary
invocation; `afterSign` explicitly verifies the identities and runs notarization.
Missing credentials and Apple errors are fatal in CI or with
`REQUIRE_NOTARIZATION=true`. Local signed test builds may skip notarization, but
are not release-ready. Do not publish local unnotarized artifacts.

## Verification

Run `npx jest tests/api/mac-signing-policy.test.js tests/api/mac-signing-hooks.test.js --runInBand`
from the repository root. Build on each target Mac architecture with the normal
desktop build scripts and required credentials. The custom signing hook preserves
Electron entitlements and signs both desktop-control helpers with fixed IDs. It
rejects changed teams, identifiers, invalid signatures and hash-only DRs.

For release acceptance, install signed version A, grant Accessibility, Screen
Recording and microphone permissions, then update to signed version B from the
same team. Verify actual screen capture, desktop input and microphone use, not
just the System Settings checkboxes. Keep the app at `/Applications/Talio.app`.
The updater validates incoming app and helper signatures before replacing it.

## Existing ad-hoc installations

Moving from the old ad-hoc build to the signed identity may require one final
approval (and removing a stale Talio entry if macOS still lists the old identity).
Subsequent correctly signed updates should retain consent, subject to macOS policy
and user revocation. Talio does not reset TCC, edit its database or auto-grant OS
permissions. An already-installed old version cannot be repaired by a server-only
deployment: it must receive the signed desktop release.
