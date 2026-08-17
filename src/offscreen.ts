import { ResilientWebSocket } from './utils/extension-sdk';
import { normalizeProvider, ProviderSlotRegistry } from './utils/providerSlots';

let wsManager: ResilientWebSocket | null = null;
let lastStatusUpdate = 0;
const providerSlots = new ProviderSlotRegistry();
const recentlyCompletedJobs = new Map<string, number>();
const COMPLETED_JOB_TTL_MS = 30 * 60 * 1000;
/** Last WS URL we connected with — avoid tear-down when only UI provider tab changed */
let lastConnectedWsUrl = "";
let connectInFlight: Promise<void> | null = null;

// =======================================================================
// STORAGE PROXY - Offscreen documents ONLY have chrome.runtime APIs
// chrome.storage, chrome.cookies etc. are NOT available here.
// Must use message passing to Service Worker (background.ts) instead.
// =======================================================================

function storageGet(keys: string[]): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "PROXY_STORAGE_GET", keys }, (response) => {
        if (chrome.runtime.lastError) { resolve({}); return; }
        resolve(response?.data || {});
      });
    } catch { resolve({}); }
  });
}

function storageSet(data: Record<string, any>): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "PROXY_STORAGE_SET", data }, () => resolve());
    } catch { resolve(); }
  });
}

function cookiesGetAll(domain: string): Promise<any[]> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "PROXY_COOKIES_GET", domain }, (response) => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        resolve(response?.cookies || []);
      });
    } catch { resolve([]); }
  });
}

function broadcastStatus(status: string) {
  storageSet({ workerState: status }).catch(() => {});
  chrome.runtime.sendMessage({ type: "WS_STATUS", status }).catch(() => {});
}

function slotStatus(completedJobId?: string) {
  const currentJobs = providerSlots.currentJobs();
  return {
    status: currentJobs.length > 0 ? 'working' : 'idle',
    currentJob: currentJobs[currentJobs.length - 1] || null,
    currentJobs,
    providerCurrentJobs: providerSlots.providerCurrentJobs(),
    maxSlots: providerSlots.maxSlots('GFLOW'),
    providerMaxSlots: providerSlots.providerMaxSlots(),
    disabledProviders: providerSlots.disabledProviders(),
    ...(completedJobId ? { completedJobId } : {}),
  };
}

function rememberCompletedJob(taskId: string) {
  const now = Date.now();
  recentlyCompletedJobs.set(taskId, now);
  for (const [jobId, completedAt] of recentlyCompletedJobs) {
    if (now - completedAt > COMPLETED_JOB_TTL_MS) recentlyCompletedJobs.delete(jobId);
  }
}

function wasRecentlyCompleted(taskId: string): boolean {
  const completedAt = recentlyCompletedJobs.get(taskId);
  if (!completedAt) return false;
  if (Date.now() - completedAt <= COMPLETED_JOB_TTL_MS) return true;
  recentlyCompletedJobs.delete(taskId);
  return false;
}

async function refreshSlotConfig() {
  const data = await storageGet(['provider_max_slots', 'provider_enabled']);
  providerSlots.configure(data.provider_max_slots, data.provider_enabled);
}

function enabledAccounts(accounts: Record<string, string>, googleEmail?: string): Record<string, string> {
  const result = { ...accounts };
  if (googleEmail) result.GFLOW = googleEmail;
  for (const provider of providerSlots.disabledProviders()) delete result[provider];
  return result;
}

/** Stable API key for WS — NOT tied to selected_provider UI tab */
function pickWsApiKey(data: any): string {
  return (
    data.hub_api_key ||
    data.gflow_api_key ||
    data.dreamina_api_key ||
    data.picsart_api_key ||
    data.topview_api_key ||
    ""
  );
}

