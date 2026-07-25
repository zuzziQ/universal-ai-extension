export function RouteBadge({ gflowUrl }: { gflowUrl: string }) {
  if (
    gflowUrl.includes('localhost') ||
    gflowUrl.includes('127.0.0.1') ||
    gflowUrl.includes('local-hub.storymee.com')
  ) {
    return (
      <span className="text-[8px] font-extrabold uppercase bg-emerald-955/40 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded">
        🏠 Local Route
      </span>
    );
  }
  if (gflowUrl.includes('dev-hub.storymee.com')) {
    return (
      <span className="text-[8px] font-extrabold uppercase bg-blue-955/40 border border-blue-500/30 text-blue-400 px-2 py-0.5 rounded">
        🛠️ Dev Route
      </span>
    );
  }
  if (gflowUrl.includes('173.249.19.167')) {
    return (
      <span className="text-[8px] font-extrabold uppercase bg-amber-955/40 border border-amber-500/30 text-amber-400 px-2 py-0.5 rounded">
        ☁️ VPS Route
      </span>
    );
  }
  return (
    <span className="text-[8px] font-extrabold uppercase bg-purple-955/40 border border-purple-500/30 text-purple-400 px-2 py-0.5 rounded">
      🌐 Prod Route
    </span>
  );
}
