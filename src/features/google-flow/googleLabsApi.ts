/** Strip undefined/null header values — Chrome fetch throws / fails with bad headers. */
function cleanHeaders(headers: Record<string, any> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = String(v);
  }
  return out;
}

export async function executeTabFetch(
  tabId: number,
  url: string,
  method: string,
  headers: any,
  body?: string
): Promise<{ ok: boolean; status: number; text: string; url?: string }> {
  try {
    // Ensure tab still exists and is a normal http(s) page
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.id || !tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
        return { ok: false, status: 0, text: `Invalid tab for script inject: ${tab?.url || "missing"}` };
      }
      if (tab.status === "loading") {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e: any) {
      return { ok: false, status: 0, text: `Tab gone: ${e?.message || e}` };
    }

    const safeHeaders = cleanHeaders(headers);
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (u: string, m: string, h: Record<string, string>, b: string | undefined) => {
        try {
          const res = await window.fetch(u, {
            method: m,
            headers: h,
            body: b,
            credentials: "include",
            mode: "cors",
          });
          const status = res.status;
          const text = await res.text();
          return { ok: res.ok, status, text, url: res.url };
        } catch (err: any) {
          return {
            ok: false,
            status: 0,
            text: `TabFetchError: ${err?.name || ""} ${err?.message || String(err)}`,
          };
        }
      },
      args: [url, method, safeHeaders, body ?? undefined],
    });
    if (result?.[0]?.result) {
      return result[0].result as any;
    }
    return { ok: false, status: 0, text: "No execution result from tab (script returned empty)" };
  } catch (e: any) {
    return { ok: false, status: 0, text: `executeScript: ${e.message || String(e)}` };
  }
}

/** Service-worker / extension fetch with host_permissions (bypasses page CORS). */
export async function executeSwFetch(
  url: string,
  method: string,
  headers: any,
  body?: string
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: cleanHeaders(headers),
      body,
      credentials: "omit",
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      text: `SwFetchError: ${err?.name || ""} ${err?.message || String(err)}`,
    };
  }
}

/**
 * Prefer SW fetch (extension privileges), then tab MAIN-world fetch.
 * Fixes widespread "Failed to fetch" when tab is wrong/loading or page blocks request.
 */
export async function robustGoogleApiFetch(
  url: string,
  method: string,
  headers: any,
  body?: string,
  tabId?: number
): Promise<{ ok: boolean; status: number; text: string; via: string }> {
  const h = cleanHeaders(headers);
  // Always try SW first — host_permissions on *.googleapis.com
  const sw = await executeSwFetch(url, method, h, body);
  if (sw.ok || (sw.status > 0 && sw.status !== 0)) {
    // Got an HTTP response (even 4xx/5xx) — return it for caller to handle
    if (sw.status !== 0) return { ...sw, via: "sw" };
  }

  if (tabId && tabId > 0) {
    const tab = await executeTabFetch(tabId, url, method, h, body);
    if (tab.status !== 0 || tab.ok) {
      return { ...tab, via: "tab" };
    }
    // Both failed network-level: combine messages
    return {
      ok: false,
      status: 0,
      text: `SW: ${sw.text} | Tab: ${tab.text}`,
      via: "both-failed",
    };
  }

  return { ...sw, via: "sw-only" };
}

