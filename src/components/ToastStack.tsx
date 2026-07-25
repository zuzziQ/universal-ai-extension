import type { ToastItem } from '../types/extension';

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[200] flex flex-col gap-2 max-w-[min(320px,calc(100vw-1.5rem))] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-toast-in pointer-events-auto rounded-lg border px-3 py-2 text-[11px] font-semibold shadow-lg backdrop-blur-md ${
            t.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-300'
              : t.kind === 'error'
                ? 'bg-rose-950/90 border-rose-500/30 text-rose-300'
                : 'bg-slate-900/95 border-slate-700 text-slate-200'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
