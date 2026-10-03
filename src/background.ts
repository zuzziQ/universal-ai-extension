import { GoogleLabsDriver } from './features/google-flow/GoogleLabsDriver';
import { PicsartDriver } from './features/picsart/PicsartDriver';
import { DreaminaDriver } from './features/dreamina/DreaminaDriver';
import { TopViewDriver } from './features/topview/TopViewDriver';
import { IAIDriver } from './core/AIDriver.interface';
import { 
  generateImage, 
  generateVideo, 
  createGoogleLabsProject, 
  checkVideoGenerationStatus, 
  renameVideoWorkflow,
  resolveGoogleFlowProject
} from './features/google-flow/googleLabsApi';
import { saveOrUpdateJob, sanitizeLocationPrompt } from './core/jobHistory';
import { submitJobResult, syncDirectJobsToHub } from './core/hubClient';
import { setupOffscreen } from './core/offscreenManager';
import { registerDnrRules } from './core/dnrRules';
import { initializeAlarms, registerAlarmListener } from './core/alarms';
import { scrapeDreaminaPoints } from './features/dreamina/dreaminaScraper';


// --- Override console logs to forward to sidepanel page ---
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Local debug sink (optional). Enable with chrome.storage.local.debug_log_sink = true
let debugLogSinkEnabled = false;
chrome.storage.local.get(["debug_log_sink"]).then((d) => {
  debugLogSinkEnabled = d.debug_log_sink === true;
}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debug_log_sink) {
    debugLogSinkEnabled = changes.debug_log_sink.newValue === true;
  }
});

function forwardLog(type: string, ...args: any[]) {
  const msg = args.map(a => {
    if (a instanceof Error) {
      return a.stack || a.message;
    }
    try {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    } catch {
      return String(a);
    }
  }).join(' ');
  
  // Only notify UI for errors/warnings to reduce message storm & SW wake churn
  if (type === 'error' || type === 'warn') {
    chrome.runtime.sendMessage({ type: 'BG_LOG', logType: type, message: msg }).catch(() => {});
  }
  
  if (debugLogSinkEnabled) {
    fetch('http://127.0.0.1:9999', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: type.toUpperCase(), message: msg })
    }).catch(() => {});
  }
}

console.log = (...args) => { originalLog(...args); forwardLog('log', ...args); };
console.error = (...args) => { originalError(...args); forwardLog('error', ...args); };
console.warn = (...args) => { originalWarn(...args); forwardLog('warn', ...args); };

// --- Drivers Map ---
const drivers: Record<string, IAIDriver> = {
  GOOGLE_FLOW: new GoogleLabsDriver(),
  GFLOW: new GoogleLabsDriver(),
  "GOOGLE-ULTRA": new GoogleLabsDriver(),
  "GOOGLE_ULTRA": new GoogleLabsDriver(),
  "GOOGLE-LABS-ULTRA": new GoogleLabsDriver(),
  "GOOGLE_LABS_ULTRA": new GoogleLabsDriver(),
  PICSART: new PicsartDriver(),
  DREAMINA: new DreaminaDriver(),
  TOPVIEW: new TopViewDriver()
};

// --- Helper to Rotate Dreamina Account ---
async function autoRotateDreaminaAccount(): Promise<boolean> {
  console.log(`[Auto Rotate] Starting Dreamina account rotation (fetching from Core-Account-API)...`);
  
  const accountData = await import('./core/hubClient').then(m => m.checkoutAccount('DREAMINA'));
  if (!accountData || !accountData.email) {
    console.warn(`[Auto Rotate] Hub Gateway returned no available Dreamina account.`);
    return false;
  }

  const { accountId, email, cookiesJson } = accountData;
  console.log(`[Auto Rotate] Hub assigned account: ${email} (ID: ${accountId})`);

  const targetDomain = ".capcut.com";
  const targetUrl = "https://dreamina.capcut.com/ai-tool/generate?type=image&workspace=0";

  // Xoá cookie cũ — query theo domain (tránh getAll({}) quét toàn bộ cookie browser)
  console.log(`[Auto Rotate] Clearing existing cookies for related domains...`);
  try {
    const relatedDomains = ['capcut.com', 'dreamina.com', 'byteoversea.com', 'tiktok.com'];
    let clearedCount = 0;
    for (const domain of relatedDomains) {
      const domainCookies = await chrome.cookies.getAll({ domain });
      for (const c of domainCookies) {
        const removeUrl = 'https://' + (c.domain.startsWith('.') ? c.domain.substring(1) : c.domain) + c.path;
        await chrome.cookies.remove({ url: removeUrl, name: c.name }).catch(() => {});
        clearedCount++;
      }
    }
    console.log(`[Auto Rotate] Cleared ${clearedCount} old cookies.`);
    
    if (chrome.browsingData) {
      await chrome.browsingData.remove({
        origins: [
          'https://capcut.com',
          'https://www.capcut.com', 
          'https://dreamina.capcut.com',
          'https://www.tiktok.com',
          'https://byteoversea.com'
        ]
      }, {
        "indexedDB": true,
        "localStorage": true,
        "serviceWorkers": true,
        "webSQL": true,
        "cacheStorage": true
      });
      console.log('[Auto Rotate] Wiped browsingData successfully.');
    }
  } catch (err: any) {
    console.warn(`[Auto Rotate] Failed to clear old cookies or storage:`, err.message);
  }

  // Inject cookie mới từ JSON
  let parsedCookies: any[] = [];
  try {
    if (typeof cookiesJson === 'string') {
      parsedCookies = JSON.parse(cookiesJson);
    } else if (Array.isArray(cookiesJson)) {
      parsedCookies = cookiesJson;
    } else if (accountData.cookies && Array.isArray(accountData.cookies)) {
      parsedCookies = accountData.cookies;
    }
  } catch(e) {
    console.warn(`[Auto Rotate] Failed to parse cookies JSON from Hub`, e);
  }

  if (parsedCookies.length > 0) {
    const expirationDate = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const cookieUrl = 'https://dreamina.capcut.com';
    let successCount = 0;
    for (const c of parsedCookies) {
      try {
        await chrome.cookies.set({
          url: cookieUrl,
          name: c.name,
          value: c.value,
          domain: c.domain || targetDomain,
          path: c.path || '/',
          secure: true,
          expirationDate
        });
        successCount++;
      } catch (cookieErr: any) {
        console.warn(`[Auto Rotate] Failed to set cookie "${c.name}":`, cookieErr.message);
      }
    }
    console.log(`[Auto Rotate] Injected ${successCount}/${parsedCookies.length} cookies successfully.`);
  } else {
    console.warn(`[Auto Rotate] No valid JSON cookies array found for ${email}`);
  }

  // Cập nhật active storage với accountId để check-in sau
  const localCache = await chrome.storage.local.get(["active_emails"]) as any;
  const activeEmails = localCache.active_emails || {};
  activeEmails.DREAMINA = email;
  await chrome.storage.local.set({ 
    active_emails: activeEmails, 
    current_dreamina_email: email,
    current_dreamina_account_id: accountId
  });
  console.log(`[Auto Rotate] Saved active accountId: ${accountId}, email: ${email}`);

  // Reload tab Capcut
  try {
    const matchingTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
      chrome.tabs.query({ url: `*://*.capcut.com/*` }, resolve);
    });

    if (matchingTabs.length > 0) {
      chrome.tabs.update(matchingTabs[0].id!, { url: targetUrl });
      for (let i = 1; i < matchingTabs.length; i++) {
        chrome.tabs.reload(matchingTabs[i].id!);
      }
      console.log(`[Auto Rotate] Refreshed Capcut tab ${matchingTabs[0].id} and reloaded other tabs.`);
    } else {
      console.log(`[Auto Rotate] Opening background Capcut tab.`);
      await chrome.tabs.create({ url: targetUrl, active: false });
    }
  } catch (err: any) {
    console.warn(`[Auto Rotate] Failed to reload Capcut tabs:`, err.message);
  }

  // Đợi tab load
  await new Promise(r => setTimeout(r, 4000));
  return true;
}