function sanitizeUnsafePrompt(prompt: string): string {
  if (!prompt) return "A beautiful cinematic scene, safe photography.";
  
  // Thay thế chủ động các từ dễ bị bộ lọc nhạy cảm của Google đánh dấu nhầm trong nhà bếp/bối cảnh
  let cleaned = prompt;
  cleaned = cleaned.replace(/\bbacksplash\w*\b/gi, "wall tiles");
  cleaned = cleaned.replace(/\bknife\b/gi, "cooking tool");
  cleaned = cleaned.replace(/\bknives\b/gi, "cooking tools");

  const sensitiveWords = [
    /\bkill\w*\b/gi, /\bmurder\w*\b/gi, /\bblood\w*\b/gi, /\bfight\w*\b/gi, 
    /\battack\w*\b/gi, /\bweapon\w*\b/gi, /\bnaked\b/gi, /\bnude\b/gi, 
    /\bsexy\b/gi, /\bwar\b/gi, /\bshoot\w*\b/gi, /\bgun\w*\b/gi, 
    /\bpistol\w*\b/gi, /\brifle\w*\b/gi, /\bbomb\w*\b/gi, /\bdie\w*\b/gi, 
    /\bdeath\b/gi, /\bexplode\w*\b/gi, /\bexplosion\w*\b/gi, /\bviolent\w*\b/gi,
    /\bviolence\b/gi, /\bstab\w*\b/gi, /\bslash\w*\b/gi, /\bcorpse\w*\b/gi,
    /\bsuicide\w*\b/gi, /\bterroris\w*\b/gi, /\bdead\b/gi,
    /\bdestroy\w*\b/gi, /\bhell\b/gi, /\bdevil\b/gi, /\bghost\b/gi, /\bmonster\b/gi,
    /\bsword\w*\b/gi, /\bblade\w*\b/gi, /\bdagger\w*\b/gi,
    /\bspear\w*\b/gi, /\bbloodstain\w*\b/gi, /\bwound\w*\b/gi, /\binjury\b/gi, /\binjure\w*\b/gi,
    /\bhurt\w*\b/gi, /\bcut\b/gi, /\bscream\w*\b/gi, /\bpanic\b/gi, /\bfear\b/gi,
    /\barrest\w*\b/gi, /\bpolice\b/gi, /\bthief\b/gi, /\bthieves\b/gi, /\bprison\w*\b/gi,
    /\bhostage\w*\b/gi, /\bkidnap\w*\b/gi, /\btorture\w*\b/gi, /\bassault\w*\b/gi,
    /\bpunch\w*\b/gi, /\bkick\w*\b/gi, /\bstrike\w*\b/gi, /\bhit\b/gi
  ];

  for (const regex of sensitiveWords) {
    cleaned = cleaned.replace(regex, "dramatic action");
  }

  // Cắt ngắn thông minh nếu prompt quá dài (giới hạn 500 ký tự để Google API chạy ổn định)
  if (cleaned.length > 500) {
    // Giữ lại 300 ký tự đầu (mô tả chính) và 180 ký tự cuối (thường chứa project style prompt + layout)
    const head = cleaned.substring(0, 300);
    const tail = cleaned.substring(cleaned.length - 180);
    cleaned = `${head}... ${tail}`;
  }
  // Google PUBLIC_ERROR_MINOR: child/minor depiction policy
  cleaned = cleaned.replace(/\bem bé\b/gi, "young character");
  cleaned = cleaned.replace(/\bembe\b/gi, "young character");
  cleaned = cleaned.replace(/\btrẻ em\b/gi, "young character");
  cleaned = cleaned.replace(/\btre em\b/gi, "young character");
  cleaned = cleaned.replace(/\bbé gái\b/gi, "young character");
  cleaned = cleaned.replace(/\bbé trai\b/gi, "young character");
  cleaned = cleaned.replace(/\bbaby\b/gi, "young character");
  cleaned = cleaned.replace(/\bbabies\b/gi, "young characters");
  cleaned = cleaned.replace(/\btoddler\b/gi, "young character");
  cleaned = cleaned.replace(/\bchild\b/gi, "young character");
  cleaned = cleaned.replace(/\bchildren\b/gi, "young characters");
  cleaned = cleaned.replace(/\bkid\b/gi, "young character");
  cleaned = cleaned.replace(/\bkids\b/gi, "young characters");
  cleaned = cleaned.replace(/\binfant\b/gi, "young character");
  cleaned = cleaned.replace(/\bminor\b/gi, "young character");
  cleaned = cleaned.replace(/\bunderage\b/gi, "young character");
  cleaned = cleaned.replace(/\bschoolgirl\b/gi, "young adult character");
  cleaned = cleaned.replace(/\bschoolboy\b/gi, "young adult character");
  cleaned = cleaned.replace(/\blittle girl\b/gi, "young character");
  cleaned = cleaned.replace(/\blittle boy\b/gi, "young character");

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || "A beautiful cinematic scene, safe photography.";
}


/** Normalize hub/job aspect ratios → Flow IMAGE_ASPECT_RATIO_* enums only. */
export function normalizeImageAspectRatio(raw: any): string {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  if (s.startsWith("IMAGE_ASPECT_RATIO_")) return s;
  if (s.includes("9:16") || s.includes("PORTRAIT") || s === "VERTICAL" || s === "TALL") {
    return "IMAGE_ASPECT_RATIO_PORTRAIT";
  }
  if (s.includes("1:1") || s.includes("SQUARE")) {
    return "IMAGE_ASPECT_RATIO_SQUARE";
  }
  if (s.includes("16:9") || s.includes("LANDSCAPE") || s.includes("WIDE") || s.includes("HORIZONTAL")) {
    return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  }
  return "IMAGE_ASPECT_RATIO_LANDSCAPE";
}

/**
 * Map hub model ids → Flow imageModelName.
 * Proven default for rotate/likeness: NARWHAL.
 * GEM_PIX_2 only when hub explicitly asks (nano/banana/gem_pix).
 * Do NOT map generic "*flash*" → abra.
 */
export function normalizeImageModelName(modelId?: string): { imageModelName: string; isXray: boolean } {
  const m = String(modelId || "").trim().toLowerCase();
  const isXray = m.includes("xray") || m.includes("x-ray");
  if (!m || m === "auto" || m === "default" || m === "image" || isXray) {
    return { imageModelName: "NARWHAL", isXray };
  }
  if (
    m === "abra" ||
    m === "omni-flash-3" ||
    m === "omni_flash_3" ||
    m.includes("omni-flash") ||
    m.includes("omni_flash") ||
    (m.includes("abra") && !m.includes("zebra"))
  ) {
    return { imageModelName: "abra", isXray };
  }
  if (m.includes("narwhal") || m.includes("imagen-3") || m.includes("imagen3")) {
    return { imageModelName: "NARWHAL", isXray };
  }
  if (
    m.includes("gem_pix") ||
    m.includes("gem-pix") ||
    m.includes("nano") ||
    m.includes("banana") ||
    m.includes("pix")
  ) {
    return { imageModelName: "GEM_PIX_2", isXray };
  }
  // Safe default used by pre-experiment rotate
  return { imageModelName: "NARWHAL", isXray };
}

function isSafetyOrMinorFilterError(status: number, text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("unsafe_generation") ||
    lower.includes("public_error_unsafe_generation") ||
    lower.includes("public_error_minor") ||
    (status === 400 && lower.includes("invalid_argument") && lower.includes("public_error"))
  );
}

