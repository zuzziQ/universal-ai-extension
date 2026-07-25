export type ProviderId = 'DREAMINA' | 'PICSART' | 'TOPVIEW' | 'GFLOW';
export type ProviderFilter = 'ALL' | ProviderId;
export type JobStatusFilter = 'all' | 'processing' | 'done' | 'failed';
export type ToastKind = 'success' | 'error' | 'info';
export type ToastItem = { id: number; message: string; kind: ToastKind };
/** Full dashboard tabs — settings is a tab (no permanent left sidebar). */
export type DashboardTab = 'jobs' | 'accounts' | 'settings';
export type SidepanelTab = 'status' | 'accounts';

export const PROVIDER_IDS: ProviderId[] = ['DREAMINA', 'PICSART', 'TOPVIEW', 'GFLOW'];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  DREAMINA: 'Dreamina',
  PICSART: 'Picsart',
  TOPVIEW: 'TopView',
  GFLOW: 'Google Flow',
};

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  DREAMINA: 'Dream',
  PICSART: 'Pics',
  TOPVIEW: 'TopV',
  GFLOW: 'GFlow',
};

export const PROVIDER_ACCENT: Record<ProviderId, string> = {
  DREAMINA: 'text-pink-400 border-pink-500/30 bg-pink-950/30',
  PICSART: 'text-violet-400 border-violet-500/30 bg-violet-950/30',
  TOPVIEW: 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30',
  GFLOW: 'text-sky-400 border-sky-500/30 bg-sky-950/30',
};

/** Normalize job/provider aliases → canonical ProviderId or null. */
export function normalizeProviderId(provider: string | undefined | null): ProviderId | null {
  const p = String(provider || '').toUpperCase().replace(/-/g, '_');
  if (!p) return null;
  if (p === 'DREAMINA') return 'DREAMINA';
  if (p === 'PICSART') return 'PICSART';
  if (p === 'TOPVIEW') return 'TOPVIEW';
  if (
    p === 'GFLOW' ||
    p === 'GOOGLE_FLOW' ||
    p === 'GOOGLE_ULTRA' ||
    p === 'GOOGLE_LABS_ULTRA' ||
    p.includes('GOOGLE') ||
    p.includes('LABS')
  ) {
    return 'GFLOW';
  }
  return null;
}

export function matchesProviderFilter(jobProvider: string | undefined, filter: ProviderFilter): boolean {
  if (filter === 'ALL') return true;
  return normalizeProviderId(jobProvider) === filter;
}

export interface SavedJob {
  id: string;
  mediaType: string;
  prompt: string;
  provider: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  timestamp: number;
  resultUrl?: string;
  error?: string;
  projectId?: string;
  projectName?: string;
  projectLink?: string;
  executedBy?: string;
  source?: string;
  pool?: string;
  batchName?: string;
  modelDisp?: string;
  ratioDisp?: string;
  durationDisp?: string;
  inputParams?: any;
}

export interface ProviderAccount {
  email: string;
  cookieStr: string;
  points: number;
  status: string;
  lastChecked?: string | number | null;
  pool?: string;
}

export function formatRatio(ratio: any): string {
  if (!ratio) return '—';
  const r = String(ratio).toUpperCase().trim();
  if (r.includes('PORTRAIT') || r === '9:16') return '9:16';
  if (r.includes('LANDSCAPE') || r === '16:9') return '16:9';
  if (r.includes('SQUARE') || r === '1:1') return '1:1';
  return r;
}

export function getLowPointsThreshold(provider: string): number {
  const up = normalizeProviderId(provider) || provider.toUpperCase();
  if (up === 'DREAMINA') return 4;
  if (up === 'PICSART') return 1;
  if (up === 'TOPVIEW') return 1;
  if (up === 'GFLOW') return 1;
  return 1;
}
