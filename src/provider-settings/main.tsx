import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';

const PROVIDERS = [
  { id: 'GFLOW', label: 'Google Flow', note: 'Extension pool' },
  { id: 'VIDTORY-SDK', label: 'Vidtory', note: 'SDK / Hub' },
  { id: 'DREAMINA', label: 'Dreamina', note: 'Cần account active' },
  { id: 'VERTEX', label: 'Vertex Image', note: 'Có thể phát sinh phí' },
  { id: 'GEMINI-NATIVE', label: 'Gemini Image', note: 'Có thể phát sinh phí' },
] as const;

type ProviderState = Record<string, boolean>;

function defaults(value: ProviderState = {}): ProviderState {
  return Object.fromEntries(PROVIDERS.map(provider => [provider.id, value[provider.id] !== false]));
}

function gatewayBase(value: unknown): string {
  return String(value || 'https://dev-hub.storymee.com').replace(/\/+$/, '');
}

function ProviderSettings() {
  const [enabled, setEnabled] = useState<ProviderState>(defaults());
  const [message, setMessage] = useState('');
  const [adminKey, setAdminKey] = useState('');

  useEffect(() => {
    chrome.storage.local.get(['provider_enabled', 'provider_policy_admin_key']).then(data => {
      setEnabled(defaults((data.provider_enabled || {}) as ProviderState));
      setAdminKey(String(data.provider_policy_admin_key || ''));
    });
  }, []);

  const saveLocal = async (id: string, value: boolean) => {
    const next = { ...enabled, [id]: value };
    setEnabled(next);
    await chrome.storage.local.set({ provider_enabled: next });
    await chrome.runtime.sendMessage({ type: 'WS_REREGISTER' }).catch(() => undefined);
    setMessage(`${id} ${value ? 'đã bật' : 'đã tắt'} trên worker này.`);
  };

  const requestPolicy = async (method: 'GET' | 'PATCH') => {
    const data = await chrome.storage.local.get(['gflowUrl']);
    const apiKey = adminKey.trim();
    if (!apiKey) throw new Error('Cần nhập Hub System Admin key.');
    await chrome.storage.local.set({ provider_policy_admin_key: apiKey });
    const response = await fetch(`${gatewayBase(data.gflowUrl)}/internal/v1/jobs/providers/policy`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey },
      ...(method === 'PATCH' ? {
        body: JSON.stringify({
          disabledImageProviders: Object.entries(enabled)
            .filter(([, value]) => value === false)
            .map(([provider]) => provider.toLowerCase()),
        }),
      } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 403
      ? 'Key hiện tại không phải system-admin.'
      : body?.message || `Backend trả HTTP ${response.status}`);
    return body;
  };

  const loadBackend = async () => {
    try {
      const body = await requestPolicy('GET');
      const disabled = new Set((body?.data?.disabledImageProviders || []).map((value: unknown) => String(value).toUpperCase()));
      const next = Object.fromEntries(PROVIDERS.map(provider => [provider.id, !disabled.has(provider.id)]));
      setEnabled(next);
      await chrome.storage.local.set({ provider_enabled: next });
      setMessage('Đã tải policy backend và áp dụng cho worker.');
    } catch (error) { setMessage(`Lỗi: ${(error as Error).message}`); }
  };

  const syncBackend = async () => {
    try {
      await requestPolicy('PATCH');
      setMessage('Đã đồng bộ kill-switch lên backend.');
    } catch (error) { setMessage(`Lỗi: ${(error as Error).message}`); }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <section className="mx-auto max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Provider kill-switch</h1>
          <p className="text-sm text-slate-400 mt-1">Tắt local quảng bá 0 slot. Đồng bộ backend chặn cả fallback Vertex/Gemini trả phí.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {PROVIDERS.map(provider => {
            const active = enabled[provider.id] !== false;
            return (
              <div key={provider.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <div><p className="font-bold">{provider.label}</p><p className="text-xs text-slate-500">{provider.note}</p></div>
                <button type="button" role="switch" aria-checked={active} onClick={() => saveLocal(provider.id, !active)}
                  className={`w-11 h-6 rounded-full relative ${active ? 'bg-emerald-600' : 'bg-slate-700'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white ${active ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={loadBackend} className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-bold">Đọc backend</button>
          <button type="button" onClick={syncBackend} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold">Đồng bộ backend (Admin)</button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-slate-300">Hub System Admin key</span>
          <input type="password" value={adminKey} onChange={event => setAdminKey(event.target.value)}
            placeholder="Chỉ dùng để đọc/đồng bộ global policy"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500" />
        </label>
        <p className="text-xs text-slate-400">{message || 'Worker key không được nâng quyền; global policy bắt buộc system-admin.'}</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ProviderSettings /></React.StrictMode>);
