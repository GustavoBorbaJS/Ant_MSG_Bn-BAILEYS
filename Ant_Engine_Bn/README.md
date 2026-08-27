# Ant_Engine_Bn

WhatsApp connection engine (Baileys-based) for the DISPARA CRM. Exposes an internal HTTP API (API-key protected) consumed by `Ant_CRM_Bn` and `Ant_MSG_Bn` to pair, connect, and send messages through WhatsApp Web sessions.

## Known Baileys issues found during internal testing

While investigating a "message could not be loaded" report from real recipients, we ran controlled reconnect/session-conflict tests against `@whiskeysockets/baileys` and found one reproducible crash plus two behaviors worth raising upstream. Draft for the Baileys issue tracker below — not yet filed.

### Environment
- `@whiskeysockets/baileys`: 7.0.0-rc14
- Node.js: 20 (`node:20-alpine`, Docker)
- OS: Linux (Docker container)

### 1. Crash: `Cannot destructure property 'content' of '(intermediate value)' as it is undefined`

**Stack trace:**
```
TypeError: Cannot destructure property 'content' of '(intermediate value)' as it is undefined.
    at fetchPrivacySettings (file:///app/node_modules/@whiskeysockets/baileys/lib/Socket/chats.js:68:21)
    at async Promise.all (index 2)
    at async executeInitQueries (file:///app/node_modules/@whiskeysockets/baileys/lib/Socket/chats.js:915:9)
```

**Root cause (from reading the source):** `fetchPrivacySettings` (`chats.js:66-80`) does:
```js
const { content } = await query({
  tag: 'iq',
  attrs: { xmlns: 'privacy', to: S_WHATSAPP_NET, type: 'get' },
  content: [{ tag: 'privacy', attrs: {} }],
});
```
with no guard against `query()` resolving `undefined`. `executeInitQueries` (`chats.js:914-916`) runs this inside `Promise.all` together with `fetchProps()` / `fetchBlocklist()`, fired unconditionally on every `connection.update → open`.

**Steps to reproduce:**
1. Pair a normal session.
2. Once connected, open a **second** `makeWASocket()` using the **same** auth state (same creds/keys) concurrently — this triggers a `stream:error` / `conflict` (`type: replaced`) on the first socket, which then auto-reconnects.
3. Repeat step 2 a few times in a short window (we ran it ~10 times over ~40 minutes against the same session).
4. ~40-55s after one of the reconnects, `executeInitQueries` throws the above unhandled `TypeError` — an uncaught exception from inside the library, not surfaced through any `connection.update`/error event.

Reproduced **4 separate times**, always with the same stack trace, in the same window after a forced reconnect.

**Suggested fix:** guard the destructure, e.g. `const { content } = (await query({...})) ?? {};`, or make `query()` reject instead of resolving `undefined` when the IQ never gets a valid response (it looks like it may resolve early/empty when the socket is torn down mid-query). Either turns this into a catchable rejection instead of an uncaught exception.

### 2. Observation: pre-key upload retries never give up / no circuit breaker

In the same degraded-connection window, we consistently saw:
```
"uploading pre-keys" (count: 5, retryCount: 0)
"Failed to upload pre-keys to server" (uploadError: "Error: Connection Closed")
"Retrying pre-key upload in 1000ms"
... retryCount: 1, 2000ms ...
... retryCount: 2, 4000ms ...
... retryCount: 3, ...
```
This kept retrying with exponential backoff against a connection that was already `Connection Closed`, without giving up or forcing a clean teardown/reconnect. In a couple of runs the session eventually degraded to the point of needing a full re-pair (fresh QR) instead of recovering. Is there an intended max-retry/circuit-breaker here, or should this path trigger a reconnect instead of retrying indefinitely against a dead socket?

### 3. Question: Signal session gets closed (`Closing session`) even on a *normal* reconnect, with no forced conflict

Least certain of the three, but the timing was consistent enough to ask about. Separately from the conflict-forcing test above, we also tested a **plain** reconnect (no concurrent socket, no conflict) followed by sending a message ~3s later. Even then, libsignal logged:
```
Closing session: SessionEntry { ... remoteIdentityKey: <Buffer ...>, previousCounter: ..., ... }
```
~3-5s after `connection.update → open`, correlating closely with when the message was sent. We're investigating a "message could not be loaded" report from real recipients, and this session-churn-right-after-reconnect pattern looks like a plausible contributor — though we don't have full confirmation it causes recipient-side decryption failures (one controlled test with a real second recipient came back readable).

Is this expected behavior (e.g. deliberate re-keying because the ratchet/prekey counter looked stale after being offline)? If so, is there a way to avoid/delay it for a session about to be used to send a message?

### Note on how this was triggered

This was deliberately induced via a controlled internal test tool (opening a second socket on the same auth state) — not something that happens in normal single-device usage.
