import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  PROVIDER_SHORT,
  type ProviderFilter,
  type ProviderId,
} from '../types/extension';

export function ProviderFilterBar({
  value,
  onChange,
  counts,
  size = 'md',
  showAll = true,
  compactLabels = false,
}: {
  value: ProviderFilter;
  onChange: (v: ProviderFilter) => void;
  counts?: Partial<Record<ProviderFilter, number>>;
  size?: 'sm' | 'md';
  showAll?: boolean;
  compactLabels?: boolean;
}) {
  const pad = size === 'sm' ? 'px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[11px]';
  const items: ProviderFilter[] = showAll ? ['ALL', ...PROVIDER_IDS] : [...PROVIDER_IDS];

  return (
    <div className="flex flex-wrap gap-1 p-1 bg-slate-950/80 border border-slate-800 rounded-xl">
      {items.map((prov) => {
        const active = value === prov;
        const label =
          prov === 'ALL'
            ? 'Tất cả'
            : compactLabels
              ? PROVIDER_SHORT[prov as ProviderId]
              : PROVIDER_LABELS[prov as ProviderId];
        const count = counts?.[prov];
        return (
          <button
            key={prov}
            type="button"
            onClick={() => onChange(prov)}
            className={`${pad} font-extrabold uppercase rounded-lg transition-all border inline-flex items-center gap-1.5 ${
              active
                ? 'bg-indigo-600 text-white border-indigo-500/40 shadow-sm shadow-indigo-600/20'
                : 'text-slate-400 hover:text-slate-100 border-transparent hover:bg-slate-900'
            }`}
          >
            <span>{label}</span>
            {typeof count === 'number' && (
              <span
                className={`min-w-[1.25rem] text-center rounded-full px-1 py-0.5 text-[9px] font-black ${
                  active ? 'bg-white/15 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function JobStatusFilterBar({
  value,
  onChange,
  counts,
}: {
  value: 'all' | 'processing' | 'done' | 'failed';
  onChange: (v: 'all' | 'processing' | 'done' | 'failed') => void;
  counts?: Partial<Record<'all' | 'processing' | 'done' | 'failed', number>>;
}) {
  const items: Array<{ id: 'all' | 'processing' | 'done' | 'failed'; label: string }> = [
    { id: 'all', label: 'Tất cả' },
    { id: 'processing', label: 'Đang chạy' },
    { id: 'done', label: 'Xong' },
    { id: 'failed', label: 'Lỗi' },
  ];

  return (
    <div className="flex flex-wrap gap-1 p-1 bg-slate-950/80 border border-slate-800 rounded-xl">
      {items.map(({ id, label }) => {
        const active = value === id;
        const count = counts?.[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`px-3 py-1.5 text-[11px] font-extrabold uppercase rounded-lg transition-all border inline-flex items-center gap-1.5 ${
              active
                ? id === 'failed'
                  ? 'bg-rose-600/90 text-white border-rose-500/40'
                  : id === 'done'
                    ? 'bg-emerald-600/90 text-white border-emerald-500/40'
                    : id === 'processing'
                      ? 'bg-amber-600/90 text-white border-amber-500/40'
                      : 'bg-slate-700 text-white border-slate-600'
                : 'text-slate-400 hover:text-slate-100 border-transparent hover:bg-slate-900'
            }`}
          >
            <span>{label}</span>
            {typeof count === 'number' && (
              <span className={`min-w-[1.25rem] text-center rounded-full px-1 py-0.5 text-[9px] font-black ${
                active ? 'bg-white/15' : 'bg-slate-800 text-slate-400'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
