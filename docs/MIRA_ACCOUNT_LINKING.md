# Explicit standalone MIRA account linking

Standalone MIRA and Talio retain separate logins. Matching names or email
addresses never establish identity, membership, consent or permissions.

## User flow

1. In MIRA, open Settings → Account → Talio workplace. Read-only is the default;
   optionally request supported, individually confirmed workplace actions.
2. Connect generates a five-minute device code and opens Talio in the system
   browser. Compare the code with MIRA, review the signed-in account/company and
   requested scopes, then explicitly allow or decline. Never approve unsolicited
   codes. MIRA polls at the server-supplied interval and honors backoff.
3. MIRA can read permitted personal workplace context and attention items using
   its workplace tools. Writes retain Talio's current RBAC, validation,
   confirmation and idempotent receipts. Uncertain writes are not replayed.
4. Disconnect from MIRA or revoke a connection on `/dashboard/mira/connect`.
   Grants also expire after 30 days; inactive tenants/users, password resets,
   Mira designation gates and plan changes fail fresh authorization.

## Security and storage

- `miralinkdevices` and `miralinkgrants` are server infrastructure collections in
  the existing system repository. No arbitrary tenant/store selection is accepted.
- The human code is not the device credential. Polling requires both a random
  device secret and proof of its S256 challenge. Approval and one-time consumption
  are transactional. The temporary approved secret is encrypted with a
  purpose-derived key from `JWT_SECRET`, then removed on consumption.
- Grants are opaque, hashed-at-rest and scoped to a verified Talio tenant/owner.
  They are not application-login JWTs. The gateway accepts only fixed operations;
  downstream actions reuse the existing routes with server-only 60-second
  delegation, current RBAC and grant-scoped request identities.
- MIRA stores the grant only in an encrypted, HttpOnly, same-site cookie bound to
  its authenticated UID. No Talio credential goes into localStorage, Firebase
  profiles, model context, client source or logs. No cross-device credential sync.
- Workplace replies and subsequent messages in that conversation are encrypted
  before legacy history/cache synchronization. Partial streaming chunks are
  redacted. Opening ciphertext requires the same MIRA account and active grant,
  and validates conversation/message identity. Disconnecting or re-linking makes
  the previous connection's encrypted history unavailable. Automatic plaintext
  project/workspace memory, title generation, response caches and desktop
  notification bodies are suppressed for private workplace conversations.
- No workplace tool executes for another participant's shared-chat author. Data
  retrieved from Talio is reference material, never a system/user instruction.

MIRA requires a stable 32+ character `MIRA_LINK_COOKIE_SECRET`, or its existing
`MIRA_AUTH_SECRET` as fallback. These remain server-only. Talio uses its existing
`JWT_SECRET`. No new shared secret between the products is required.

## Validation and limits

Run the `mira-account-link`, `mira-link-consent` and `mira-linked-gateway` Jest
tests in Talio. Run `npm test` and `npm run build` with Node 22.12+ in standalone
MIRA. Tests use synthetic accounts and no real grants or workplace mutations.

Live acceptance requires a person to approve their own account, compare its
company, retrieve a harmless own-task query, disconnect, and verify denial.
Linking does not connect new WhatsApp, phone, email or calendar accounts, grant
administrator rights, merge chats or create an always-on monitoring service.
