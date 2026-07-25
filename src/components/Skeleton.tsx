export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-lg ${className}`} />;
}

export function JobListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-slate-900/40 border border-slate-850 rounded-xl p-3 space-y-3">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-12 ml-auto" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="w-[70px] h-[70px] shrink-0 rounded-lg" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-7 flex-1" />
            <Skeleton className="h-7 flex-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AccountListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-3 rounded-xl border border-slate-900 bg-slate-950/40 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-4 w-10" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SidepanelJobSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-slate-950/60 border border-slate-900 rounded-lg p-2 space-y-1.5">
          <div className="flex justify-between">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-12" />
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
