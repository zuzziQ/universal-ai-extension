// Content script running in MAIN world on dreamina.capcut.com
console.log("[Universal Ext] Main World interceptor loaded on Dreamina");

const originalFetch = window.fetch;

function findValueByKey(obj: any, targetKeys: string[]): any {
  if (!obj || typeof obj !== 'object') return null;
  
  for (const key of targetKeys) {
    if (obj[key] && typeof obj[key] === 'string' && obj[key].trim() !== '' && obj[key] !== '—') {
      return obj[key];
    }
  }

  for (const k of Object.keys(obj)) {
    try {
      if (typeof obj[k] === 'object') {
        const found = findValueByKey(obj[k], targetKeys);
        if (found) return found;
      }
    } catch (_) {}
  }

  return null;
}

function parseGenerateRequestBody(bodyObj: any) {
  try {
    const submitId = bodyObj.submit_id;
    let draftContent = bodyObj.draft_content;
    if (typeof draftContent === 'string') {
      draftContent = JSON.parse(draftContent);
    }
    
    let prompt = findValueByKey(draftContent || bodyObj, ['prompt', 'text', 'script']) || '';
    let model = findValueByKey(draftContent || bodyObj, ['model', 'model_id', 'model_req_key']) || '';
    let aspectRatio = findValueByKey(draftContent || bodyObj, ['resolution_type', 'aspect_ratio', 'video_aspect_ratio']) || '';

    const component = draftContent?.component_list?.[0];
    const generateType = component?.generate_type;
    const isVideo = generateType === 'gen_video' || JSON.stringify(draftContent || bodyObj).toLowerCase().includes('video');

    if (!prompt && component) {
      const abilities = component.abilities || {};
      if (generateType === 'gen_video') {
        const videoParams = abilities.gen_video?.text_to_video_params || {};
        const inputs = videoParams.video_gen_inputs || [];
        prompt = inputs[0]?.prompt || '';
        model = videoParams.model_req_key || '';
        aspectRatio = videoParams.video_aspect_ratio || '';
      } else {
        const coreParam = abilities.generate?.core_param || {};
        prompt = coreParam.prompt || '';
        model = coreParam.model || '';
        aspectRatio = coreParam.large_image_info?.resolution_type || '';
      }
    }

    return {
      submitId,
      prompt: prompt || '—',
      jobType: isVideo ? 'video' : 'image',
      model: model || 'auto',
      aspectRatio: aspectRatio || '—'
    };
  } catch (e) {
    console.error('[Universal Ext] Failed to parse generate body:', e);
    return null;
  }
}

function parseHistoryData(data: any) {
  try {
    let records: any[] = [];
    if (Array.isArray(data)) {
      records = data;
    } else if (typeof data === 'object') {
      records = Object.values(data);
    }

    const updates: any[] = [];

    for (const record of records) {
      if (!record || !record.submit_id) continue;

      const submitId = record.submit_id;
      const status = record.status;
      const isSuccess = status === 2 || status === '2';
      const isFailed = status === 3 || status === '3' || status === 60 || status === '60';

      if (isSuccess) {
        const outputUrls: string[] = [];
        const scanForUrls = (obj: any): string[] => {
          const found: string[] = [];
          if (!obj) return found;
          if (typeof obj === 'string') {
            if (obj.startsWith('http') && (obj.includes('.png') || obj.includes('.jpg') || obj.includes('.jpeg') || obj.includes('.mp4') || obj.includes('imagex') || obj.includes('capcutapi'))) {
              found.push(obj);
            }
            return found;
          }
          if (Array.isArray(obj)) {
            for (const item of obj) {
              found.push(...scanForUrls(item));
            }
          } else if (typeof obj === 'object') {
            for (const val of Object.values(obj)) {
              found.push(...scanForUrls(val));
            }
          }
          return found;
        };

        let respObj = record.response;
        if (typeof respObj === 'string') {
          try { respObj = JSON.parse(respObj); } catch {}
        }
        if (respObj) {
          const urls = scanForUrls(respObj);
          const uniqueUrls = [...new Set(urls)].filter(u => !u.includes('thumbnail') && !u.includes('avatar'));
          outputUrls.push(...uniqueUrls);
        }

        const promptVal = findValueByKey(record, ['prompt', 'text', 'script']) || '';
        const isVideo = JSON.stringify(record).toLowerCase().includes('video');

        updates.push({
          submitId,
          status: 'done',
          outputUrls,
          prompt: promptVal || undefined,
          jobType: isVideo ? 'video' : 'image'
        });
      } else if (isFailed) {
        let failReason = 'Dreamina generation failed';
        const failInfo = record.fail_reason || record.reason || record.message || '';
        if (failInfo) failReason = String(failInfo);
        
        const promptVal = findValueByKey(record, ['prompt', 'text', 'script']) || '';
        const isVideo = JSON.stringify(record).toLowerCase().includes('video');

        updates.push({
          submitId,
          status: 'failed',
          errorMessage: failReason,
          prompt: promptVal || undefined,
          jobType: isVideo ? 'video' : 'image'
        });
      }
    }

    return updates;
  } catch (e) {
    console.error('[Universal Ext] Failed to parse history data:', e);
    return [];
  }
}

// Monkey patch window.fetch
window.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input ? (input as Request).url : ''));

  // 1. Capture request to generate job
  if (url && url.includes('/mweb/v1/aigc_draft/generate')) {
    try {
      if (init && init.body) {
        const bodyText = typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body as any);
        const bodyObj = JSON.parse(bodyText);
        const parsedInput = parseGenerateRequestBody(bodyObj);

        if (parsedInput) {
          const response = await originalFetch.apply(this, arguments as any);
          const clonedResponse = response.clone();

          clonedResponse.text().then((responseText) => {
            try {
              const resObj = JSON.parse(responseText);
              const isSuccess = resObj.ret === 0 || resObj.ret === '0' || resObj.status === 0 || resObj.status === '0';
              if (isSuccess) {
                console.log(`[Universal Ext] Intercepted user generate request: submitId ${parsedInput.submitId}`);
                window.postMessage({
                  type: 'DREAMINA_INTERCEPTED_EVENT',
                  event: 'GENERATE_SUBMITTED',
                  payload: parsedInput
                }, '*');
              }
            } catch (e) {
              console.error('[Universal Ext] Error parsing generate response:', e);
            }
          }).catch(() => {});

          return response;
        }
      }
    } catch (err) {
      console.warn('[Universal Ext] Error intercepting generate fetch:', err);
    }
  }

  // 2. Capture polling or list status updates
  if (url && (url.includes('/mweb/v1/get_history_by_ids') || url.includes('/mweb/v1/aigc_draft/list'))) {
    try {
      const response = await originalFetch.apply(this, arguments as any);
      const clonedResponse = response.clone();

      clonedResponse.text().then((responseText) => {
        try {
          const resObj = JSON.parse(responseText);
          const isSuccess = resObj.ret === 0 || resObj.ret === '0' || resObj.status === 0 || resObj.status === '0';
          if (isSuccess && resObj.data) {
            const updates = parseHistoryData(resObj.data);
            if (updates.length > 0) {
              window.postMessage({
                type: 'DREAMINA_INTERCEPTED_EVENT',
                event: 'HISTORY_UPDATED',
                payload: updates
              }, '*');
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }).catch(() => {});

      return response;
    } catch (err) {
      // Ignore network errors
    }
  }

  return originalFetch.apply(this, arguments as any);
};
