---
type: docs
title: CHANGELOG
description: OKF standardized document for CHANGELOG in project universal-ai-extension.
tags: [universal-ai-extension]
related_files: [file:///C:/storymee/5-Extension-Automations/universal-ai-extension/CHANGELOG.md]
---

# Changelog - Universal AI Director Extension

All notable changes to the Universal AI Director Extension will be documented in this file.

## [1.0.7] - 2026-07-21

- Worker history uses an explicit credential policy instead of account-table membership.
- Empty scoped results are distinguished from Gateway/authentication failures.
- Worker completion is authenticated and limited to the key's provider scope.

## [1.0.6] - 2026-07-21

- Moved job list/complete calls to authenticated `/worker/v1/jobs/*`.
- Removed unsafe no-auth fallback; invalid keys retain cache and show a precise error.

## [1.0.5] - 2026-07-17

### Added
- **Dashboard top-nav layout** (Jobs · Accounts · Settings) — removed permanent left settings sidebar that duplicated Chrome sidepanel.
- **Google Flow as rotatable provider pool** (same switch/release model as Dreamina/Picsart/TopView); browser session merged into GFlow list.
- **Provider / status filter bars** with per-provider job counts; GFlow aliases (`GOOGLE_FLOW`, Ultra…) normalize correctly.
- **Zustand store** (`src/store/extensionStore.ts`) for jobs, accounts, WS/connection and UI tab state.
- **Hooks**: `useExtensionStorage`, `useLifelinePort`, `useToast`, `useDebouncedValue` (search 200ms).
- **UI components**: `JobCard`, `ToastStack`, `RouteBadge`, `ProviderAccountsColumn`, `AccountTierBadge`, skeleton loaders.
- **Dreamina job queue mutex** — multi-job Dreamina runs sequentially (same pattern as GFlow lock).
- **Skeleton loaders** for job history (dashboard), sidepanel recent jobs, and account sync.
- **Docs**: `README.md` + rewritten `BAO_CAO_KY_THUAT.md`; ecosystem contract/rotation/gaps synced.

### Fixed / Performance
- **Jobs history empty**: invalid Bearer returns Hub `data: []` — retry fetch without Authorization; never wipe local cache.
- **WS DISCONNECT on provider tab switch**: stable WS `api_key` (hub first); soft `WS_REREGISTER` only for `selected_provider`.
- **Account 404**: stop calling `/accounts?provider=`; use `/worker/v1/dreamina|topview/accounts`, GFlow rotation, cookie pool.
- **GFlow `batchGenerateImages` 400 INVALID_ARGUMENT (refs / character jobs):** experimental payload broke protobuf schema after likeness attempts — `Unknown name "mediaGenerationId"`, `invalid image_input_type` (`SUBJECT` / `STYLE`). Restored **proven** request shape: `IMAGE_INPUT_TYPE_REFERENCE` + bare `name` only; `structuredPrompt.parts` text-only; default `imageModelName: NARWHAL`; soft optional `entityContext`. Dual-fetch SW→tab + safety/model-flip retries kept (never reintroduce SUBJECT/mediaGenerationId).
- Strip / avoid browser `User-Agent` header (`@storymee/api-client` + extension interceptor).
- Job polling only when Jobs tab / sidepanel Giám sát active (15s).
- Background log spam gated (`debug_log_sink`); offscreen create lock + CHECK_SESSION storage proxy.
- Cookie rotation domain-scoped; video list lazy play; no hardcoded API secrets.

### Changed
- Sidepanel tabs: **Giám sát** + **Cài đặt**; toast feedback replaces blocking `alert()`.
- Design tokens for intermediate Tailwind shades registered in `index.css`.
- Removed junk backup files (`App.tsx.bak*`).

## [1.1.0] - 2026-06-25

### Added
- **Manual Gateway URL Save**: Added a dedicated "Lưu" (Save) button next to the Gateway connection URL input in both Sidepanel and Dashboard Full-Screen settings to support manual Cloudflare Tunnel URLs saving and triggering hot WS reconnects.

### Fixed
- **WebSocket Status Infinite Loop**: Excluded `"workerState"` from the storage change listener's `apiKeys` array in `src/background.ts`, resolving the infinite reconnect loop causing status toggling madness.

### Changed
- **Sidepanel Redesign**: Streamlined the Extension's Sidepanel UI down to two focused tabs:
  - **Giám sát (Monitor)**: Displays connection status, Route Badge (Local/VPS), a compact 2x2 stats matrix, a list of active processing/pending jobs, and 3 recently completed/failed jobs.
  - **Cài đặt (Settings)**: Houses Google identity status, Worker name config, Gateway URL config (with Local/VPS presets and manual Save), Hub decryption key sync, active providers status, and the quick account switcher.
- **Route Options Streamlining**: Removed the "Production" preset option from the gateway config in both Sidepanel and Dashboard Full-Screen layouts. Reduced grid layouts to `grid-cols-2` to align with the simplified Local and VPS preset scheme.

## [1.0.0] - 2026-05-30

### Added
- **Premium Control Deck Dashboard**: Developed a high-end React 19 visual control dashboard in `src/App.tsx` incorporating a vibrant modern HSL dark theme, glassmorphic status panels, real-time WebSocket connection state, an interactive Manual Task Console bypassing Google reCAPTCHA, active driver configuration cards (Google Labs, Picsart, Dreamina, TopView), and an inline media history sync player.
- **Chrome Extension Entrypoints**: Hooked up Vite production bundle mapping for both sidepanel (`sidepanel.html` -> `src/sidepanel/main.tsx`) and options dashboard (`index.html` -> `src/dashboard/main.tsx`).
- **Global Vite Types**: Introduced `src/vite-env.d.ts` supporting standard CSS module references (`../index.css`).

### Fixed
- **WebCrypto Sign Typing Mismatch**: Patched `src/utils/crypto.ts` casting parameter payloads to prevent strict engine compiler type collisions between typed array representations.
- **Unused Local Imports & Variables**: Refactored `src/background.ts` and `src/App.tsx` to scrub unused dependencies, keeping `noUnusedLocals` compiler standard happy.
- **Chrome Storage Type Casting**: Cast `chrome.storage.local.get` callback values to `any` globally inside background threads and UI dashboards to resolve typing mismatches with strict empty object defaults.
