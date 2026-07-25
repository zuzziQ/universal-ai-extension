import { memo, useState } from 'react';
import { AlertCircle, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import type { SavedJob, ToastKind } from '../types/extension';

export const JobCard = memo(function JobCard({
  job,
  copyToClipboard,
  onMediaError,
  onViewDetails,
  onSwitchAccount,
  notify,
}: {
  job: SavedJob;
  copyToClipboard: (text: string) => void;
  onMediaError?: (url: string) => void;
  onViewDetails: (job: SavedJob) => void;
  onSwitchAccount?: (provider: string, email: string) => void;
  notify?: (message: string, kind?: ToastKind) => void;
}) {
  const [mediaError, setMediaError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [videoArmed, setVideoArmed] = useState(false);
  const isVideo = job.mediaType === 'video';

  const handleMediaError = () => {
    setMediaError(true);
    if (onMediaError && job.resultUrl) {
      onMediaError(job.resultUrl);
    }
  };

  // Trạng thái đường viền bên trái (status border)
  const borderStatusClass = 
    job.status === 'done' ? 'border-l-[3px] border-l-emerald-500' :
    job.status === 'failed' ? 'border-l-[3px] border-l-rose-500' :
    job.status === 'processing' ? 'border-l-[3px] border-l-amber-500 animate-pulse' :
    'border-l-[3px] border-l-slate-700';

  // Cập nhật phân loại nguồn giống Hub Frontend
  const inputParams = job.inputParams || {};
  const frontendApp = (inputParams.frontendApp || inputParams.frontend_app || '').toLowerCase();
  const projectName = (inputParams.projectName || inputParams.project_name || job.batchName || '').toLowerCase();
  
  let frontendName = 'Hệ Thống Mẹ';
  if (frontendApp.includes('flow-architect') || projectName.includes('flow-architect')) frontendName = 'Flow Architect';
  else if (frontendApp.includes('world-asset') || projectName.includes('world-asset')) frontendName = 'World Asset';
  else if (frontendApp.includes('direct') || frontendApp.includes('web') || projectName.includes('web') || projectName.includes('capcut')) frontendName = 'Direct Web';

  const clientApiKeyStr = inputParams.clientApiKey || '';
  let poolName = 'Internal';
  if ((job.pool || inputParams.pool || '').toLowerCase() === 'partner' || clientApiKeyStr.toLowerCase().includes('partner')) {
      poolName = 'Partner';
  }

  let category = 'LLM';
  const type = (inputParams.jobType || job.mediaType || '').toLowerCase();
  if (type === 'video' || type.includes('video')) category = 'Video';
  else if (type === 'image' || type.includes('image')) category = 'Image';

  // Badges provider colors
  const providerUpper = (job.provider || 'Hub').toUpperCase();
  let providerBadgeClass = 'bg-slate-950 border border-slate-855 text-indigo-400';
  if (providerUpper === 'DREAMINA') {
    providerBadgeClass = 'bg-purple-955/40 text-purple-400 border border-purple-500/20';
  } else if (providerUpper === 'GFLOW' || providerUpper === 'GOOGLE_FLOW') {
    providerBadgeClass = 'bg-emerald-955/40 text-emerald-400 border border-emerald-500/20';
  } else if (providerUpper === 'PICSART') {
    providerBadgeClass = 'bg-blue-955/40 text-blue-400 border border-blue-500/20';
  } else if (providerUpper === 'TOPVIEW') {
    providerBadgeClass = 'bg-amber-955/40 text-amber-400 border border-amber-500/20';
  }

  // Trạng thái hiển thị showcase ở góc phải
  let mediaShowcaseHtml;
  if (job.status === 'done' && job.resultUrl) {
    if (isVideo) {
      mediaShowcaseHtml = mediaError ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-500" title="Lỗi tải video">
          <AlertCircle className="w-4 h-4 text-amber-500" />
        </div>
      ) : videoArmed ? (
        <video 
          src={job.resultUrl} 
          className="w-full h-full object-cover cursor-pointer hover:scale-110 transition-transform duration-200" 
          onError={handleMediaError}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          controls={false}
          onClick={() => onViewDetails(job)}
          {...{ referrerPolicy: "no-referrer" }}
        />
      ) : (
        <button
          type="button"
          className="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-slate-950 text-slate-400 hover:text-indigo-300 hover:bg-slate-900 transition-colors cursor-pointer"
          title="Phát preview video"
          onClick={(e) => {
            e.stopPropagation();
            setVideoArmed(true);
          }}
        >
          <span className="text-base leading-none">▶</span>
          <span className="text-[8px] font-bold uppercase">Video</span>
        </button>
      );
    } else if (job.mediaType === 'image' && !job.resultUrl.startsWith('{') && !job.resultUrl.startsWith('[')) {
      mediaShowcaseHtml = mediaError ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-500" title="Lỗi tải ảnh">
          <AlertCircle className="w-4 h-4 text-amber-500" />
        </div>
      ) : (
        <img 
          src={job.resultUrl} 
          alt="Preview" 
          className="w-full h-full object-cover cursor-pointer hover:scale-110 transition-transform duration-200" 
          onError={handleMediaError}
          onClick={() => onViewDetails(job)}
          referrerPolicy="no-referrer"
        />
      );
    } else {
      mediaShowcaseHtml = (
        <div className="w-full h-full flex items-center justify-center bg-slate-955 text-slate-400 text-[8px] font-mono p-1 break-all overflow-hidden text-ellipsis" onClick={() => onViewDetails(job)}>
          TXT
        </div>
      );
    }
  } else if (job.status === 'processing') {
    mediaShowcaseHtml = <div className="text-amber-400 text-xs animate-pulse">⏳</div>;
  } else if (job.status === 'failed') {
    mediaShowcaseHtml = <div className="text-rose-400 text-xs">❌</div>;
  } else {
    mediaShowcaseHtml = <div className="text-slate-500 text-xs">🕐</div>;
  }

  return (
    <div className={`bg-slate-900/40 border border-slate-850 hover:border-slate-800 rounded-xl p-3 flex flex-col gap-2 transition-all duration-200 shadow-md ${borderStatusClass}`}>
      {/* Row 1: Badges & Status */}
      <div className="flex justify-between items-center gap-2 w-full">
        <div className="flex flex-wrap items-center gap-1">
          {/* Frontend */}
          <span className="bg-slate-800/80 text-slate-300 border border-slate-700/50 text-[8.5px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
            💻 {frontendName}
          </span>
          {/* Pool Badge */}
          <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-extrabold uppercase ${
            poolName === 'Partner' 
              ? 'bg-amber-955/45 text-amber-400 border border-amber-500/20' 
              : 'bg-slate-800/80 text-slate-400 border border-slate-700/50'
          }`}>
            {poolName === 'Partner' ? '🤝 Partner' : '🏠 Internal'}
          </span>
          {/* Category Badge */}
          <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-extrabold uppercase ${
            category === 'Video' 
              ? 'bg-purple-955/45 text-purple-400 border border-purple-500/20' 
              : category === 'Image'
                ? 'bg-emerald-955/45 text-emerald-400 border border-emerald-500/20'
                : 'bg-blue-955/45 text-blue-400 border border-blue-500/20'
          }`}>
            {category === 'Video' ? '🎥 Video' : category === 'Image' ? '🖼️ Image' : category}
          </span>
          {/* Provider */}
          <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-extrabold uppercase ${providerBadgeClass}`}>
            {providerUpper}
          </span>
        </div>

        {/* Status Badge */}
        <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-extrabold uppercase ${
          job.status === 'done' ? 'bg-emerald-955/80 text-emerald-400 border border-emerald-900/30' :
          job.status === 'failed' ? 'bg-rose-955/80 text-rose-455 border border-rose-900/30' :
          'bg-amber-955/80 text-amber-400 border border-amber-900/30 animate-pulse'
        }`}>
          {job.status}
        </span>
      </div>

      {/* Row 2: Prompt + Params & Preview (Side by Side) */}
      <div className="flex gap-3 items-start w-full">
        {/* Cột trái: Prompt & Params */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {/* Prompt */}
          <div className="text-xs font-semibold text-slate-202 italic leading-relaxed">
            <span 
              style={isExpanded ? {} : {
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              className="mb-1 block"
            >
              "{job.prompt}"
            </span>
            <div className="flex gap-2">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-bold text-[9px] hover:underline cursor-pointer inline-block"
              >
                {isExpanded ? '[Thu gọn]' : '[Xem thêm]'}
              </button>
              <button 
                onClick={() => onViewDetails(job)}
                className="text-slate-400 hover:text-slate-350 font-bold text-[9px] hover:underline cursor-pointer inline-block"
              >
                [Chi tiết]
              </button>
            </div>
          </div>

          {/* Reference Images Row */}
          {(() => {
            const refImg = job.inputParams?.reference_image || job.inputParams?.referenceImage;
            const refUrls = job.inputParams?.reference_image_urls || job.inputParams?.referenceImageUrls;
            const refImages: string[] = [];
            if (refImg && typeof refImg === 'string' && refImg.startsWith('http')) {
              refImages.push(refImg);
            }
            if (Array.isArray(refUrls)) {
              refUrls.forEach((u: any) => {
                if (typeof u === 'string' && u.startsWith('http') && !refImages.includes(u)) {
                  refImages.push(u);
                }
              });
            }
            if (refImages.length === 0) return null;
            return (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[8px] text-slate-500 font-bold uppercase">Refs:</span>
                <div className="flex gap-1">
                  {refImages.map((imgUrl, idx) => (
                    <div key={idx} className="w-6 h-6 rounded overflow-hidden border border-white/10 bg-slate-950 flex-shrink-0 cursor-zoom-in group relative">
                      <img 
                        src={imgUrl} 
                        alt={`Ref ${idx}`} 
                        className="w-full h-full object-cover hover:scale-125 transition-transform" 
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(imgUrl, '_blank');
                        }}
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Expanded parameters */}
          {isExpanded && job.inputParams && (
            <div className="mt-1 p-2 bg-slate-955/80 rounded-lg border border-slate-850 font-mono text-[9px] text-slate-400 space-y-1 overflow-x-auto max-w-full">
              <div className="font-bold text-slate-350 mb-0.5 uppercase text-[8px] tracking-wider">Parameters:</div>
              {Object.entries(job.inputParams).map(([key, val]) => {
                if (key === 'prompt' || key === 'reference_image' || key === 'reference_image_urls' || key === 'reference_image_roles') return null;
                if (val === null || val === undefined || val === '') return null;
                return (
                  <div key={key} className="flex justify-between gap-2 border-b border-slate-900/50 pb-0.5">
                    <span className="text-slate-555">{key}:</span>
                    <span className="text-slate-350 truncate max-w-[150px]" title={String(val)}>
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Inline Parameter Tags */}
          <div className="flex flex-wrap gap-1">
            {job.modelDisp && (
              <span className="text-[8.5px] bg-slate-950/60 text-slate-400 border border-slate-850 px-1.5 py-0.5 rounded font-mono" title="Model">
                📐 {job.modelDisp}
              </span>
            )}
            {job.ratioDisp && (
              <span className="text-[8.5px] bg-slate-950/60 text-slate-400 border border-slate-850 px-1.5 py-0.5 rounded font-mono" title="Ratio">
                🖼️ {job.ratioDisp}
              </span>
            )}
            {job.durationDisp && job.durationDisp !== '—' && (
              <span className="text-[8.5px] bg-slate-950/60 text-slate-400 border border-slate-850 px-1.5 py-0.5 rounded font-mono" title="Duration">
                ⏱️ {job.durationDisp}
              </span>
            )}
            {job.batchName && (
              <span className="text-[8.5px] bg-slate-950/30 text-slate-400 border border-slate-900/40 px-1.5 py-0.5 rounded font-mono truncate max-w-[120px]" title={`Batch: ${job.batchName}`}>
                📦 {job.batchName}
              </span>
            )}
          </div>
        </div>

        {/* Cột phải: Media Showcase */}
        <div className="w-[70px] h-[70px] flex-shrink-0 bg-black/40 border border-white/5 rounded-lg overflow-hidden flex items-center justify-center relative">
          {mediaShowcaseHtml}
        </div>
      </div>

      {/* Error message (nếu có) */}
      {job.error && (
        <div className="text-[9px] text-rose-400 italic bg-rose-955/10 p-1.5 rounded border border-rose-500/10 break-words leading-tight w-full">
          <strong>Lỗi:</strong> {job.error}
        </div>
      )}

      {/* Row 3: Meta info (ID & Email badge) */}
      <div className="flex justify-between items-center gap-2 border-t border-slate-800/30 pt-1.5 text-[10px] w-full">
        <span className="text-[8px] font-mono text-slate-500 truncate" title={job.id}>
          ID: {job.id.substring(0, 8)}...
        </span>
        {job.executedBy && (
          <span 
            onClick={() => {
              copyToClipboard(job.executedBy!);
              notify?.(`Đã copy email: ${job.executedBy}`, 'success');
            }}
            className="text-[8px] text-slate-450 truncate max-w-[180px] bg-slate-950 hover:bg-slate-855 border border-slate-850 px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer select-all font-semibold" 
            title={`Click để copy email & tìm kiếm: ${job.executedBy}`}
          >
            👤 {job.executedBy}
          </span>
        )}
      </div>

      {/* Row 4: Action buttons stretched to full width */}
      <div className="flex gap-1.5 w-full mt-1 flex-wrap">
        {job.executedBy && (
          <button
            onClick={() => onSwitchAccount && onSwitchAccount(job.provider, job.executedBy!)}
            className="flex-1 min-w-[70px] bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/30 text-emerald-400 font-bold text-[10px] py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer"
            title="Chuyển nhanh sang tài khoản này"
          >
            <RefreshCw className="w-3 h-3" />
            Switch
          </button>
        )}
        {(providerUpper === 'GFLOW' || providerUpper === 'GOOGLE_FLOW') && (
          <a
            href={job.projectId ? `https://labs.google/fx/tools/flow/project/${job.projectId}` : "https://labs.google/fx/tools/image-fx"}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-w-[70px] bg-indigo-950 hover:bg-indigo-900 border border-indigo-500/30 text-indigo-400 font-bold text-[10px] py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer no-underline"
            title="Mở Project Google Flow"
          >
            <ExternalLink className="w-3 h-3" />
            Project
          </a>
        )}
        {job.resultUrl && (
          <>
            <button
              onClick={() => {
                copyToClipboard(job.resultUrl!);
                notify?.('Đã copy kết quả vào clipboard', 'success');
              }}
              className="flex-1 min-w-[70px] bg-slate-950 hover:bg-slate-850 border border-slate-800 text-[10px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all text-slate-400 hover:text-slate-200 cursor-pointer"
              title="Copy link kết quả"
            >
              <Copy className="w-3 h-3" />
              Copy Link
            </button>
            {(!job.resultUrl.startsWith('{') && !job.resultUrl.startsWith('[') && (job.mediaType === 'video' || job.mediaType === 'image' || job.resultUrl.startsWith('http'))) && (
              <a 
                href={job.resultUrl} 
                target="_blank" 
                rel="noreferrer"
                className="flex-1 min-w-[70px] bg-slate-950 hover:bg-slate-850 border border-slate-800 text-[10px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 transition-all text-slate-202 hover:text-slate-100 text-center no-underline cursor-pointer flex justify-center items-center"
                title="Mở link gốc trong tab mới"
              >
                <ExternalLink className="w-3 h-3" />
                Xem gốc
              </a>
            )}
          </>
        )}
      </div>

      {/* Cảnh báo chi tiết nếu media error */}
      {mediaError && job.resultUrl && (
        <div className="text-[8.5px] text-amber-500 bg-amber-955/10 p-1.5 rounded border border-amber-500/10 mt-1 leading-normal w-full">
          ⚠️ <strong>Lỗi SSL/Hết hạn:</strong> Click <strong>Xem gốc</strong> bên trên để bypass cảnh báo chứng chỉ SSL của Chrome.
        </div>
      )}
    </div>
  );

});
