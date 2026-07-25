import { AlertCircle } from 'lucide-react';
import { AccountTierBadge } from './AccountTierBadge';
import { AccountListSkeleton } from './Skeleton';
import { getLowPointsThreshold, type ProviderAccount } from '../types/extension';

export function ProviderAccountsColumn({
  accounts,
  provider,
  activeEmail,
  hideLowPoints,
  verifyingEmail,
  isLoading,
  onSwitch,
  onRelease,
}: {
  accounts: ProviderAccount[];
  provider: string;
  activeEmail: string;
  hideLowPoints: boolean;
  verifyingEmail: string | null;
  isLoading?: boolean;
  onSwitch: (provider: string, email: string, cookieStr: string) => void;
  onRelease: (provider: string, email: string) => void;
}) {
  if (isLoading) {
    return <AccountListSkeleton count={4} />;
  }

  const threshold = getLowPointsThreshold(provider);
  const visibleAccounts = accounts.filter((a) => {
    if (hideLowPoints) {
      return a.points >= threshold && a.status !== 'LOW_CREDIT';
    }
    return true;
  });

  if (visibleAccounts.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl space-y-2">
        <AlertCircle className="w-5 h-5 text-slate-650 mx-auto" />
        <p className="text-[10px] text-slate-500">Không có tài khoản nào.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
      {visibleAccounts.map((acc) => {
        const isActive = (activeEmail || '').toLowerCase() === acc.email.toLowerCase();
        const isLow = acc.points < threshold || acc.points <= 0 || acc.status === 'LOW_CREDIT';

        return (
          <div
            key={acc.email}
            className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
              isActive
                ? 'bg-indigo-955/15 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                : 'bg-slate-950/40 border-slate-900 hover:border-slate-850'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isActive ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'
                    }`}
                  />
                  <p
                    className={`text-xs font-bold truncate ${isActive ? 'text-indigo-405' : 'text-slate-355'}`}
                    title={acc.email}
                  >
                    {acc.email}
                  </p>
                </div>
                <span
                  className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded shrink-0 ${
                    isLow
                      ? 'bg-rose-955/50 border border-rose-500/20 text-rose-455'
                      : 'bg-emerald-955/50 border border-emerald-500/20 text-emerald-450'
                  }`}
                >
                  {acc.points} P
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <AccountTierBadge acc={acc} provider={provider} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/40">
              <span className="text-[9px] text-slate-500 font-medium">
                {acc.lastChecked ? `Checked: ${new Date(acc.lastChecked).toLocaleTimeString()}` : 'Chưa verify'}
              </span>

              <div className="flex gap-1.5">
                {isActive ? (
                  <button
                    onClick={() => onRelease(provider, acc.email)}
                    className="bg-slate-850 hover:bg-slate-755 text-slate-300 text-[9px] font-extrabold px-2 py-0.5 rounded transition-all active:scale-95"
                  >
                    Release
                  </button>
                ) : (
                  <button
                    onClick={() => onSwitch(provider, acc.email, acc.cookieStr)}
                    disabled={verifyingEmail !== null}
                    className="bg-indigo-650 hover:bg-indigo-600 disabled:opacity-50 text-white text-[9px] font-extrabold px-2 py-0.5 rounded active:scale-95 transition-all"
                  >
                    {verifyingEmail === acc.email ? 'Switching...' : 'Switch'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
