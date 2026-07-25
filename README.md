# StoryMee Universal AI Director (Chrome Extension)

Chrome Extension (MV3) — worker desktop chạy automation **Dreamina**, **Google Flow (GFlow)**, **Picsart**, **TopView** qua Hub Gateway.

| | |
|--|--|
| **Version** | `1.0.5` (`manifest.json` / `package.json`) |
| **Path** | `5-Extension-Automations/universal-ai-extension` |
| **Ecosystem docs** | [`00-Ecosystem-Docs/01-architecture/jobs/extension-rotation.md`](../../00-Ecosystem-Docs/01-architecture/jobs/extension-rotation.md) · [job-tracking](../../00-Ecosystem-Docs/01-architecture/jobs/job-tracking/README.md) · [06-extension-contract](../../00-Ecosystem-Docs/01-architecture/jobs/job-tracking/06-extension-contract.md) |
| **Technical report** | [BAO_CAO_KY_THUAT.md](./BAO_CAO_KY_THUAT.md) |
| **Changelog** | [CHANGELOG.md](./CHANGELOG.md) |

---

## Build & load

```bash
cd 5-Extension-Automations/universal-ai-extension
npm install
npm run build
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → chọn thư mục `dist/`.

---

## Architecture (short)

```
┌─────────────┐     WS      ┌──────────────┐     NATS      ┌─────────────┐
│  Offscreen  │◄───────────►│ storymee-hub │◄─────────────►│ core-job-api│
│  (WS keep)  │  /v1/media/ │   :5100      │               │             │
└──────┬──────┘  gflow-…/ws └──────────────┘               └─────────────┘
       │ messages
       ▼
┌─────────────┐   drivers   ┌──────────────┐
│ background  │────────────►│ Dreamina /   │
│ service wrk │             │ GFlow / …    │
└──────┬──────┘             └──────────────┘
       │ chrome.storage + JOB_UPDATED
       ▼
┌─────────────┐
│ Sidepanel / │  Zustand store + React UI
│ Dashboard   │
└─────────────┘
```

| Module | Role |
|--------|------|
| `src/offscreen.ts` | Long-lived WebSocket to Hub |
| `src/background.ts` | Job dispatch, cookies, OAuth capture, account switch |
| `src/App.tsx` + `components/` | Sidepanel + full dashboard UI |
| `src/store/extensionStore.ts` | Zustand: jobs, accounts, connection |
| `src/core/api.ts` | Hub HTTP client + account/job path helpers |
| `src/features/*` | Provider drivers |

---

## Connection rules (critical)

1. **Gateway only** — `gflowUrl` = `https://dev-hub.storymee.com` or `https://hub.storymee.com` (or local `:5100`). Never raw microservice ports from the extension.
2. **WS stable key** — WebSocket uses `hub_api_key` (then any provider key). **UI tab `selected_provider` does not reconnect WS.**
3. **Jobs worker route** — Extension uses `GET /worker/v1/jobs` with an active Hub API key. No-auth is rejected; never fall back to a public job list.
4. **Account list paths** (not `/accounts?…`):
   - GFlow: `/worker/v1/account/rotation/gflow/accounts`
   - Dreamina: `/worker/v1/dreamina/accounts` (Bearer required)
   - TopView: `/worker/v1/topview/accounts`
   - Cookie pool: `/worker/v1/account/cookies?provider=X&decrypt=true`
5. **No `User-Agent` header** in browser/extension (Chrome rejects unsafe headers).

---

## Providers

All four are **rotatable account pools** (not special-case singletons):

| Provider | Active email storage | Notes |
|----------|---------------------|--------|
| DREAMINA | `active_emails.DREAMINA` | Mutex job queue; cookie inject + points scrape |
| GFLOW | `active_emails.GFLOW` (+ `googleEmail`) | Pool + browser session merge; oauth from Hub row; **image payload constraints below** |
| PICSART | `active_emails.PICSART` | Cookie pool |
| TOPVIEW | `active_emails.TOPVIEW` | Worker IAM route |

### GFlow image payload (do not “improve” without regression)

`batchGenerateImages` only accepts the **proven** shape used by rotate:

- `imageInputs`: `{ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: bareId }` only  
- `structuredPrompt.parts`: `[{ text }]` only — **no** `mediaGenerationId`  
- Default model: `NARWHAL` (optional explicit `GEM_PIX_2`)  
- Soft optional `entityContext`; refs bind via REFERENCE, not SUBJECT  

Experimental fields (`IMAGE_INPUT_TYPE_SUBJECT` / `STYLE`, `mediaGenerationId` in parts) cause Hub-visible job failures: `400 INVALID_ARGUMENT`. Details: [BAO_CAO_KY_THUAT.md §2.3.1](./BAO_CAO_KY_THUAT.md).

---

## UI

| Surface | Tabs |
|---------|------|
| **Sidepanel** | Giám sát · Cài đặt |
| **Full dashboard** (`index.html`) | Jobs · Accounts · Settings (top nav only — no left settings rail) |

---

## Debug

| Storage key | Purpose |
|-------------|---------|
| `debug_log_sink` | `true` → background logs also POST to `127.0.0.1:9999` |
| `recent_jobs_list` | Local job history cache (max ~150) |
| `workerState` | WS status for UI |
| `disable_ws` | Force-disable WebSocket |

Console tags: `[FE Jobs]`, `[FE Sync]`, `[Offscreen]`, `[Background]`.
