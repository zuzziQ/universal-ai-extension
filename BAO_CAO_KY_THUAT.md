# Báo Cáo Kỹ Thuật: StoryMee Universal AI Director

**Version extension:** `1.0.5`  
**Cập nhật:** 2026-07-17  
**Repo path:** `5-Extension-Automations/universal-ai-extension`

Tài liệu này mô tả cơ chế vận hành hiện tại (sau refactor UI/store, account paths, WS stable key, jobs auth fallback, **GFlow image payload proven-shape**).

---

## 1. Kết nối Job realtime (Offscreen + WebSocket)

### 1.1 Offscreen Document (`src/offscreen.ts`)

Chrome MV3 không giữ WebSocket ổn định trong Service Worker. Extension mở **offscreen document** để:

- Kết nối `wss://{gateway}/v1/media/gflow-extension/ws?email={workerName}&api_key={stableKey}`
- Heartbeat / `WORKER_STATUS` / `REGISTER`
- Nhận `GENERATE`, gửi `JOB_ACK` / `JOB_REJECT` / `JOB_DONE`

Proxy bắt buộc (offscreen **không** có `chrome.storage` / `chrome.cookies`):

| Message type | Hướng | Mục đích |
|--------------|-------|----------|
| `PROXY_STORAGE_GET` / `SET` | Offscreen → Background | Đọc/ghi storage |
| `PROXY_COOKIES_GET` | Offscreen → Background | Cookie Google cho worker id fallback |
| `WS_STATUS` | Offscreen → UI | ONLINE / CONNECTING / DISCONNECTED |
| `GENERATE_JOB` | Offscreen → Background | Dispatch driver |
| `SUBMIT_RESULT_WS` | Background → Offscreen | Báo `JOB_DONE` qua WS |
| `WS_REREGISTER` | Background → Offscreen | Soft register (không đóng socket) |
| `FORCE_RECONNECT_WS` | UI / Background → Offscreen | Hard reconnect |

### 1.2 Stable API key (không theo tab provider)

```
stableKey = hub_api_key
         || gflow_api_key
         || dreamina_api_key
         || picsart_api_key
         || topview_api_key
```

- **Hard reconnect** chỉ khi đổi: gateway URL, worker name, hoặc bất kỳ API key nào.
- **Soft re-register** khi đổi: `selected_provider` (UI), `oauthToken`, `googleEmail`, `active_emails`.
- Tránh bug: GFlow ONLINE → switch Dreamina → về GFlow bị DISCONNECT (do reconnect theo `selected_provider` + key khác).

### 1.3 Gateway định tuyến

Toàn bộ HTTP/WS đi qua Hub Gateway (cổng **5100** / domain `dev-hub` · `hub`):

| Use | Path |
|-----|------|
| WebSocket worker | `/v1/media/gflow-extension/ws` |
| Jobs list | `GET /worker/v1/jobs?limit=100` + Hub API key |
| Job complete (HTTP fallback) | `POST /worker/v1/jobs/{id}/complete` |
| Cookie checkout/checkin | `/worker/v1/account/cookies/*` |
| GFlow account pool | `/worker/v1/account/rotation/gflow/accounts` |
| Dreamina accounts (IAM) | `/worker/v1/dreamina/accounts` |
| TopView accounts (IAM) | `/worker/v1/topview/accounts` |
| Direct job sync | `POST /worker/v1/jobs/direct-sync` |

**Cấm** gọi raw port microservice (4502, 4506, …) từ extension.

---

## 2. Điều phối Job (`background.ts` → Drivers)

### 2.1 Nhận job

1. Hub WS → Offscreen `GENERATE`
2. Offscreen `JOB_ACK` → `chrome.runtime.sendMessage({ type: "GENERATE_JOB" })`
3. `handleGenerateJob` → `saveOrUpdateJob` (local Indexed/storage list) → driver

### 2.2 Providers & concurrency

