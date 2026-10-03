import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  getHubApiClient,
  extractJobsArray,
  accountListPaths,
  mapAccountRow,
  fetchJobsRaw,
  pickStableApiKey,
  resolveGatewayBase,
} from './core/api';
import {
  Activity,
  Terminal,
  RefreshCw,
  ExternalLink,
  Image as ImageIcon,
  CheckCircle,
  Copy,
  Globe,
  Lock,
  Sparkles,
  Cpu,
  Settings,
  Layers,
  PlusCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Search,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { JobCard } from './components/JobCard';
import { ToastStack } from './components/ToastStack';
import { RouteBadge } from './components/RouteBadge';
import { ProviderAccountsColumn } from './components/ProviderAccountsColumn';
import { ProviderFilterBar, JobStatusFilterBar } from './components/ProviderFilterBar';
import { JobListSkeleton, SidepanelJobSkeleton } from './components/Skeleton';
import { useToast } from './hooks/useToast';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useExtensionStorage, useLifelinePort } from './hooks/useExtensionStorage';
import { useExtensionStore } from './store/extensionStore';
import {
  formatRatio,
  getLowPointsThreshold,
  matchesProviderFilter,
  normalizeProviderId,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_ACCENT,
  type ProviderFilter,
  type ProviderId,
  type SavedJob,
} from './types/extension';