function buildWsUrl(gflowUrl: string, email: string, apiKey: string): string {
  try {
    let url = (gflowUrl || "https://hub.storymee.com").trim();
    if (!url.includes("://")) url = "https://" + url;
    const urlObj = new URL(url);
    const proto = (urlObj.protocol === "https:" || urlObj.protocol === "wss:") ? "wss:" : "ws:";
    const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
    return `${proto}//${urlObj.host}/v1/media/gflow-extension/ws?email=${encodeURIComponent(email)}${keyParam}`;
  } catch {
    const keyParam = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
    return `wss://hub.storymee.com/v1/media/gflow-extension/ws?email=${encodeURIComponent(email)}${keyParam}`;
  }
}

async function softReregister() {
  const data = await storageGet([
    "clientUuid", "workerName", "googleEmail", "oauthToken", "active_emails"
  ]);
  if (!wsManager?.ws || wsManager.ws.readyState !== WebSocket.OPEN) {
    await checkWebSocket(false);
    return;
  }
  const workerInstanceName = data.workerName || "universal-director";
  const email = workerInstanceName;
  const clientUuid = data.clientUuid || "";
  wsManager.send({
    action: "REGISTER",
    email,
    client_uuid: clientUuid,
    google_email: data.googleEmail || data.active_emails?.GFLOW || "",
    oauth_token: data.oauthToken || "",
  });
  const accounts = enabledAccounts(data.active_emails || {}, data.googleEmail);
  wsManager.send({
    action: "WORKER_STATUS",
    ...slotStatus(),
    lastSeen: Math.floor(Date.now() / 1000),
    accounts,
  });
  console.log("[Offscreen] Soft re-REGISTER (no socket tear-down)");
}

/**
 * @param forceReconnect — true only when gateway URL / worker name / hub key changed
 */
async function checkWebSocket(forceReconnect = false) {
  if (connectInFlight) {
    await connectInFlight;
    if (!forceReconnect) return;
  }

  connectInFlight = (async () => {
    try {
      await checkWebSocketInner(forceReconnect);
    } finally {
      connectInFlight = null;
    }
  })();
  await connectInFlight;
}