// --- Configure sidepanel behavior and fallback listeners ---
function configureSidePanel() {
  if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: Error) => console.error("[Universal Ext] Sidepanel setup error:", error));
  }

  if (chrome.action && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
    chrome.action.onClicked.addListener((tab) => {
      if (tab.id) {
        chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
          console.warn("[Universal Ext] Programmatic sidepanel open failed, opening options page instead:", err);
          chrome.runtime.openOptionsPage().catch(() => {});
        });
      }
    });
  }
}

configureSidePanel();

// --- Storage Changed Listener ---
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    const keys = ["xBrowserValidation", "xClientData", "xBrowserChannel", "xBrowserCopyright", "xBrowserYear"];
    if (keys.some(k => changes[k])) {
      registerDnrRules().catch(console.error);
    }
    // Hard reconnect only when gateway / worker name / any API key changes.
    // selected_provider is UI-only — must NOT disconnect WS (was the GFlow switch bug).
    const hardReconnectKeys = [
      "hub_api_key",
      "dreamina_api_key",
      "picsart_api_key",
      "topview_api_key",
      "gflow_api_key",
      "gflowUrl",
      "workerName",
    ];
    if (hardReconnectKeys.some((k) => changes[k])) {
      console.log("[Background] Connection keys changed → hard WS reconnect");
      const changesSimple: Record<string, any> = {};
      for (const [k, v] of Object.entries(changes)) {
        changesSimple[k] = { newValue: (v as any).newValue };
      }
      chrome.runtime.sendMessage({ type: "STORAGE_CHANGED_NOTIFY", changes: changesSimple }).catch(() => {});
    } else if (changes.selected_provider) {
      // Soft only — keep socket ONLINE when flipping Dreamina ↔ GFlow tabs
      console.log("[Background] selected_provider UI change → soft re-register (no disconnect)");
      chrome.runtime.sendMessage({ type: "WS_REREGISTER" }).catch(() => {});
    } else if (changes.oauthToken || changes.googleEmail || changes.active_emails) {
      chrome.runtime.sendMessage({ type: "WS_REREGISTER" }).catch(() => {});
    }
  }
});

// --- Proactive Token Refresh (Every 45 minutes or if missing) ---
chrome.alarms.create("refreshTokenAlarm", { periodInMinutes: 45 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshTokenAlarm") {
    proactiveTokenRefresh();
  }
});

async function proactiveTokenRefresh() {
  const data = await chrome.storage.local.get(["oauthToken", "googleEmail"]);
  if (!data.googleEmail) return; // If no Google Account is logged in, don't refresh
  
  console.log("[Background] Proactively refreshing Google Labs token...");
  chrome.storage.local.remove(["oauthToken"]);
  chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
    if (tabs.length === 0) {
      chrome.tabs.create({ url: "https://labs.google/fx/tools/videofx", active: false }, (newTab) => {
        setTimeout(() => {
          if (newTab && newTab.id) {
            chrome.tabs.remove(newTab.id).catch(() => {});
          }
        }, 8000);
      });
    } else {
      if (tabs[0].id) {
        chrome.tabs.reload(tabs[0].id);
        setTimeout(() => {
          chrome.tabs.remove(tabs[0].id!).catch(() => {});
        }, 8000);
      }
    }
  });
}

// Initial check on startup
setTimeout(async () => {
  const data = await chrome.storage.local.get(["oauthToken", "googleEmail"]);
  if (data.googleEmail && !data.oauthToken) {
    proactiveTokenRefresh();
  }
}, 3000);

// --- Capture OAuth Bearer token from network requests ---
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    for (let header of details.requestHeaders || []) {
      if (header.name.toLowerCase() === 'authorization' && header.value && header.value.startsWith('Bearer ya29.')) {
        const token = header.value.replace('Bearer ', '');
        chrome.storage.local.get(["oauthToken"], (data) => {
          if (data.oauthToken !== token) {
            chrome.storage.local.set({ oauthToken: token });
            console.log("[Universal Ext] Captured OAuth Token from network request!");
            extractWebIdentity();
          }
        });
      }
      if (header.name.toLowerCase() === 'x-browser-validation') {
        chrome.storage.local.set({ xBrowserValidation: header.value });
      }
      if (header.name.toLowerCase() === 'x-client-data') {
        chrome.storage.local.set({ xClientData: header.value });
      }
    }
  },
  { urls: ["*://*.googleapis.com/*", "*://labs.google/*", "*://*.labs.google/*"] },
  ["requestHeaders"]
);

// --- Extract Web Identity from Google listAccounts page ---
async function extractWebIdentity() {
  try {
    const res = await fetch("https://accounts.google.com/ListAccounts?gpsia=1", { method: 'GET' });
    const text = await res.text();
    const emailMatch = text.match(/"([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)"/);
    const avatarMatch = text.match(/"(https:\/\/lh3\.googleusercontent\.com\/a\/[a-zA-Z0-9_-]+)"/);
    
    if (emailMatch) {
      const email = emailMatch[1];
      const avatar = avatarMatch ? avatarMatch[1] : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      chrome.storage.local.set({ googleEmail: email, googleAvatar: avatar });
      // Notify backend about new token
      const settings = await chrome.storage.local.get(["gflowUrl", "gflow_api_key"]);
      if (settings.gflowUrl && settings.gflow_api_key) {
        const tokens = await chrome.storage.local.get(["oauthToken"]);
        // Endpoint được chuẩn hóa theo Domain-Driven Routing
        await fetch(`${settings.gflowUrl}/worker/v1/account/rotation/gflow/accounts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.gflow_api_key}`
          },
          body: JSON.stringify({
            email: email,
            oauthToken: tokens.oauthToken
          })
        }).catch(e => console.warn("[Universal Ext] Failed to sync session to Hub:", e));
      }
      console.log("[Universal Ext] Extracted Web Identity: " + email);
    }
  } catch (e: any) {
    console.warn("[Universal Ext] Web Identity Fetch failed: " + e.message);
  }
}

