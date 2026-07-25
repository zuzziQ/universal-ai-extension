import { setupOffscreen } from './offscreenManager';

export function initializeAlarms() {
  chrome.alarms.create("pollJobs", { periodInMinutes: 1.0 }); // Min 1.0 min in MV3 production
  chrome.alarms.create("keep-alive-alarm", { periodInMinutes: 5 }); // Every 5 minutes
  setupOffscreen().catch(console.error);
  console.log("[Universal Ext] Alarms and Offscreen initialized robustly");
}

export function registerAlarmListener() {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "pollJobs") {
      setupOffscreen().catch(console.error);
    } else if (alarm.name === "keep-alive-alarm") {
      // Periodically reload Google Labs tab if active and online to prevent token invalidation
      const data = await chrome.storage.local.get(["workerState"]);
      const state = data.workerState || "DISCONNECTED";
      if (state === "ONLINE") {
        chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
          if (tabs.length > 0 && tabs[0].id) {
            console.log("[Universal Ext] Heartbeat Active: Reloading Google Labs tab to maintain credentials...");
            chrome.tabs.reload(tabs[0].id);
          }
        });
      }
    }
  });
}
