import { useEffect } from 'react';
import { useExtensionStore } from '../store/extensionStore';

/**
 * Bootstraps Zustand store from chrome.storage.local and keeps it in sync
 * with storage + runtime messages (WS status, job updates, BG logs).
 */
export function useExtensionStorage() {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      console.warn('[Universal Ext] Chrome Storage APIs are not available.');
      return;
    }

    const store = useExtensionStore.getState();

    try {
      chrome.storage.local.get(
        [
          'gflowUrl',
          'workerState',
          'googleEmail',
          'googleAvatar',
          'oauthToken',
          'xBrowserValidation',
          'xClientData',
          'recent_jobs_list',
          'selected_provider',
          'active_emails',
          'hide_low_points',
          'active_executor',
          'rotation_log',
          'hub_api_key',
          'dreamina_api_key',
          'picsart_api_key',
          'topview_api_key',
          'gflow_api_key',
          'workerName',
          'dreamina_accounts',
          'picsart_accounts',
          'topview_accounts',
          'gflow_accounts',
          'dreamina_execution_mode',
          'current_dreamina_email',
          'auto_switch_enabled',
          'provider_enabled',
        ],
        (data: any) => {
          if (chrome.runtime?.lastError) {
            console.warn('[Universal Ext] storage get error:', chrome.runtime.lastError.message);
            return;
          }
          store.hydrateFromStorage(data || {});
          // Always re-apply local job history if present (prevent empty UI after failed Hub sync)
          if (Array.isArray(data?.recent_jobs_list) && data.recent_jobs_list.length > 0) {
            store.setJobs(data.recent_jobs_list);
          }
          if (!data?.gflowUrl) {
            chrome.storage.local.set({ gflowUrl: 'https://hub.storymee.com' });
          }
        }
      );
    } catch (err) {
      console.error('[Universal Ext] Failed to query chrome.storage.local:', err);
    }

    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return;
      const s = useExtensionStore.getState();
      const nv = <T,>(key: string, fallback: T): T => {
        const ch = changes[key];
        if (!ch) return fallback;
        return (ch.newValue as T) ?? fallback;
      };
      try {
        if (changes.gflowUrl) s.setGflowUrl(nv('gflowUrl', 'https://hub.storymee.com'));
        if (changes.workerState) s.setWorkerState(nv('workerState', 'DISCONNECTED'));
        if (changes.googleEmail) s.setGoogleEmail(nv('googleEmail', ''));
        if (changes.googleAvatar) s.setGoogleAvatar(nv('googleAvatar', ''));
        if (changes.oauthToken) s.setOauthToken(nv('oauthToken', ''));
        if (changes.xBrowserValidation) s.setXBrowserValidation(nv('xBrowserValidation', ''));
        if (changes.xClientData) s.setXClientData(nv('xClientData', ''));
        if (changes.workerName) s.setWorkerName(nv('workerName', ''));
        if (changes.selected_provider) {
          const p = nv<string | undefined>('selected_provider', undefined);
          if (p === 'DREAMINA' || p === 'PICSART' || p === 'TOPVIEW' || p === 'GFLOW') {
            s.setSelectedProvider(p);
            chrome.storage.local.get(
              ['hub_api_key', 'dreamina_api_key', 'picsart_api_key', 'topview_api_key', 'gflow_api_key'],
              (keys: any) => {
                const map = {
                  DREAMINA: keys.dreamina_api_key || keys.hub_api_key || '',
                  PICSART: keys.picsart_api_key || keys.hub_api_key || '',
                  TOPVIEW: keys.topview_api_key || keys.hub_api_key || '',
                  GFLOW: keys.gflow_api_key || keys.hub_api_key || '',
                };
                s.setProviderApiKeys(map);
                s.setHubApiKey(map[p] || '');
              }
            );
          }
        }
        if (changes.recent_jobs_list) {
          const list = nv<any[]>('recent_jobs_list', []);
          s.setJobs(Array.isArray(list) ? list : []);
        }
        if (
          changes.hub_api_key ||
          changes.dreamina_api_key ||
          changes.picsart_api_key ||
          changes.topview_api_key ||
          changes.gflow_api_key
        ) {
          chrome.storage.local.get(
            ['hub_api_key', 'dreamina_api_key', 'picsart_api_key', 'topview_api_key', 'gflow_api_key'],
            (data: any) => {
              s.setProviderApiKeys({
                DREAMINA: data.dreamina_api_key || data.hub_api_key || '',
                PICSART: data.picsart_api_key || data.hub_api_key || '',
                TOPVIEW: data.topview_api_key || data.hub_api_key || '',
                GFLOW: data.gflow_api_key || data.hub_api_key || '',
              });
            }
          );
        }
        if (changes.active_emails) s.setActiveEmails(nv('active_emails', {}));
        if (changes.hide_low_points) s.setHideLowPoints(!!nv('hide_low_points', false));
        if (changes.active_executor) s.setActiveExecutor(nv('active_executor', null));
        if (changes.rotation_log) {
          const log = nv<any[]>('rotation_log', []);
          s.setRotationLog(Array.isArray(log) ? log : []);
        }
        if (changes.dreamina_accounts) {
          const list = nv<any[]>('dreamina_accounts', []);
          s.setDreaminaAccounts(Array.isArray(list) ? list : []);
        }
        if (changes.picsart_accounts) {
          const list = nv<any[]>('picsart_accounts', []);
          s.setPicsartAccounts(Array.isArray(list) ? list : []);
        }
        if (changes.topview_accounts) {
          const list = nv<any[]>('topview_accounts', []);
          s.setTopviewAccounts(Array.isArray(list) ? list : []);
        }
        if (changes.gflow_accounts) {
          const list = nv<any[]>('gflow_accounts', []);
          s.setGflowAccounts(Array.isArray(list) ? list : []);
        }
        if (changes.dreamina_execution_mode) {
          const mode = nv<string>('dreamina_execution_mode', 'extension');
          s.setDreaminaExecutionMode(mode === 'headless' ? 'headless' : 'extension');
        }
        if (changes.current_dreamina_email) s.setCurrentDreaminaEmail(nv('current_dreamina_email', ''));
        if (changes.auto_switch_enabled) {
          s.setAutoSwitchEnabled(changes.auto_switch_enabled.newValue !== false);
        }
        if (changes.provider_enabled) {
          const value = nv<Record<string, boolean>>('provider_enabled', {});
          s.setProviderEnabled({
            GFLOW: value.GFLOW !== false,
            'VIDTORY-SDK': value['VIDTORY-SDK'] !== false,
            DREAMINA: value.DREAMINA !== false,
            VERTEX: value.VERTEX !== false,
            'GEMINI-NATIVE': value['GEMINI-NATIVE'] !== false,
          });
        }
      } catch (innerErr) {
        console.error('[Universal Ext] Error processing storage changes:', innerErr);
      }
    };

    const handleRuntimeMessage = (message: any) => {
      if (!message) return;
      const s = useExtensionStore.getState();
      try {
        if (message.type === 'WS_STATUS') s.setWorkerState(message.status);
        if (message.type === 'JOB_UPDATED') s.setJobs(Array.isArray(message.list) ? message.list : []);
        if (message.type === 'BG_LOG') {
          const prefix = `[BG-${String(message.logType || 'log').toUpperCase()}]`;
          if (message.logType === 'error') console.error(prefix, message.message);
          else if (message.logType === 'warn') console.warn(prefix, message.message);
          else console.log(prefix, message.message);
        }
      } catch (innerErr) {
        console.error('[Universal Ext] Error processing runtime message:', innerErr);
      }
    };

    try {
      chrome.storage.onChanged.addListener(handleStorageChange);
    } catch (err) {
      console.error('[Universal Ext] Failed to add storage change listener:', err);
    }
    try {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    } catch (err) {
      console.error('[Universal Ext] Failed to add runtime message listener:', err);
    }

    return () => {
      try {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      } catch {
        /* ignore */
      }
      try {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      } catch {
        /* ignore */
      }
    };
  }, []);
}

/** Keep service worker alive while the panel is open. */
export function useLifelinePort() {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;

    console.log('[Universal Ext] Opening lifeline port...');
    const port = chrome.runtime.connect({ name: 'universal-lifeline' });
    const interval = setInterval(() => {
      try {
        port.postMessage({ type: 'ping' });
      } catch (e) {
        console.warn('[Universal Ext] Lifeline port ping failed:', e);
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, []);
}
