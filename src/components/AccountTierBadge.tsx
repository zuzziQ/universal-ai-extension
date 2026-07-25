import type { ProviderAccount } from '../types/extension';

export function AccountTierBadge({ acc, provider }: { acc: ProviderAccount; provider: string }) {
  const provUpper = provider.toUpperCase();
  if (provUpper === 'GFLOW') {
    const isUltra =
      acc.points >= 1000 ||
      acc.email.toLowerCase().includes('ultra') ||
      acc.email.toLowerCase().includes('labs') ||
      acc.cookieStr?.includes('ultra');
    if (isUltra) {
      return (
        <span className="text-[9px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-rose-500 text-white px-2 py-0.5 rounded-full shadow-sm">
          Google Ultra
        </span>
      );
    }
    return (
      <span className="text-[9px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
        Google Standard
      </span>
    );
  }

  if (provUpper === 'DREAMINA') {
    const isVip =
      acc.points >= 900 ||
      acc.email.toLowerCase().includes('pro') ||
      acc.email.toLowerCase().includes('vip') ||
      acc.pool === 'vip';
    if (isVip) {
      return (
        <span className="text-[9px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-2 py-0.5 rounded-full shadow-sm">
          Dreamina VIP
        </span>
      );
    }
    return (
      <span className="text-[9px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
        Dreamina Free
      </span>
    );
  }

  if (provUpper === 'PICSART') {
    const isPro =
      acc.points >= 50 || acc.email.toLowerCase().includes('pro') || acc.email.toLowerCase().includes('gold');
    if (isPro) {
      return (
        <span className="text-[9px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white px-2 py-0.5 rounded-full shadow-sm">
          Picsart Gold
        </span>
      );
    }
    return (
      <span className="text-[9px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
        Picsart Free
      </span>
    );
  }

  if (provUpper === 'TOPVIEW') {
    const isPro =
      acc.points >= 10 || acc.email.toLowerCase().includes('pro') || acc.email.toLowerCase().includes('vip');
    if (isPro) {
      return (
        <span className="text-[9px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-2 py-0.5 rounded-full shadow-sm">
          TopView Pro
        </span>
      );
    }
    return (
      <span className="text-[9px] font-extrabold uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
        TopView Standard
      </span>
    );
  }

  return null;
}