export default function App() {
  const isSidepanel = window.location.pathname.includes('sidepanel.html');
  const { toasts, pushToast } = useToast();
  useExtensionStorage();
  useLifelinePort();

  const {
    gflowUrl, setGflowUrl,
    workerState,
    googleEmail,
    googleAvatar,
    oauthToken,
    xBrowserValidation,
    xClientData,
    workerName, setWorkerName,
    hubApiKey, setHubApiKey,
    providerApiKeys, setProviderApiKeys,
    selectedProvider, setSelectedProvider,
    jobs, setJobs,
    failedHosts, setFailedHosts,
    selectedJobForModal, setSelectedJobForModal,
    activeTab, setActiveTab,
    sidepanelTab, setSidepanelTab,
    rotationLog,
    dreaminaAccounts, setDreaminaAccounts,
    picsartAccounts, setPicsartAccounts,
    topviewAccounts, setTopviewAccounts,
    gflowAccounts, setGflowAccounts,
    activeEmails, setActiveEmails,
    hideLowPoints, setHideLowPoints,
    isSyncingAccounts, setIsSyncingAccounts,
    verifyingEmail, setVerifyingEmail,
    isFetchingJobs, setIsFetchingJobs,
    showApiKey, setShowApiKey,
    showVaultHeaders, setShowVaultHeaders,
    jobStatusFilter, setJobStatusFilter,
    jobSearchQuery, setJobSearchQuery,
    jobProviderFilter, setJobProviderFilter,
    dreaminaExecutionMode, setDreaminaExecutionMode,
    currentDreaminaEmail,
    autoSwitchEnabled, setAutoSwitchEnabled,
  } = useExtensionStore();

  const debouncedJobSearch = useDebouncedValue(jobSearchQuery, 200);
  const jobsFetchLock = useRef(false);
  const [jobsFetchError, setJobsFetchError] = useState<string | null>(null);
  const [jobsFetchInfo, setJobsFetchInfo] = useState<string | null>(null);

  // Active emails — GFlow is a pool provider (not a separate browser-only identity)
  const activeDreaminaEmail = activeEmails.DREAMINA || currentDreaminaEmail;
  const activeGflowEmail = activeEmails.GFLOW || googleEmail || '';

  // GFlow list: merge browser session account so pool always includes current identity
  const gflowAccountsMerged = useMemo(() => {
    const list = [...(gflowAccounts || [])];
    if (googleEmail) {
      const exists = list.some((a) => a.email?.toLowerCase() === googleEmail.toLowerCase());
      if (!exists) {
        list.unshift({
          email: googleEmail,
          cookieStr: '',
          points: oauthToken ? 1000 : 0,
          status: oauthToken ? 'ACTIVE' : 'SESSION',
          lastChecked: null,
          pool: 'browser-session',
        } as any);
      }
    }
    return list;
  }, [gflowAccounts, googleEmail, oauthToken]);

  const accountsList =
    selectedProvider === 'DREAMINA'
      ? dreaminaAccounts
      : selectedProvider === 'PICSART'
        ? picsartAccounts
        : selectedProvider === 'TOPVIEW'
          ? topviewAccounts
          : gflowAccountsMerged;

  const getActiveEmailForProvider = (provider: string) => {
    const id = normalizeProviderId(provider) || (provider.toUpperCase() as ProviderId);
    if (id === 'DREAMINA') return activeDreaminaEmail;
    if (id === 'GFLOW') return activeGflowEmail;
    return activeEmails[id] || '';
  };

  // Open full dashboard; avoid stacking with sidepanel look by using focused full-page layout
  const openDashboard = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    } else {
      window.open('/index.html', '_blank');
    }
  };

  const mapHubJobToSaved = useCallback((job: any): SavedJob | null => {
    try {
      if (!job || (!job.id && !job.task_id && !job.jobId)) return null;
      const jobType = String(job.jobType || job.job_type || job.type || '');

      let displayPrompt = "";
      if (job.inputParams && typeof job.inputParams === 'object') {
        displayPrompt = job.inputParams.prompt || job.inputParams.brief || job.inputParams.script || job.prompt || "";
      }
      if (!displayPrompt) displayPrompt = job.prompt || "";
      if (!displayPrompt) {
        if (jobType === 'script_analyze') displayPrompt = 'Phân tích kịch bản tập phim';
        else if (jobType === 'script_evaluate') displayPrompt = 'Đánh giá kịch bản tập phim';
        else displayPrompt = jobType || 'Không rõ tác vụ';
      }

      let resultUrl: string | undefined = undefined;
      const pickUrl = (raw: any): string | undefined => {
        if (!raw) return undefined;
        if (typeof raw === 'string') {
          if (raw.startsWith('{') || raw.startsWith('[')) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return typeof parsed[0] === 'string' ? parsed[0] : JSON.stringify(parsed[0]);
              }
              if (parsed?.images?.[0]?.url) return parsed.images[0].url;
              if (parsed?.result?.urls?.[0]) return parsed.result.urls[0];
              if (parsed?.url) return parsed.url;
            } catch { /* keep string */ }
          }
          return raw;
        }
        if (Array.isArray(raw) && raw.length > 0) {
          return typeof raw[0] === 'string' ? raw[0] : (raw[0]?.url || JSON.stringify(raw[0]));
        }
        return undefined;
      };

      resultUrl = pickUrl(job.outputUrls) || pickUrl(job.output_urls) || pickUrl(job.output_url) || pickUrl(job.resultUrl);

      if (resultUrl && typeof resultUrl === 'string') {
        if (resultUrl.includes('localhost:5100') || resultUrl.includes('127.0.0.1:5100')) {
          const cleanGflowUrl = (gflowUrl || "https://hub.storymee.com").replace(/\/$/, '');
          resultUrl = resultUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1):5100/, cleanGflowUrl);
        }
      }

      let mediaType = 'text';
      const lowerType = jobType.toLowerCase();
      const lowerUrl = (resultUrl || '').toLowerCase();
      if (
        lowerUrl.includes('video') || lowerUrl.includes('mp4') || lowerUrl.includes('webm') ||
        lowerType === 'video' || lowerType.includes('video') || lowerType.includes('animation')
      ) mediaType = 'video';
      else if (
        lowerUrl.includes('image') || lowerUrl.includes('jpg') || lowerUrl.includes('png') || lowerUrl.includes('webp') ||
        lowerType === 'image' || lowerType.includes('image') || lowerType.includes('picture')
      ) mediaType = 'image';
      else if (lowerUrl.includes('audio') || lowerType === 'audio' || lowerType.includes('audio')) mediaType = 'audio';

      let extStatus: SavedJob['status'] = 'pending';
      const st = String(job.status || '').toLowerCase();
      if (st === 'done' || st === 'completed' || st === 'success') extStatus = 'done';
      else if (st === 'failed' || st === 'error') extStatus = 'failed';
      else if (st === 'processing' || st === 'queued' || st === 'running') extStatus = 'processing';

      const configData = job.config || job.inputParams?.config || {};
      const reqModel = job.model || job.reqModel || configData.model_id || configData.modelId || job.inputParams?.model_id || job.inputParams?.modelId || 'auto';
      const rawRatio = job.aspectRatio || job.reqRatio || configData.aspect_ratio || configData.aspectRatio || job.inputParams?.aspect_ratio || job.inputParams?.aspectRatio || (mediaType === 'video' ? '16:9' : '1:1');
      const rawDuration = job.reqDuration !== undefined ? job.reqDuration : (configData.duration || configData.duration_sec || job.inputParams?.duration);
      const durationDisp = rawDuration !== undefined ? (rawDuration ? `${rawDuration}s` : '—') : (mediaType === 'video' ? '5s' : '—');

      // Hub often omits top-level provider — read from inputParams
      const providerRaw =
        job.provider ||
        job.inputParams?.provider ||
        job.input_params?.provider ||
        (jobType.includes('script_') ? 'LLM_AI' : 'Hub');
      const created = job.createdAt || job.created_at || job.timestamp;

      return {
        id: String(job.id || job.task_id || job.jobId),
        mediaType,
        prompt: displayPrompt,
        provider: providerRaw,
        status: extStatus,
        timestamp: created ? new Date(created).getTime() : Date.now(),
        resultUrl,
        error: job.errorMessage || job.error_message || job.error || undefined,
        projectId: job.inputParams?.actualMeta?.projectId || job.inputParams?.project_id || job.inputParams?.projectId || job.projectId,
        projectName: job.inputParams?.project_name || job.inputParams?.projectName,
        projectLink: job.inputParams?.project_link || job.inputParams?.projectLink,
        executedBy: job.executed_by || job.executedBy || job.inputParams?.executed_by || undefined,
        source: job.source || 'api',
        pool: job.pool || job.inputParams?.pool || 'internal',
        batchName: job.batchName || job.inputParams?.batchName || undefined,
        modelDisp: reqModel,
        ratioDisp: formatRatio(rawRatio),
        durationDisp,
        inputParams: job.inputParams
      };
    } catch (e) {
      console.warn('[FE Jobs] Skip malformed job row', e, job);
      return null;
    }
  }, [gflowUrl]);

  const applyMappedJobs = (mappedJobs: SavedJob[], note: string) => {
    setJobs((prevJobs) => {
      const hubIds = new Set(mappedJobs.map((j) => j.id));
      const localOnly = prevJobs.filter((j) => j.id && !hubIds.has(j.id));
      const merged = [...mappedJobs, ...localOnly];
      merged.sort((a, b) => b.timestamp - a.timestamp);
      const capped = merged.slice(0, 150);
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ recent_jobs_list: capped });
      }
      return capped;
    });
    setJobsFetchError(null);
    setJobsFetchInfo(note);
  };

  const fetchJobsFromHub = async () => {
    if (jobsFetchLock.current) return;
    jobsFetchLock.current = true;
    setIsFetchingJobs(true);
    setFailedHosts([]);
    try {
      // 1) Always surface local cache first
      let localJobs: SavedJob[] = [];
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const local = await chrome.storage.local.get([
          'recent_jobs_list',
          'hub_api_key',
          'gflow_api_key',
          'dreamina_api_key',
          'picsart_api_key',
          'topview_api_key',
          'gflowUrl',
        ]) as any;
        if (Array.isArray(local.recent_jobs_list) && local.recent_jobs_list.length > 0) {
          localJobs = local.recent_jobs_list;
          const current = useExtensionStore.getState().jobs;
          if (!current.length) setJobs(localJobs);
        }

        // 2) Native fetch (extension-safe) through worker/API-key namespace.
        const stableKey = pickStableApiKey(local);
        const keyCandidates = Array.from(new Set([
          local.hub_api_key,
          local.gflow_api_key,
          local.dreamina_api_key,
          local.picsart_api_key,
          local.topview_api_key,
        ].map((key) => String(key || '').trim()).filter(Boolean)));
        const gateway = (local.gflowUrl as string) || gflowUrl;
        console.log(`[FE Jobs] fetchJobsRaw gateway=${resolveGatewayBase(gateway)} keys=${keyCandidates.length}`);

        let rawList: any[] | null = null;
        let usedAuth = false;
        let authRejected = false;

        // Probe saved keys without logging their values. Persist the first key
        // actually accepted by the Hub as the stable worker credential.
        for (const candidate of keyCandidates) {
          const withAuth = await fetchJobsRaw(gateway, candidate);
          const list = extractJobsArray(withAuth.body);
          console.log(`[FE Jobs] with-auth status=${withAuth.status} count=${list?.length ?? 'n/a'} url=${withAuth.url}`);
          if (withAuth.ok && list) {
            rawList = list;
            usedAuth = true;
            if (candidate !== local.hub_api_key) {
              await chrome.storage.local.set({ hub_api_key: candidate });
            }
            break;
          } else if (withAuth.status === 401 || withAuth.status === 403) {
            authRejected = true;
          }
        }

        // Worker list is never public. Keep cache if the key is absent/invalid.
        if (!rawList) {
          setJobsFetchError(
            authRejected
              ? 'Các API key đã lưu đều bị Hub từ chối (403). Hãy nhập Hub Worker API key đang active.'
              : stableKey
                ? 'Không kết nối được Jobs API tại Gateway hiện tại.'
                : 'Chưa có Hub Worker API key.',
          );
          setJobsFetchInfo(
            localJobs.length
              ? `Đang hiện ${localJobs.length} job local cache.`
              : 'Chưa có local cache. Mở Settings → set Gateway = dev-hub / hub.'
          );
          return;
        }

        const mappedJobs = rawList
          .map((j) => mapHubJobToSaved(j))
          .filter((j): j is SavedJob => !!j && !!j.id);

        if (mappedJobs.length === 0) {
          setJobsFetchError(null);
          setJobsFetchInfo(
            localJobs.length
              ? `Hub không có job trong scope của key — giữ ${localJobs.length} job local.`
              : 'Hub không trả job nào (data=[]).'
          );
          return;
        }

        applyMappedJobs(
          mappedJobs,
          `Đã sync ${mappedJobs.length} job từ Hub${usedAuth ? ' (auth)' : ' (public)'}`
        );
        return;
      }

      // Non-extension env (dev preview)
      const apiClient = await getHubApiClient(false, { auth: true });
      const resJson = await apiClient.get('/worker/v1/jobs?limit=100');
      const rawList = extractJobsArray(resJson) || [];
      const mappedJobs = rawList.map((j) => mapHubJobToSaved(j)).filter((j): j is SavedJob => !!j && !!j.id);
      if (mappedJobs.length) applyMappedJobs(mappedJobs, `Đã sync ${mappedJobs.length} job`);
      else setJobsFetchInfo('Hub không có job.');
    } catch (err: any) {
      const msg = err?.message || err?.data?.message || String(err);
      setJobsFetchError(`Lỗi fetch jobs: ${msg}`);
      setJobsFetchInfo('Giữ lịch sử local — không ghi đè.');
      console.error(`[FE Jobs] Error fetching jobs:`, err);
    } finally {
      jobsFetchLock.current = false;
      setIsFetchingJobs(false);
    }
  };

  // Watch selectedProvider to load correct provider accounts from chrome storage local
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const storeKey = `${selectedProvider.toLowerCase()}_accounts`;
      chrome.storage.local.get([storeKey]).then((data) => {
        const stored = (data as any)[storeKey];
        const list = Array.isArray(stored) ? stored : [];
        const provUpper = selectedProvider.toUpperCase();
        if (provUpper === 'DREAMINA') setDreaminaAccounts(list);
        else if (provUpper === 'PICSART') setPicsartAccounts(list);
        else if (provUpper === 'TOPVIEW') setTopviewAccounts(list);
        else if (provUpper === 'GFLOW') setGflowAccounts(list);
      }).catch((err) => {
        console.warn(`[FE] Failed to get ${storeKey} from local storage:`, err);
      });
    }
    
    // Update hubApiKey input value to match the selected provider's API key
    const targetKey = providerApiKeys[selectedProvider.toUpperCase()] || "";
    setHubApiKey(targetKey);
    
    // Auto-sync accounts only when an API key is configured (no hardcoded fallback)
    const apiToken = targetKey || hubApiKey || "";
    if (apiToken) {
      syncAccounts(selectedProvider);
    }
  }, [selectedProvider, providerApiKeys]);

  // Poll Hub jobs only when the UI actually needs them (avoids 10s spam on Accounts tab)
  useEffect(() => {
    const needsJobPoll =
      activeTab === 'jobs' ||
      (isSidepanel && sidepanelTab === 'status');
    if (!needsJobPoll) return;

    let cancelled = false;
    const tick = () => {
      if (!cancelled) fetchJobsFromHub();
    };
    tick();
    const interval = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gflowUrl, hubApiKey, selectedProvider, activeTab, sidepanelTab, isSidepanel]);

  const handleConnectWs = () => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      console.warn("[Universal Ext] Chrome runtime Messaging API is not available.");
      return;
    }
    try {
      chrome.runtime.sendMessage({
        action: "CONNECT_WS",
        payload: { gflowUrl: gflowUrl }
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("[Universal Ext] Reconnect message error:", chrome.runtime.lastError.message);
          return;
        }
        if (res && res.success) {
          console.log("[Universal Ext] Reconnect message sent successfully.");
        }
      });
    } catch (err) {
      console.error("[Universal Ext] Failed to send CONNECT_WS message:", err);
    }
  };

  // Centralized Multi-Account Handlers
  const syncAccounts = async (provider: string) => {
    setIsSyncingAccounts(true);
    const provUpper = (normalizeProviderId(provider) || provider.toUpperCase()) as ProviderId;
    try {
      const apiClient = await getHubApiClient();
      const paths = accountListPaths(provUpper);
      console.log(`[FE Sync] Fetching ${provUpper} accounts via`, paths[0]);

      let resJson: any = null;
      let lastErr: any = null;
      for (const path of paths) {
        try {
          resJson = await apiClient.get(path);
          const raw = resJson?.accounts ?? resJson?.data ?? resJson;
          // Hub dreamina returns { status: 'ok', accounts: [] }; cookies/gflow use { status: 'success', data: [] }
          if (Array.isArray(raw) || Array.isArray(resJson?.accounts) || Array.isArray(resJson?.data)) {
            console.log(`[FE Sync] ${provUpper} OK via ${path}`);
            break;
          }
          if (resJson?.status === 'success' || resJson?.status === 'ok') break;
          lastErr = resJson;
          resJson = null;
        } catch (e: any) {
          lastErr = e;
          resJson = null;
          console.warn(`[FE Sync] ${path} →`, e?.status || e?.message || e);
        }
      }

      if (!resJson) {
        // GFlow: still surface browser session even if Hub path fails
        if (provUpper === 'GFLOW' && googleEmail) {
          const sessionOnly = [{
            email: googleEmail,
            cookieStr: '',
            points: oauthToken ? 1000 : 0,
            status: oauthToken ? 'ACTIVE' : 'SESSION',
            lastChecked: null,
            pool: 'browser-session',
          } as any];
          setGflowAccounts(sessionOnly);
          await chrome.storage.local.set({ gflow_accounts: sessionOnly });
        }
        console.error(`[FE Sync] Error syncing accounts for ${provUpper}:`, lastErr?.message || lastErr?.status || lastErr);
        return;
      }

      const accountsRaw = Array.isArray(resJson.accounts)
        ? resJson.accounts
        : Array.isArray(resJson.data)
          ? resJson.data
          : Array.isArray(resJson)
            ? resJson
            : [];

      let accounts = accountsRaw
        .map((acc: any) => mapAccountRow(acc))
        .filter((a: any) => !!a.email);

      // GFlow: merge browser session into pool
      if (provUpper === 'GFLOW' && googleEmail) {
        const hasSession = accounts.some(
          (a: any) => a.email?.toLowerCase() === googleEmail.toLowerCase()
        );
        if (!hasSession) {
          accounts = [
            {
              email: googleEmail,
              cookieStr: '',
              points: oauthToken ? 1000 : 0,
              status: oauthToken ? 'ACTIVE' : 'SESSION',
              lastChecked: null,
              pool: 'browser-session',
            } as any,
            ...accounts,
          ];
        }
        // Persist oauth tokens from Hub pool into chrome storage when matching active
        const withToken = accounts.find((a: any) => a.oauthToken);
        if (withToken?.oauthToken && !oauthToken) {
          await chrome.storage.local.set({
            oauthToken: withToken.oauthToken,
            googleEmail: withToken.email,
          });
        }
      }

      if (provUpper === 'DREAMINA') setDreaminaAccounts(accounts);
      else if (provUpper === 'PICSART') setPicsartAccounts(accounts);
      else if (provUpper === 'TOPVIEW') setTopviewAccounts(accounts);
      else if (provUpper === 'GFLOW') setGflowAccounts(accounts);

      const storeKey = `${provUpper.toLowerCase()}_accounts`;
      await chrome.storage.local.set({ [storeKey]: accounts });

      const activeForProv =
        provUpper === 'GFLOW'
          ? activeEmails.GFLOW || googleEmail || ''
          : activeEmails[provUpper] || '';
      if (!activeForProv && accounts.length > 0) {
        const threshold = getLowPointsThreshold(provUpper);
        const firstActive = accounts.find((a: any) => a.points >= threshold) || accounts[0];
        const updatedActive = { ...activeEmails, [provUpper]: firstActive.email };
        setActiveEmails(updatedActive);
        const storagePatch: Record<string, any> = { active_emails: updatedActive };
        if (provUpper === 'DREAMINA') storagePatch.current_dreamina_email = firstActive.email;
        if (provUpper === 'GFLOW') {
          storagePatch.googleEmail = firstActive.email;
          if (firstActive.oauthToken) storagePatch.oauthToken = firstActive.oauthToken;
        }
        await chrome.storage.local.set(storagePatch);
      } else if (provUpper === 'GFLOW' && !activeEmails.GFLOW && googleEmail) {
        const updatedActive = { ...activeEmails, GFLOW: googleEmail };
        setActiveEmails(updatedActive);
        await chrome.storage.local.set({ active_emails: updatedActive });
      }
    } catch (err: any) {
      console.error(`[FE Sync] Error syncing accounts for ${provider}:`, err.message || err);
    } finally {
      setIsSyncingAccounts(false);
    }
  };

  const syncAllAccounts = async () => {
    await Promise.all([
      syncAccounts('DREAMINA'),
      syncAccounts('PICSART'),
      syncAccounts('TOPVIEW'),
      syncAccounts('GFLOW')
    ]);
  };

  const handleSwitchAccount = async (provider: string, email: string, cookieStr: string) => {
    const providerUpper = (normalizeProviderId(provider) || provider.toUpperCase()) as ProviderId;
    setVerifyingEmail(email);
    
    // Save locally — GFlow uses same active_emails pool as other providers
    const updatedActive = { ...activeEmails, [providerUpper]: email };
    setActiveEmails(updatedActive);
    const storagePatch: Record<string, any> = { active_emails: updatedActive };
    if (providerUpper === 'DREAMINA') storagePatch.current_dreamina_email = email;
    if (providerUpper === 'GFLOW') {
      storagePatch.googleEmail = email;
      // Prefer oauth from pool row when switching GFlow
      const poolRow = gflowAccountsMerged.find((a) => a.email?.toLowerCase() === email.toLowerCase()) as any;
      if (poolRow?.oauthToken) {
        storagePatch.oauthToken = poolRow.oauthToken;
      }
    }
    await chrome.storage.local.set(storagePatch);
    
    // Trigger cookies injection and automatic points verification in the background script
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      // GFlow with oauth-only row (no cookies): bind identity + token, soft re-register
      if (providerUpper === 'GFLOW' && !cookieStr) {
        setVerifyingEmail(null);
        chrome.runtime.sendMessage({ type: 'WS_REREGISTER' }).catch(() => {});
        pushToast(`Đã chọn GFlow: ${email}`, 'success');
        return;
      }
      chrome.runtime.sendMessage({
        action: "SWITCH_ACCOUNT",
        payload: { provider: providerUpper, email, cookieStr }
      }, (res) => {
        setVerifyingEmail(null);
        if (chrome.runtime.lastError) {
          console.warn("[FE Sync] Switch account message runtime error:", chrome.runtime.lastError.message);
          pushToast(chrome.runtime.lastError.message || 'Switch failed', 'error');
          return;
        }
        
        if (res && res.success) {
          console.log(`[FE Sync] Successfully switched active account for ${providerUpper} to ${email}. Points: ${res.points}`);
          pushToast(`Đã switch ${PROVIDER_LABELS[providerUpper] || providerUpper}: ${email}`, 'success');
          
          // Refresh list from local storage cache to reflect new points & status
          const storeKey = `${providerUpper.toLowerCase()}_accounts`;
          chrome.storage.local.get([storeKey]).then((data: any) => {
            const list = data[storeKey] || [];
            if (providerUpper === 'DREAMINA') setDreaminaAccounts(list);
            else if (providerUpper === 'PICSART') setPicsartAccounts(list);
            else if (providerUpper === 'TOPVIEW') setTopviewAccounts(list);
            else if (providerUpper === 'GFLOW') setGflowAccounts(list);
          });
        } else {
          console.error(`[FE Sync] Failed to switch or verify account:`, res?.error);
          pushToast(res?.error || 'Switch thất bại', 'error');
        }
      });
    }
  };

  const onSwitchAccountFromJob = async (provider: string, email: string) => {
    const id = normalizeProviderId(provider) || (provider.toUpperCase() as ProviderId);
    let accList: any[] = [];
    if (id === 'DREAMINA') accList = dreaminaAccounts;
    else if (id === 'PICSART') accList = picsartAccounts;
    else if (id === 'TOPVIEW') accList = topviewAccounts;
    else if (id === 'GFLOW') accList = gflowAccountsMerged;

    const acc = accList.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (acc) {
      await handleSwitchAccount(id, acc.email, acc.cookieStr);
    } else {
      pushToast(`Không tìm thấy cookie cho ${email}. Sync tài khoản trước.`, 'error');
    }
  };


  const handleReleaseAccount = async (provider: string, email: string) => {
    const providerUpper = (normalizeProviderId(provider) || provider.toUpperCase()) as ProviderId;
    const apiClient = await getHubApiClient();
    
    try {
      await apiClient.post('/worker/v1/account/cookies/unlock', {
        provider: providerUpper, 
        email: email, 
        workerName: workerName || "universal-director" 
      }).catch(async () => {
        // legacy fallback
        await apiClient.post('/accounts/unlock', {
          provider: providerUpper,
          email,
          workerName: workerName || 'universal-director',
        }).catch(() => {});
      });
      if (providerUpper === 'DREAMINA') {
        await apiClient.post('/worker/v1/account/cookies/checkin', {
          email,
          status: 'ACTIVE',
        }).catch(() => {});
      }
    } catch (lockErr) {
      console.error("[FE Sync] Unlock error:", lockErr);
    }

    // Clear local active state
    const updatedActive = { ...activeEmails, [providerUpper]: "" };
    setActiveEmails(updatedActive);
    const storagePatch: Record<string, any> = { active_emails: updatedActive };
    if (providerUpper === 'DREAMINA') storagePatch.current_dreamina_email = "";
    // Keep googleEmail when releasing GFlow pool slot unless it was the released account
    if (providerUpper === 'GFLOW' && googleEmail?.toLowerCase() === email.toLowerCase()) {
      /* keep browser session email for session row */
    }
    await chrome.storage.local.set(storagePatch);
    
    syncAccounts(providerUpper);
  };

  const handleSwitchSelectedProvider = async (prov: 'DREAMINA' | 'PICSART' | 'TOPVIEW' | 'GFLOW') => {
    setSelectedProvider(prov);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      // Storage listener → STORAGE_CHANGED_NOTIFY reconnects once (avoid double FORCE_RECONNECT)
      await chrome.storage.local.set({ selected_provider: prov });
    }
  };

  const handleSaveHubApiKey = async () => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      if (!hubApiKey.trim()) {
        pushToast('Nhập API key trước khi lưu', 'error');
        return;
      }
      const storageKey = `${selectedProvider.toLowerCase()}_api_key`;
      const candidate = hubApiKey.trim();
      await chrome.storage.local.set({ [storageKey]: candidate });
      
      // Update local state
      const updatedKeys = { ...providerApiKeys, [selectedProvider.toUpperCase()]: hubApiKey };
      setProviderApiKeys(updatedKeys);

      // Only promote a provider key to stable Hub worker identity after the
      // authenticated worker endpoint accepts it.
      const verified = await fetchJobsRaw(gflowUrl, candidate);
      if (verified.ok) {
        await chrome.storage.local.set({ hub_api_key: candidate });
      } else if (verified.status === 401 || verified.status === 403) {
        const existing = await chrome.storage.local.get(['hub_api_key']) as any;
        if (existing.hub_api_key === candidate) {
          await chrome.storage.local.remove('hub_api_key');
        }
      }
      
      // Save workerName
      if (workerName.trim()) {
        await chrome.storage.local.set({ workerName: workerName.trim() });
      }
      
      // Sync immediately
      syncAccounts(selectedProvider);

      // Force reconnect WS immediately to apply the new API Key
      chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
      if (verified.ok) {
        pushToast(`Key ${selectedProvider} hợp lệ · đã reconnect`, 'success');
      } else if (verified.status === 401 || verified.status === 403) {
        pushToast('Key đã lưu cho provider nhưng không phải Hub Worker API key active', 'error');
      } else {
        pushToast('Đã lưu key; chưa xác minh được Gateway', 'error');
      }
    }
  };

  const handleRequestMoreAccounts = async () => {
    try {
      const apiClient = await getHubApiClient(false);
      console.log(`[FE Accounts] Requesting more slots for ${selectedProvider}...`);
      
      // Hub: POST /worker/v1/dreamina/request-more (IAM)
      const path =
        selectedProvider === 'DREAMINA'
          ? '/worker/v1/dreamina/request-more'
          : selectedProvider === 'TOPVIEW'
            ? '/worker/v1/topview/request-more'
            : `/worker/v1/${selectedProvider.toLowerCase()}/request-more`;
      const resJson = await apiClient.post(path, {});
      if (resJson && (resJson.success || resJson.status === 'ok' || resJson.status === 'success')) {
        pushToast(`Đã gửi yêu cầu thêm tài khoản ${selectedProvider}`, 'success');
      } else {
        pushToast(resJson?.error || resJson?.message || 'Yêu cầu thất bại. Kiểm tra API key (Bearer sk-…).', 'error');
      }
    } catch (err: any) {
      pushToast(`Lỗi yêu cầu: ${err.message}`, 'error');
    }
  };

  const handleToggleExecutionMode = async (mode: 'extension' | 'headless') => {
    setDreaminaExecutionMode(mode);
    await chrome.storage.local.set({ dreamina_execution_mode: mode });
  };

  const handleToggleAutoSwitch = async (enabled: boolean) => {
    setAutoSwitchEnabled(enabled);
    await chrome.storage.local.set({ auto_switch_enabled: enabled });
  };

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for restricted contexts
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        pushToast('Không copy được clipboard', 'error');
      }
    });
  }, [pushToast]);

  // Filter and search logic for jobs (GFlow aliases normalized)
  const filteredJobs = useMemo(() => {
    const q = debouncedJobSearch.toLowerCase().trim();
    return jobs.filter(job => {
      const matchStatus = jobStatusFilter === 'all' 
        ? true 
        : jobStatusFilter === 'processing' 
          ? (job.status === 'processing' || job.status === 'pending')
          : job.status === jobStatusFilter;
      const matchProvider = matchesProviderFilter(job.provider, jobProviderFilter);
      const matchSearch = !q ||
        job.prompt.toLowerCase().includes(q) || 
        (job.executedBy && job.executedBy.toLowerCase().includes(q)) ||
        job.id.toLowerCase().includes(q);
      return matchStatus && matchProvider && matchSearch;
    });
  }, [jobs, jobStatusFilter, jobProviderFilter, debouncedJobSearch]);

  const { totalJobsCount, processingJobsCount, doneJobsCount, failedJobsCount, providerJobCounts, statusCounts } = useMemo(() => {
    const scoped = jobs.filter((j) => matchesProviderFilter(j.provider, jobProviderFilter));
    const providerJobCounts: Partial<Record<ProviderFilter, number>> = { ALL: jobs.length };
    for (const id of PROVIDER_IDS) {
      providerJobCounts[id] = jobs.filter((j) => matchesProviderFilter(j.provider, id)).length;
    }
    return {
      totalJobsCount: scoped.length,
      processingJobsCount: scoped.filter(j => j.status === 'processing' || j.status === 'pending').length,
      doneJobsCount: scoped.filter(j => j.status === 'done').length,
      failedJobsCount: scoped.filter(j => j.status === 'failed').length,
      providerJobCounts,
      statusCounts: {
        all: scoped.length,
        processing: scoped.filter(j => j.status === 'processing' || j.status === 'pending').length,
        done: scoped.filter(j => j.status === 'done').length,
        failed: scoped.filter(j => j.status === 'failed').length,
      } as const,
    };
  }, [jobs, jobProviderFilter]);

  // ----------------------------------------  // 1. SIDEPANEL GIAO DIỆN TỐI GIẢN
  if (isSidepanel) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans relative select-none">
        <ToastStack toasts={toasts} />
        {/* Background neon glows */}
        <div className="absolute top-[-10%] left-[-20%] w-[60%] h-[30%] bg-purple-900/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-20%] w-[60%] h-[30%] bg-blue-900/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Minimal Header */}
        <header className="border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md sticky top-0 z-50 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-lg shadow-md shadow-indigo-500/20">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-xs font-bold bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Universal AI
              </h1>
              <p className="text-[8px] text-slate-400">StoryMee Worker</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <RouteBadge gflowUrl={gflowUrl} />
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold backdrop-blur-sm border ${
              workerState === 'ONLINE' 
                ? 'bg-emerald-955/40 border-emerald-500/35 text-emerald-400' 
                : workerState === 'CONNECTING'
                ? 'bg-amber-955/40 border-amber-500/35 text-amber-400 animate-pulse'
                : 'bg-rose-955/40 border-rose-500/35 text-rose-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                workerState === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : workerState === 'CONNECTING' ? 'bg-amber-400' : 'bg-rose-400'
              }`} />
              {workerState}
            </span>

            <button 
              onClick={openDashboard}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition-all"
              title="Mở Dashboard"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </header>

        {/* Sidepanel tab switcher */}
        <div className="px-3 pt-2">
          <div className="flex p-0.5 bg-slate-900/70 border border-slate-850 rounded-lg gap-0.5">
            <button
              type="button"
              onClick={() => setSidepanelTab('status')}
              className={`flex-1 py-1.5 text-[10px] font-extrabold uppercase rounded-md transition-all ${
                sidepanelTab === 'status'
                  ? 'bg-indigo-650 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Giám sát
            </button>
            <button
              type="button"
              onClick={() => setSidepanelTab('accounts')}
              className={`flex-1 py-1.5 text-[10px] font-extrabold uppercase rounded-md transition-all ${
                sidepanelTab === 'accounts'
                  ? 'bg-indigo-650 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cài đặt
            </button>
          </div>
        </div>

        {/* Sidepanel Body */}
        <main className="flex-1 overflow-y-auto p-3 space-y-3">
          {sidepanelTab === 'status' && (
            <>
              {/* WS Status & Route Badge */}
              <div className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kết nối:</span>
                <div className="flex items-center gap-2">
                  <RouteBadge gflowUrl={gflowUrl} />
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold backdrop-blur-sm border ${
                    workerState === 'ONLINE' 
                      ? 'bg-emerald-955/40 border-emerald-500/35 text-emerald-400' 
                      : workerState === 'CONNECTING'
                      ? 'bg-amber-955/40 border-amber-500/35 text-amber-400 animate-pulse'
                      : 'bg-rose-955/40 border-rose-500/35 text-rose-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      workerState === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : workerState === 'CONNECTING' ? 'bg-amber-400' : 'bg-rose-400'
                    }`} />
                    {workerState}
                  </span>
                </div>
              </div>

              {/* Gateway URL Display */}
              <div className="text-[10px] text-slate-400 font-mono break-all px-1">
                Gateway: <span className="text-indigo-400">{gflowUrl}</span>
              </div>

              {/* Stats 2x2 Table */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-900/30 border border-slate-850/60 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-slate-500 font-bold uppercase">Tổng Job</p>
                  <p className="text-sm font-bold text-slate-200">{jobs.length}</p>
                </div>
                <div className="bg-slate-900/30 border border-slate-850/60 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-slate-505 font-bold uppercase text-amber-400">Đang chạy</p>
                  <p className="text-sm font-bold text-amber-400">{processingJobsCount}</p>
                </div>
                <div className="bg-slate-900/30 border border-slate-850/60 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-slate-505 font-bold uppercase text-emerald-400">Thành công</p>
                  <p className="text-sm font-bold text-emerald-400">{doneJobsCount}</p>
                </div>
                <div className="bg-slate-900/30 border border-slate-850/60 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-slate-505 font-bold uppercase text-rose-450">Lỗi</p>
                  <p className="text-sm font-bold text-rose-450">{failedJobsCount}</p>
                </div>
              </div>

              {/* Active Jobs */}
              {(() => {
                const activeJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
                return (
                  <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Active Jobs ({activeJobs.length})
                    </h3>
                    {activeJobs.length === 0 ? (
                      <p className="text-[10px] text-slate-500 italic text-center py-2">Không có job đang chạy</p>
                    ) : (
                      <div className="space-y-1.5">
                        {activeJobs.map(job => (
                          <div key={job.id} className="bg-slate-950/60 border border-slate-900 rounded-lg p-2 space-y-1">
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-slate-500 font-mono">ID: {job.id.substring(0, 6)}...</span>
                              <span className="font-bold px-1.5 py-0.2 rounded uppercase bg-amber-955/80 text-amber-400 border border-amber-900/30 animate-pulse">
                                {job.status}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-350 truncate italic">"{job.prompt}"</p>
                            {job.executedBy && (
                              <p className="text-[8px] text-slate-500 truncate">Thực thi: {job.executedBy}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* 3 Last Jobs */}
              {(() => {
                const completedJobs = jobs.filter(j => j.status === 'done' || j.status === 'failed').slice(0, 3);
                return (
                  <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Jobs gần đây
                      </h3>
                      <button 
                        onClick={fetchJobsFromHub}
                        disabled={isFetchingJobs}
                        className="p-1 rounded bg-slate-800 border border-slate-700 hover:border-slate-650 transition-all text-slate-400 hover:text-slate-205"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isFetchingJobs ? 'animate-spin text-indigo-400' : ''}`} />
                      </button>
                    </div>

                    {isFetchingJobs && completedJobs.length === 0 ? (
                      <SidepanelJobSkeleton count={3} />
                    ) : completedJobs.length === 0 ? (
                      <p className="text-[10px] text-slate-505 italic text-center py-2">Không có task nào</p>
                    ) : (
                      <div className="space-y-1.5">
                        {completedJobs.map(job => (
                          <div key={job.id} className="bg-slate-950/60 border border-slate-900 rounded-lg p-2 space-y-1">
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-slate-505 font-mono">ID: {job.id.substring(0, 6)}...</span>
                              <span className={`font-bold px-1.5 py-0.2 rounded uppercase ${
                                job.status === 'done' ? 'bg-emerald-955/80 text-emerald-400 border border-emerald-900/30' :
                                'bg-rose-955/80 text-rose-450 border border-rose-900/30'
                              }`}>
                                {job.status}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-350 truncate italic">"{job.prompt}"</p>
                            {job.executedBy && (
                              <p className="text-[8px] text-slate-500 truncate">Thực thi: {job.executedBy}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })()}
            </>
          )}

          {sidepanelTab === 'accounts' && (
            <div className="space-y-3">
              {/* GFlow active (pool) — not a separate singleton identity card */}
              {(activeGflowEmail || googleEmail) && (
                <div className="flex items-center gap-2 bg-sky-955/20 p-2 rounded-lg border border-sky-500/20">
                  {googleAvatar ? (
                    <img src={googleAvatar} alt="GFlow" className="w-5 h-5 rounded-full border border-sky-500/30" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[8px] font-extrabold uppercase text-sky-400/80">Google Flow active</p>
                    <p className="text-[10px] text-slate-300 truncate">{activeGflowEmail || googleEmail}</p>
                  </div>
                  <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                </div>
              )}

              {/* Worker Name Config */}
              <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3 h-3 text-purple-400" />
                  Tên Worker Này
                </h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    placeholder="Studio-PC, Worker-1..."
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 text-xs rounded-lg px-2.5 py-1.5 text-slate-200 outline-none placeholder-slate-650"
                  />
                  <button
                    onClick={async () => {
                      if (workerName.trim() && typeof chrome !== 'undefined' && chrome.storage) {
                        await chrome.storage.local.set({ workerName: workerName.trim() });
                        chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        pushToast('Đã lưu tên worker & reconnect WS', 'success');
                      }
                    }}
                    className="bg-violet-650 hover:bg-violet-500 active:scale-95 text-white font-bold text-[10px] px-3 rounded-lg transition-all"
                  >
                    Lưu
                  </button>
                </div>
              </section>

              {/* Gateway Connection Config */}
              <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Settings className="w-3 h-3 text-indigo-400" />
                  Gateway Connection
                </h3>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={gflowUrl} 
                    onChange={(e) => setGflowUrl(e.target.value)} 
                    placeholder="https://hub.storymee.com" 
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-505 focus:ring-1 focus:ring-indigo-550 text-xs rounded-lg px-2.5 py-1.5 text-slate-202 outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (gflowUrl.trim() && typeof chrome !== 'undefined' && chrome.storage) {
                        await chrome.storage.local.set({ gflowUrl: gflowUrl.trim() });
                        chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        pushToast('Đã lưu Gateway URL & reconnect', 'success');
                      }
                    }}
                    className="bg-indigo-650 hover:bg-indigo-600 active:scale-95 text-white font-bold text-[10px] px-3 rounded-lg transition-all"
                  >
                    Lưu
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                  <button
                    onClick={() => {
                      setGflowUrl("http://localhost:5100");
                      if (typeof chrome !== 'undefined' && chrome.storage) {
                        chrome.storage.local.set({ gflowUrl: "http://localhost:5100" }).then(() => {
                          chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        });
                      }
                    }}
                    className="bg-slate-955 hover:bg-slate-900 border border-slate-850 text-[9px] text-emerald-400 py-1 rounded font-bold transition-all text-center"
                  >
                    Local
                  </button>
                  <button
                    onClick={() => {
                      setGflowUrl("https://dev-hub.storymee.com");
                      if (typeof chrome !== 'undefined' && chrome.storage) {
                        chrome.storage.local.set({ gflowUrl: "https://dev-hub.storymee.com" }).then(() => {
                          chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        });
                      }
                    }}
                    className="bg-slate-955 hover:bg-slate-900 border border-slate-850 text-[9px] text-blue-400 py-1 rounded font-bold transition-all text-center"
                  >
                    Dev Hub
                  </button>
                  <button
                    onClick={() => {
                      setGflowUrl("http://173.249.19.167:5100");
                      if (typeof chrome !== 'undefined' && chrome.storage) {
                        chrome.storage.local.set({ gflowUrl: "http://173.249.19.167:5100" }).then(() => {
                          chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        });
                      }
                    }}
                    className="bg-slate-955 hover:bg-slate-900 border border-slate-850 text-[9px] text-amber-500 py-1 rounded font-bold transition-all text-center"
                  >
                    VPS
                  </button>
                  <button
                    onClick={() => {
                      setGflowUrl("https://hub.storymee.com");
                      if (typeof chrome !== 'undefined' && chrome.storage) {
                        chrome.storage.local.set({ gflowUrl: "https://hub.storymee.com" }).then(() => {
                          chrome.runtime.sendMessage({ type: "FORCE_RECONNECT_WS" }).catch(() => {});
                        });
                      }
                    }}
                    className="bg-slate-955 hover:bg-slate-900 border border-slate-850 text-[9px] text-purple-400 py-1 rounded font-bold transition-all text-center"
                  >
                    Prod Hub
                  </button>
                </div>
              </section>

              {/* Hub API & Decryption Key */}
              <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  Provider / Hub Worker API key ({selectedProvider})
                </h3>
                <div className="relative">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={hubApiKey}
                    onChange={(e) => setHubApiKey(e.target.value)}
                    placeholder="sk-storymee-..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs font-mono rounded-lg pl-2.5 pr-8 py-1.5 text-slate-300 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1.5 text-slate-500 hover:text-slate-300 text-[10px] font-bold"
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button
                  onClick={handleSaveHubApiKey}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold text-[10px] py-1.5 rounded-lg transition-all"
                >
                  Lưu & Đồng bộ Accounts
                </button>
              </section>

              {/* Active Providers List */}
              <section className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-2">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-800/40">
                  Pool đang active
                </h3>
                <div className="space-y-1.5">
                  {PROVIDER_IDS.map((provider) => {
                    const activeEmail = getActiveEmailForProvider(provider);
                    const list =
                      provider === 'DREAMINA'
                        ? dreaminaAccounts
                        : provider === 'PICSART'
                          ? picsartAccounts
                          : provider === 'TOPVIEW'
                            ? topviewAccounts
                            : gflowAccountsMerged;
                    const activeAcc = list.find(
                      (a) => a.email?.toLowerCase() === activeEmail.toLowerCase()
                    );
                    const points = activeAcc ? activeAcc.points : 0;

                    return (
                      <div
                        key={provider}
                        className="flex items-center justify-between text-[11px] bg-slate-950/40 p-1.5 rounded-lg border border-slate-900"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${activeEmail ? 'bg-emerald-400' : 'bg-slate-600'}`}
                          />
                          <span className="font-semibold text-slate-350">
                            {PROVIDER_LABELS[provider]}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 min-w-0 text-right">
                          <span
                            className="text-[10px] text-slate-400 truncate max-w-[110px]"
                            title={activeEmail}
                          >
                            {activeEmail || 'chưa switch'}
                          </span>
                          {activeEmail && (
                            <span className="text-[8px] font-extrabold px-1.5 py-0.2 bg-indigo-955/80 text-indigo-400 border border-indigo-900/40 rounded">
                              {points} P
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Provider pool switcher */}
              <div className="space-y-2">
                <ProviderFilterBar
                  value={selectedProvider}
                  onChange={(v) => {
                    if (v !== 'ALL') handleSwitchSelectedProvider(v);
                  }}
                  showAll={false}
                  size="sm"
                  compactLabels
                />
                <div className="flex items-center gap-1.5 justify-end">
                  <input
                    type="checkbox"
                    id="hide-low-pts-side"
                    checked={hideLowPoints}
                    onChange={(e) => {
                      setHideLowPoints(e.target.checked);
                      chrome.storage.local.set({ hide_low_points: e.target.checked });
                    }}
                    className="rounded bg-slate-950 border-slate-800 text-indigo-550 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <label
                    htmlFor="hide-low-pts-side"
                    className="text-[9px] text-slate-500 font-bold select-none cursor-pointer"
                  >
                    Ẩn ít điểm
                  </label>
                </div>
              </div>

              {/* Mini account list for selected provider pool */}
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <ProviderAccountsColumn
                  accounts={accountsList}
                  provider={selectedProvider}
                  activeEmail={getActiveEmailForProvider(selectedProvider)}
                  hideLowPoints={hideLowPoints}
                  verifyingEmail={verifyingEmail}
                  isLoading={isSyncingAccounts}
                  onSwitch={handleSwitchAccount}
                  onRelease={handleReleaseAccount}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // 2. FULL DASHBOARD — top nav only (no left settings sidebar; avoids "duplicate side panel" with Chrome sidepanel)
  const settingsPanel = (
    <div className="max-w-3xl mx-auto space-y-4 animate-fadeIn">
      <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-slate-100">Kết nối Worker</h2>
            <p className="text-[10px] text-slate-500">Gateway, API key, auto-switch — dùng chung 4 provider</p>
          </div>
          <div className="flex items-center gap-2">
            <RouteBadge gflowUrl={gflowUrl} />
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              workerState === 'ONLINE'
                ? 'bg-emerald-955/40 border-emerald-500/30 text-emerald-400'
                : workerState === 'CONNECTING'
                  ? 'bg-amber-955/40 border-amber-500/30 text-amber-400'
                  : 'bg-rose-955/40 border-rose-500/30 text-rose-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${workerState === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              {workerState}
            </span>
            <button
              onClick={handleConnectWs}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-extrabold px-3 py-1.5 rounded-lg flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reconnect
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1 block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Tên Worker</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={workerName}
                onChange={(e) => setWorkerName(e.target.value)}
                placeholder="Studio-PC, Worker-1..."
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-violet-500 text-xs rounded-lg px-2.5 py-2 outline-none"
              />
              <button
                onClick={async () => {
                  if (workerName.trim() && chrome?.storage) {
                    await chrome.storage.local.set({ workerName: workerName.trim() });
                    chrome.runtime.sendMessage({ type: 'FORCE_RECONNECT_WS' }).catch(() => {});
                    pushToast('Đã lưu worker & reconnect', 'success');
                  }
                }}
                className="bg-violet-650 hover:bg-violet-500 text-white text-[10px] font-bold px-3 rounded-lg"
              >
                Lưu
              </button>
            </div>
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] font-bold uppercase text-slate-500">Gateway URL</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={gflowUrl}
                onChange={(e) => setGflowUrl(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs rounded-lg px-2.5 py-2 outline-none font-mono"
              />
              <button
                onClick={async () => {
                  if (gflowUrl.trim() && chrome?.storage) {
                    await chrome.storage.local.set({ gflowUrl: gflowUrl.trim() });
                    chrome.runtime.sendMessage({ type: 'FORCE_RECONNECT_WS' }).catch(() => {});
                    pushToast('Đã lưu Gateway', 'success');
                  }
                }}
                className="bg-indigo-650 hover:bg-indigo-600 text-white text-[10px] font-bold px-3 rounded-lg"
              >
                Lưu
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                { label: 'Local', url: 'http://localhost:5100' },
                { label: 'Dev', url: 'https://dev-hub.storymee.com' },
                { label: 'VPS', url: 'http://173.249.19.167:5100' },
                { label: 'Prod', url: 'https://hub.storymee.com' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setGflowUrl(p.url);
                    chrome?.storage?.local.set({ gflowUrl: p.url }).then(() => {
                      chrome.runtime.sendMessage({ type: 'FORCE_RECONNECT_WS' }).catch(() => {});
                    });
                  }}
                  className="text-[9px] font-bold px-2 py-1 rounded border border-slate-800 bg-slate-950 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/30"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-semibold">Auto-switch accounts</span>
            <button
              type="button"
              onClick={() => handleToggleAutoSwitch(!autoSwitchEnabled)}
              className={`w-8 h-4 rounded-full relative transition-all ${autoSwitchEnabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${autoSwitchEnabled ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>
          {selectedProvider === 'DREAMINA' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-semibold">Dreamina engine</span>
              <div className="flex bg-slate-950 p-0.5 border border-slate-800 rounded-lg">
                {(['extension', 'headless'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleToggleExecutionMode(m)}
                    className={`px-2 py-0.5 text-[9px] font-bold rounded ${dreaminaExecutionMode === m ? 'bg-pink-600 text-white' : 'text-slate-500'}`}
                  >
                    {m === 'extension' ? 'Ext' : 'Headless'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-slate-100">API key theo provider</h2>
          <ProviderFilterBar
            value={selectedProvider}
            onChange={(v) => {
              if (v !== 'ALL') handleSwitchSelectedProvider(v);
            }}
            showAll={false}
            size="sm"
            compactLabels
          />
        </div>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={hubApiKey}
            onChange={(e) => setHubApiKey(e.target.value)}
            placeholder={`sk-… (${PROVIDER_LABELS[selectedProvider]})`}
            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs font-mono rounded-lg pl-3 pr-10 py-2.5 outline-none"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-200"
          >
            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={handleSaveHubApiKey}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl"
        >
          Lưu key & đồng bộ {PROVIDER_LABELS[selectedProvider]}
        </button>
      </div>

      <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 space-y-2">
        <button
          type="button"
          onClick={() => setShowVaultHeaders(!showVaultHeaders)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-xs font-bold text-slate-300">Session vault (debug)</span>
          {showVaultHeaders ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>
        {showVaultHeaders && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            {[
              { label: 'OAuth ya29', value: oauthToken },
              { label: 'x-browser-validation', value: xBrowserValidation },
              { label: 'x-client-data', value: xClientData },
            ].map((row) => (
              <div key={row.label} className="flex gap-2 items-center">
                <span className="text-[9px] text-slate-500 w-36 shrink-0">{row.label}</span>
                <input
                  readOnly
                  type="password"
                  value={row.value || '—'}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    copyToClipboard(row.value || '');
                    pushToast('Copied', 'success');
                  }}
                  className="text-[9px] font-bold text-indigo-400 px-2"
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {rotationLog?.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-4 space-y-2">
          <h2 className="text-xs font-bold text-slate-300">Rotation log</h2>
          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {rotationLog.slice(0, 20).map((log: any, idx: number) => (
              <div key={idx} className="text-[10px] bg-slate-950/60 border border-slate-900 rounded-lg p-2 flex justify-between gap-2">
                <span className="text-slate-400 truncate">
                  <span className="text-rose-400">{log.fromEmail || '—'}</span>
                  {' → '}
                  <span className="text-emerald-400">{log.toEmail || '—'}</span>
                </span>
                <span className="text-slate-600 shrink-0">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-955 text-slate-100 flex flex-col font-sans relative">
      <ToastStack toasts={toasts} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-purple-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[35%] h-[35%] bg-indigo-900/20 rounded-full blur-[120px]" />
      </div>

      {/* Top app bar — single chrome, no side rail */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-xl shadow-lg shadow-indigo-600/20 shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-tight truncate">Universal AI Director</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                  workerState === 'ONLINE' ? 'text-emerald-400' : workerState === 'CONNECTING' ? 'text-amber-400' : 'text-rose-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${workerState === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                  {workerState}
                </span>
                <RouteBadge gflowUrl={gflowUrl} />
              </div>
            </div>
          </div>

          <nav className="flex p-1 bg-slate-900/80 border border-slate-800 rounded-xl gap-0.5">
            {(
              [
                { id: 'jobs' as const, label: 'Jobs', icon: Activity },
                { id: 'accounts' as const, label: 'Accounts', icon: Layers },
                { id: 'settings' as const, label: 'Settings', icon: Settings },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = activeTab === id || (id === 'jobs' && (activeTab as string) === 'dashboard');
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`px-3.5 py-2 text-[11px] font-extrabold uppercase rounded-lg transition-all inline-flex items-center gap-1.5 ${
                    active
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* JOBS */}
        {(activeTab === 'jobs' || (activeTab as string) === 'dashboard' || (activeTab as string) === 'history') && (
          <section className="space-y-5 animate-fadeIn">
            {(jobsFetchError || jobsFetchInfo) && (
              <div
                className={`rounded-xl border px-3 py-2.5 text-[11px] flex flex-col sm:flex-row sm:items-center gap-2 justify-between ${
                  jobsFetchError
                    ? 'bg-rose-955/20 border-rose-500/30 text-rose-300'
                    : 'bg-slate-900/60 border-slate-700 text-slate-400'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${jobsFetchError ? 'text-rose-400' : 'text-slate-500'}`} />
                  <div className="min-w-0">
                    {jobsFetchError && <p className="font-bold leading-snug">{jobsFetchError}</p>}
                    {jobsFetchInfo && <p className={`leading-snug ${jobsFetchError ? 'text-rose-200/80' : ''}`}>{jobsFetchInfo}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fetchJobsFromHub()}
                  disabled={isFetchingJobs}
                  className="shrink-0 text-[10px] font-extrabold uppercase px-3 py-1.5 rounded-lg border border-current/30 hover:bg-white/5 disabled:opacity-50"
                >
                  Thử lại
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Tổng (filter)', value: totalJobsCount, cls: 'text-slate-100 border-slate-850 bg-slate-900/40' },
                { label: 'Đang chạy', value: processingJobsCount, cls: 'text-amber-400 border-amber-500/20 bg-amber-955/15' },
                { label: 'Xong', value: doneJobsCount, cls: 'text-emerald-400 border-emerald-500/20 bg-emerald-955/15' },
                { label: 'Lỗi', value: failedJobsCount, cls: 'text-rose-400 border-rose-500/20 bg-rose-955/15' },
              ].map((s) => (
                <div key={s.label} className={`rounded-2xl border p-4 ${s.cls}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{s.label}</p>
                  <p className="text-2xl font-black mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                <div className="space-y-2 min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Provider</p>
                  <ProviderFilterBar
                    value={jobProviderFilter}
                    onChange={setJobProviderFilter}
                    counts={providerJobCounts}
                  />
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Trạng thái</p>
                  <JobStatusFilterBar
                    value={jobStatusFilter}
                    onChange={setJobStatusFilter}
                    counts={statusCounts}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={jobSearchQuery}
                    onChange={(e) => setJobSearchQuery(e.target.value)}
                    placeholder="Tìm prompt, email, job id… (debounce 200ms)"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs rounded-xl pl-10 pr-3 py-2.5 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={fetchJobsFromHub}
                  disabled={isFetchingJobs}
                  className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white disabled:opacity-50"
                  title="Refresh jobs"
                >
                  <RefreshCw className={`w-4 h-4 ${isFetchingJobs ? 'animate-spin text-indigo-400' : ''}`} />
                </button>
              </div>
            </div>

            {failedHosts.length > 0 && (
              <div className="space-y-2">
                {failedHosts.map((host) => (
                  <div key={host} className="bg-amber-955/20 border border-amber-500/20 rounded-xl p-3 flex flex-col sm:flex-row gap-3 justify-between text-amber-400">
                    <div className="flex gap-2 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Host/ảnh không tải được: {host}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Kiểm tra kết nối hoặc mở tab mới để kiểm tra.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => window.open(`https://${host}/`, '_blank')}
                        className="bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 justify-center"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Kiểm tra Host
                      </button>
                      <button
                        type="button"
                        onClick={() => setFailedHosts((prev) => prev.filter((h) => h !== host))}
                        className="p-1.5 hover:bg-amber-500/20 text-amber-400 hover:text-amber-200 rounded-lg transition-colors inline-flex items-center justify-center"
                        title="Đóng thông báo"
                        aria-label="Dismiss"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isFetchingJobs && jobs.length === 0 ? (
              <JobListSkeleton count={6} />
            ) : filteredJobs.length === 0 ? (
              <div className="border border-dashed border-slate-800 rounded-2xl py-14 text-center text-slate-500">
                <ImageIcon className="w-10 h-10 mx-auto mb-2 text-slate-700" />
                <p className="text-sm font-medium">Không có job khớp filter.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    copyToClipboard={copyToClipboard}
                    onViewDetails={setSelectedJobForModal}
                    onSwitchAccount={onSwitchAccountFromJob}
                    notify={pushToast}
                    onMediaError={(url) => {
                      try {
                        const parsed = new URL(url);
                        const host = parsed.host.toLowerCase();
                        if (
                          parsed.protocol === 'https:' &&
                          (host.includes('localhost') ||
                            host.includes('127.0.0.1') ||
                            host.startsWith('192.168.') ||
                            host.startsWith('10.'))
                        ) {
                          setFailedHosts((prev) => (prev.includes(parsed.host) ? prev : [...prev, parsed.host]));
                        }
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ACCOUNTS — 4 providers equal (GFlow is a pool, not a singleton) */}
        {activeTab === 'accounts' && (
          <section className="space-y-4 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-100">Kho tài khoản (pool xoay)</h2>
                <p className="text-[10px] text-slate-500">
                  Dreamina · Picsart · TopView · <span className="text-sky-400 font-semibold">Google Flow</span> — cùng mô hình switch / release
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideLowPoints}
                    onChange={(e) => {
                      setHideLowPoints(e.target.checked);
                      chrome?.storage?.local.set({ hide_low_points: e.target.checked });
                    }}
                    className="rounded w-3.5 h-3.5"
                  />
                  <span className="text-[10px] font-bold text-slate-400">Ẩn low points</span>
                </label>
                <button
                  type="button"
                  onClick={handleRequestMoreAccounts}
                  className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 bg-indigo-950/40 inline-flex items-center gap-1"
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Xin thêm
                </button>
                <button
                  type="button"
                  onClick={syncAllAccounts}
                  disabled={isSyncingAccounts}
                  className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAccounts ? 'animate-spin' : ''}`} />
                  Sync all
                </button>
              </div>
            </div>

            {/* Active strip — one chip per provider */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {PROVIDER_IDS.map((prov) => {
                const email = getActiveEmailForProvider(prov);
                return (
                  <div
                    key={prov}
                    className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 min-w-0 ${PROVIDER_ACCENT[prov]}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${email ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-extrabold uppercase opacity-80">{PROVIDER_LABELS[prov]}</p>
                      <p className="text-[11px] font-semibold truncate text-slate-100/90">{email || 'chưa chọn'}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {(
                [
                  { id: 'DREAMINA' as const, list: dreaminaAccounts, icon: Layers, title: 'Dreamina' },
                  { id: 'PICSART' as const, list: picsartAccounts, icon: Cpu, title: 'Picsart' },
                  { id: 'TOPVIEW' as const, list: topviewAccounts, icon: Terminal, title: 'TopView' },
                  { id: 'GFLOW' as const, list: gflowAccountsMerged, icon: Globe, title: 'Google Flow' },
                ] as const
              ).map(({ id, list, icon: Icon, title }) => (
                <div key={id} className="bg-slate-900/40 border border-slate-850 rounded-2xl p-4 flex flex-col gap-3 min-h-[280px]">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                    <h3 className={`text-xs font-black uppercase tracking-wider flex items-center gap-2 ${
                      id === 'DREAMINA' ? 'text-pink-400' : id === 'PICSART' ? 'text-violet-400' : id === 'TOPVIEW' ? 'text-emerald-400' : 'text-sky-400'
                    }`}>
                      <Icon className="w-4 h-4" />
                      {title}
                    </h3>
                    <span className="text-[10px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-full text-slate-400 font-bold">
                      {list.length} acc
                    </span>
                  </div>
                  {id === 'GFLOW' && (
                    <p className="text-[9px] text-slate-500 leading-relaxed -mt-1">
                      Xoay pool giống provider khác. Session browser hiện tại được gộp vào list nếu chưa có trong Hub.
                    </p>
                  )}
                  <ProviderAccountsColumn
                    accounts={list}
                    provider={id}
                    activeEmail={getActiveEmailForProvider(id)}
                    hideLowPoints={hideLowPoints}
                    verifyingEmail={verifyingEmail}
                    isLoading={isSyncingAccounts}
                    onSwitch={handleSwitchAccount}
                    onRelease={handleReleaseAccount}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'settings' && settingsPanel}
      </main>

      {/* Details Modal */}
      {selectedJobForModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-slate-500">Job</span>
                <span className="text-xs font-mono text-indigo-400 font-bold bg-indigo-955/40 border border-indigo-500/20 px-2 py-0.5 rounded truncate">
                  {selectedJobForModal.id}
                </span>
              </div>
              <button type="button" onClick={() => setSelectedJobForModal(null)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {selectedJobForModal.status === 'done' && selectedJobForModal.resultUrl && (
                <div className="bg-black/50 rounded-xl border border-slate-800 p-3 flex flex-col items-center gap-3">
                  {selectedJobForModal.mediaType === 'video' ? (
                    <video src={selectedJobForModal.resultUrl} className="max-h-[200px] max-w-full rounded-lg" controls playsInline muted />
                  ) : selectedJobForModal.mediaType === 'image' && !selectedJobForModal.resultUrl.startsWith('{') ? (
                    <img src={selectedJobForModal.resultUrl} alt="" className="max-h-[200px] max-w-full rounded-lg object-contain" />
                  ) : (
                    <pre className="text-[10px] text-slate-400 break-all whitespace-pre-wrap w-full">{selectedJobForModal.resultUrl}</pre>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        copyToClipboard(selectedJobForModal.resultUrl!);
                        pushToast('Đã copy link', 'success');
                      }}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 inline-flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    <a
                      href={selectedJobForModal.resultUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1 no-underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Mở
                    </a>
                  </div>
                </div>
              )}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Prompt</span>
                  <button
                    type="button"
                    onClick={() => {
                      copyToClipboard(selectedJobForModal.prompt);
                      pushToast('Đã copy prompt', 'success');
                    }}
                    className="text-[10px] text-indigo-400 font-bold"
                  >
                    Copy
                  </button>
                </div>
                <div className="bg-slate-950 border border-slate-850 p-3 rounded-xl text-sm text-slate-200 italic max-h-36 overflow-y-auto">
                  "{selectedJobForModal.prompt}"
                </div>
              </div>
              {selectedJobForModal.error && (
                <div className="bg-rose-955/15 border border-rose-500/20 p-3 rounded-xl text-xs text-rose-400">{selectedJobForModal.error}</div>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] text-slate-500">Provider</p>
                  <p className="font-semibold uppercase">{selectedJobForModal.provider}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Status</p>
                  <p className="font-semibold">{selectedJobForModal.status}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Executed by</p>
                  <p className="font-semibold truncate">{selectedJobForModal.executedBy || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">Model / Ratio</p>
                  <p className="font-semibold">{selectedJobForModal.modelDisp || '—'} · {selectedJobForModal.ratioDisp || '—'}</p>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedJobForModal(null)}
                className="text-xs font-bold px-4 py-2 rounded-lg bg-slate-800 text-slate-200"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