async function checkWebSocketInner(forceReconnect: boolean) {
  const data = await storageGet([
    "gflowUrl", "googleEmail", "clientUuid", "workerName",
    "hub_api_key", "dreamina_api_key", "picsart_api_key",
    "topview_api_key", "gflow_api_key", "disable_ws",
    "oauthToken", "active_emails"
  ]);

  if (data.disable_ws === true) {
    console.log("[Offscreen] WebSocket disabled via disable_ws.");
    if (wsManager) {
      try { wsManager.close(); } catch {}
      wsManager = null;
      lastConnectedWsUrl = "";
    }
    return;
  }

  const gflowUrl = data.gflowUrl || "https://hub.storymee.com";
  let clientUuid = data.clientUuid;
  // Stable key — switching Dreamina/Picsart/GFlow UI tabs must NOT change WS auth
  const apiKey = pickWsApiKey(data);

  if (!clientUuid) {
    clientUuid = Math.random().toString(36).substring(2) + Date.now().toString(36);
    await storageSet({ clientUuid });
  }

  const cookies = await cookiesGetAll(".google.com");
  const sessionCookie = cookies.find((c: any) => c.name === "__Secure-1PSID");
  const workerInstanceName = data.workerName
    || (sessionCookie ? `ext_${sessionCookie.value.slice(-6)}@flow.local` : "universal-director");
  const email = workerInstanceName;
  const wsUrl = buildWsUrl(gflowUrl, email, apiKey);

  // Already connected to same endpoint — heartbeat only
  if (
    !forceReconnect &&
    wsManager &&
    wsManager.ws &&
    wsManager.ws.readyState === WebSocket.OPEN &&
    lastConnectedWsUrl === wsUrl
  ) {
    const now = Date.now();
    if (now - lastStatusUpdate > 30000) {
      const accounts = enabledAccounts(data.active_emails || {}, data.googleEmail);
      wsManager.send({
        action: "WORKER_STATUS",
        ...slotStatus(),
        lastSeen: Math.floor(Date.now() / 1000),
        accounts,
      });
      lastStatusUpdate = now;
    }
    return;
  }

  // URL unchanged but socket connecting — wait
  if (
    !forceReconnect &&
    wsManager &&
    wsManager.ws &&
    wsManager.ws.readyState === WebSocket.CONNECTING &&
    lastConnectedWsUrl === wsUrl
  ) {
    console.log("[Offscreen] WS still CONNECTING, skip re-open");
    return;
  }

  // Need (re)connect — only when forced or URL/key/worker identity changed
  if (wsManager) {
    console.log(`[Offscreen] Replacing WS (force=${forceReconnect}, urlChanged=${lastConnectedWsUrl !== wsUrl})`);
    try {
      wsManager.close();
    } catch { /* ignore */ }
    wsManager = null;
  }

  console.log(`[Offscreen] Connecting to: ${wsUrl.replace(/api_key=[^&]+/, "api_key=***")}`);
  lastConnectedWsUrl = wsUrl;

  wsManager = new ResilientWebSocket(wsUrl, {
    reconnectInterval: 5000,
    maxReconnectAttempts: 50,
    pingInterval: 25000,
    workerId: email,
    workerName: workerInstanceName,
    getPingPayload: () => slotStatus(),
  });

  wsManager.broadcastStatus = (status: string) => {
    broadcastStatus(status);
    wsManager?.trigger("stateChange", status);
  };

  wsManager.on("open", () => {
    console.log("[Offscreen] WebSocket Connected!");
    if (wsManager) {
      const googleEmail = data.googleEmail || data.active_emails?.GFLOW || "";
      const oauthToken = data.oauthToken || "";
      wsManager.send({
        action: "REGISTER",
        email,
        client_uuid: clientUuid,
        google_email: googleEmail,
        oauth_token: oauthToken,
      });

      storageGet(["active_emails", "googleEmail"]).then((res: any) => {
        const accounts = enabledAccounts(res.active_emails || {}, res.googleEmail);
        wsManager?.send({
          action: "WORKER_STATUS",
          ...slotStatus(),
          lastSeen: Math.floor(Date.now() / 1000),
          accounts,
        });
      });

      lastStatusUpdate = Date.now();
    }
  });

  wsManager.on("message", (msg: any) => {
    if (msg.action === "GENERATE") {
      const provider = normalizeProvider(msg.provider || 'gflow');
      const taskId = String(msg.task_id || msg.jobId || '');
      if (!taskId) {
        console.warn('[Offscreen] Ignoring GENERATE without task_id');
        return;
      }
      if (providerSlots.hasTask(taskId)) {
        console.warn(`[Offscreen] Ignoring duplicate active GENERATE for task ${taskId}`);
        wsManager?.send({
          action: "JOB_ACK",
          taskId, task_id: taskId, provider,
          duplicate: true,
        });
        wsManager?.send({ action: 'WORKER_STATUS', ...slotStatus() });
        return;
      }
      if (wasRecentlyCompleted(taskId)) {
        console.warn(`[Offscreen] Ignoring duplicate completed GENERATE for task ${taskId}`);
        wsManager?.send({ action: 'WORKER_STATUS', ...slotStatus(taskId) });
        return;
      }
      if (!providerSlots.tryAcquire(provider, taskId)) {
          console.warn(`[Offscreen] ${provider} concurrency limit reached. Rejecting job: ${taskId}`);
          if (wsManager) {
            wsManager.send({
              action: "JOB_REJECT",
              taskId, task_id: taskId,
              reason: `${provider.toLowerCase()}_concurrency_limit_reached`,
              retryable: true,
            });
          }
          return;
      }
        if (wsManager) {
          wsManager.send({
            action: "JOB_ACK",
            taskId, task_id: taskId, provider,
          });
          wsManager.send({ action: 'WORKER_STATUS', ...slotStatus() });
        }

        chrome.runtime.sendMessage({ type: "GENERATE_JOB", payload: msg }, () => {
          // SUBMIT_RESULT_WS normally releases at result time. This callback is
          // the crash/error fallback and release is idempotent.
          if (providerSlots.release(taskId)) {
            wsManager?.send({ action: 'WORKER_STATUS', ...slotStatus(taskId) });
          }
          console.log(`[Offscreen] ${provider} job ${taskId} finished. Active count: ${providerSlots.activeCount(provider)}`);
        });
    } else if (msg.action === "CHECK_SESSION") {
      storageGet(["oauthToken", "googleEmail", "active_emails"]).then((result: any) => {
        if (wsManager) {
          wsManager.send({
            action: "SESSION_STATUS_PONG",
            provider: "gflow",
            email: result.googleEmail || result.active_emails?.GFLOW,
            sessionReady: !!result.oauthToken,
          });
        }
      });
    }
  });

  wsManager.connect();
}