// --- Main Job Dispatcher ---
async function handleGenerateJob(msg: any) {
  let activeAcc: any = null;
  const providerUpper = (msg.provider || "GOOGLE_FLOW").toUpperCase();
  const driver = drivers[providerUpper];

  if (!driver) {
    console.error(`[Universal Ext] Unsupported provider: ${providerUpper}`);
    await submitJobResult(msg.task_id, providerUpper, {
      success: false,
      error: `Provider ${providerUpper} is not supported by Universal Extension`
    });
    return { success: false, error: `Provider ${providerUpper} is not supported` };
  }

  const entityTypeLower = String(msg.entity_type || msg.entityType || msg.EntityType || "").toLowerCase();
  const isLocationOrProp = entityTypeLower === "location" || entityTypeLower === "setting" || entityTypeLower === "scene" || entityTypeLower === "prop";
  
  let finalPrompt = msg.prompt || "";
  if (isLocationOrProp) {
    console.log(`[Universal Ext] Sanitizing location/prop prompt to remove character-specific style terms...`);
    finalPrompt = sanitizeLocationPrompt(finalPrompt);
    console.log(`[Universal Ext] Cleaned Prompt: "${finalPrompt}"`);
  }

  const projId = msg.project_id || msg.projectId || "";
  const projName = msg.project_name || msg.projectName || "";
  const projLink = msg.project_link || msg.projectLink || "";
  console.log(`[Universal Ext] Dispatching task ${msg.task_id} to ${providerUpper} Driver... Project: ${projName} (${projId}) - Link: ${projLink}`);
  
  await saveOrUpdateJob({
    id: msg.task_id,
    mediaType: msg.media_type || 'image',
    prompt: finalPrompt,
    provider: providerUpper,
    status: 'processing',
    timestamp: Date.now(),
    projectId: projId,
    projectName: projName,
    projectLink: projLink,
    inputParams: msg.input_params || msg.inputParams || msg,
    source: msg.source,
    pool: msg.pool,
    batchName: msg.batch_name || msg.batchName || projName
  });

  const config = await chrome.storage.local.get([
    "dreamina_execution_mode",
    "active_emails",
    "auto_switch_enabled",
    "gflowUrl",
    "hub_api_key",
    "googleEmail"
  ]) as any;

  const executionMode = config.dreamina_execution_mode || "extension";

  if (providerUpper === 'GOOGLE_FLOW' || providerUpper === 'GFLOW' || providerUpper === 'GOOGLE-ULTRA' || providerUpper === 'GOOGLE_ULTRA' || providerUpper === 'GOOGLE-LABS-ULTRA' || providerUpper === 'GOOGLE_LABS_ULTRA') {
    let rotateAttempts = 0;
    let lastErrorMsg = "GFlow execution failed";
    while (rotateAttempts < 3) {
      let activeEmail = "";
      try {
        const googleTokens = await chrome.storage.local.get([
          "oauthToken",
          "googleEmail",
          "xBrowserValidation",
          "xClientData",
          "active_emails"
        ]) as any;

        // GFlow is a rotatable provider pool (same model as Dreamina): active_emails.GFLOW is source of truth
        const poolEmail = googleTokens.active_emails?.GFLOW || "";
        activeEmail = poolEmail || googleTokens.googleEmail || "universal_director@storymee.local";
        // Keep googleEmail in sync with pool selection for drivers / WS identity
        if (poolEmail && poolEmail !== googleTokens.googleEmail) {
          await chrome.storage.local.set({ googleEmail: poolEmail });
        }

        const tokens = {
          oauthToken: googleTokens.oauthToken,
          xBrowserValidation: googleTokens.xBrowserValidation,
          xClientData: googleTokens.xClientData,
          email: activeEmail,
          cookies: []
        };
        console.log(`[Universal Ext] GFlow pool provider active: ${activeEmail}. Attempt ${rotateAttempts + 1}`);
        
        // Nested inputParams often carry model/ratio from Hub jobs
        const ip = msg.input_params || msg.inputParams || {};
        const result = await driver.generate({
          taskId: msg.task_id,
          prompt: finalPrompt,
          mediaType: msg.media_type || msg.mediaType || ip.media_type || ip.jobType || 'image',
          aspectRatio:
            msg.aspect_ratio ||
            msg.aspectRatio ||
            ip.aspect_ratio ||
            ip.aspectRatio ||
            ip.ratio ||
            "16:9",
          referenceImageUrls:
            msg.reference_image_urls ||
            msg.referenceImageUrls ||
            ip.reference_image_urls ||
            ip.referenceImageUrls ||
            (ip.reference_image || ip.referenceImage
              ? [ip.reference_image || ip.referenceImage]
              : []) ||
            [],
          referenceImageRoles: msg.reference_image_roles || msg.referenceImageRoles || ip.reference_image_roles || [],
          storyboardFrameUrl: msg.storyboard_frame_url || msg.storyboardFrameUrl || ip.storyboard_frame_url,
          generatorMode: msg.generator_mode || msg.generatorMode || ip.generator_mode || ip.generatorMode,
          cameraMovement: msg.camera_movement || msg.cameraMovement || ip.camera_movement,
          projectName: projName,
          projectId: projId,
          modelId:
            msg.model_id ||
            msg.modelId ||
            msg.ModelId ||
            ip.model_id ||
            ip.modelId ||
            ip.model ||
            "auto",
          entityType: msg.entity_type || msg.entityType || msg.EntityType || ip.entity_type || ip.entityType,
          duration: msg.duration || msg.duration_seconds || msg.durationSeconds || (msg.duration_sec !== undefined ? msg.duration_sec : (msg.duration_ms ? Math.round(msg.duration_ms / 1000) : undefined)),
          numOutputs: msg.num_outputs || msg.numOutputs || ip.num_outputs || ip.numOutputs || 1
        }, tokens);

        if (result.success) {
          if (result.outputUrls && result.outputUrls.length > 0 && (msg.media_type || 'image') === 'image') {
            console.log("[StoryMee] GFLOW image generated, delegating persistence to backend asset sync");
          }

          await saveOrUpdateJob({
            id: msg.task_id,
            status: 'done',
            resultUrl: result.outputUrls?.[0]
          });
          await submitJobResult(msg.task_id, providerUpper, result);

          return {
            success: true,
            outputUrls: result.outputUrls,
            email: activeEmail,
            actualMeta: result.actualMeta,
            creditsUsed: result.creditsUsed
          };
        } else {
          throw new Error(result.error || "GFlow driver failed");
        }
      } catch (gErr: any) {
        lastErrorMsg = gErr.message || "Unknown GFlow error";
        const isAuthError = lastErrorMsg.includes('401') || lastErrorMsg.toLowerCase().includes('unauthenticated');
        if (isAuthError && rotateAttempts < 2) {
          console.warn(`[Background] GFlow auth error detected (Attempt ${rotateAttempts + 1}/3). Attempting token refresh. error: ${lastErrorMsg}`);
          await chrome.storage.local.remove(["oauthToken"]);
          
          const googleTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ url: "*://labs.google/fx/tools/flow*" }, resolve);
          });
          if (googleTabs.length > 0) {
            console.log(`[Background] Reloading existing Labs Flow tab ${googleTabs[0].id}`);
            chrome.tabs.reload(googleTabs[0].id!);
          } else {
            console.log(`[Background] Opening new Labs Flow tab in background`);
            await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: false });
          }

          console.log("[Background] Waiting 10s for new token...");
          await new Promise(r => setTimeout(r, 10000));
          const freshTokens = await chrome.storage.local.get(["oauthToken"]) as any;
          if (freshTokens.oauthToken) {
            console.log("[Background] New token captured, retrying...");
            rotateAttempts++;
            continue;
          } else {
            console.error("[Background] Failed to capture new token. Expiring session...");
            if (activeAcc && activeAcc.accountId) {
              const { checkinAccount } = await import('./core/hubClient');
              await checkinAccount(activeAcc.accountId, 0, 'EXPIRED');
            }
            break;
          }
        } else {
          break;
        }
      }
    }

    await saveOrUpdateJob({
      id: msg.task_id,
      status: 'failed',
      error: lastErrorMsg
    });
    await submitJobResult(msg.task_id, providerUpper, {
      success: false,
      error: lastErrorMsg
    });
    return { success: false, error: lastErrorMsg };
  }

  if (providerUpper === 'DREAMINA' && executionMode === "headless") {
    console.log(`[Universal Ext] Headless Mode is active. Delegating job ${msg.task_id} to external CLI worker...`);
    await submitJobResult(msg.task_id, providerUpper, {
      success: true,
      outputUrls: [],
      rawResponse: "FORWARDED_TO_HEADLESS_WORKER"
    });
    await saveOrUpdateJob({
      id: msg.task_id,
      status: 'done',
      resultUrl: ""
    });
    return { success: true, message: "FORWARDED_TO_HEADLESS_WORKER" };
  }


  if (providerUpper === 'DREAMINA') {
    // Dreamina specific: always checkout from Hub and inject cookies into browser before generation
    await autoRotateDreaminaAccount();
    const cache = await chrome.storage.local.get(["current_dreamina_email", "current_dreamina_account_id"]);
    if (cache.current_dreamina_email && cache.current_dreamina_account_id) {
      activeAcc = { email: cache.current_dreamina_email, accountId: cache.current_dreamina_account_id };
    }
  } else {
    // For other providers (GFlow, Picsart, TopView) fetch account from Hub
    const accountData = await import('./core/hubClient').then(m => m.checkoutAccount(providerUpper));
    if (accountData && accountData.email) {
      activeAcc = accountData;
    }
  }

  if (!activeAcc || (!activeAcc.accountId && providerUpper !== 'DREAMINA')) {
    const errText = `No active account available from Hub for provider ${providerUpper}.`;
    await saveOrUpdateJob({ id: msg.task_id, status: 'failed', error: errText });
    await submitJobResult(msg.task_id, providerUpper, { success: false, error: errText });
    return { success: false, error: errText };
  }

  let result: any = null;
  try {
    console.log(`[Universal Ext] Executing single-pass generate job on ${providerUpper} with account: ${activeAcc.email}`);
    
    let parsedCookies: any[] = [];
    if (providerUpper !== 'DREAMINA' && activeAcc.cookiesJson) {
      try {
        if (typeof activeAcc.cookiesJson === 'string') {
          parsedCookies = JSON.parse(activeAcc.cookiesJson);
        } else if (Array.isArray(activeAcc.cookiesJson)) {
          parsedCookies = activeAcc.cookiesJson;
        } else if (activeAcc.cookies && Array.isArray(activeAcc.cookies)) {
          parsedCookies = activeAcc.cookies;
        }
      } catch (e) {
        console.warn(`[Universal Ext] Failed to parse cookies for ${providerUpper}`, e);
      }
    }

    if (parsedCookies.length === 0) {
      console.log(`[Universal Ext] Cookies from storage is empty. Fetching directly from browser cookies for ${providerUpper}...`);
      const targetDomain = providerUpper === 'DREAMINA' ? '.capcut.com' : providerUpper === 'PICSART' ? '.picsart.com' : '.google.com';
      try {
        const browserCookies = await chrome.cookies.getAll({ domain: targetDomain });
        if (browserCookies && browserCookies.length > 0) {
          console.log(`[Universal Ext] Fallback successful! Harvested ${browserCookies.length} cookies directly from browser.`);
          parsedCookies = browserCookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path
          }));
        }
      } catch (cookieErr: any) {
        console.warn(`[Universal Ext] Fallback cookies.getAll failed:`, cookieErr.message);
      }
    }

    const tokens = { cookies: parsedCookies, email: activeAcc.email, accountId: activeAcc.accountId };
    
    result = await driver.generate({
      taskId: msg.task_id,
      prompt: finalPrompt,
      mediaType: msg.media_type || 'image',
      aspectRatio: msg.aspect_ratio || msg.aspectRatio,
      referenceImageUrls: msg.reference_image_urls || [],
      referenceImageRoles: msg.reference_image_roles || [],
      storyboardFrameUrl: msg.storyboard_frame_url || msg.storyboardFrameUrl,
      generatorMode: msg.generator_mode || msg.generatorMode,
      cameraMovement: msg.camera_movement || msg.cameraMovement,
      projectName: projName,
      projectId: projId,
      modelId: msg.model_id || msg.modelId || msg.ModelId,
      entityType: msg.entity_type || msg.entityType || msg.EntityType,
      duration: msg.duration || msg.duration_seconds || msg.durationSeconds || (msg.duration_sec !== undefined ? msg.duration_sec : (msg.duration_ms ? Math.round(msg.duration_ms / 1000) : undefined))
    }, tokens);

    if (result && result.points !== undefined && result.points !== null) {
      if (!result.actualMeta) result.actualMeta = {};
      result.actualMeta.remaining_points = result.points;
    }

    if (result && result.success) {
      await saveOrUpdateJob({
        id: msg.task_id,
        status: 'done',
        resultUrl: result.outputUrls?.[0] || ""
      });
      await submitJobResult(msg.task_id, providerUpper, result);

      if (result.points !== undefined && result.points !== null) {
        const newStatus = result.points <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
        if (activeAcc && activeAcc.accountId) {
          const { checkinAccount } = await import('./core/hubClient');
          await checkinAccount(activeAcc.accountId, result.creditsUsed || 1, newStatus);
        }

        if (providerUpper === 'DREAMINA' && (result.points <= 0 || newStatus === 'LOW_CREDIT')) {
          console.log(`[Background] Post-execution rotation triggered: points = ${result.points}, status = ${newStatus}`);
          autoRotateDreaminaAccount().catch(console.error);
        }
      }

      return {
        success: true,
        outputUrls: result.outputUrls,
        email: activeAcc.email,
        actualMeta: result.actualMeta,
        creditsUsed: result.creditsUsed
      };
    } else {
      if (result && result.points !== undefined && result.points !== null) {
        const newStatus = result.points <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
        if (result.points <= 0) {
          result.error = "OUT_OF_POINTS";
        }
        if (activeAcc && activeAcc.accountId) {
          const { checkinAccount } = await import('./core/hubClient');
          await checkinAccount(activeAcc.accountId, result.creditsUsed || 1, newStatus);
        }

        if (providerUpper === 'DREAMINA' && (result.points <= 0 || newStatus === 'LOW_CREDIT')) {
          console.log(`[Background] Post-execution rotation triggered due to failed job with points: points = ${result.points}`);
          autoRotateDreaminaAccount().catch(console.error);
        }
      }
      throw new Error(result?.error || "Driver generation returned unsuccessful status");
    }
  } catch (drvErr: any) {
    console.error(`[Universal Ext] Driver execution failed:`, drvErr.message);
    await saveOrUpdateJob({
      id: msg.task_id,
      status: 'failed',
      error: drvErr.message
    });
    
    // Nếu là lỗi đăng nhập/cookie hết hạn, cập nhật trạng thái EXPIRED ngay
    const errMsg = drvErr.message || "";
    let isExpired = false;
    if (errMsg.includes('Cookie') || errMsg.includes('expired') || errMsg.includes('login') || errMsg.includes('unauthorized') || errMsg.includes('auth')) {
      isExpired = true;
      if (activeAcc && activeAcc.accountId) {
        const { checkinAccount } = await import('./core/hubClient');
        await checkinAccount(activeAcc.accountId, 0, 'EXPIRED');
      }
    }

    if (providerUpper === 'DREAMINA' && isExpired) {
      console.log(`[Background] Post-execution rotation triggered due to EXPIRED auth error: ${errMsg}`);
      autoRotateDreaminaAccount().catch(console.error);
    }

    let errorMsg = drvErr.message;
    if (result && result.points !== undefined && result.points !== null && result.points <= 0) {
      errorMsg = "OUT_OF_POINTS";
    }

    await submitJobResult(msg.task_id, providerUpper, {
      success: false,
      error: errorMsg,
      email: activeAcc.email,
      actualMeta: result?.actualMeta
    });
    return { success: false, error: errorMsg, email: activeAcc.email };
  }
}

