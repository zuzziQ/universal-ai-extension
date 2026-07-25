import { create } from 'zustand';
import type {
  DashboardTab,
  JobStatusFilter,
  ProviderAccount,
  ProviderFilter,
  ProviderId,
  SavedJob,
  SidepanelTab,
} from '../types/extension';

export interface ExtensionState {
  // Connection
  gflowUrl: string;
  workerState: string;
  googleEmail: string;
  googleAvatar: string;
  oauthToken: string;
  xBrowserValidation: string;
  xClientData: string;
  workerName: string;
  hubApiKey: string;
  providerApiKeys: Record<string, string>;
  providerEnabled: Record<string, boolean>;
  selectedProvider: ProviderId;

  // Jobs
  jobs: SavedJob[];
  failedHosts: string[];
  selectedJobForModal: SavedJob | null;
  isFetchingJobs: boolean;
  jobStatusFilter: JobStatusFilter;
  jobSearchQuery: string;
  jobProviderFilter: ProviderFilter;

  // Accounts
  dreaminaAccounts: ProviderAccount[];
  picsartAccounts: ProviderAccount[];
  topviewAccounts: ProviderAccount[];
  gflowAccounts: ProviderAccount[];
  activeEmails: Record<string, string>;
  hideLowPoints: boolean;
  isSyncingAccounts: boolean;
  verifyingEmail: string | null;
  currentDreaminaEmail: string;
  dreaminaExecutionMode: 'extension' | 'headless';
  autoSwitchEnabled: boolean;
  activeExecutor: any;
  rotationLog: any[];

  // UI
  activeTab: DashboardTab;
  sidepanelTab: SidepanelTab;
  showApiKey: boolean;
  showVaultHeaders: boolean;

  // Setters
  setGflowUrl: (v: string) => void;
  setWorkerState: (v: string) => void;
  setGoogleEmail: (v: string) => void;
  setGoogleAvatar: (v: string) => void;
  setOauthToken: (v: string) => void;
  setXBrowserValidation: (v: string) => void;
  setXClientData: (v: string) => void;
  setWorkerName: (v: string) => void;
  setHubApiKey: (v: string) => void;
  setProviderApiKeys: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setProviderEnabled: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setSelectedProvider: (v: ProviderId) => void;

  setJobs: (v: SavedJob[] | ((prev: SavedJob[]) => SavedJob[])) => void;
  setFailedHosts: (v: string[] | ((prev: string[]) => string[])) => void;
  setSelectedJobForModal: (v: SavedJob | null) => void;
  setIsFetchingJobs: (v: boolean) => void;
  setJobStatusFilter: (v: JobStatusFilter) => void;
  setJobSearchQuery: (v: string) => void;
  setJobProviderFilter: (v: ProviderFilter) => void;

  setDreaminaAccounts: (v: ProviderAccount[]) => void;
  setPicsartAccounts: (v: ProviderAccount[]) => void;
  setTopviewAccounts: (v: ProviderAccount[]) => void;
  setGflowAccounts: (v: ProviderAccount[]) => void;
  setActiveEmails: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setHideLowPoints: (v: boolean) => void;
  setIsSyncingAccounts: (v: boolean) => void;
  setVerifyingEmail: (v: string | null) => void;
  setCurrentDreaminaEmail: (v: string) => void;
  setDreaminaExecutionMode: (v: 'extension' | 'headless') => void;
  setAutoSwitchEnabled: (v: boolean) => void;
  setActiveExecutor: (v: any) => void;
  setRotationLog: (v: any[]) => void;

  setActiveTab: (v: DashboardTab) => void;
  setSidepanelTab: (v: SidepanelTab) => void;
  setShowApiKey: (v: boolean) => void;
  setShowVaultHeaders: (v: boolean) => void;

  /** Bulk hydrate from chrome.storage.local snapshot */
  hydrateFromStorage: (data: Record<string, any>) => void;
}

function applySetter<T>(set: any, key: keyof ExtensionState, v: T | ((prev: T) => T)) {
  if (typeof v === 'function') {
    set((s: ExtensionState) => ({ [key]: (v as (prev: T) => T)(s[key] as T) }));
  } else {
    set({ [key]: v });
  }
}