// ===== Message listener =====
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "SUBMIT_RESULT_WS") {
    const { taskId, provider, result } = request;
    if (wsManager?.ws?.readyState === WebSocket.OPEN) {
      try {
        const payload: any = {
          action: "JOB_DONE",
          task_id: taskId,
          completedJobId: taskId,
          provider: provider,
          email: result.email || "",
          status: result.success ? "success" : "failed"
        };

        if (result.success) {
          payload.result = result.outputUrls && result.outputUrls.length > 0
            ? result.outputUrls
            : (result.rawResponse ? (typeof result.rawResponse === 'string' ? [result.rawResponse] : result.rawResponse) : []);
        } else {
          payload.error_message = result.error || "Unknown error";
        }

        if (result.actualMeta) {
          payload.actualMeta = result.actualMeta;
        }

        wsManager.send(payload);
        rememberCompletedJob(String(taskId));
        providerSlots.release(String(taskId));
        wsManager.send({ action: 'WORKER_STATUS', ...slotStatus(String(taskId)) });
        sendResponse({ success: true });
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: "WS_NOT_OPEN" });
    }
    return true;
  }

  if (request.type === "PING_OFFSCREEN") {
    sendResponse({ status: "ALIVE" });
    return true;
  }

  if (request.type === "FORCE_RECONNECT_WS") {
    lastConnectedWsUrl = "";
    if (wsManager) {
      try { wsManager.close(); } catch {}
      wsManager = null;
    }
    checkWebSocket(true)
      .then(() => sendResponse({ success: true }))
      .catch((err: any) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === "WS_REREGISTER") {
    softReregister()
      .then(() => sendResponse?.({ success: true }))
      .catch(() => sendResponse?.({ success: false }));
    return true;
  }

  // Background forwards storage change events here
  if (request.type === "STORAGE_CHANGED_NOTIFY") {
    const ch = request.changes || {};
    if (ch.provider_max_slots || ch.provider_enabled) refreshSlotConfig().then(() => softReregister()).catch(() => {});
    // Only hard-reconnect when connection identity changes — NOT selected_provider UI tab
    const hard =
      ch.hub_api_key ||
      ch.gflow_api_key ||
      ch.dreamina_api_key ||
      ch.picsart_api_key ||
      ch.topview_api_key ||
      ch.gflowUrl ||
      ch.workerName;
    if (hard) {
      lastConnectedWsUrl = "";
      if (wsManager) {
        try { wsManager.close(); } catch {}
        wsManager = null;
      }
      checkWebSocket(true).catch(() => {});
    } else if (ch.selected_provider) {
      // UI provider tab only — keep socket, refresh status payload
      softReregister().catch(() => {});
    }
    return false;
  }

  return false;
});

// Boot
console.log("[Offscreen] Booting with stable WS key (not tied to selected_provider)...");
setInterval(() => checkWebSocket(false), 15000);
refreshSlotConfig().finally(() => checkWebSocket(true));
