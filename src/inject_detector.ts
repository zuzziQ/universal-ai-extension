// Injected into dashboard and localhost to expose Universal Extension ID
(function() {
  const extId = chrome.runtime.id;
  console.log("[Universal Ext] Exposing Extension ID:", extId);
  document.documentElement.setAttribute('data-storymee-extension-id', extId);
  
  const event = new CustomEvent("STORYMEE_EXTENSION_CONNECTED", {
    detail: { extId: extId, version: "1.0.0", isUniversal: true }
  });
  window.dispatchEvent(event);
})();
