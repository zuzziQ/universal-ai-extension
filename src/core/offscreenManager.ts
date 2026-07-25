let creatingOffscreen: Promise<void> | null = null;

export async function closeExistingOffscreen() {
  try {
    if (typeof (chrome.runtime as any).getContexts !== 'function') {
      console.warn("[Background] chrome.runtime.getContexts is not supported on this Chrome version.");
      return;
    }
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
      console.log("[Background] Closed existing Offscreen Document.");
      // Allow Chrome to clean up
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (err: any) {
    console.warn("[Background] Error closing offscreen:", err.message);
  }
}

export async function setupOffscreen(forceRecreate = false) {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");

  if (forceRecreate) {
    await closeExistingOffscreen();
  } else {
    if (typeof (chrome.runtime as any).getContexts === 'function') {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"]
      });
      if (contexts.length > 0) {
        console.log("[Background] Offscreen Document already exists.");
        return;
      }
    }
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
        justification: "Maintain robust long-lived WebSocket connection to Hub Gateway"
      });
      console.log("[Background] Offscreen Document created successfully.");
    } catch (err: any) {
      // Ignore "already exists" races; rethrow real failures so callers can retry
      const msg = err?.message || String(err);
      if (!/already exists|Only a single offscreen/i.test(msg)) {
        console.warn("[Background] Failed to create Offscreen Document:", msg);
        throw err;
      }
    } finally {
      creatingOffscreen = null;
    }
  })();

  await creatingOffscreen;
}