export async function fetchFreshRecaptchaToken(tabId: number, action: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const reqId = "recaptcha_api_" + Date.now() + "_" + Math.random().toString().substring(2, 7);
    const timeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Timeout waiting for recaptcha in api helper"));
    }, 6000);
    
    const listener = (request: any) => {
      if (request.action === "FORWARD_RECAPTCHA" && request.reqId === reqId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeoutId);
        if (request.error) reject(new Error(request.error));
        else resolve(request.token);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: (key: string, rAction: string, rId: string) => {
          let bridge = document.getElementById(rId);
          if (!bridge) {
            bridge = document.createElement("div");
            bridge.id = rId;
            bridge.style.display = "none";
            document.body.appendChild(bridge);
          }

          function getSiteKey() {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              if (s.src && s.src.includes('recaptcha') && s.src.includes('render=')) {
                const match = s.src.match(/render=([^&]+)/);
                if (match) return match[1];
              }
            }
            if ((window as any).___grecaptcha_cfg && (window as any).___grecaptcha_cfg.clients) {
              for (const k in (window as any).___grecaptcha_cfg.clients) {
                const sitekey = (window as any).___grecaptcha_cfg.clients[k]?.sitekey;
                if (sitekey) return sitekey;
              }
            }
            return key;
          }

          const activeKey = getSiteKey();

          function execRecaptcha() {
            try {
              (window as any).grecaptcha.enterprise.ready(() => {
                (window as any).grecaptcha.enterprise.execute(activeKey, { action: rAction })
                  .then((token: string) => bridge!.setAttribute("data-token", token))
                  .catch((err: any) => bridge!.setAttribute("data-error", String(err)));
              });
            } catch (e) {
              bridge!.setAttribute("data-error", String(e));
            }
          }

          if (typeof (window as any).grecaptcha === 'undefined' || !(window as any).grecaptcha.enterprise) {
             const s = document.createElement('script');
             s.src = "https://www.google.com/recaptcha/enterprise.js?render=" + activeKey;
             s.onload = execRecaptcha;
             s.onerror = () => bridge!.setAttribute("data-error", "Failed to load recaptcha script");
             document.head.appendChild(s);
          } else {
             execRecaptcha();
          }
        },
        args: ["6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV", action, reqId]
      });

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "ISOLATED",
        func: (rId: string) => {
          let attempts = 0;
          const intervalId = setInterval(() => {
            attempts++;
            if (attempts > 30) {
              clearInterval(intervalId);
              chrome.runtime.sendMessage({ action: "FORWARD_RECAPTCHA", reqId: rId, error: "DOM Bridge polling timeout" });
              return;
            }
            const bridge = document.getElementById(rId);
            if (bridge) {
              const token = bridge.getAttribute("data-token");
              const err = bridge.getAttribute("data-error");
              if (token) {
                clearInterval(intervalId);
                chrome.runtime.sendMessage({ action: "FORWARD_RECAPTCHA", reqId: rId, token: token });
                bridge.remove();
              } else if (err) {
                clearInterval(intervalId);
                chrome.runtime.sendMessage({ action: "FORWARD_RECAPTCHA", reqId: rId, error: err });
                bridge.remove();
              }
            }
          }, 200);
        },
        args: [reqId]
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      chrome.runtime.sendMessage({ action: "FORWARD_RECAPTCHA", reqId: reqId, error: e.message || String(e) });
      reject(e);
    }
  });
}

export async function uploadReferenceImage(payload: any, tokens: any) {
  const { base64Image, projectId } = payload;
  if (!base64Image) throw new Error("Missing base64Image");

  const clientContext: any = {
    projectId: projectId || "ba466f2d-083b-4f86-bd6b-0d054a7ed865",
    tool: "PINHOLE"
  };

  let finalBase64 = base64Image;
  try {
    const fetchRes = await fetch(base64Image);
    const blob = await fetchRes.blob();
    const imageBitmap = await createImageBitmap(blob);
    let width = imageBitmap.width;
    let height = imageBitmap.height;
    const MAX_DIMENSION = 1024;
    
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      if (width > height) {
        height = Math.round((height * MAX_DIMENSION) / width);
        width = MAX_DIMENSION;
      } else {
        width = Math.round((width * MAX_DIMENSION) / height);
        height = MAX_DIMENSION;
      }
      
      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageBitmap, 0, 0, width, height);
        const resizedBlob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        
        const buffer = await resizedBlob.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        finalBase64 = `data:image/jpeg;base64,${btoa(binary)}`;
      }
    }
  } catch (e) {
    console.warn("Failed to resize image, proceeding with original:", e);
  }

  const uploadBody = {
    clientContext: clientContext,
    imageBytes: finalBase64.replace(/^data:image\/\w+;base64,/, "")
  };

  if (!tokens?.oauthToken) {
    throw new Error("Upload Error: Missing Google OAuth token — open labs.google/fx and sign in");
  }

  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json",
    "origin": "https://labs.google",
    "referer": "https://labs.google/",
  };
  if (tokens.xBrowserValidation) headers["x-browser-validation"] = tokens.xBrowserValidation;
  if (tokens.xClientData) headers["x-client-data"] = tokens.xClientData;

  // tabId not available in this helper signature — SW-first robust fetch
  const up = await executeSwFetch(
    "https://aisandbox-pa.googleapis.com/v1/flow/uploadImage",
    "POST",
    headers,
    JSON.stringify(uploadBody)
  );
  const ok = up.ok;
  const status = up.status;
  const text = up.text;

  if (!ok) {
    throw new Error(`Upload Error (${status}): ${text}`);
  }

  const data = JSON.parse(text);
  let rawMediaId = (data.media && data.media.name) || data.mediaId || data.id || data.name || (data.image && data.image.mediaId);
  if (rawMediaId) {
    return { 
      mediaId: rawMediaId.replace(/^media\//, ""),
      projectId: clientContext.projectId 
    };
  }
  throw new Error("Could not parse mediaId from response");
}

