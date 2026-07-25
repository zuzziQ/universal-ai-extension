// DNR rules to map browser validation headers dynamically to google APIs
export async function registerDnrRules() {
  try {
    const stData = await chrome.storage.local.get(["xBrowserValidation", "xClientData", "xBrowserChannel", "xBrowserCopyright", "xBrowserYear"]);
    const requestHeaders: any[] = [];
    if (stData.xBrowserValidation) {
      requestHeaders.push({ header: "x-browser-validation", operation: "set", value: stData.xBrowserValidation });
    }
    if (stData.xClientData) {
      requestHeaders.push({ header: "x-client-data", operation: "set", value: stData.xClientData });
    }
    if (stData.xBrowserChannel) {
      requestHeaders.push({ header: "x-browser-channel", operation: "set", value: stData.xBrowserChannel });
    }
    if (stData.xBrowserCopyright) {
      requestHeaders.push({ header: "x-browser-copyright", operation: "set", value: stData.xBrowserCopyright });
    }
    if (stData.xBrowserYear) {
      requestHeaders.push({ header: "x-browser-year", operation: "set", value: String(stData.xBrowserYear) });
    }

    // Default headers for Origin and Referer
    requestHeaders.push({ header: "Origin", operation: "set", value: "https://labs.google" });
    requestHeaders.push({ header: "Referer", operation: "set", value: "https://labs.google/" });

    const rules = [
      {
        id: 999,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: requestHeaders
        },
        condition: {
          urlFilter: "aisandbox-pa.googleapis.com",
          resourceTypes: ["xmlhttprequest", "other"]
        }
      }
    ];
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [999, 998, 997, 996],
      addRules: rules as any
    });
    console.log("[Universal Ext] DNR Session Rules updated successfully (Google Labs only).");
  } catch (err) {
    console.error("[Universal Ext] Failed to update DNR Session Rules:", err);
  }
}
