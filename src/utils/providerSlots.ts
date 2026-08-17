export const DEFAULT_PROVIDER_MAX_SLOTS: Record<string, number> = {
  GFLOW: 2,
  'VIDTORY-SDK': 2,
  DREAMINA: 1,
  VERTEX: 1,
  'GEMINI-NATIVE': 1,
};

export function normalizeProvider(value: string): string {
  const normalized = String(value || 'GFLOW').trim().toUpperCase().replace(/[_\s]+/g, '-');
  if (normalized === 'GOOGLE-FLOW' || normalized === 'GOOGLE-FLOW-ULTRA' || normalized === 'GOOGLE-LABS-ULTRA') return 'GFLOW';
  if (normalized === 'VIDTORY') return 'VIDTORY-SDK';
  if (normalized === 'GOOGLE-NATIVE' || normalized === 'GEMINI' || normalized === 'GEMINI-AUTO' || normalized === 'IMAGEN') return 'GEMINI-NATIVE';
  if (normalized === 'GOOGLE-VERTEX' || normalized === 'VERTEX-AI') return 'VERTEX';
  return normalized;
}

export class ProviderSlotRegistry {
  private limits = { ...DEFAULT_PROVIDER_MAX_SLOTS };
  private enabled: Record<string, boolean> = Object.fromEntries(
    Object.keys(DEFAULT_PROVIDER_MAX_SLOTS).map(provider => [provider, true]),
  );
  private jobs = new Map<string, Set<string>>();

  configure(config?: Record<string, number>, enabled?: Record<string, boolean>) {
    for (const [provider, value] of Object.entries(config || {})) {
      const limit = Number(value);
      if (Number.isFinite(limit) && limit >= 0) this.limits[normalizeProvider(provider)] = Math.floor(limit);
    }
    for (const [provider, value] of Object.entries(enabled || {})) {
      this.enabled[normalizeProvider(provider)] = value !== false;
    }
  }

  tryAcquire(providerValue: string, taskId: string): boolean {
    const provider = normalizeProvider(providerValue);
    if (!this.isEnabled(provider)) return false;
    const active = this.jobs.get(provider) || new Set<string>();
    if (active.has(taskId)) return true;
    if (active.size >= this.maxSlots(provider)) return false;
    active.add(taskId);
    this.jobs.set(provider, active);
    return true;
  }

  release(taskId: string): boolean {
    for (const active of this.jobs.values()) if (active.delete(taskId)) return true;
    return false;
  }

  maxSlots(providerValue: string): number {
    const provider = normalizeProvider(providerValue);
    if (!this.isEnabled(provider)) return 0;
    return this.limits[provider] ?? 1;
  }

  isEnabled(providerValue: string): boolean {
    return this.enabled[normalizeProvider(providerValue)] !== false;
  }

  currentJobs(): string[] {
    return [...this.jobs.values()].flatMap(active => [...active]);
  }

  providerCurrentJobs(): Record<string, string[]> {
    return Object.fromEntries([...this.jobs.entries()].map(([provider, active]) => [provider, [...active]]));
  }

  activeCount(providerValue?: string): number {
    if (providerValue) return this.jobs.get(normalizeProvider(providerValue))?.size || 0;
    return this.currentJobs().length;
  }

  hasTask(taskId: string): boolean {
    for (const active of this.jobs.values()) if (active.has(taskId)) return true;
    return false;
  }

  providerMaxSlots(): Record<string, number> {
    return Object.fromEntries(Object.keys(this.limits).map(provider => [provider, this.maxSlots(provider)]));
  }

  disabledProviders(): string[] {
    return Object.keys(this.limits).filter(provider => !this.isEnabled(provider));
  }
}