// --- Share Message Handler ---
const sharedMessageHandler = (request: any, _sender: chrome.runtime.MessageSender, sendResponse: (res?: any) => void) => {
  if (request.type === "PROXY_STORAGE_GET") {
    chrome.storage.local.get(request.keys, (data) => sendResponse({ data }));
    return true;
  }

  if (request.type === "PROXY_STORAGE_SET") {
    chrome.storage.local.set(request.data, () => sendResponse({ success: true }));
    return true;
  }

  if (request.type === "PROXY_COOKIES_GET") {
    chrome.cookies.getAll({ domain: request.domain }, (cookies) => sendResponse({ cookies: cookies || [] }));
    return true;
  }

  if (request.type === "GENERATE_JOB") {
    handleGenerateJob(request.payload).then((resData) => {
      sendResponse({ success: true, result: resData });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.action === "saveToken") {
     chrome.storage.local.set({ oauthToken: request.token }).then(() => {
       sendResponse({ success: true });
       extractWebIdentity();
     });
     return true;
  }

  if (request.action === "saveIdentity") {
     chrome.storage.local.set({ googleEmail: request.email, googleAvatar: request.avatar }).then(() => {
       sendResponse({ success: true });
     });
     return true;
  }

  if (request.action === "GENERATE_IMAGE") {
    chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
      const existingTab = tabs.find(t => t.id !== undefined);
      const tabId = existingTab?.id;

      chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]).then(async (tokens) => {
        try {
          const resolvedProjectId = await resolveGoogleFlowProject(request.payload, tabId);
          request.payload.projectId = resolvedProjectId;

          if (tabId && resolvedProjectId && resolvedProjectId !== "default" && resolvedProjectId !== "012b7b28-f3f0-4441-9926-f5c9dc59deb3") {
            try {
              const tab = await chrome.tabs.get(tabId);
              const targetUrl = `https://labs.google/fx/tools/flow/project/${resolvedProjectId}`;
              if (tab && tab.url && !tab.url.includes(resolvedProjectId) && tab.url !== targetUrl) {
                console.log(`[Universal Ext] Navigating Google Labs tab to project: ${resolvedProjectId}`);
                await chrome.tabs.update(tabId, { url: targetUrl, active: false });
                await new Promise(r => setTimeout(r, 4000));
              }
            } catch (err) {
              console.warn(`[Universal Ext] Optional project navigation failed:`, err);
            }
          }

          const result = await generateImage(request.payload, tokens, undefined, tabId);
          sendResponse(result);
        } catch (err: any) {
          sendResponse({ error: err.message });
        }
      });
    });
    return true;
  }

  if (request.action === "GENERATE_SCENE") {
    chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
      const existingTab = tabs.find(t => t.id !== undefined);
      const tabId = existingTab?.id;

      chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]).then(async (tokens) => {
        try {
          const resolvedProjectId = await resolveGoogleFlowProject(request.payload, tabId);
          request.payload.projectId = resolvedProjectId;

          if (tabId && resolvedProjectId && resolvedProjectId !== "default" && resolvedProjectId !== "012b7b28-f3f0-4441-9926-f5c9dc59deb3") {
            try {
              const tab = await chrome.tabs.get(tabId);
              const targetUrl = `https://labs.google/fx/tools/flow/project/${resolvedProjectId}`;
              if (tab && tab.url && !tab.url.includes(resolvedProjectId) && tab.url !== targetUrl) {
                console.log(`[Universal Ext] Navigating Google Labs tab to project: ${resolvedProjectId}`);
                await chrome.tabs.update(tabId, { url: targetUrl, active: false });
                await new Promise(r => setTimeout(r, 4000));
              }
            } catch (err) {
              console.warn(`[Universal Ext] Optional project navigation failed:`, err);
            }
          }

          const result = await generateVideo(request.payload, tokens, undefined, tabId);
          sendResponse(result);
        } catch (err: any) {
          sendResponse({ error: err.message });
        }
      });
    });
    return true;
  }

  if (request.action === "CHECK_STATUS") {
    chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]).then(tokens => {
      checkVideoGenerationStatus(request.payload.mediaIds, tokens, request.payload.projectId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (request.action === "RENAME_WORKFLOW") {
    chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]).then(tokens => {
      renameVideoWorkflow(request.payload.workflowId, request.payload.displayName, tokens, request.payload.projectId)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }

  if (request.action === "CREATE_PROJECT") {
    chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
      const existingTab = tabs.find(t => t.id !== undefined);
      const tabId = existingTab?.id;

      chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]).then(async (tokens) => {
        try {
          const newProjectId = await createGoogleLabsProject(tokens, request.payload.projectName, tabId);
          
          const projectName = request.payload.projectName;
          if (projectName && newProjectId) {
            const mapKey = `gflow_project_map_${projectName}`;
            const legacyMapKey = `project_map_${projectName}`;
            await chrome.storage.local.set({ [mapKey]: newProjectId, [legacyMapKey]: newProjectId });
            console.log(`[Universal Ext] Project created and mapped: ${projectName} -> ${newProjectId}`);
          }
          sendResponse({ success: true, projectId: newProjectId });
        } catch (err: any) {
          sendResponse({ error: err.message });
        }
      });
    });
    return true;
  }

  if (request.action === "CONNECT_WS") {
    (async () => {
      try {
        await chrome.storage.local.set({ gflowUrl: request.payload?.gflowUrl || "https://hub.storymee.com" });
        await setupOffscreen();
        await new Promise(resolve => setTimeout(resolve, 300));
        const res = await chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => null);
        if (res && res.success) {
          sendResponse({ success: true });
        } else {
          sendResponse({ success: true, note: "Reconnect triggered" });
        }
      } catch (err: any) {
        console.error("[Background] CONNECT_WS error:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === "SWITCH_ACCOUNT") {
    const { provider, email, cookieStr } = request.payload;
    const providerUpper = (provider || "DREAMINA").toUpperCase();
    
    const executeSwitch = async () => {
      const data = await chrome.storage.local.get(["active_emails"]);
      const activeEmails: Record<string, any> = data.active_emails || {};
      const oldEmail = activeEmails[providerUpper];
      
      let targetDomain = "";
      let targetUrl = "";
      if (providerUpper === 'DREAMINA') {
        targetDomain = ".capcut.com";
        targetUrl = "https://dreamina.capcut.com/ai-tool/generate?type=image&workspace=0";
      } else if (providerUpper === 'PICSART') {
        targetDomain = ".picsart.com";
        targetUrl = "https://picsart.com/create";
      } else if (providerUpper === 'TOPVIEW') {
        targetDomain = ".topview.ai";
        targetUrl = "https://www.topview.ai/member";
      } else if (providerUpper === 'GFLOW' || providerUpper === 'GOOGLE_FLOW') {
        targetDomain = ".google.com";
        targetUrl = "https://labs.google/fx/tools/flow";
      }

      if (oldEmail && oldEmail !== email && providerUpper === 'DREAMINA') {
        try {
          const matchingTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ url: "*://dreamina.capcut.com/*" }, resolve);
          });
          if (matchingTabs.length > 0) {
            console.log(`[Switch Account] Scraping old account (${oldEmail}) points before switch...`);
            const oldPoints = await scrapeDreaminaPoints(matchingTabs[0].id!, true);
            if (oldPoints !== null && oldPoints !== undefined && oldPoints !== "logged_out") {
              console.log(`[Switch Account] Saving points for old account (${oldEmail}): ${oldPoints} Pts`);
              const oldStatus = oldPoints <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
              const sCache = await chrome.storage.local.get(["current_dreamina_account_id"]);
              if (sCache.current_dreamina_account_id) {
                const { checkinAccount } = await import('./core/hubClient');
                await checkinAccount(sCache.current_dreamina_account_id as string, 0, oldStatus);
              }
            }
          }
        } catch (oldScrapeErr) {
          console.warn("[Switch Account] Failed to scrape points of old account:", oldScrapeErr);
        }
      }

      if (targetDomain) {
        console.log(`[Cookie Injection] Clearing existing cookies for related domains...`);
        const allCookies = await chrome.cookies.getAll({});
        let clearedCount = 0;
        for (const c of allCookies) {
          if (c.domain.includes('capcut') || c.domain.includes('dreamina') || c.domain.includes('byteoversea') || c.domain.includes('tiktok') || c.domain.includes(targetDomain.replace(/^\./, ''))) {
            const removeUrl = 'https://' + (c.domain.startsWith('.') ? c.domain.substring(1) : c.domain) + c.path;
            await chrome.cookies.remove({ url: removeUrl, name: c.name }).catch(() => {});
            clearedCount++;
          }
        }
        console.log(`[Cookie Injection] Cleared ${clearedCount} old cookies.`);
        
        if (chrome.browsingData) {
          let originsToWipe: string[] = [];
          if (providerUpper === 'DREAMINA') {
            originsToWipe = ['https://capcut.com', 'https://www.capcut.com', 'https://dreamina.capcut.com', 'https://www.tiktok.com', 'https://byteoversea.com'];
          } else if (providerUpper === 'PICSART') {
            originsToWipe = ['https://picsart.com', 'https://www.picsart.com'];
          } else if (providerUpper === 'TOPVIEW') {
            originsToWipe = ['https://topview.ai', 'https://www.topview.ai'];
          } else {
            originsToWipe = ['https://labs.google', 'https://google.com'];
          }
          await chrome.browsingData.remove({ origins: originsToWipe as [string, ...string[]] }, {
            "indexedDB": true,
            "localStorage": true,
            "serviceWorkers": true,
            "webSQL": true,
            "cacheStorage": true
          }).catch(() => {});
        }
      }

      if (targetDomain && cookieStr) {
        const expirationDate = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
        const cookieUrl = providerUpper === 'DREAMINA' ? 'https://dreamina.capcut.com'
          : providerUpper === 'PICSART' ? 'https://picsart.com'
          : providerUpper === 'TOPVIEW' ? 'https://www.topview.ai'
          : 'https://labs.google';

        console.log(`[Cookie Injection] Injecting cookies for ${email} → ${cookieUrl} (domain: ${targetDomain})`);
        const pairs = cookieStr.split(';').map((p: string) => p.trim()).filter(Boolean);
        let successCount = 0;
        for (const pair of pairs) {
          const firstEq = pair.indexOf('=');
          if (firstEq > -1) {
            const name = pair.substring(0, firstEq).trim();
            const value = pair.substring(firstEq + 1).trim();
            try {
              await chrome.cookies.set({
                url: cookieUrl,
                name,
                value,
                domain: targetDomain,
                path: '/',
                secure: true,
                expirationDate
              });
              successCount++;
            } catch (cookieErr: any) {
              console.warn(`[Cookie Injection] Failed to set cookie "${name}":`, cookieErr.message);
            }
          }
        }
        console.log(`[Cookie Injection] Set ${successCount}/${pairs.length} cookies successfully.`);
      }

      // Canonical key for GFlow aliases
      const storageKey =
        providerUpper === 'GOOGLE_FLOW' || providerUpper === 'GOOGLE_ULTRA' || providerUpper === 'GOOGLE_LABS_ULTRA'
          ? 'GFLOW'
          : providerUpper;
      activeEmails[storageKey] = email;
      if (storageKey === 'GFLOW') {
        activeEmails.GFLOW = email;
        // GFlow is a rotatable provider pool — bind identity for driver/WS + force OAuth recapture
        await chrome.storage.local.set({
          active_emails: activeEmails,
          googleEmail: email,
        });
        await chrome.storage.local.remove(['oauthToken']);
        console.log(`[Switch Account] GFlow active identity → ${email} (oauth cleared for recapture)`);
      } else {
        await chrome.storage.local.set({ active_emails: activeEmails });
      }
      if (providerUpper === 'DREAMINA') {
        await chrome.storage.local.set({ current_dreamina_email: email });
      }

      let tab: any = null;
      if (targetDomain) {
        const domainBase = targetDomain.startsWith('.') ? targetDomain.substring(1) : targetDomain;
        // labs.google tabs for GFlow; also match google.com session pages
        const queryUrls =
          storageKey === 'GFLOW'
            ? ['*://labs.google/*', '*://*.labs.google/*']
            : [`*://*.${domainBase}/*`];
        const matchingTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
          chrome.tabs.query({ url: queryUrls }, resolve);
        });

        if (matchingTabs.length > 0) {
          chrome.tabs.update(matchingTabs[0].id!, { url: targetUrl });
          for (let i = 1; i < matchingTabs.length; i++) {
            chrome.tabs.reload(matchingTabs[i].id!);
          }
          tab = matchingTabs[0];
          console.log(`[Switch Account] Redirecting tab and reloading other tabs.`);
        } else {
          console.log(`[Switch Account] Opening background tab for scraping.`);
          tab = await chrome.tabs.create({ url: targetUrl, active: false });
        }
      }

      let newPoints: number | undefined = undefined;
      let newStatus = 'ACTIVE';

      if (providerUpper === 'DREAMINA') {
        if (tab) {
          await new Promise(r => setTimeout(r, 4000));
          console.log(`[Switch Account] Scraping new account (${email}) points...`);
          const parsedResult = await scrapeDreaminaPoints(tab.id!, true);

          if (parsedResult === "logged_out") {
            newStatus = 'EXPIRED';
            newPoints = 0;
            console.log(`[Background] Detected logout for ${email}. Clearing session.`);
            await chrome.storage.local.remove(['active_emails', 'current_dreamina_email']);
          } else if (typeof parsedResult === 'number') {
            newPoints = parsedResult;
            console.log(`[Switch Account] Scraped new account points: ${newPoints}`);
          } else {
            try {
              const checkPassportRes = await chrome.scripting.executeScript({
                target: { tabId: tab.id! },
                world: 'MAIN',
                func: async () => {
                  try {
                    const infoResponse = await window.fetch(
                      'https://dreamina.capcut.com/passport/web/account/info/?aid=513641&account_sdk_source=web&sdk_version=2.1.10-tiktok&language=en',
                      { credentials: 'include' }
                    );
                    const infoJson = await infoResponse.json();
                    return infoJson.data?.user_id_str || '';
                  } catch (e) {
                    return '';
                  }
                }
              });
              const userId = checkPassportRes?.[0]?.result || '';
              if (!userId) {
                newStatus = 'EXPIRED';
                await chrome.storage.local.remove(['active_emails', 'current_dreamina_email']);
                console.log(`[Switch Account] Expired verify.`);
              }
            } catch (passportErr) {
              console.warn("[Switch Account] Failed to verify passport:", passportErr);
            }
          }
        }
      } else {
        let verifyUrl = "";
        if (providerUpper === 'PICSART') verifyUrl = "https://picsart.com/api/v1/users/me";
        else if (providerUpper === 'TOPVIEW') verifyUrl = "https://www.topview.ai/api/user/profile";
        else if (providerUpper === 'GFLOW') verifyUrl = "https://labs.google/fx/api/user";

        if (verifyUrl) {
          try {
            const res = await fetch(verifyUrl, { credentials: 'include' });
            if (res.status === 401 || res.status === 403) {
              newStatus = 'EXPIRED';
            }
          } catch (e) {}
        }
        newPoints = 1;
      }

      if (newStatus !== 'EXPIRED' && newPoints !== undefined && newPoints !== null && newPoints <= 0) {
        newStatus = 'LOW_CREDIT';
      }
      // syncAccountPoints is deprecated, skipping manual switch sync
      chrome.runtime.sendMessage({ type: "PING_OFFSCREEN" }).catch(() => {});

      return { success: true, points: newPoints, email, status: newStatus, activeEmails };
    };

    executeSwitch().then((res) => sendResponse(res)).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === "DREAMINA_MANUAL_GENERATE_SUBMITTED") {
    (async () => {
      try {
        const { submitId, prompt, jobType, model, aspectRatio } = request.payload;
        console.log(`[Background] Manual job detected in tab: submitId=${submitId}, prompt="${prompt}", model="${model}", ratio="${aspectRatio}"`);

        // Cache meta for later status sync
        const cacheKey = `manual_meta_${submitId}`;
        await chrome.storage.local.set({ [cacheKey]: { model, aspectRatio } });

        // Lấy active email của Dreamina hiện tại
        const storage = await chrome.storage.local.get(["active_emails", "current_dreamina_email"]) as any;
        const activeEmail = storage.active_emails?.DREAMINA || storage.current_dreamina_email || "manual_user@storymee.local";

        // 1. Cào điểm sớm ngay lập tức
        if (_sender.tab && _sender.tab.id) {
          const tabId = _sender.tab.id;
          console.log(`[Background] Scraping early points balance in tab ${tabId} for manual job...`);
          // Đợi 2 giây để UI/API CapCut xử lý xong việc trừ điểm
          await new Promise(r => setTimeout(r, 2000));
          const earlyPoints = await scrapeDreaminaPoints(tabId, true);
          if (earlyPoints !== null && earlyPoints !== undefined && earlyPoints !== "logged_out") {
            const newStatus = earlyPoints <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
            console.log(`[Background] Scraped early manual points: ${earlyPoints} Pts. Syncing to Hub...`);
            const sCache = await chrome.storage.local.get(["current_dreamina_account_id"]);
            if (sCache.current_dreamina_account_id) {
              const { checkinAccount } = await import('./core/hubClient');
              await checkinAccount(sCache.current_dreamina_account_id as string, 0, newStatus);
            }
          }
        }

        // 2. Tạo record direct job trạng thái processing và sync về Hub
        const cleanModel = model || 'auto';
        const cleanRatio = aspectRatio || '1:1';
        const manualJob = {
          id: `manual-dreamina-${submitId}__model_${cleanModel}__ratio_${cleanRatio}`,
          email: activeEmail,
          jobType: jobType || 'image',
          prompt: prompt || '—',
          status: 'processing',
          outputUrls: [],
          pointsCost: 0,
          errorMessage: null,
          createdAt: Date.now()
        };
        await syncDirectJobsToHub([manualJob]);

        sendResponse({ success: true });
      } catch (err: any) {
        console.warn("[Background] Failed to handle DREAMINA_MANUAL_GENERATE_SUBMITTED:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === "DREAMINA_MANUAL_HISTORY_UPDATED") {
    (async () => {
      try {
        const updates = request.payload as any[];
        console.log(`[Background] Intercepted manual history updates for ${updates.length} records.`);

        const storage = await chrome.storage.local.get(["active_emails", "current_dreamina_email"]) as any;
        const activeEmail = storage.active_emails?.DREAMINA || storage.current_dreamina_email || "manual_user@storymee.local";

        const cacheKeys = updates.map(u => `manual_meta_${u.submitId}`);
        const cachedMeta = await chrome.storage.local.get(cacheKeys);

        const jobsToSync: any[] = [];
        let shouldScrapePoints = false;

        for (const update of updates) {
          const { submitId, status, outputUrls, errorMessage } = update;
          console.log(`[Background] Syncing manual job status: submitId=${submitId} -> status=${status}`);
          
          const meta = (cachedMeta[`manual_meta_${submitId}`] as any) || {};
          const cleanModel = meta.model || 'auto';
          const cleanRatio = meta.aspectRatio || '1:1';
          const fullId = `manual-dreamina-${submitId}__model_${cleanModel}__ratio_${cleanRatio}`;

          jobsToSync.push({
            id: fullId,
            email: activeEmail,
            status: status,
            outputUrls: outputUrls || [],
            errorMessage: errorMessage || null,
            updatedAt: Date.now(),
            ...(update.prompt && { prompt: update.prompt }),
            ...(update.jobType && { jobType: update.jobType })
          });

          if (status === 'done' || status === 'failed') {
            shouldScrapePoints = true;
          }
        }

        if (jobsToSync.length > 0) {
          await syncDirectJobsToHub(jobsToSync);
        }

        // 3. Cào điểm lần cuối sau khi job hoàn thành
        if (shouldScrapePoints && _sender.tab && _sender.tab.id) {
          const tabId = _sender.tab.id;
          console.log(`[Background] Scraping final points balance in tab ${tabId} after job resolution...`);
          const finalPoints = await scrapeDreaminaPoints(tabId, true);
          if (finalPoints !== null && finalPoints !== undefined && finalPoints !== "logged_out") {
            const newStatus = finalPoints <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
            console.log(`[Background] Scraped final manual points: ${finalPoints} Pts. Syncing to Hub...`);
            const sCache = await chrome.storage.local.get(["current_dreamina_account_id"]);
            if (sCache.current_dreamina_account_id) {
              const { checkinAccount } = await import('./core/hubClient');
              await checkinAccount(sCache.current_dreamina_account_id as string, 0, newStatus);
            }
          }
        }

        sendResponse({ success: true });
      } catch (err: any) {
        console.warn("[Background] Failed to handle DREAMINA_MANUAL_HISTORY_UPDATED:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  return false;
};

chrome.runtime.onMessage.addListener(sharedMessageHandler);

// --- Lifeline connection ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "universal-lifeline") {
    console.log("[Universal Ext] Sidepanel lifeline connected.");
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === "ping") {
        try { port.postMessage({ type: "pong" }); } catch (e) {}
      }
    });
  }
});

// --- External page messages ---
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  console.log("[Universal Ext] Received external message:", sender.url);
  const sharedActions = ["GENERATE_SCENE", "UPLOAD_REFERENCE_IMAGE", "GENERATE_IMAGE", "CHECK_STATUS", "RENAME_WORKFLOW", "CREATE_PROJECT", "CONNECT_WS", "SWITCH_ACCOUNT"];
  if (sharedActions.includes(request.action)) {
    return sharedMessageHandler(request, sender, sendResponse);
  }

  if (request.action === "GET_GOOGLE_LABS_TOKEN") {
    chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData", "googleEmail", "googleAvatar"], (data) => {
      sendResponse({
        token: data.oauthToken,
        xBrowserValidation: data.xBrowserValidation,
        xClientData: data.xClientData,
        email: data.googleEmail,
        avatar: data.googleAvatar
      });
    });
    return true;
  }

  if (request.action === "OPEN_LABS_BACKGROUND") {
    chrome.storage.local.remove(["oauthToken"]);
    chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
      if (tabs.length === 0) {
        chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: false });
        sendResponse({ success: true, message: "Opened new Labs tab" });
      } else {
        if (tabs[0].id) chrome.tabs.reload(tabs[0].id);
        sendResponse({ success: true, message: "Reloaded existing Labs tab" });
      }
    });
    return true;
  }

  if (request.action === "PING") {
    sendResponse({ status: "Extension Connected", version: chrome.runtime.getManifest().version });
    return true;
  }

  if (request.action === "RELOAD") {
    console.log("[Universal Ext] Restarting extension...");
    sendResponse({ success: true });
    setTimeout(() => { chrome.runtime.reload(); }, 500);
    return true;
  }
  return false;
});

// --- Initialization & Alarms ---
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Universal Ext] Extension Installed/Updated. Reason:', details.reason);
  setupOffscreen(true).catch(console.error);
  extractWebIdentity();
  registerDnrRules().catch(console.error);
  configureSidePanel();
  initializeAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  initializeAlarms();
  extractWebIdentity();
  registerDnrRules().catch(console.error);
  configureSidePanel();
});

registerAlarmListener();

// Immediate initialization
setupOffscreen(true).catch(console.error);
registerDnrRules().catch(console.error);

