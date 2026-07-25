// Content script running in ISOLATED world (default) on dreamina.capcut.com
console.log("[Universal Ext] Isolated World listener loaded on Dreamina");

window.addEventListener("message", (event) => {
  // We only accept messages from ourselves
  if (event.source !== window) return;

  if (event.data && event.data.type === "DREAMINA_INTERCEPTED_EVENT") {
    const { event: subEvent, payload } = event.data;
    console.log(`[Universal Ext] Received intercepted event: ${subEvent}`, payload);

    if (subEvent === "GENERATE_SUBMITTED") {
      chrome.runtime.sendMessage({
        type: "DREAMINA_MANUAL_GENERATE_SUBMITTED",
        payload
      }).catch((err) => console.warn("[Universal Ext] Failed to send GENERATE_SUBMITTED message:", err.message));
    } else if (subEvent === "HISTORY_UPDATED") {
      chrome.runtime.sendMessage({
        type: "DREAMINA_MANUAL_HISTORY_UPDATED",
        payload
      }).catch((err) => console.warn("[Universal Ext] Failed to send HISTORY_UPDATED message:", err.message));
    }
  }
});
