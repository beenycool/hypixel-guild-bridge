# Web UI

A browser-based dashboard for managing the **rankup automation system** in the
Hypixel guild Discord bridge.

## What it does

The web UI provides a graphical interface for the same data and actions exposed
by the Discord `/settings`, `/rankup-check`, `/rankup-pending`, and
`/rankup-history` commands, focused on the rankup subsystem only.

It does **not** replace the Discord command surface — both remain usable.

### Pages

| Page     | URL                    | Purpose                                                             |
| -------- | ---------------------- | ------------------------------------------------------------------- |
| Overview | `/`                    | Per-bridge status, recent activity, manual run-check trigger        |
| Settings | `/settings.html`       | All bridge settings including rankup rules, exclusions, and toggles |
| Pending  | `/rankup-pending.html` | Review queue: approve or reject pending rank changes                |
| History  | `/rankup-history.html` | Full audit log of every rankup-related action                       |

The bridge selector in the page header switches between configured bridges. The
selected bridge is persisted in `localStorage`.

## How to enable

1. In your `application-config.yaml`, set:
   ```yaml
   web:
     enabled: true
     port: 9091
     token: '<long random string>'
   ```
2. Restart the bridge. The web server listens on the configured port
   (default `9091`). If you run behind the bundled reverse proxy in
   `index.ts`, the UI is automatically reachable on the same external port as
   the rest of the service.
3. Open `http://<host>:<port>/` in a browser. You will be prompted for the
   access token — paste the value from `web.token`.
4. The token is stored in `localStorage` under the key `rankup_token`. Click
   **Disconnect** in the top-right to clear it.

### Security caveats

- The token is the **only** authentication. Anyone with it can approve/reject
  rank changes and edit rules.
- Treat `web.token` like a password. Generate it with a password manager.
- The bundled reverse proxy does **not** add additional auth. If you expose
  the port directly, ensure TLS and/or network-level controls are in place.
- Bearer tokens are sent in `Authorization` headers (REST) or in the WS
  handshake message. All comparisons use `crypto.timingSafeEqual`.

## Architecture

```
browser  ──HTTP──▶  WebServer (port 9091)
   │                  │
   │                  ├─ /api/rankup/*   → RankupApiHandler
   │                  ├─ /message (POST) → existing message dispatch
   │                  └─ /* (GET)        → static files from web/public
   │
   └──WebSocket──▶   /message
                       │
                       ├─ { type: 'message', ... }   → existing chat dispatch
                       └─ { type: 'subscribeRankup' } → RankupWsEvents
                                                      (polling-diff, 1s)
```

### REST API

All endpoints require `Authorization: Bearer <token>`. Errors return
`{ success: false, error: string }` with appropriate HTTP status codes.

| Method | Path                                     | Purpose                                     |
| ------ | ---------------------------------------- | ------------------------------------------- |
| GET    | `/api/rankup/bridges`                    | List bridges with status                    |
| GET    | `/api/rankup/pending?bridgeId=X`         | List pending reviews                        |
| POST   | `/api/rankup/pending/:id/approve`        | Approve a pending review                    |
| POST   | `/api/rankup/pending/:id/reject`         | Reject a pending review (logs to history)   |
| GET    | `/api/rankup/history?bridgeId=X&limit=N` | List history (newest first)                 |
| GET    | `/api/rankup/rules?bridgeId=X`           | Read full rankup config                     |
| PUT    | `/api/rankup/rules?bridgeId=X`           | Save full rankup config                     |
| GET    | `/api/rankup/guild-ranks?bridgeId=X`     | List guild rank names (for dropdowns)       |
| POST   | `/api/rankup/run-check`                  | Trigger an immediate check (body: bridgeId) |
| GET    | `/api/rankup/status?bridgeId=X`          | Get last manual check time                  |

### WebSocket

Reuse the existing `/message` WebSocket. The frontend sends:

```json
{ "type": "subscribeRankup", "token": "<access token>" }
```

The server replies with `{ "type": "ack", "success": true }` or
`{ "type": "ack", "success": false, "error": "Invalid token" }`.

After subscribing, the client receives events:

| Event                        | Payload                            |
| ---------------------------- | ---------------------------------- |
| `rankup.reviewAdded`         | `PendingReview` (full object)      |
| `rankup.reviewRemoved`       | `{ id: number, bridgeId: string }` |
| `rankup.historyAppended`     | `RankupHistoryEntry` (full object) |
| `rankup.bridgeConfigChanged` | `{ bridgeId: string }`             |

Events are detected by a **polling-diff loop** running every 1 second on the
server. This avoids changing `PendingReviewManager` to emit events. Latency
between a change in the in-memory state and the broadcast is therefore at most
~1 second.

## File layout

```
src/instance/web/
  auth.ts              # verifyToken helper (timingSafeEqual)
  rankup-api.ts        # REST endpoint handler
  rankup-ws-events.ts  # WebSocket broadcaster (polling-diff)

web/public/
  index.html, settings.html, rankup-pending.html, rankup-history.html
  css/app.css          # Design system
  js/
    common.js          # Shared App.* API (auth overlay, fetch, WS, nav)
    settings.js, overview.js, pending.js, history.js
```

No build step. The frontend is plain HTML/CSS/JS, served directly.

## Notes

- `POST /api/rankup/pending/:id/approve` triggers `runTaskForBridge(bridgeId)`
  and removes the review. The system re-evaluates all members on the next
  scheduled check. If manual-review mode is on, the same review will be
  re-created if the rule still matches.
- `POST /api/rankup/pending/:id/reject` logs a `'reject'` entry to history
  and removes the review.
- `GET /api/rankup/guild-ranks` performs a live Hypixel API call via the first
  configured minecraft instance. Slow guilds or rate limits may cause this
  endpoint to take a few seconds.
