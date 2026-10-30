# Browser account reverse bridge

The browser alone owns credentials, refresh rotation, and its user/SID/generation. This adapter retains one live attachment and a frozen, validated owner projection. It has no credential cache, persistence, network session, or model authorization policy. `origin` is normalized with the existing New API helper; wire owners must already use that exact canonical origin, a positive decimal user ID, a nonempty trimmed SID, and a positive safe integer generation. Additional owner fields are rejected.

The browser serves `aiscoo/browser-account` on the existing socket. `restore(undefined)` returns `{owner, session}`. `control({owner})` returns `{owner, accessToken}`. `relay({owner})` returns `{token, expiresAt}`. `oauth({method, args})` uses only the fixed `BROWSER_ACCOUNT_OAUTH_METHODS` list and positional IOAuthService arguments. `session` emits `{owner}`. Public restore/profile/metadata/callback results are projected explicitly; void OAuth results are discarded. Refresh tokens and session bundles have no wire result or authority property.

```mermaid
sequenceDiagram
  participant B as Browser credential owner
  participant A as Connection adapter
  participant H as Host owner hook
  B->>A: session {owner} or initial restore
  A->>A: Synchronously invalidate old owner/read revision
  A->>H: onOwnerChanged(next owner)
  H-->>A: Accepted
  A->>A: Check attachment and revision
  A-->>H: signed-in / signed-out
```

Every read checks the captured attachment, owner, and local revision before and after asynchronous work. A control response additionally binds its returned owner. Detach clears current ownership synchronously before calling the Host hook; it does not dispose the shared socket. A second live attachment throws synchronously. Late restores, hooks, reads, and events cannot mutate a later attachment, even if its owner fields match. Duplicate session projections are idempotent. Failed validation or owner acceptance fails closed. Unrecognized remote errors become a fixed error code without remote messages, stacks, or secret-bearing data.

Only `authority.oauth`, the explicit IOAuthService projection, may be registered on the ordinary forward OAuth channel. The bridge, attachment, and credential authority must never be passed to reflective RPC registration. The parent owns loopback/Origin checks, service injection, and socket disposal. The channel is a live connection boundary, not an additional replay or task owner; Desktop continuous and mobile replayable transports retain their existing owners and delivery semantics.