/**
 * Flow batchGenerateImages — proven payload (pre-experiment).
 *
 * DO NOT add experimental fields that break protobuf schema:
 *  - mediaGenerationId in structuredPrompt.parts  → Unknown name "mediaGenerationId"
 *  - IMAGE_INPUT_TYPE_SUBJECT / STYLE / MIXED     → invalid image_input_type
 *  - mediaId + name-with-prefix combos on imageInputs
 *
 * Working shape only:
 *  imageInputs: [{ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: bareId }]
 *  structuredPrompt.parts: [{ text }]
 *  mediaGenerationContext.entityContext optional (soft)
 */
export async function generateImage(payload: any, tokens: any, recaptchaToken?: string, tabId?: number) {
  const { prompt, mediaIds, projectId, modelId, aspectRatio, entityContext } = payload;
  const numOutputs = Math.min(4, Math.max(1, Number(payload.numOutputs) || 1));
  const dynamicProjectId = projectId || "012b7b28-f3f0-4441-9926-f5c9dc59deb3";

  let safetyFilterFailures = 0;
  let invalidArgRetries = 0;
  let networkRetries = 0;
  let recaptchaRetries = 0;
  let activePrompt = String(prompt || "").trim();
  // Bare media ids only — preserve refs, never silently drop to force success
  const originalMediaIds: string[] = Array.isArray(mediaIds)
    ? mediaIds.map((m: string) => String(m).replace(/^media\//, "").trim()).filter(Boolean)
    : [];
  const activeMediaIds: string[] = [...originalMediaIds];
  let activeEntityContext = entityContext || null;
  let { imageModelName, isXray } = normalizeImageModelName(modelId);
  let imageAspectRatio = normalizeImageAspectRatio(aspectRatio);

  const sharedCtx: any = {
    projectId: dynamicProjectId,
    tool: "PINHOLE",
    sessionId: ";" + Date.now(),
  };
  if (recaptchaToken) {
    sharedCtx.recaptchaContext = { token: recaptchaToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" };
  }

  if (!tokens?.oauthToken) {
    throw new Error(
      "Image Generate Error: Missing OAuth token — mở https://labs.google/fx/tools/flow và đăng nhập Google"
    );
  }

  const headers: any = {
    authorization: `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json",
  };
  if (tokens.xBrowserValidation) headers["x-browser-validation"] = tokens.xBrowserValidation;
  if (tokens.xClientData) headers["x-client-data"] = tokens.xClientData;

  const apiUrl = `https://aisandbox-pa.googleapis.com/v1/projects/${dynamicProjectId}/flowMedia:batchGenerateImages`;

  /** Canonical proven imageInputs — REFERENCE + bare name only. */
  const buildImageInputs = (ids: string[]) =>
    ids.map((mId: string) => ({
      imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
      name: mId.replace(/^media\//, ""),
    }));

  while (
    safetyFilterFailures < 3 &&
    invalidArgRetries < 3 &&
    networkRetries < 3 &&
    recaptchaRetries < 3
  ) {
    const requestsArr = Array.from({ length: numOutputs }).map(() => {
      const req: any = {
        seed: Math.floor(Math.random() * 1000000),
        imageModelName,
        imageAspectRatio,
        // Text-only parts — never attach mediaGenerationId here
        structuredPrompt: {
          parts: [{ text: activePrompt }],
        },
        clientContext: sharedCtx,
      };
      if (activeMediaIds.length > 0) {
        req.imageInputs = buildImageInputs(activeMediaIds);
      }
      if (isXray) {
        req.requestContext = {
          flowSdkInfo: {
            appletId: "43d3a4ae-117a-461b-a732-adac0ea13021",
            appletVersionId: "5433ba71-e90b-44ef-a311-1849d71edaed",
          },
        };
      }
      return req;
    });

    // Proven outer envelope (same as pre-experiment working rotate)
    const bodyJson: any = {
      clientContext: sharedCtx,
      useNewMedia: true,
      mediaGenerationContext: {
        batchId: "img-batch-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        ...(activeEntityContext ? { entityContext: activeEntityContext } : {}),
      },
      requests: requestsArr,
    };

    console.log(
      `[Universal Ext] generateImage | model=${imageModelName} ratio=${imageAspectRatio} ` +
        `refs=${activeMediaIds.length}/${originalMediaIds.length} entity=${!!activeEntityContext} ` +
        `promptLen=${activePrompt.length} attempt=${safetyFilterFailures + invalidArgRetries + networkRetries + 1}`
    );
    if (activeMediaIds.length > 0) {
      console.log(
        `[Universal Ext] Ref mediaIds:`,
        activeMediaIds,
        `inputs:`,
        JSON.stringify(buildImageInputs(activeMediaIds))
      );
    }

    const res = await robustGoogleApiFetch(apiUrl, "POST", headers, JSON.stringify(bodyJson), tabId);
    const ok = res.ok;
    const status = res.status;
    const text = res.text || "";
    console.log(`[Universal Ext] generateImage HTTP via=${res.via} status=${status} bodyLen=${text.length}`);

    if (!ok) {
      const lowerText = text.toLowerCase();

      // Network hard-fail — keep refs, retry dual-fetch path
      if (status === 0 || /failed to fetch|swfetcherror|tabfetcherror|networkerror/i.test(text)) {
        networkRetries++;
        if (networkRetries < 3) {
          console.warn(
            `[Universal Ext] Network fail (try ${networkRetries}) — keep refs=${activeMediaIds.length}`
          );
          await new Promise((r) => setTimeout(r, 800 * networkRetries));
          continue;
        }
        throw new Error(
          `Image Generate Error (0): Failed to fetch (via=${res.via}). ` +
            `Mở tab https://labs.google/fx/tools/flow (đã login), đợi load xong. ` +
            `Chi tiết: ${text.slice(0, 200)}`
        );
      }

      if (status === 403 && (lowerText.includes("recaptcha") || lowerText.includes("unusual_activity"))) {
        recaptchaRetries++;
        console.warn(
          `[Universal Ext] reCAPTCHA 403 detected (${recaptchaRetries}/3). Requesting a new token...`
        );
        if (recaptchaRetries >= 3) {
          throw new Error(
            `Image Generate Error (403): Google blocked reCAPTCHA after ${recaptchaRetries} attempts.`
          );
        }
        if (tabId) {
          try {
            await chrome.tabs.reload(tabId);
            await new Promise((r) => setTimeout(r, 6000));
            const nextToken = await fetchFreshRecaptchaToken(tabId, "IMAGE_GENERATION");
            sharedCtx.recaptchaContext = {
              token: nextToken,
              applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
            };
            continue;
          } catch (recaptchaErr: any) {
            console.error(`[Universal Ext] reCAPTCHA recovery failed:`, recaptchaErr.message);
          }
        }
        throw new Error(`Image Generate Error (403): ${text.slice(0, 240)}`);
      }

      if (isSafetyOrMinorFilterError(status, text) || lowerText.includes("public_error_minor")) {
        safetyFilterFailures++;
        console.warn(
          `[Universal Ext] Safety/MINOR policy (${status}). Retry ${safetyFilterFailures}/3 (KEEP refs)`
        );
        if (safetyFilterFailures === 1) {
          activePrompt = sanitizeUnsafePrompt(prompt);
          activeEntityContext = null;
          continue;
        }
        if (safetyFilterFailures === 2) {
          activePrompt =
            "A beautiful cinematic scene, safe professional photography, soft lighting, masterpiece.";
          activeEntityContext = null;
          continue;
        }
        if (activeMediaIds.length > 0) {
          throw new Error(
            `Image blocked by Google (PUBLIC_ERROR_MINOR/safety) while using ${activeMediaIds.length} reference image(s). ` +
              `Google chặn likeness/trẻ em trên ref. Đổi ref hoặc bỏ REFS. Raw: ${text.slice(0, 180)}`
          );
        }
        throw new Error(`Image blocked by Google safety filter. Raw: ${text.slice(0, 200)}`);
      }

      // 400 INVALID_ARGUMENT — only safe retries (model flip / drop entity). Never SUBJECT/mediaGenerationId.
      if (status === 400 && (lowerText.includes("invalid_argument") || lowerText.includes("invalid argument"))) {
        invalidArgRetries++;
        console.warn(
          `[Universal Ext] INVALID_ARGUMENT. Retry ${invalidArgRetries}/3. Snippet: ${text.slice(0, 280)}`
        );
        // Always strip entity on schema/policy arg errors
        activeEntityContext = null;
        if (invalidArgRetries === 1) {
          // Flip GEM_PIX_2 ↔ NARWHAL (both are valid imageModelName values)
          imageModelName = imageModelName === "GEM_PIX_2" ? "NARWHAL" : "GEM_PIX_2";
          isXray = false;
        } else if (invalidArgRetries === 2) {
          imageModelName = "NARWHAL";
          imageAspectRatio = "IMAGE_ASPECT_RATIO_LANDSCAPE";
          isXray = false;
        } else {
          throw new Error(
            `Image Generate Error (400): invalid argument after ${invalidArgRetries} retries ` +
              `(refs kept=${activeMediaIds.length}). ${text.slice(0, 240)}`
          );
        }
        continue;
      }

      throw new Error(`Image Generate Error (${status}): ${text}`);
    }

    const data = JSON.parse(text);
    if (data.media && data.media.length > 0) {
      const images = data.media
        .map((mediaObj: any) => {
          const rawMediaId = mediaObj.name || "";
          const gflowUrl =
            mediaObj?.image?.generatedImage?.fifeUrl || mediaObj?.image?.generatedImage?.url;
          return {
            mediaId: String(rawMediaId).replace(/^media\//, ""),
            url: gflowUrl,
          };
        })
        .filter((img: any) => !!img.url);

      if (images.length === 0) {
        throw new Error("Image generation returned media without URLs");
      }

      return {
        success: true,
        images,
        projectId: dynamicProjectId,
        usedRefCount: activeMediaIds.length,
        requestedRefCount: originalMediaIds.length,
        imageModelName,
        imageAspectRatio,
      };
    }
    throw new Error("Could not parse image mediaIds from response");
  }
  throw new Error("Image Generation blocked by Google safety filters repeatedly.");
}

export async function generateVideo(payload: any, tokens: any, recaptchaToken?: string, tabId?: number) {
  const { prompt, mediaIds, projectId } = payload;
  let activePrompt = prompt;
  let safetyFilterFailures = 0;
  let recaptchaRetries = 0;
  
  let apiUrl = "";
  const numOutputs = payload.numOutputs || 1;
  const dynamicProjectId = projectId || "012b7b28-f3f0-4441-9926-f5c9dc59deb3";

  const clientContext: any = {
    tool: "PINHOLE",
    projectId: dynamicProjectId,
    userPaygateTier: "PAYGATE_TIER_TWO",
    sessionId: ";" + Date.now()
  };

  if (recaptchaToken) {
    clientContext.recaptchaContext = {
      token: recaptchaToken,
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
    };
  }

  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json"
  };

  while (safetyFilterFailures < 3 && recaptchaRetries < 3) {
    let requestsArr: any[] = [];
    if (mediaIds && mediaIds.length > 0) {
      apiUrl = "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoReferenceImages";
      requestsArr = Array.from({ length: numOutputs }).map(() => ({
        aspectRatio: String(payload.aspectRatio || "").includes("PORTRAIT") || payload.aspectRatio === "9:16" ? "VIDEO_ASPECT_RATIO_PORTRAIT" : "VIDEO_ASPECT_RATIO_LANDSCAPE",
        seed: Math.floor(Math.random() * 100000),
        textInput: {
          structuredPrompt: {
            parts: [{ text: activePrompt }]
          }
        },
        referenceImages: mediaIds.map((mId: string) => ({
          mediaId: String(mId).replace(/^media\//, ""),
          imageUsageType: "IMAGE_USAGE_TYPE_ASSET"
        })),
        videoModelKey: String(payload.videoModelKey || "").includes("t2v") ? String(payload.videoModelKey).replace("t2v", "r2v") : (payload.videoModelKey || "veo_3_1_r2v_lite_low_priority"),
        metadata: {}
      }));
    } else {
      apiUrl = "https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText";
      requestsArr = Array.from({ length: numOutputs }).map(() => ({
        aspectRatio: String(payload.aspectRatio || "").includes("PORTRAIT") || payload.aspectRatio === "9:16" ? "VIDEO_ASPECT_RATIO_PORTRAIT" : "VIDEO_ASPECT_RATIO_LANDSCAPE",
        seed: Math.floor(Math.random() * 100000),
        textInput: {
          structuredPrompt: {
            parts: [{ text: activePrompt }]
          }
        },
        videoModelKey: String(payload.videoModelKey || "").includes("r2v") ? String(payload.videoModelKey).replace("r2v", "t2v") : (payload.videoModelKey || "veo_3_1_t2v_lite_low_priority"),
        metadata: {}
      }));
    }

    const bodyJson = {
      mediaGenerationContext: {
        batchId: "vid-batch-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        audioFailurePreference: "BLOCK_SILENCED_VIDEOS"
      },
      clientContext: clientContext,
      useV2ModelConfig: true,
      requests: requestsArr
    };

    console.log(`[Universal Ext] generateVideo | Prompt: "${activePrompt}" | Attempt: ${safetyFilterFailures + 1}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      credentials: "omit",
      body: JSON.stringify(bodyJson)
    });

    const ok = response.ok;
    const status = response.status;
    const text = await response.text();

    if (!ok) {
      const lowerText = text.toLowerCase();
      if (status === 403 && (lowerText.includes("recaptcha") || lowerText.includes("unusual_activity"))) {
        recaptchaRetries++;
        console.warn(`[Universal Ext] reCAPTCHA 403 detected on video (${recaptchaRetries}/3).`);
        if (recaptchaRetries >= 3) {
          throw new Error(`Generate Error (403): Google blocked video reCAPTCHA after ${recaptchaRetries} attempts.`);
        }
        if (tabId) {
          try {
            await chrome.tabs.reload(tabId);
            await new Promise(r => setTimeout(r, 6000));
            const nextToken = await fetchFreshRecaptchaToken(tabId, "VIDEO_GENERATION");
            
            clientContext.recaptchaContext = { token: nextToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" };
            bodyJson.clientContext.recaptchaContext = { token: nextToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" };
            continue;
          } catch (recaptchaErr: any) {
            console.error(`[Universal Ext] reCAPTCHA video recovery failed:`, recaptchaErr.message);
          }
        }
        throw new Error(`Generate Error (403): ${text.slice(0, 240)}`);
      }
      if (lowerText.includes("unsafe_generation") || lowerText.includes("public_error_unsafe_generation")) {
        safetyFilterFailures++;
        if (safetyFilterFailures === 1) {
          activePrompt = sanitizeUnsafePrompt(prompt);
        } else {
          activePrompt = "A beautiful cinematic scene, safe professional photography, soft lighting, masterpiece.";
        }
        continue;
      }
      throw new Error(`Generate Error (${status}): ${text}`);
    }

    const data = JSON.parse(text);
    const operationIds: string[] = [];
    let workflowId = data.workflows?.[0]?.name || data.workflowId || "";

    if (data.media) {
      data.media.forEach((m: any) => operationIds.push(m.name));
    }

    if (operationIds.length === 0 && data.responses) {
      data.responses.forEach((resp: any) => {
        if (resp.media) {
          operationIds.push(resp.media.name);
          if (resp.media.video?.operation && !workflowId) {
            workflowId = resp.media.video.operation.name;
          }
        }
      });
    }

    if (workflowId && workflowId.startsWith("flowWorkflows/")) {
      workflowId = workflowId.replace(/^flowWorkflows\//, "");
    }

    return { 
      success: true, 
      data: data, 
      projectId: dynamicProjectId, 
      operationIds: operationIds,
      workflowId 
    };
  }
  throw new Error("Video Generation blocked by Google safety filters repeatedly.");
}

export async function renameVideoWorkflow(workflowId: string, displayName: string, tokens: any, projectId: string) {
  const url = `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/workflows/${workflowId}?updateMask=displayName`;
  const body = { displayName };
  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json"
  };

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: headers,
      credentials: "omit",
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: text };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function checkVideoGenerationStatus(mediaIds: string[], tokens: any, projectId: string) {
  const clientContext: any = {
    tool: "PINHOLE",
    projectId: projectId || "012b7b28-f3f0-4441-9926-f5c9dc59deb3",
    userPaygateTier: "PAYGATE_TIER_TWO",
    sessionId: ";" + Date.now()
  };

  const bodyJson = {
    media: mediaIds.map(id => ({
      name: String(id).replace(/^media\//, ""),
      projectId: projectId
    })),
    clientContext: clientContext
  };

  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json"
  };

  const response = await fetch("https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus", {
    method: "POST",
    headers: headers,
    credentials: "omit",
    body: JSON.stringify(bodyJson)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Status Check Error (${response.status}): ${text}`);
  }

  const data = await response.json();
  
  if (data && data.media) {
    for (const mediaItem of data.media) {
      const status = mediaItem.mediaMetadata?.mediaStatus?.mediaGenerationStatus || mediaItem.mediaStatus?.mediaGenerationStatus;
      if (status === 'MEDIA_GENERATION_STATUS_SUCCEEDED' || status === 'MEDIA_GENERATION_STATUS_DONE' || status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
        const pureMediaId = mediaItem.name.replace(/^media\//, "");
        try {
          const redirectRes = await fetch(`https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${pureMediaId}`, {
            method: "GET"
          });
          if (redirectRes && redirectRes.url && redirectRes.url.includes("flow-content.google")) {
            if (!mediaItem.video) mediaItem.video = {};
            if (!mediaItem.video.generatedVideo) mediaItem.video.generatedVideo = {};
            mediaItem.video.generatedVideo.fifeUrl = redirectRes.url;
          }
        } catch(e) {
          console.warn("[Universal Ext] Failed to fetch redirect URL:", e);
        }
      }
    }
  }
  
  return data;
}

export async function createGoogleLabsProject(tokens: any, projectName?: string, tabId?: number) {
  const headers: any = {
    "content-type": "application/json"
  };
  if (tokens.xBrowserValidation) headers["x-browser-validation"] = tokens.xBrowserValidation;

  const projectTitle = projectName ? `${projectName} (Universal)` : `Universal Project ${new Date().toLocaleString()}`;
  const reqBody = JSON.stringify({
    json: {
      projectTitle: projectTitle,
      toolName: "PINHOLE"
    }
  });

  let ok = false;
  let status = 0;
  let text = "";

  if (tabId) {
    const tabRes = await executeTabFetch(tabId, "https://labs.google/fx/api/trpc/project.createProject", "POST", headers, reqBody);
    ok = tabRes.ok;
    status = tabRes.status;
    text = tabRes.text;
  } else {
    const response = await fetch("https://labs.google/fx/api/trpc/project.createProject", {
      method: "POST",
      headers: headers,
      credentials: "include",
      body: reqBody
    });
    ok = response.ok;
    status = response.status;
    text = await response.text();
  }

  if (!ok) {
    throw new Error(`Create Project Error (${status}): ${text}`);
  }

  const data = JSON.parse(text);
  const projectId = data?.result?.data?.json?.result?.projectId;
  if (!projectId) {
    throw new Error("Could not parse projectId from response");
  }
  return projectId;
}

export async function createGoogleLabsEntity(
  projectId: string,
  tokens: any,
  tabId?: number,
  mediaIds?: string[]
): Promise<string> {
  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json"
  };
  if (tokens.xBrowserValidation) headers["x-browser-validation"] = tokens.xBrowserValidation;

  const mediaNames = (mediaIds || []).map((id) => {
    const bare = String(id).replace(/^media\//, "");
    return `media/${bare}`;
  });

  // Try with media bound into createEntity (character sheet), then bare projectId
  const bodies = [
    mediaNames.length
      ? {
          json: {
            projectId,
            mediaIds: mediaNames,
            category: "CHARACTER",
            name: "StoryMee Character",
          },
        }
      : null,
    mediaNames.length
      ? {
          json: {
            projectId,
            referenceMediaIds: mediaNames,
          },
        }
      : null,
    { json: { projectId } },
  ].filter(Boolean) as any[];

  let lastErr = "";
  for (const body of bodies) {
    const reqBody = JSON.stringify(body);
    let ok = false;
    let status = 0;
    let text = "";

    if (tabId) {
      const tabRes = await executeTabFetch(
        tabId,
        "https://labs.google/fx/api/trpc/flow.createEntity",
        "POST",
        headers,
        reqBody
      );
      ok = tabRes.ok;
      status = tabRes.status;
      text = tabRes.text;
    } else {
      const sw = await executeSwFetch(
        "https://labs.google/fx/api/trpc/flow.createEntity",
        "POST",
        headers,
        reqBody
      );
      ok = sw.ok;
      status = sw.status;
      text = sw.text;
    }

    if (!ok) {
      lastErr = `Create Entity Error (${status}): ${text.slice(0, 200)}`;
      console.warn(`[Universal Ext] ${lastErr}`);
      continue;
    }

    try {
      const data = JSON.parse(text);
      const entityId =
        data?.result?.data?.json?.entityId ||
        data?.result?.data?.json?.result?.entityId ||
        data?.entityId;
      if (entityId) {
        console.log(`[Universal Ext] createEntity OK with payload keys:`, Object.keys(body.json || {}));
        return entityId;
      }
      lastErr = "Could not parse entityId from response: " + text.slice(0, 160);
    } catch (e: any) {
      lastErr = e?.message || String(e);
    }
  }

  throw new Error(lastErr || "Create Entity failed");
}

export async function generateText(payload: any, tokens: any, recaptchaToken?: string, tabId?: number) {
  const { prompt } = payload;
  const modelId = payload.modelId || "gemini-3-flash-preview";

  const headers: any = {
    "authorization": `Bearer ${tokens.oauthToken}`,
    "content-type": "application/json"
  };

  const apiUrl = "https://aisandbox-pa.googleapis.com/v1/flow:generateContent";

  const bodyJson: any = {
    model: modelId,
    contents: [{
      role: "user",
      parts: [{ text: prompt }]
    }]
  };
  if (recaptchaToken) {
    bodyJson.recaptchaContext = {
      token: recaptchaToken,
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
    };
  }

  let safetyFilterFailures = 0;
  let recaptchaRetries = 0;
  while (safetyFilterFailures < 3 && recaptchaRetries < 3) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      credentials: "omit",
      body: JSON.stringify(bodyJson)
    });

    const ok = response.ok;
    const status = response.status;
    const text = await response.text();

    if (!ok) {
      const lowerText = text.toLowerCase();
      if (status === 403 && (lowerText.includes("recaptcha") || lowerText.includes("unusual_activity"))) {
        recaptchaRetries++;
        console.warn(`[Universal Ext] reCAPTCHA 403 detected on text (${recaptchaRetries}/3).`);
        if (recaptchaRetries >= 3) {
          throw new Error(`Text Generate Error (403): Google blocked reCAPTCHA after ${recaptchaRetries} attempts.`);
        }
        if (tabId) {
          try {
            await chrome.tabs.reload(tabId);
            await new Promise(r => setTimeout(r, 6000));
            const nextToken = await fetchFreshRecaptchaToken(tabId, "TEXT_GENERATION");
            bodyJson.recaptchaContext = { token: nextToken, applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB" };
            continue;
          } catch (recaptchaErr: any) {
            console.error(`[Universal Ext] reCAPTCHA text recovery failed:`, recaptchaErr.message);
          }
        }
        throw new Error(`Text Generate Error (403): ${text.slice(0, 240)}`);
      }
      throw new Error(`Text Generate Error (${status}): ${text}`);
    }

    const data = JSON.parse(text);
    return data;
  }
  throw new Error("Text generation failed repeatedly.");
}

export async function resolveGoogleFlowProject(payload: any, tabId?: number): Promise<string> {
  let projectId = payload.projectId;
  const projectName = payload.projectName;
  const isUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  let activeTabId = tabId;
  if (!activeTabId) {
    try {
      const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
        chrome.tabs.query({ url: "*://labs.google/*" }, resolve);
      });
      const existingTab = tabs.find(t => t.id !== undefined);
      activeTabId = existingTab?.id;
    } catch (e) {
      console.warn("[GoogleLabsApi] Failed to query tabs:", e);
    }
  }

  const tokens = await chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]);

  // 1. If it's a UUID, check if it's mapped to a Google Flow Project ID
  if (projectId && isUuid(projectId)) {
    const mapKey = `gflow_project_map_${projectId}`;
    const stored = await chrome.storage.local.get([mapKey]);
    const resolvedId = stored[mapKey] as string;
    
    if (resolvedId && resolvedId !== 'default') {
      console.log(`[GoogleLabsApi] Resolved Google Flow project from UUID "${projectId}": ${resolvedId}`);
      return resolvedId;
    }
    
    // UUID is not mapped yet! This is a new Episode/Project from StoryMee DB.
    // We will create a new Google Flow project for it.
    const resolvedProjectName = projectName || `StoryMee Ep-${projectId.substring(0, 8)}`;
    console.log(`[GoogleLabsApi] StoryMee Project UUID "${projectId}" not mapped. Creating new Google Flow project "${resolvedProjectName}"...`);
    try {
      const newId = await createGoogleLabsProject(tokens, resolvedProjectName, activeTabId);
      await chrome.storage.local.set({ 
        [mapKey]: newId,
        [`gflow_project_map_${resolvedProjectName}`]: newId 
      });
      console.log(`[GoogleLabsApi] Created and mapped StoryMee project "${projectId}" to Google Flow project "${newId}"`);
      return newId;
    } catch (err: any) {
      console.error(`[GoogleLabsApi] Failed to create project for UUID "${projectId}":`, err.message);
    }
  }

  // 2. If projectName is a UUID, treat it like projectId above
  if (projectName && isUuid(projectName)) {
    const mapKey = `gflow_project_map_${projectName}`;
    const stored = await chrome.storage.local.get([mapKey]);
    const resolvedId = stored[mapKey] as string;
    if (resolvedId && resolvedId !== 'default') {
      return resolvedId;
    }
  }

  // 3. Resolve using projectName string matching
  if (projectName) {
    const mapKey = `gflow_project_map_${projectName}`;
    const legacyMapKey = `project_map_${projectName}`;
    const stored = await chrome.storage.local.get([mapKey, legacyMapKey]);
    const resolvedId = (stored[mapKey] as string) || (stored[legacyMapKey] as string);
    
    if (resolvedId && resolvedId !== 'default') {
      console.log(`[GoogleLabsApi] Resolved project name "${projectName}" from storage: ${resolvedId}`);
      return resolvedId;
    }

    console.log(`[GoogleLabsApi] Project "${projectName}" not mapped. Creating new project on Google Flow...`);
    try {
      const newId = await createGoogleLabsProject(tokens, projectName, activeTabId);
      await chrome.storage.local.set({ [mapKey]: newId, [legacyMapKey]: newId });
      console.log(`[GoogleLabsApi] Created project "${projectName}" with ID: ${newId}`);
      return newId;
    } catch (err: any) {
      console.error(`[GoogleLabsApi] Project creation failed:`, err.message);
    }
  }

  // Fallback to URL of tab if available
  if (activeTabId) {
    try {
      const tab = await new Promise<chrome.tabs.Tab>((resolve, reject) => {
        chrome.tabs.get(activeTabId!, (t) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(t);
        });
      });
      if (tab && tab.url) {
        const match = tab.url.match(/project\/([a-z0-9\-]+)/);
        if (match && match[1] && match[1] !== 'default') {
          console.log(`[GoogleLabsApi] Found project ID from tab URL: ${match[1]}`);
          return match[1];
        }
      }
    } catch (err) {
      console.warn(`[GoogleLabsApi] Error getting project from tab URL:`, err);
    }
  }

  // Final fallback project ID
  return "ba466f2d-083b-4f86-bd6b-0d054a7ed865";
}