| Provider | Driver | Concurrency |
|----------|--------|-------------|
| GFlow / GOOGLE_* | `GoogleLabsDriver` | Mutex + offscreen `activeGflowJobs <= 1` |
| Dreamina | `DreaminaDriver` | **Mutex** tuần tự (tránh race cookie/tab) |
| Picsart / TopView | Stub drivers | Theo job dispatch |

### 2.3 GFlow

- Identity pool: `active_emails.GFLOW` (ưu tiên) → `googleEmail`
- OAuth: capture `Authorization: Bearer ya29.` qua `webRequest`
- reCAPTCHA v3 inject trên tab `labs.google`
- Prompt sanitize / truncate khi cần
- HTTP tới Google: **prefer service-worker fetch** (`host_permissions`), fallback tab MAIN-world (`robustGoogleApiFetch`)

#### 2.3.1 Image API — proven payload (bắt buộc)

Endpoint:  
`POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages`

Code: `src/features/google-flow/googleLabsApi.ts` → `generateImage`.

**Shape đã verify (rotate + text + refs chạy ổn):**

```json
{
  "clientContext": { "projectId": "…", "tool": "PINHOLE", "sessionId": ";…" },
  "useNewMedia": true,
  "mediaGenerationContext": {
    "batchId": "img-batch-…",
    "entityContext": { "entityId": "…", "characterSlot": { "imageReferenceIndex": 0 } }
  },
  "requests": [{
    "seed": 123456,
    "imageModelName": "NARWHAL",
    "imageAspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "structuredPrompt": { "parts": [{ "text": "…" }] },
    "clientContext": { "…same…" },
    "imageInputs": [
      { "imageInputType": "IMAGE_INPUT_TYPE_REFERENCE", "name": "<bareMediaId>" }
    ]
  }]
}
```

| Rule | Giá trị an toàn | **Cấm** (phá protobuf → 400) |
|------|-----------------|------------------------------|
| `imageInputs[].imageInputType` | `IMAGE_INPUT_TYPE_REFERENCE` only | `IMAGE_INPUT_TYPE_SUBJECT`, `STYLE`, `MIXED`, `UNSPECIFIED` (trên endpoint này) |
| `imageInputs[].name` | bare id (`upload` đã strip `media/`) | `name: "media/…"`, field `mediaId` kèm name |
| `structuredPrompt.parts` | `[{ "text": "…" }]` only | `mediaGenerationId` trong parts |
| `imageModelName` default | `NARWHAL` | map generic `*flash*` → `abra` |
| Optional | `GEM_PIX_2` khi hub explicitly nano/banana; flip model on 400 | retry bằng SUBJECT / mediaGenerationId |
| Entity | soft `entityContext` (create fail → vẫn gen bằng REFERENCE) | `additionalImageReferenceIndexes` experimental |

**Lỗi đã gặp (2026-07-17) khi thử likeness experimental:**

- `Unknown name "mediaGenerationId" … Cannot find field`
- `invalid value for enum type: "IMAGE_INPUT_TYPE_SUBJECT"`

→ **Đã revert** về shape trên. Text-only vẫn pass với payload sai; job **có REFS** mới fail — luôn test character refs sau khi đụng payload.

**Retry an toàn (không đụng schema):** network dual-fetch; reCAPTCHA reload; safety/`PUBLIC_ERROR_MINOR` → sanitize prompt (giữ refs); 400 INVALID_ARGUMENT → drop entity + flip `NARWHAL` ↔ `GEM_PIX_2`. **Không** drop refs chỉ để “force success” (tránh ảnh random không giống ref).

### 2.4 Dreamina

- MAIN world: `content_dreamina_main.ts` monkey-patch `fetch`
- ISOLATED: bridge → background → `syncDirectJobsToHub`
- Auto rotate: `checkoutAccount` → inject cookies → reload CapCut tab

### 2.5 Báo kết quả