export const useExtensionStore = create<ExtensionState>((set) => ({
  gflowUrl: 'https://hub.storymee.com',
  workerState: 'DISCONNECTED',
  googleEmail: '',
  googleAvatar: '',
  oauthToken: '',
  xBrowserValidation: '',
  xClientData: '',
  workerName: '',
  hubApiKey: '',
  providerApiKeys: { DREAMINA: '', PICSART: '', TOPVIEW: '', GFLOW: '' },
  providerEnabled: { GFLOW: true, 'VIDTORY-SDK': true, DREAMINA: true, VERTEX: true, 'GEMINI-NATIVE': true },
  selectedProvider: 'DREAMINA',

  jobs: [],
  failedHosts: [],
  selectedJobForModal: null,
  isFetchingJobs: false,
  jobStatusFilter: 'all',
  jobSearchQuery: '',
  jobProviderFilter: 'ALL',

  dreaminaAccounts: [],
  picsartAccounts: [],
  topviewAccounts: [],
  gflowAccounts: [],
  activeEmails: {},
  hideLowPoints: false,
  isSyncingAccounts: false,
  verifyingEmail: null,
  currentDreaminaEmail: '',
  dreaminaExecutionMode: 'extension',
  autoSwitchEnabled: true,
  activeExecutor: null,
  rotationLog: [],

  activeTab: 'jobs',
  sidepanelTab: 'status',
  showApiKey: false,
  showVaultHeaders: false,

  setGflowUrl: (v) => set({ gflowUrl: v }),
  setWorkerState: (v) => set({ workerState: v }),
  setGoogleEmail: (v) => set({ googleEmail: v }),
  setGoogleAvatar: (v) => set({ googleAvatar: v }),
  setOauthToken: (v) => set({ oauthToken: v }),
  setXBrowserValidation: (v) => set({ xBrowserValidation: v }),
  setXClientData: (v) => set({ xClientData: v }),
  setWorkerName: (v) => set({ workerName: v }),
  setHubApiKey: (v) => set({ hubApiKey: v }),
  setProviderApiKeys: (v) => applySetter(set, 'providerApiKeys', v),
  setProviderEnabled: (v) => applySetter(set, 'providerEnabled', v),
  setSelectedProvider: (v) => set({ selectedProvider: v }),

  setJobs: (v) => applySetter(set, 'jobs', v),
  setFailedHosts: (v) => applySetter(set, 'failedHosts', v),
  setSelectedJobForModal: (v) => set({ selectedJobForModal: v }),
  setIsFetchingJobs: (v) => set({ isFetchingJobs: v }),
  setJobStatusFilter: (v) => set({ jobStatusFilter: v }),
  setJobSearchQuery: (v) => set({ jobSearchQuery: v }),
  setJobProviderFilter: (v) => set({ jobProviderFilter: v }),

  setDreaminaAccounts: (v) => set({ dreaminaAccounts: v }),
  setPicsartAccounts: (v) => set({ picsartAccounts: v }),
  setTopviewAccounts: (v) => set({ topviewAccounts: v }),
  setGflowAccounts: (v) => set({ gflowAccounts: v }),
  setActiveEmails: (v) => applySetter(set, 'activeEmails', v),
  setHideLowPoints: (v) => set({ hideLowPoints: v }),
  setIsSyncingAccounts: (v) => set({ isSyncingAccounts: v }),
  setVerifyingEmail: (v) => set({ verifyingEmail: v }),
  setCurrentDreaminaEmail: (v) => set({ currentDreaminaEmail: v }),
  setDreaminaExecutionMode: (v) => set({ dreaminaExecutionMode: v }),
  setAutoSwitchEnabled: (v) => set({ autoSwitchEnabled: v }),
  setActiveExecutor: (v) => set({ activeExecutor: v }),
  setRotationLog: (v) => set({ rotationLog: v }),

  setActiveTab: (v) => set({ activeTab: v }),
  setSidepanelTab: (v) => set({ sidepanelTab: v }),
  setShowApiKey: (v) => set({ showApiKey: v }),
  setShowVaultHeaders: (v) => set({ showVaultHeaders: v }),

  hydrateFromStorage: (data) => {
    const patch: Partial<ExtensionState> = {};
    if (data.gflowUrl) patch.gflowUrl = data.gflowUrl;
    if (data.workerState) patch.workerState = data.workerState;
    if (data.googleEmail) patch.googleEmail = data.googleEmail;
    if (data.googleAvatar) patch.googleAvatar = data.googleAvatar;
    if (data.oauthToken) patch.oauthToken = data.oauthToken;
    if (data.xBrowserValidation) patch.xBrowserValidation = data.xBrowserValidation;
    if (data.xClientData) patch.xClientData = data.xClientData;
    if (data.workerName) patch.workerName = data.workerName;
    if (Array.isArray(data.recent_jobs_list)) patch.jobs = data.recent_jobs_list;
    if (data.selected_provider) patch.selectedProvider = data.selected_provider;
    if (data.active_emails) patch.activeEmails = data.active_emails;
    if (typeof data.hide_low_points === 'boolean') patch.hideLowPoints = data.hide_low_points;
    if (data.active_executor) patch.activeExecutor = data.active_executor;
    if (Array.isArray(data.rotation_log)) patch.rotationLog = data.rotation_log;
    if (Array.isArray(data.dreamina_accounts)) patch.dreaminaAccounts = data.dreamina_accounts;
    if (Array.isArray(data.picsart_accounts)) patch.picsartAccounts = data.picsart_accounts;
    if (Array.isArray(data.topview_accounts)) patch.topviewAccounts = data.topview_accounts;
    if (Array.isArray(data.gflow_accounts)) patch.gflowAccounts = data.gflow_accounts;
    if (data.dreamina_execution_mode) patch.dreaminaExecutionMode = data.dreamina_execution_mode;
    if (data.current_dreamina_email) patch.currentDreaminaEmail = data.current_dreamina_email;
    if (typeof data.auto_switch_enabled === 'boolean') patch.autoSwitchEnabled = data.auto_switch_enabled !== false;
    if (data.provider_enabled && typeof data.provider_enabled === 'object') {
      patch.providerEnabled = {
        GFLOW: data.provider_enabled.GFLOW !== false,
        'VIDTORY-SDK': data.provider_enabled['VIDTORY-SDK'] !== false,
        DREAMINA: data.provider_enabled.DREAMINA !== false,
        VERTEX: data.provider_enabled.VERTEX !== false,
        'GEMINI-NATIVE': data.provider_enabled['GEMINI-NATIVE'] !== false,
      };
    }

    patch.providerApiKeys = {
      DREAMINA: data.dreamina_api_key || data.hub_api_key || '',
      PICSART: data.picsart_api_key || data.hub_api_key || '',
      TOPVIEW: data.topview_api_key || data.hub_api_key || '',
      GFLOW: data.gflow_api_key || data.hub_api_key || '',
    };
    const sel = (data.selected_provider || 'DREAMINA') as ProviderId;
    patch.hubApiKey = patch.providerApiKeys[sel] || data.hub_api_key || '';

    set(patch);
  },
}));