1. Ưu tiên WS: `JOB_DONE` + `result: string[]` + `actualMeta`
2. Fallback HTTP: `POST /internal/v1/jobs/{taskId}/complete`

Hub accept cả `RESULT` (V1) và `JOB_DONE` (V2) — xem ecosystem `06-extension-contract.md` / `07-gaps-and-risks.md`.

---

## 3. HTTP Client & cạm bẫy Jobs list

### 3.1 `@storymee/api-client`

- `enforceApiPrefix: false` (không ép `/api`)
- **Không set `User-Agent`** trong browser (Chrome unsafe header)

### 3.2 Quirk bắt buộc biết

```
GET /worker/v1/jobs + active API key → 200 + scoped jobs
GET /worker/v1/jobs without auth     → 401
GET /worker/v1/jobs + invalid key    → 403
```

UI `fetchJobsFromHub`:

1. Load `recent_jobs_list` local
2. `fetch` native **có** stable key
3. Nếu `data.length === 0` → **retry không Authorization**
4. Map job; `provider` lấy từ `inputParams.provider` (top-level DB thường null)
5. **Không wipe** local khi Hub lỗi/rỗng

---

## 4. Account pools (UI + API)

Cả 4 provider là **pool xoay** (`active_emails[PROVIDER]`):

| API list | Response shape |
|----------|----------------|
| `/worker/v1/dreamina/accounts` | `{ status: "ok", accounts: [] }` — cần Bearer |
| `/worker/v1/topview/accounts` | tương tự IAM |
| `/worker/v1/account/rotation/gflow/accounts` | `{ status: "success", data: [{ email, oauthToken, …}] }` |
| `/worker/v1/account/cookies?provider=X&decrypt=true` | cookie pool generic |

GFlow: merge browser session vào list nếu Hub chưa có email đó; switch có thể gắn `oauthToken` từ row pool.

**Path cấm (404 trên gateway):** `/accounts?provider=…`

---

## 5. UI / State

| Layer | Tech |
|-------|------|
| State | Zustand `extensionStore` |
| Storage sync | `useExtensionStorage` + `hydrateFromStorage` |
| Debounce search | `useDebouncedValue` 200ms |
| Toasts | `useToast` (không `alert`) |
| Full dashboard | Top nav: **Jobs · Accounts · Settings** (không left sidebar — tránh trùng Chrome sidepanel) |
| Sidepanel | Giám sát · Cài đặt |

Components tách: `JobCard`, `ProviderAccountsColumn`, `ProviderFilterBar`, `Skeleton`, `RouteBadge`, …

---

## 6. Local storage keys (SSOT UI)

| Key | Ý nghĩa |
|-----|---------|
| `gflowUrl` | Gateway base |
| `hub_api_key` / `*_api_key` | Auth |
| `workerName` | Worker display id trên Hub |
| `clientUuid` | Dispatch routing |
| `selected_provider` | UI only (không reconnect WS) |
| `active_emails` | Map provider → email active |
| `gflow_accounts` / `dreamina_accounts` / … | Cache pool |
| `recent_jobs_list` | Job history local |
| `workerState` | ONLINE / … |
| `oauthToken`, `googleEmail` | GFlow session |
| `disable_ws` | Tắt WS |
| `debug_log_sink` | Forward log → `127.0.0.1:9999` |

---

## 7. Liên kết ecosystem

| Doc | Nội dung |
|-----|----------|
| `00-Ecosystem-Docs/01-architecture/jobs/job-tracking/` | Job lifecycle E2E |
| `00-Ecosystem-Docs/01-architecture/jobs/job-tracking/06-extension-contract.md` | WS contract |
| `00-Ecosystem-Docs/01-architecture/jobs/extension-rotation.md` | Rotation + accounts map |
| `00-Ecosystem-Docs/01-architecture/machine/storymee-architecture.json` | Machine SSOT entry |
