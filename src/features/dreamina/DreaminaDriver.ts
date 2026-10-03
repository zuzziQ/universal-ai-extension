import { IAIDriver, GeneratePayload, GenerateResult } from '../../core/AIDriver.interface';
import { sha256Hex, awsV4Auth, md5, generateUUID } from '../../utils/crypto';
import { calculateCRC32, getImageDimensions } from '../../utils/binary';
import { syncCookies } from '../../utils/cookies';
import { waitForTabComplete } from '../google-flow/GoogleLabsDriver';

function getResponseObject(record: any): any {
  if (!record) return null;
  let resp = record.response;
  if (typeof resp === 'string') {
    try {
      resp = JSON.parse(resp);
    } catch (e) {
      return null;
    }
  }
  if (resp && typeof resp.response === 'string') {
    try {
      resp.response = JSON.parse(resp.response);
    } catch (e) {}
  }
  return resp;
}

function getDraftContentObject(record: any): any {
  if (!record) return null;
  let content = record.draft_content;
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  }
  return content;
}

async function uploadImageToCapCut(
  imageUrl: string,
  deviceId: string,
  userId: string
): Promise<{ success: boolean; error?: string; uri?: string; width?: number; height?: number }> {
  try {
    console.log(`[DreaminaDriver] Fetching image for upload: ${imageUrl}`);
    const imgResponse = await fetch(imageUrl);
    if (!imgResponse.ok) {
      return { success: false, error: `Failed to fetch image: ${imgResponse.statusText}` };
    }
    const imgBuffer = await imgResponse.arrayBuffer();
    const imgBytes = new Uint8Array(imgBuffer);
    const { width: imgW, height: imgH } = getImageDimensions(imgBytes);

    // Get Upload Token
    const tokPath = '/mweb/v1/get_upload_token';
    const tokUrl = `https://mweb-api-sg.capcut.com${tokPath}?aid=513641&web_version=7.5.0&da_version=3.3.12&aigc_features=app_lip_sync`;
    const tokTime = Math.floor(Date.now() / 1000).toString();
    const tokSign = md5(`9e2c|${tokPath.slice(-7)}|7|8.4.0|${tokTime}||11ac`);

    const tokResponse = await fetch(tokUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'app-sdk-version': '48.0.0', 'appid': '513641', 'appvr': '8.4.0',
        'device-time': tokTime, 'did': deviceId,
        'lan': 'en', 'loc': 'VN', 'pf': '7',
        'sign': tokSign, 'sign-ver': '1',
        'store-country-code': 'vn', 'store-country-code-src': 'uid',
        'tdid': ''
      },
      body: JSON.stringify({ scene: 2 }),
      credentials: 'include'
    });
    const tokJson = await tokResponse.json();
    console.log(`[ImageX] get_upload_token response ret=${tokJson.ret} errmsg=${tokJson.errmsg} space=${tokJson.data?.space_name}`);
    if (tokJson.ret !== 0 && tokJson.ret !== '0') {
      return { success: false, error: `Failed to acquire imagex upload token: ${tokJson.errmsg}` };
    }

    const creds = {
      access_key_id: tokJson.data.access_key_id,
      secret_access_key: tokJson.data.secret_access_key,
      session_token: tokJson.data.session_token
    };
    const space = tokJson.data.space_name;

    // Apply Image Upload via AWS V4
    const randStr = Array.from({ length: 11 }, () => Math.random().toString(36)[2]).join('');
    const applyUrl = `https://imagex-normal-sg.capcutapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${space}&FileSize=${imgBytes.length}&s=${randStr}&device_platform=web`;
    const emptyHash = await sha256Hex(new Uint8Array(0));
    const applyAuth = await awsV4Auth('GET', applyUrl, emptyHash, creds);

    const applyResponse = await fetch(applyUrl, {
      method: 'GET',
      headers: applyAuth
    });
    const applyJson = await applyResponse.json();
    console.log(`[ImageX] ApplyImageUpload status=${applyResponse.status} ResponseCode=${applyJson.ResponseMetadata?.Error?.Code} RequestId=${applyJson.ResponseMetadata?.RequestId}`);
    if (!applyJson.Result?.UploadAddress) {
      return { success: false, error: `ApplyImageUpload failed: ${JSON.stringify(applyJson.ResponseMetadata?.Error || applyJson)}` };
    }
    const uploadAddress = applyJson.Result.UploadAddress;
    const storeInfo = uploadAddress.StoreInfos[0];
    const storeUri = storeInfo.StoreUri;
    const authTok = storeInfo.Auth;
    const uploadHost = uploadAddress.UploadHosts[0];
    const sessionKey = uploadAddress.SessionKey;
    console.log(`[ImageX] POST target host=${uploadHost} storeUri=${storeUri} authTok_prefix=${authTok?.substring(0, 30)}`);

    // POST raw bytes to AWS ImageX S3 Upload Host
    const crc = calculateCRC32(imgBytes);
    const postUrl = `https://${uploadHost}/upload/v1/${storeUri}`;
    const postHeaders: any = {
      'accept': '*/*',
      'authorization': authTok,
      'content-crc32': crc,
      'content-disposition': 'attachment; filename="undefined"',
      'content-type': 'application/octet-stream',
      'origin': 'https://dreamina.capcut.com',
      'referer': 'https://dreamina.capcut.com/',
      'x-storage-u': userId,
      'user-agent': navigator.userAgent
    };

    const postResponse = await fetch(postUrl, {
      method: 'POST',
      headers: postHeaders,
      body: imgBytes
    });
    const postRawText = await postResponse.text();
    let postJson: any = {};
    try { postJson = JSON.parse(postRawText); } catch { postJson = { raw: postRawText }; }
    console.log(`[ImageX] POST response status=${postResponse.status} code=${postJson.code} message=${postJson.message || postJson.raw}`);
    if (postJson.code !== 2000) {
      return { success: false, error: `ImageX POST binary upload failed with code ${postJson.code}: ${postJson.message || postJson.raw}` };
    }

    // Commit Image Upload via AWS V4
    const commitUrl = `https://imagex-normal-sg.capcutapi.com/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${space}`;
    const commitBody = JSON.stringify({ SessionKey: sessionKey });
    const commitHash = await sha256Hex(commitBody);
    const commitAuth = await awsV4Auth('POST', commitUrl, commitHash, creds);
    commitAuth['content-type'] = 'application/json';

    const commitResponse = await fetch(commitUrl, {
      method: 'POST',
      headers: commitAuth,
      body: commitBody
    });
    const commitJson = await commitResponse.json();
    const pluginResult = commitJson.Result.PluginResult[0];
    const finalImageUri = pluginResult.ImageUri;
    const finalWidth = pluginResult.ImageWidth || imgW;
    const finalHeight = pluginResult.ImageHeight || imgH;

    return {
      success: true,
      uri: finalImageUri,
      width: finalWidth,
      height: finalHeight
    };
  } catch (e: any) {
    return { success: false, error: `Upload image error: ${e.message}` };
  }
}

async function scrapeDreaminaPointsInTab(tabId: number, maxWaitSeconds = 15): Promise<number | null> {
  try {
    const pointsResult = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (waitSec) => {
        return new Promise<number | null>((resolve) => {
          let attempts = 0;
          const maxAttempts = waitSec * 2; // Check every 500ms

          const tryFetchAPI = (resolveCallback: (pts: number | null) => void) => {
            const urls = [
              'https://dreamina.capcut.com/mweb/v1/vip/benefit_info?aid=513641&device_platform=web',
              'https://dreamina.capcut.com/mweb/v1/user/benefit?aid=513641&device_platform=web'
            ];
            let idx = 0;
            const runNext = () => {
              if (idx >= urls.length) {
                resolveCallback(null);
                return;
              }
              const url = urls[idx++];
              window.fetch(url, { credentials: 'include' })
                .then((r) => r.ok ? r.json() : null)
                .then((json) => {
                  if (json && (json.ret === 0 || json.ret === '0' || json.code === 0)) {
                    const data = json.data || {};
                    if (data.benefit_details && Array.isArray(data.benefit_details)) {
                      const creditDetail = data.benefit_details.find((b: any) => b.benefit_type === 'aigc_credits');
                      if (creditDetail && creditDetail.left_amount !== undefined && creditDetail.left_amount !== null) {
                        resolveCallback(Number(creditDetail.left_amount));
                        return;
                      }
                    }
                    const points = data.left_amount !== undefined ? data.left_amount :
                                   data.credits !== undefined ? data.credits :
                                   data.points !== undefined ? data.points :
                                   data.balance !== undefined ? data.balance : null;
                    if (points !== null && typeof points === 'number') {
                      resolveCallback(points);
                      return;
                    }
                  }
                  runNext();
                })
                .catch(() => {
                  runNext();
                });
            };
            runNext();
          };

          const cleanPoints = (text: string | null) => {
            if (!text) return null;
            text = text.trim().toLowerCase();
            if (text.startsWith('+')) {
              text = text.substring(1).trim();
            }
            const kMatch = text.match(/([\d.,]+)\s*k/);
            if (kMatch) {
              const numStr = kMatch[1].replace(/,/g, '.');
              const num = parseFloat(numStr);
              return isNaN(num) ? null : Math.round(num * 1000);
            }
            const normalMatch = text.match(/([\d,.]+)/);
            if (normalMatch) {
              const numStr = normalMatch[1].replace(/[,.]/g, '');
              const num = parseInt(numStr, 10);
              return isNaN(num) ? null : num;
            }
            return null;
          };

          const interval = setInterval(() => {
            attempts++;
            
            // 1. Check API
            if (attempts === 1 || attempts % 4 === 0) {
              tryFetchAPI((apiPoints) => {
                if (apiPoints !== null && apiPoints >= 0) {
                  clearInterval(interval);
                  resolve(apiPoints);
                }
              });
            }

            // 2. Check DOM Credit Element
            const creditEl = document.querySelector('#SiderMenuCredit') as HTMLElement;
            if (creditEl) {
              creditEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
              creditEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              const parsed = cleanPoints(creditEl.textContent || "");
              if (parsed !== null && parsed >= 0) {
                clearInterval(interval);
                resolve(parsed);
                return;
              }
            }

            // 3. Check class-based elements
            const els = document.querySelectorAll(
              '[class*="credit-amount-text"], [class*="credit_amount"], [class*="credit"], [class*="Credit"], [class*="balance"], [class*="Balance"], [class*="coin"], [data-testid*="credit"], [class*="point"], [class*="Point"]'
            );
            for (const el of Array.from(els)) {
              (el as HTMLElement).dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
              (el as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              const parsed = cleanPoints(el.textContent || "");
              if (parsed !== null && parsed >= 0 && parsed < 100000) {
                clearInterval(interval);
                resolve(parsed);
                return;
              }
            }

            if (attempts >= maxAttempts) {
              clearInterval(interval);
              resolve(null);
            }
          }, 500);
        });
      },
      args: [maxWaitSeconds]
    });
    return pointsResult?.[0]?.result ?? null;
  } catch (err: any) {
    console.warn(`[scrapeDreaminaPointsInTab] Failed to scrape points in tab ${tabId}:`, err.message);
    return null;
  }
}

function getImageResolution(aspectRatio?: string): { width: number; height: number } {
  if (!aspectRatio) return { width: 2048, height: 2048 };
  const ratio = aspectRatio.toUpperCase();
  if (ratio.includes('16:9') || ratio.includes('LANDSCAPE')) {
    return { width: 2048, height: 1152 };
  }
  if (ratio.includes('9:16') || ratio.includes('PORTRAIT')) {
    return { width: 1152, height: 2048 };
  }
  if (ratio.includes('4:3')) {
    return { width: 2048, height: 1536 };
  }
  if (ratio.includes('3:4')) {
    return { width: 1536, height: 2048 };
  }
  return { width: 2048, height: 2048 };
}

// Mutex tuần tự hóa multi-job Dreamina (tránh race cookie/tab/WAF khi 2 job song song)
let dreaminaLockPromise: Promise<void> = Promise.resolve();

export class DreaminaDriver implements IAIDriver {
  async generate(payload: GeneratePayload, tokens: { cookies?: any[]; email?: string; accountId?: string }): Promise<GenerateResult> {
    const previous = dreaminaLockPromise;
    let releaseLock: () => void = () => {};
    dreaminaLockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await previous;
      return await this.executeGenerate(payload, tokens);
    } finally {
      releaseLock();
    }
  }

  private async executeGenerate(payload: GeneratePayload, tokens: { cookies?: any[]; email?: string; accountId?: string }): Promise<GenerateResult> {
    console.log(`[DreaminaDriver] Preparing AIGC execution for task: ${payload.taskId} | Media Type: ${payload.mediaType}`);

    if (!tokens.cookies || tokens.cookies.length === 0) {
      return { success: false, error: 'Missing active CapCut/Dreamina session cookies in database' };
    }

    let tab: chrome.tabs.Tab | undefined = undefined;

    try {
      // 1. Tiêm Cookies sạch vào trình duyệt Extension để bypass CORS bằng utility chung
      await syncCookies(tokens.cookies, 'https://dreamina.capcut.com', '.capcut.com');
      
      // Lấy deviceId từ cookie _tea_web_id hoặc sử dụng mặc định
      const deviceId = tokens.cookies.find(c => c.name === '_tea_web_id')?.value || '7630610624435242504';

      console.log(`[DreaminaDriver] Opening signature-safe dynamic tab to bypass WAF & sync userId...`);
      const targetTabUrl = `https://dreamina.capcut.com/ai-tool/generate?type=${payload.mediaType === 'video' ? 'video' : 'image'}&workspace=0`;
      
      try {
        tab = await chrome.tabs.create({ url: targetTabUrl, active: false });
      } catch (tabErr: any) {
        console.warn(`[DreaminaDriver] tabs.create failed (likely No current window), trying fallback:`, tabErr.message);
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        if (windows && windows.length > 0) {
          tab = await chrome.tabs.create({ windowId: windows[0].id, url: targetTabUrl, active: false });
        } else {
          const newWin = await chrome.windows.create({ url: targetTabUrl, focused: false });
          if (!newWin || !newWin.id) throw new Error('Failed to create new window or window ID missing');
          tab = newWin.tabs?.[0] || await new Promise<chrome.tabs.Tab>((resolve, reject) => {
            chrome.tabs.query({ windowId: newWin.id }, (tabs) => {
              if (tabs && tabs[0]) resolve(tabs[0]);
              else reject(new Error('No tabs in newly created window'));
            });
          });
        }
      }
      
      // Chờ tab load hoàn tất kèm timeout fallback 5 giây
      await waitForTabComplete(tab.id!, 5000);
      const initTabState = await chrome.tabs.get(tab.id!).catch(() => null);
      console.log(`[DreaminaDriver] Injected tab URL: ${initTabState ? initTabState.url : 'unknown'}`);

      // Lấy User ID bằng cách fetch từ ngữ cảnh trang CapCut (tab) để gửi kèm session cookies
      let userId = '';
      let debugInfo = '';
      try {
        const infoResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: 'MAIN',
          func: async () => {
            try {
              const res = await window.fetch(
                'https://dreamina.capcut.com/passport/web/account/info/?aid=513641&account_sdk_source=web&sdk_version=2.1.10-tiktok&language=en',
                { credentials: 'include' }
              );
              const json = await res.json();
              if (json.data?.user_id_str) {
                return { success: true, userId: json.data.user_id_str };
              }
              return { success: false, error: 'Empty user_id_str', raw: JSON.stringify(json) };
            } catch (fetchErr: any) {
              return { success: false, error: 'Fetch failed: ' + fetchErr.message };
            }
          }
        });
        
        const execResult = (infoResult?.[0]?.result as any);
        if (execResult && execResult.success) {
          userId = execResult.userId;
          console.log(`[DreaminaDriver] Synced User ID string via tab: "${userId}"`);
        } else {
          debugInfo = execResult ? `Error: ${execResult.error}, Raw: ${execResult.raw || 'none'}` : 'No execution result';
          console.warn(`[DreaminaDriver] Failed to fetch User ID via tab: ${debugInfo}`);
        }
      } catch (err: any) {
        debugInfo = 'ExecuteScript failed: ' + err.message;
        console.warn(`[DreaminaDriver] Failed to fetch User ID via tab scripting:`, err.message);
      }

      if (!userId) {
        return { success: false, error: `Failed to retrieve CapCut User ID. Diagnostics: ${debugInfo}` };
      }

      let startPoints: number | null = null;
      try {
        console.log('[DreaminaDriver] Scraping start points balance from CapCut DOM...');
        startPoints = await scrapeDreaminaPointsInTab(tab.id!, 10);
        console.log(`[DreaminaDriver] Initial points balance: ${startPoints} Pts`);
      } catch (pointsErr: any) {
        console.warn(`[DreaminaDriver] Failed to scrape start points balance:`, pointsErr.message);
      }

      if (startPoints === 0) {
        console.warn(`[DreaminaDriver] Account has 0 points! Aborting generation.`);
        return { success: false, error: 'OUT_OF_POINTS', points: 0, email: tokens.email, actualMeta: { remaining_points: 0 } };
      }

      const submitId = generateUUID();
      const seed = Math.floor(Math.random() * 2000000000);
      let draftContent: any = {};
      let metricsExtra: any = {};
      let rootModel = 'high_aes_general_v50';
      if (payload.mediaType === 'image') {
        const reqModel = (payload.modelId && payload.modelId !== 'auto') ? payload.modelId : '';
        if (reqModel.includes('gpt')) rootModel = 'high_aes_gpt_v20';
        else if (reqModel.includes('v47') || reqModel.includes('4.7')) rootModel = 'high_aes_general_v47';
        else if (reqModel.includes('v46') || reqModel.includes('4.6')) rootModel = 'high_aes_general_v46';
        else if (reqModel.includes('v45') || reqModel.includes('4.5')) rootModel = 'high_aes_general_v45';
        else rootModel = (reqModel && reqModel.startsWith('high_aes')) ? reqModel : 'high_aes_general_v50';
      }
      let workspaceId = 0;
      let extend: any = { root_model: rootModel, workspace_id: workspaceId };

      // 2. PHÂN LOẠI LUỒNG SINH: BLEND (IMAGE2IMAGE) vs VIDEO vs TEXT2IMAGE
      const refUrls = (payload.referenceImageUrls || []).filter(url => url && url.startsWith('http'));
      if (payload.mediaType === 'image' && refUrls.length > 0) {
        // --- LUỒNG TEXT-TO-IMAGE CÓ CHARACTER REFERENCE (MULTI-REFERENCE IMAGE TAGGING) ---
        console.log(`[DreaminaDriver] Running Image Reference Mode. Processing ${refUrls.length} assets...`);
        
        // A. Upload reference images
        const uploadPromises: Promise<any>[] = [];
        for (const url of refUrls) {
          uploadPromises.push(uploadImageToCapCut(url, deviceId, userId));
        }
        const uploadResults = await Promise.all(uploadPromises);
        
        // Kiểm tra kết quả upload
        for (let i = 0; i < uploadResults.length; i++) {
          const res = uploadResults[i];
          if (!res.success || !res.uri) {
            return { success: false, error: `Failed to upload character reference ${i + 1}: ${res.error}` };
          }
        }

        const getTitleFromUrl = (urlStr: string) => {
          try {
            const p = new URL(urlStr).pathname;
            const filename = p.substring(p.lastIndexOf('/') + 1);
            return filename.split('.')[0] || 'image';
          } catch {
            return 'image';
          }
        };

        const materialList: any[] = [];
        let charIdx = 0;
        for (const charRes of uploadResults) {
          const originalUrl = refUrls[charIdx] || '';
          materialList.push({
            type: '', id: generateUUID(),
            material_type: 'image',
            image_info: {
              type: 'image',
              id: generateUUID(),
              source_from: 'upload',
              platform_type: 1,
              name: '',
              image_uri: charRes.uri,
              aigc_image: {
                type: '',
                id: generateUUID()
              },
              width: charRes.width || 1024,
              height: charRes.height || 1024,
              format: '',
              title: getTitleFromUrl(originalUrl),
              uri: charRes.uri
            }
          });
          charIdx++;
        }

        // Thuật toán parse prompt thông minh sang meta_list cho CapCut/Dreamina
        const metaList: any[] = [];
        const charRoles = payload.referenceImageRoles || [];
        
        interface MatchedToken {
          startIndex: number;
          endIndex: number;
          roleName: string;
          charIndex: number;
        }
        
        const matches: MatchedToken[] = [];
        const promptLower = payload.prompt.toLowerCase();
        
        charRoles.forEach((role: string, idx: number) => {
          if (!role) return;
          const roleLower = role.toLowerCase();
          let pos = promptLower.indexOf(roleLower);
          while (pos !== -1) {
            const beforeChar = pos > 0 ? promptLower[pos - 1] : ' ';
            const afterChar = pos + roleLower.length < promptLower.length ? promptLower[pos + roleLower.length] : ' ';
            const isWord = /[^a-zA-Z0-9]/.test(beforeChar) && /[^a-zA-Z0-9]/.test(afterChar);
            
            if (isWord) {
              matches.push({
                startIndex: pos,
                endIndex: pos + roleLower.length,
                roleName: role,
                charIndex: idx
              });
            }
            pos = promptLower.indexOf(roleLower, pos + 1);
          }
        });
        
        matches.sort((a, b) => a.startIndex - b.startIndex);
        
        const filteredMatches: MatchedToken[] = [];
        let lastEnd = 0;
        for (const match of matches) {
          if (match.startIndex >= lastEnd) {
            filteredMatches.push(match);
            lastEnd = match.endIndex;
          }
        }
        
        if (filteredMatches.length > 0) {
          console.log(`[DreaminaDriver] Parsed prompt mentions for image:`, filteredMatches);
          let currentPos = 0;
          
          for (const match of filteredMatches) {
            if (match.startIndex > currentPos) {
              const txt = payload.prompt.substring(currentPos, match.startIndex);
              metaList.push({
                type: '', id: generateUUID(),
                meta_type: 'text',
                text: txt
              });
            }
            
            metaList.push({
              type: '', id: generateUUID(),
              meta_type: 'image',
              text: '',
              material_ref: {
                type: '', id: generateUUID(),
                material_idx: match.charIndex
              }
            });
            
            currentPos = match.endIndex;
          }
          
          if (currentPos < payload.prompt.length) {
            const txt = payload.prompt.substring(currentPos);
            metaList.push({
              type: '', id: generateUUID(),
              meta_type: 'text',
              text: txt
            });
          }
        } else {
          console.log(`[DreaminaDriver] No character roles matched in image prompt. Using fallback meta_list.`);
          metaList.push({
            type: '', id: generateUUID(),
            meta_type: 'text',
            text: payload.prompt
          });
          for (let idx = 0; idx < materialList.length; idx++) {
            metaList.push({
              type: '', id: generateUUID(),
              meta_type: 'image',
              text: '',
              material_ref: { type: '', id: generateUUID(), material_idx: idx }
            });
          }
        }

        const unifiedEditInput = {
          type: '', id: generateUUID(),
          material_list: materialList,
          meta_list: metaList
        };

        const componentId = generateUUID();
        const nowStr = Date.now().toString();
        const { width: imgW, height: imgH } = getImageResolution(payload.aspectRatio);

        draftContent = {
          type: 'draft', id: generateUUID(),
          min_version: '3.3.9', min_features: ['AIGC_Image_UnifiedEdit'],
          is_from_tsn: true, version: '3.3.17',
          main_component_id: componentId,
          component_list: [{
            type: 'image_base_component', id: componentId,
            min_version: '3.0.2', aigc_mode: 'workbench',
            metadata: { type: '', id: generateUUID(), created_platform: 3,
                       created_platform_version: '', created_time_in_ms: nowStr, created_did: '' },
            generate_type: 'generate',
            abilities: {
              type: '', id: generateUUID(),
              generate: {
                type: '', id: generateUUID(),
                core_param: {
                  type: '', id: generateUUID(),
                  model: rootModel,
                  prompt: payload.prompt,
                  negative_prompt: payload.negativePrompt || '', seed,
                  sample_strength: 0.5,
                  large_image_info: { type: '', id: generateUUID(), height: imgH, width: imgW, resolution_type: '2k' },
                  intelligent_ratio: true, generate_type: 0
                },
                unified_edit_input: unifiedEditInput
              },
              gen_option: { type: '', id: generateUUID(), generate_all: false }
            }
          }]
        };

        metricsExtra = {
          promptSource: 'custom', generateCount: payload.numOutputs || 1, enterFrom: 'click',
          position: 'page_bottom_box',
          sceneOptions: JSON.stringify([{
            type: 'image',
            scene: 'ImageBasicGenerate',
            modelReqKey: rootModel,
            resolutionType: '2k',
            abilityList: [],
            benefitCount: payload.numOutputs || 1,
            reportParams: {
              enterSource: 'generate',
              vipSource: 'generate',
              extraVipFunctionKey: `${rootModel}-2k`,
              useVipFunctionDetailsReporterHoc: true
            }
          }]),
          isBoxSelect: false, isCutout: false, generateId: submitId, isRegenerate: false
        };

      } else if (payload.mediaType === 'video') {
        // --- LUỒNG VIDEO (CINEMATIC MOVIE PIPELINE - PRD V2.0) ---
        console.log(`[DreaminaDriver] Running Cinematic Movie Pipeline task: ${payload.taskId}`);
        
        let finalPrompt = payload.prompt;
        if (payload.cameraMovement) {
          finalPrompt = `${payload.prompt}, camera movement: ${payload.cameraMovement}`;
          console.log(`[DreaminaDriver] Appending camera movement to prompt: ${payload.cameraMovement}`);
        }

        let capcutAspectRatio = '16:9';
        if (payload.aspectRatio) {
          if (payload.aspectRatio.includes('LANDSCAPE')) {
            capcutAspectRatio = '16:9';
          } else if (payload.aspectRatio.includes('PORTRAIT')) {
            capcutAspectRatio = '9:16';
          } else if (payload.aspectRatio.includes('SQUARE')) {
            capcutAspectRatio = '1:1';
          } else if (payload.aspectRatio.includes(':')) {
            capcutAspectRatio = payload.aspectRatio;
          }
        }

        const requestedModel = payload.modelId || 'dreamina_seedance_40';
        const durationSec = payload.duration || 5;
        const durationMs = durationSec * 1000;

        rootModel = 'dreamina_seedance_40';
        let benefitType = 'seedance_20_fast_720p_output';

        const rawModel = requestedModel.toLowerCase();
        if (rawModel.includes('mini') || rawModel.includes('2.0_mini') || rawModel.includes('seedance_40_mini')) {
          rootModel = 'dreamina_seedance_40_mini';
          benefitType = 'seedance_20_mini_720p_output';
        } else if (rawModel.includes('2.0_fast') || rawModel.includes('fast_2.0') || (rawModel.includes('seedance_40') && !rawModel.includes('pro') && !rawModel.includes('mini'))) {
          rootModel = 'dreamina_seedance_40';
          benefitType = durationSec > 10 ? 'seedance_20_fast_720p_15s_output' : 'seedance_20_fast_720p_output';
        } else if (rawModel.includes('pro') || rawModel.includes('40_pro') || rawModel.includes('2.0_pro') || rawModel.includes('seedance_2.0')) {
          rootModel = 'dreamina_seedance_40_pro';
          benefitType = durationSec > 10 ? 'seedance_20_pro_720p_15s_output' : 'seedance_20_pro_720p_output';
        } else if (rawModel.includes('1.5') || rawModel.includes('15_pro') || rawModel.includes('1.5_pro')) {
          rootModel = 'dreamina_lib_sync_image_quick_1.5';
          benefitType = durationSec > 10 ? 'seedance_15_pro_720p_12s_output' : 'seedance_15_pro_720p_output';
        } else if (rawModel.includes('1.0_fast') || rawModel.includes('10_fast')) {
          rootModel = 'dreamina_seedance_10_fast';
          benefitType = 'seedance_10_fast_720p_output';
        } else if (rawModel.includes('1.0') || rawModel.includes('10') || rawModel.includes('seedance_10')) {
          rootModel = 'dreamina_seedance_10';
          benefitType = 'seedance_10_720p_output';
        }

        console.log(`[DreaminaDriver] Model Mapped: ${rootModel} | Benefit Type: ${benefitType} | Duration: ${durationSec}s (${durationMs}ms)`);

        const commerce = {
          amount: durationSec,
          benefit_type: benefitType,
          resource_id: 'generate_video',
          resource_id_type: 'str',
          resource_sub_type: 'aigc'
        };

        extend = {
          root_model: rootModel,
          m_video_commerce_info: commerce,
          workspace_id: 0,
          m_video_commerce_info_list: [commerce]
        };

        const componentId = generateUUID();
        const nowStr = Date.now().toString();

        const videoTaskExtra: any = {
          isDefaultSeed: 1, originSubmitId: submitId, isRegenerate: false,
          enterFrom: 'click', position: 'page_bottom_box',
          functionMode: 'omni_reference',
          sceneOptions: JSON.stringify([{
            type: 'video', scene: 'BasicVideoGenerateButton',
            resolution: '720p', modelReqKey: rootModel,
            videoDuration: durationSec, inputVideoDuration: 0,
            reportParams: {
              enterSource: 'generate', vipSource: 'generate',
              extraVipFunctionKey: `${rootModel}-720p`,
              useVipFunctionDetailsReporterHoc: true
            },
            materialTypes: []
          }])
        };

        let videoGenInputs: any[] = [];
        let unifiedEditInput: any = undefined;

        const hasStoryboard = !!payload.storyboardFrameUrl;
        const refUrls = (payload.referenceImageUrls || []).filter(url => url && url.startsWith('http'));
        const hasCharacters = refUrls.length > 0;

        if (hasStoryboard || hasCharacters) {
          console.log(`[DreaminaDriver] Preparing assets upload. Storyboard: ${hasStoryboard}, Characters count: ${refUrls.length}`);
          
          const uploadPromises: Promise<any>[] = [];
          if (hasStoryboard) {
            uploadPromises.push(uploadImageToCapCut(payload.storyboardFrameUrl!, deviceId, userId));
          }
          for (const url of refUrls) {
            uploadPromises.push(uploadImageToCapCut(url, deviceId, userId));
          }

          const uploadResults = await Promise.all(uploadPromises);

          for (let i = 0; i < uploadResults.length; i++) {
            const res = uploadResults[i];
            if (!res.success || !res.uri) {
              const name = (hasStoryboard && i === 0) ? "storyboard frame" : `character reference ${i - (hasStoryboard ? 1 : 0) + 1}`;
              return { success: false, error: `Failed to upload ${name}: ${res.error}` };
            }
          }

          const storyboardRes = hasStoryboard ? uploadResults[0] : null;
          const characterResList = hasStoryboard ? uploadResults.slice(1) : uploadResults;

          console.log(`[DreaminaDriver] Upload completed. Storyboard URI: ${storyboardRes?.uri || 'none'}. Characters URIs: ${characterResList.map(r => r.uri).join(', ')}`);

          const getTitleFromUrl = (urlStr: string) => {
            try {
              const p = new URL(urlStr).pathname;
              const filename = p.substring(p.lastIndexOf('/') + 1);
              return filename.split('.')[0] || 'image';
            } catch {
              return 'image';
            }
          };

          const materialList: any[] = [];
          if (storyboardRes) {
            materialList.push({
              type: '', id: generateUUID(),
              material_type: 'image',
              image_info: {
                type: 'image',
                id: generateUUID(),
                source_from: 'upload',
                platform_type: 1,
                name: '',
                image_uri: storyboardRes.uri,
                aigc_image: {
                  type: '',
                  id: generateUUID()
                },
                width: storyboardRes.width || 1024,
                height: storyboardRes.height || 1024,
                format: '',
                title: 'storyboard',
                uri: storyboardRes.uri
              }
            });
          }
          let charIdx = 0;
          for (const charRes of characterResList) {
            const originalUrl = refUrls[charIdx] || '';
            materialList.push({
              type: '', id: generateUUID(),
              material_type: 'image',
              image_info: {
                type: 'image',
                id: generateUUID(),
                source_from: 'upload',
                platform_type: 1,
                name: '',
                image_uri: charRes.uri,
                aigc_image: {
                  type: '',
                  id: generateUUID()
                },
                width: charRes.width || 1024,
                height: charRes.height || 1024,
                format: '',
                title: getTitleFromUrl(originalUrl),
                uri: charRes.uri
              }
            });
            charIdx++;
          }

          // Thuật toán parse prompt thông minh sang meta_list cho CapCut/Dreamina
          const metaList: any[] = [];
          const charRoles = payload.referenceImageRoles || [];
          
          interface MatchedToken {
            startIndex: number;
            endIndex: number;
            roleName: string;
            charIndex: number;
          }
          
          const matches: MatchedToken[] = [];
          const promptLower = finalPrompt.toLowerCase();
          
          charRoles.forEach((role: string, idx: number) => {
            if (!role) return;
            const roleLower = role.toLowerCase();
            let pos = promptLower.indexOf(roleLower);
            while (pos !== -1) {
              const beforeChar = pos > 0 ? promptLower[pos - 1] : ' ';
              const afterChar = pos + roleLower.length < promptLower.length ? promptLower[pos + roleLower.length] : ' ';
              const isWord = /[^a-zA-Z0-9]/.test(beforeChar) && /[^a-zA-Z0-9]/.test(afterChar);
              
              if (isWord) {
                matches.push({
                  startIndex: pos,
                  endIndex: pos + roleLower.length,
                  roleName: role,
                  charIndex: idx
                });
              }
              pos = promptLower.indexOf(roleLower, pos + 1);
            }
          });
          
          matches.sort((a, b) => a.startIndex - b.startIndex);
          
          const filteredMatches: MatchedToken[] = [];
          let lastEnd = 0;
          for (const match of matches) {
            if (match.startIndex >= lastEnd) {
              filteredMatches.push(match);
              lastEnd = match.endIndex;
            }
          }
          
          if (filteredMatches.length > 0) {
            console.log(`[DreaminaDriver] Parsed prompt mentions:`, filteredMatches);
            let currentPos = 0;
            
            for (const match of filteredMatches) {
              if (match.startIndex > currentPos) {
                const txt = finalPrompt.substring(currentPos, match.startIndex);
                metaList.push({
                  type: '', id: generateUUID(),
                  meta_type: 'text',
                  text: txt
                });
              }
              
              const materialIdx = hasStoryboard ? (match.charIndex + 1) : match.charIndex;
              metaList.push({
                type: '', id: generateUUID(),
                meta_type: 'image',
                text: '',
                material_ref: {
                  type: '', id: generateUUID(),
                  material_idx: materialIdx
                }
              });
              
              currentPos = match.endIndex;
            }
            
            if (currentPos < finalPrompt.length) {
              const txt = finalPrompt.substring(currentPos);
              metaList.push({
                type: '', id: generateUUID(),
                meta_type: 'text',
                text: txt
              });
            }
          } else {
            console.log(`[DreaminaDriver] No character roles matched in prompt. Using fallback meta_list.`);
            metaList.push({
              type: '', id: generateUUID(),
              meta_type: 'text',
              text: finalPrompt
            });
            for (let idx = 0; idx < materialList.length; idx++) {
              metaList.push({
                type: '', id: generateUUID(),
                meta_type: 'image',
                text: '',
                material_ref: { type: '', id: generateUUID(), material_idx: idx }
              });
            }
          }

          unifiedEditInput = {
            type: '', id: generateUUID(),
            material_list: materialList,
            meta_list: metaList
          };

          videoGenInputs = [{
            type: '', id: generateUUID(),
            min_version: '3.3.9',
            prompt: '', // Bắt buộc để trống ở ngoài khi dùng unified_edit_input theo đúng CapCut API
            video_mode: 2,
            fps: 24,
            duration_ms: durationMs,
            resolution: '720p',
            idip_meta_list: []
          }];

        } else {
          console.log(`[DreaminaDriver] Launching standard Text-to-Video...`);
          videoGenInputs = [{
            type: '', id: generateUUID(),
            min_version: '3.3.9',
            prompt: finalPrompt, video_mode: 2, fps: 24,
            duration_ms: durationMs, resolution: '720p', idip_meta_list: []
          }];
        }

        const genVideoAbilities: any = {
          type: '', id: generateUUID(),
          text_to_video_params: {
            type: '', id: generateUUID(),
            video_gen_inputs: videoGenInputs,
            video_aspect_ratio: capcutAspectRatio,
            seed, model_req_key: rootModel,
            priority: 0
          },
          video_task_extra: JSON.stringify(videoTaskExtra)
        };

        if (videoGenInputs.length > 0) {
          videoGenInputs[0].model_req_key = rootModel;
          videoGenInputs[0].video_aspect_ratio = capcutAspectRatio;
          if (unifiedEditInput) {
            videoGenInputs[0].unified_edit_input = unifiedEditInput;
          }
        }


        draftContent = {
          type: 'draft', id: generateUUID(), min_version: '3.3.9', min_features: (hasStoryboard || hasCharacters) ? ['AIGC_Video_UnifiedEdit'] : [],
          is_from_tsn: true, version: '3.3.17',
          main_component_id: componentId,
          component_list: [{
            type: 'video_base_component', id: componentId,
            min_version: '1.0.0', aigc_mode: 'workbench',
            metadata: { type: '', id: generateUUID(), created_platform: 3,
                       created_platform_version: '', created_time_in_ms: nowStr, created_did: '' },
            generate_type: 'gen_video',
            abilities: {
              type: '', id: generateUUID(),
              gen_video: genVideoAbilities
            },
            process_type: 1
          }]
        };

        metricsExtra = {
          isDefaultSeed: 1, originSubmitId: submitId, isRegenerate: false,
          enterFrom: 'click', position: 'page_bottom_box',
          functionMode: 'omni_reference',
          sceneOptions: JSON.stringify([{
            type: 'video', scene: 'BasicVideoGenerateButton',
            resolution: '720p', modelReqKey: rootModel,
            videoDuration: durationSec, batchNumber: 1, inputVideoDuration: 0,
            useSeedanceFast5sFreeTrial: false,
            reportParams: {
              enterSource: 'generate', vipSource: 'generate',
              extraVipFunctionKey: `${rootModel}-720p`,
              useVipFunctionDetailsReporterHoc: true
            },
            materialTypes: (hasStoryboard || hasCharacters) ? [1] : []
          }]),
          batchNumber: 1,
          submitGroupId: generateUUID(),
          hasRejectedAudit: 0
        };

      } else {
        // --- LUỒNG TEXT2IMAGE THƯỜNG ---
        console.log(`[DreaminaDriver] Running Text-to-Image Mode using high_aes_general_v50 model`);
        
        const componentId = generateUUID();
        const nowStr = Date.now().toString();
        const { width: imgW, height: imgH } = getImageResolution(payload.aspectRatio);

        draftContent = {
          type: 'draft', id: generateUUID(), min_version: '3.0.2', min_features: [],
          is_from_tsn: true, version: '3.3.12',
          main_component_id: componentId,
          component_list: [{
            type: 'image_base_component', id: componentId,
            min_version: '3.0.2', aigc_mode: 'workbench',
            metadata: { type: '', id: generateUUID(), created_platform: 3,
                       created_platform_version: '', created_time_in_ms: nowStr, created_did: '' },
            generate_type: 'generate',
            abilities: {
              type: '', id: generateUUID(),
              generate: {
                type: '', id: generateUUID(),
                core_param: {
                  type: '', id: generateUUID(),
                  model: rootModel,
                  prompt: payload.prompt, negative_prompt: payload.negativePrompt || '', seed,
                  sample_strength: 0.5,
                  large_image_info: { type: '', id: generateUUID(), height: imgH, width: imgW, resolution_type: '2k' },
                  intelligent_ratio: true, generate_type: 0
                }
              },
              gen_option: { type: '', id: generateUUID(), generate_all: false }
            }
          }]
        };

        metricsExtra = {
          promptSource: 'custom', generateCount: payload.numOutputs || 1, enterFrom: 'click',
          position: 'page_bottom_box',
          sceneOptions: JSON.stringify([{
            type: 'image',
            scene: 'ImageBasicGenerate',
            modelReqKey: rootModel,
            resolutionType: '2k',
            abilityList: [],
            benefitCount: payload.numOutputs || 1,
            reportParams: {
              enterSource: 'generate',
              vipSource: 'generate',
              extraVipFunctionKey: `${rootModel}-2k`,
              useVipFunctionDetailsReporterHoc: true
            }
          }]),
          isBoxSelect: false, isCutout: false, generateId: submitId, isRegenerate: false
        };
      }

      // 3. THỰC THI GỬI API DRAFT GENERATE ĐỒNG NHẤT QUA TAB ẨN ĐỂ VƯỢT WAF
      const path = '/mweb/v1/aigc_draft/generate';
      const url = 'https://mweb-api-sg.capcut.com' + path
                + '?aid=513641&device_platform=web&region=VN&da_version=3.3.12'
                + '&os=windows&web_component_open_flag=1&commerce_with_input_video=1'
                + '&web_version=7.5.0&aigc_features=app_lip_sync';
      
      const deviceTime = Math.floor(Date.now() / 1000).toString();
      const sign = md5('9e2c|' + path.slice(-7) + '|7|8.4.0|' + deviceTime + '||11ac');

      const body = {
        extend,
        submit_id: submitId,
        metrics_extra: JSON.stringify(metricsExtra),
        draft_content: JSON.stringify(draftContent),
        http_common_info: { aid: 513641 }
      };

      // Tab already opened at the beginning of generate()

      console.log(`[DreaminaDriver] Injecting and executing generate fetch in MAIN world...`);
      let executeResult: any;
      try {
        executeResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: 'MAIN',
          func: async (fetchUrl: string, fetchHeaders: any, fetchBody: any) => {
            try {
              const res = await window.fetch(fetchUrl, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(fetchBody),
                credentials: 'include'
              });
              const text = await res.text();
              return { status: res.status, text };
            } catch (err: any) {
              return { error: err.message };
            }
          },
          args: [
            url,
            {
              'content-type': 'application/json',
              'app-sdk-version': '48.0.0', 'appid': '513641', 'appvr': '8.4.0',
              'device-time': deviceTime, 'did': deviceId,
              'lan': 'en', 'loc': 'VN', 'pf': '7',
              'sign': sign, 'sign-ver': '1',
              'store-country-code': 'vn', 'store-country-code-src': 'uid',
              'tdid': ''
            },
            body
          ]
        });
      } catch (err: any) {
        await chrome.tabs.remove(tab.id!).catch(() => {});
        return { success: false, error: `Failed to inject execution script: ${err.message}` };
      }

      const resultPayload = executeResult?.[0]?.result;
      if (!resultPayload || resultPayload.error) {
        await chrome.tabs.remove(tab.id!).catch(() => {});
        return { success: false, error: `Injected generate fetch failed: ${resultPayload?.error || 'No response'}` };
      }

      console.log(`[DreaminaDriver] Injected API Response status: ${resultPayload.status}`);
      let genResult: any;
      try {
        genResult = JSON.parse(resultPayload.text);
      } catch (err: any) {
        await chrome.tabs.remove(tab.id!).catch(() => {});
        return { success: false, error: `Failed to parse generate response: ${resultPayload.text}` };
      }

      console.log('[DreaminaDriver] API Generate Response:', JSON.stringify(genResult));

      const isSuccess = genResult.ret === 0 || genResult.ret === '0' || genResult.status === 0 || genResult.status === '0';
      if (!isSuccess) {
        await chrome.tabs.remove(tab.id!).catch(() => {});
        return { success: false, error: genResult.errmsg || genResult.message || 'Failed to trigger Dreamina API Generation' };
      }

      // 3.1 CẬP NHẬT ĐIỂM SỚM NGAY SAU KHI TẠO JOB THÀNH CÔNG (KHÔNG ĐỢI POLL XONG)
      try {
        console.log('[DreaminaDriver] Job generated successfully. Scraping point balance early...');
        const earlyPoints = await scrapeDreaminaPointsInTab(tab.id!, 10);
        if (earlyPoints !== null && earlyPoints !== undefined) {
          const newStatus = earlyPoints <= 0 ? 'LOW_CREDIT' : 'ACTIVE';
          console.log(`[DreaminaDriver] Early points scraped: ${earlyPoints} Pts. Syncing to Hub...`);
          if (tokens && tokens.accountId) {
            const { checkinAccount } = await import('../../core/hubClient');
            await checkinAccount(tokens.accountId, 0, newStatus).catch(() => {});
          }
        }
      } catch (pointsErr: any) {
        console.warn(`[DreaminaDriver] Failed to scrape early points balance:`, pointsErr.message);
      }

      if (payload.mediaType === 'video') {
        console.log(`[DreaminaDriver] Reloading tab to establish WebSocket progress tracking for video job...`);
        try {
          await chrome.tabs.reload(tab.id!);
          // Chờ tab load hoàn tất sau reload kèm timeout fallback 5 giây
          await waitForTabComplete(tab.id!, 5000);
          console.log(`[DreaminaDriver] Tab reloaded and ready for progress tracking.`);
        } catch (reloadErr: any) {
          console.warn(`[DreaminaDriver] Failed to reload tab:`, reloadErr.message);
        }
      }

      // 4. BẮT ĐẦU LUỒNG POLLING TRONG CÙNG NGỮ CẢNH TAB
      console.log(`[DreaminaDriver] Generation successfully queued! Starting history list polling in tab...`);
      
      const pollPath = '/mweb/v1/get_history_by_ids';
      const pollUrl = 'https://mweb-api-sg.capcut.com' + pollPath
                    + '?aid=513641&device_platform=web&region=VN&da_version=3.3.12'
                    + '&os=windows&web_component_open_flag=1&web_version=7.5.0'
                    + '&aigc_features=app_lip_sync';

      const durationSec = payload.duration || 5;
      const maxRetries = payload.mediaType === 'video' ? Math.max(60, Math.ceil(durationSec * 12)) : 25;
      let finalUrls: string[] = [];
      let pollError: string | null = null;
      let draftRecord: any = null;
      let emptyPollCount = 0;

      for (let i = 0; i < maxRetries; i++) {
        const delay = i === 0 ? 1200 : (i === 1 ? 2000 : (i === 2 ? 3500 : 5000));
        await new Promise(r => setTimeout(r, delay));
        
        const pollTime = Math.floor(Date.now() / 1000).toString();
        const pollSign = md5('9e2c|' + pollPath.slice(-7) + '|7|8.4.0|' + pollTime + '||11ac');

        const currentTabState = await chrome.tabs.get(tab.id!).catch(() => null);
        const currentUrl = currentTabState ? currentTabState.url : "unknown";
        console.log(`[DreaminaDriver] Polling retry ${i + 1}/${maxRetries} in tab. URL: ${currentUrl}`);

        // ── Sign-out popup guard: dismiss "You've signed out" modal before polling ──
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: () => {
              // Tìm nút Refresh/OK trong modal signed-out
              const btns = Array.from(document.querySelectorAll('button'));
              for (const btn of btns) {
                const txt = (btn.textContent || '').toLowerCase().trim();
                if (txt === 'refresh' || txt === 'ok' || txt === 'close' || txt === 'dismiss') {
                  (btn as HTMLElement).click();
                  return `dismissed: ${txt}`;
                }
              }
              return null;
            }
          });
        } catch (_) { /* tab may not be injectable yet */ }

        let pollExecuteResult: any;

        try {
          pollExecuteResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: 'MAIN',
            func: async (fetchUrl: string, fetchHeaders: any, fetchBody: any) => {
              try {
                const res = await window.fetch(fetchUrl, {
                  method: 'POST',
                  headers: fetchHeaders,
                  body: JSON.stringify(fetchBody),
                  credentials: 'include'
                });
                const text = await res.text();
                return { status: res.status, text };
              } catch (err: any) {
                return { error: err.message };
              }
            },
            args: [
              pollUrl,
              {
                'content-type': 'application/json',
                'app-sdk-version': '48.0.0', 'appid': '513641', 'appvr': '8.4.0',
                'device-time': pollTime, 'did': deviceId,
                'lan': 'en', 'loc': 'VN', 'pf': '7',
                'sign': pollSign, 'sign-ver': '1',
                'store-country-code': 'vn', 'store-country-code-src': 'uid',
                'tdid': '', 'x-platform': 'pc'
              },
              { submit_ids: [submitId] }
            ]
          });
        } catch (err: any) {
          console.warn(`[DreaminaDriver] Execute script during polling failed:`, err.message);
          continue;
        }

        const pollPayload = pollExecuteResult?.[0]?.result;
        let pollResult: any;
        let isPollSuccess = false;
        draftRecord = null;

        if (pollPayload && !pollPayload.error) {
          try {
            pollResult = JSON.parse(pollPayload.text);
            isPollSuccess = pollResult.ret === 0 || pollResult.ret === '0' || pollResult.status === 0 || pollResult.status === '0';
            if (isPollSuccess && pollResult.data) {
              if (Array.isArray(pollResult.data)) {
                draftRecord = pollResult.data[0];
              } else {
                draftRecord = pollResult.data[submitId];
              }
            }
          } catch (err: any) {
            console.warn(`[DreaminaDriver] Failed to parse polling response:`, pollPayload.text);
          }
        } else {
          console.warn(`[DreaminaDriver] Polling fetch error:`, pollPayload?.error);
        }

        // FALLBACK: Nếu API get_history_by_ids lỗi hoặc không trả về record, gọi API list nháp dự phòng
        if (!draftRecord) {
          emptyPollCount++;
          console.log(`[DreaminaDriver] Polling primary API failed or empty (Count: ${emptyPollCount}). Trying fallback draft list API...`);
          try {
            const listExecuteResult = await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              world: 'MAIN',
              func: async () => {
                try {
                  const res = await window.fetch(
                    'https://dreamina.capcut.com/mweb/v1/aigc_draft/list?aid=513641&device_platform=web&page_size=20&page_token=&scene=2',
                    { credentials: 'include' }
                  );
                  const text = await res.text();
                  return { status: res.status, text };
                } catch (err: any) {
                  return { error: err.message };
                }
              }
            });
            const listPayload = listExecuteResult?.[0]?.result;
            if (listPayload && !listPayload.error) {
              const listResult = JSON.parse(listPayload.text || '{}');
              if (listResult.ret === 0 || listResult.ret === '0') {
                const drafts = listResult.data?.draft_list || [];
                draftRecord = drafts.find((d: any) => d.submit_id === submitId);
                if (draftRecord) {
                  console.log(`[DreaminaDriver] Found draft record via fallback list API! Status: ${draftRecord.status}`);
                  isPollSuccess = true;
                  emptyPollCount = 0;
                }
              }
            }
          } catch (fallbackErr: any) {
            console.warn(`[DreaminaDriver] Fallback list API failed:`, fallbackErr.message);
          }

          if (!draftRecord && emptyPollCount >= 6 && payload.mediaType === 'video') {
            console.log(`[DreaminaDriver] Polling primary and fallback APIs have been empty for ${emptyPollCount} times. Reloading tab to refresh CapCut session/WS...`);
            try {
              await chrome.tabs.reload(tab.id!);
              emptyPollCount = 0;
              await new Promise(r => setTimeout(r, 6000));
            } catch (reloadErr: any) {
              console.warn(`[DreaminaDriver] Failed to reload tab during polling:`, reloadErr.message);
            }
          }
        } else {
          emptyPollCount = 0;
        }

        if (isPollSuccess && draftRecord) {
            console.log(`[DreaminaDriver] Task Status in tab: ${draftRecord.status}`);
            const respObj = getResponseObject(draftRecord) || {};
            const innerResp = respObj.response || {};
            
            // Trích xuất progress realtime
            let progress = 0;
            if (draftRecord.progress !== undefined && draftRecord.progress !== null) {
              progress = Number(draftRecord.progress);
            } else if (respObj.progress !== undefined && respObj.progress !== null) {
              progress = Number(respObj.progress);
            } else if (innerResp.progress !== undefined && innerResp.progress !== null) {
              progress = Number(innerResp.progress);
            } else if (draftRecord.render_progress !== undefined && draftRecord.render_progress !== null) {
              progress = Number(draftRecord.render_progress);
            }

            // Trích xuất actualMeta realtime
            const currentActualMeta: any = {
              provider: 'DREAMINA',
              mediaType: payload.mediaType,
              model: null,
              duration: null,
              aspectRatio: null
            };
            try {
              const draftContentObj = getDraftContentObject(draftRecord) || {};
              const componentList = draftContentObj.component_list || draftRecord.component_list || [];

              if (payload.mediaType === 'video') {
                const videoInfo = innerResp.video_generate_info || respObj.video_generate_info || {};
                currentActualMeta.model = videoInfo.model_req_key 
                  || componentList[0]?.abilities?.gen_video?.text_to_video_params?.model_req_key 
                  || null;
                const durMs = videoInfo.transcoded_video?.origin?.duration_ms 
                  || videoInfo.video_url_duration_ms 
                  || videoInfo.duration_ms 
                  || videoInfo.duration 
                  || null;
                currentActualMeta.duration = durMs ? Math.round(Number(durMs) / 1000) : null;
                
                const w = videoInfo.width || videoInfo.transcoded_video?.origin?.width || null;
                const h = videoInfo.height || videoInfo.transcoded_video?.origin?.height || null;
                if (w && h) {
                  currentActualMeta.aspectRatio = `${w}:${h}`;
                } else {
                  currentActualMeta.aspectRatio = componentList[0]?.abilities?.gen_video?.text_to_video_params?.video_aspect_ratio || null;
                }
              } else {
                const imgInfos = innerResp.image_generate_infos || respObj.image_generate_infos || [];
                const imgInfo = imgInfos[0] || {};
                currentActualMeta.model = componentList[0]?.abilities?.generate?.core_param?.model 
                  || null;
                const w = imgInfo.width || null;
                const h = imgInfo.height || null;
                if (w && h) {
                  currentActualMeta.aspectRatio = `${w}:${h}`;
                } else {
                  currentActualMeta.aspectRatio = componentList[0]?.abilities?.generate?.core_param?.large_image_info?.resolution_type || null;
                }
                currentActualMeta.duration = 0;
              }
            } catch (metaErr: any) {
              console.warn('[DreaminaDriver] Failed to extract currentActualMeta:', metaErr.message);
            }

            if (progress >= 0) {
              // Chuẩn hóa nếu là 0-1
              if (progress < 1) {
                progress = Math.round(progress * 100);
              } else {
                progress = Math.round(progress);
              }
              console.log(`[JOB_PROGRESS] taskId:${payload.taskId} progress:${progress} email:${tokens.email || ''} actualMeta:${JSON.stringify(currentActualMeta)}`);
              chrome.runtime.sendMessage({
                type: "JOB_PROGRESS",
                taskId: payload.taskId,
                progress: progress,
                email: tokens.email,
                actualMeta: currentActualMeta
              }).catch(() => {});
            }

            if (draftRecord.status === 2 || draftRecord.status === '2' || draftRecord.status === 50 || draftRecord.status === '50') { // SUCCESS
              // Trích xuất ảnh - format chính
              const mainImgInfos = innerResp.image_generate_infos || respObj.image_generate_infos || [];
              if (mainImgInfos.length > 0) {
                for (const info of mainImgInfos) {
                  if (info.image_url) finalUrls.push(info.image_url);
                  else if (info.url) finalUrls.push(info.url);
                  else if (info.origin_url) finalUrls.push(info.origin_url);
                }
              }
              // Format thay thế: response.generate_result_list
              const genResultList = innerResp.generate_result_list || respObj.generate_result_list || [];
              if (finalUrls.length === 0 && genResultList.length > 0) {
                for (const item of genResultList) {
                  if (item.image_url) finalUrls.push(item.image_url);
                  else if (item.url) finalUrls.push(item.url);
                }
              }

              // Trích xuất video
              if (draftRecord.response && draftRecord.response.video_generate_info) {
                const videoInfo = draftRecord.response.video_generate_info;
                const videoUrl = videoInfo.transcoded_video?.origin?.video_url 
                  || videoInfo.video_url 
                  || videoInfo.transcoded_video?.video_url;
                if (videoUrl) {
                  finalUrls.push(videoUrl);
                }
              }

              // Dự phòng trích xuất sâu (Deep Harvesting) - thử tất cả các field có URL
              if (finalUrls.length === 0) {
                // item_list fallback
                if (draftRecord.item_list) {
                  for (const item of draftRecord.item_list) {
                    const largeImages = item.image?.large_images || [];
                    for (const img of largeImages) {
                      if (img.image_url) finalUrls.push(img.image_url);
                    }
                    const videoUrl = item.video?.transcoded_video?.origin?.video_url 
                      || item.video?.video_url
                      || item.video?.transcoded_video?.video_url;
                    if (videoUrl) finalUrls.push(videoUrl);
                    if (item.image_url) finalUrls.push(item.image_url);
                    if (item.url) finalUrls.push(item.url);
                  }
                }
                // Try scanning top-level response for any URL fields
                const scanForUrls = (obj: any, depth: number = 0): string[] => {
                  if (depth > 4 || !obj || typeof obj !== 'object') return [];
                  const found: string[] = [];
                  for (const key of Object.keys(obj)) {
                    const val = obj[key];
                    if (typeof val === 'string' && (
                      val.startsWith('http') && (
                        val.includes('.jpg') || val.includes('.jpeg') || val.includes('.png') || val.includes('.webp') || val.includes('.mp4') ||
                        val.includes('image') || val.includes('video') || val.includes('ibyteimg') || val.includes('capcut') || val.includes('byteimg')
                      )
                    )) {
                      found.push(val);
                    } else if (typeof val === 'object') {
                      found.push(...scanForUrls(val, depth + 1));
                    }
                  }
                  return found;
                };
                if (draftRecord.response) {
                  const deepUrls = scanForUrls(draftRecord.response);
                  const uniqueDeep = [...new Set(deepUrls)].filter(u => !u.includes('thumbnail') && !u.includes('avatar'));
                  finalUrls.push(...uniqueDeep);
                }
              }

              console.log(`[DreaminaDriver] Extracted ${finalUrls.length} URLs from status=2 response. Raw response keys: ${Object.keys(draftRecord.response || {}).join(',')}`);
              break;
            } else if (draftRecord.status === 3 || draftRecord.status === '3' || draftRecord.status === 60 || draftRecord.status === '60') { // FAILED
              // Trích xuất lý do thất bại cụ thể từ response CapCut
              let failReason = 'Dreamina generation failed on CapCut backend';
              const failInfo = draftRecord.fail_reason || draftRecord.reason || draftRecord.message
                || draftRecord.response?.message || draftRecord.response?.reason || '';
              if (failInfo) {
                failReason = String(failInfo);
              } else if (draftRecord.response?.error_code || draftRecord.error_code) {
                const ec = draftRecord.response?.error_code || draftRecord.error_code;
                // CapCut error_code 10004 = Not enough credits
                if (ec === 10004 || ec === '10004' || ec === 700000012 || ec === '700000012') {
                  failReason = 'OUT_OF_POINTS';
                } else {
                  failReason = `CapCut error_code: ${ec}`;
                }
              }
              pollError = failReason;
              break;
            }
          }
        }

      // 5. TRÍCH XUẤT ĐIỂM (POINTS SCRAPING) SAU KHI CHẠY XONG
      let freshPoints: number | undefined = undefined;
      try {
        console.log('[DreaminaDriver] Scraping fresh points balance from CapCut DOM (with polling)...');
        const pointsVal = await scrapeDreaminaPointsInTab(tab.id!, 15);
        if (pointsVal !== null && pointsVal !== undefined) {
          freshPoints = pointsVal;
          console.log(`[DreaminaDriver] Successfully harvested points balance: ${freshPoints} Pts`);
        }
      } catch (pointsErr: any) {
        console.warn(`[DreaminaDriver] Failed to scrape points balance from DOM:`, pointsErr.message);
      }

      // 6. TRÍCH XUẤT THAM SỐ THỰC TẾ (ACTUAL METADATA)
      const actualMeta: any = {
        provider: 'DREAMINA',
        mediaType: payload.mediaType,
        remaining_points: freshPoints,
        model: null,
        duration: null,
        aspectRatio: null
      };

      if (draftRecord) {
        try {
          const respObj = getResponseObject(draftRecord) || {};
          const innerResp = respObj.response || {};
          const draftContentObj = getDraftContentObject(draftRecord) || {};
          const componentList = draftContentObj.component_list || draftRecord.component_list || [];

          if (payload.mediaType === 'video') {
            const videoInfo = innerResp.video_generate_info || respObj.video_generate_info || {};
            actualMeta.model = videoInfo.model_req_key 
              || componentList[0]?.abilities?.gen_video?.text_to_video_params?.model_req_key 
              || null;
            const durMs = videoInfo.transcoded_video?.origin?.duration_ms 
              || videoInfo.video_url_duration_ms 
              || videoInfo.duration_ms 
              || videoInfo.duration 
              || null;
            actualMeta.duration = durMs ? Math.round(Number(durMs) / 1000) : null;
            
            const w = videoInfo.width || videoInfo.transcoded_video?.origin?.width || null;
            const h = videoInfo.height || videoInfo.transcoded_video?.origin?.height || null;
            if (w && h) {
              actualMeta.aspectRatio = `${w}:${h}`;
            } else {
              actualMeta.aspectRatio = componentList[0]?.abilities?.gen_video?.text_to_video_params?.video_aspect_ratio || null;
            }
          } else {
            const imgInfos = innerResp.image_generate_infos || respObj.image_generate_infos || [];
            const imgInfo = imgInfos[0] || {};
            actualMeta.model = componentList[0]?.abilities?.generate?.core_param?.model 
              || null;
            const w = imgInfo.width || null;
            const h = imgInfo.height || null;
            if (w && h) {
              actualMeta.aspectRatio = `${w}:${h}`;
            } else {
              actualMeta.aspectRatio = componentList[0]?.abilities?.generate?.core_param?.large_image_info?.resolution_type || null;
            }
            actualMeta.duration = 0;
          }
        } catch (metaErr: any) {
          console.warn('[DreaminaDriver] Failed to extract actualMeta:', metaErr.message);
        }
      }

      let creditsUsed: number | undefined = undefined;
      if (startPoints !== null && freshPoints !== null && freshPoints !== undefined) {
        const diff = startPoints - freshPoints;
        if (diff >= 0) {
          creditsUsed = diff;
          console.log(`[DreaminaDriver] Actual credits used (startPoints ${startPoints} - endPoints ${freshPoints}): ${creditsUsed} Pts`);
        }
      }

      if (pollError) {
        return { success: false, error: pollError, points: freshPoints, email: tokens.email, actualMeta, creditsUsed };
      }

      if (finalUrls.length > 0) {
        let returnedUrls = finalUrls;
        if (payload.mediaType === 'image' && payload.numOutputs) {
          returnedUrls = finalUrls.slice(0, payload.numOutputs);
          console.log(`[DreaminaDriver] Slicing output URLs to match requested variants: ${payload.numOutputs}/${finalUrls.length}`);
        }
        console.log('[DreaminaDriver] Successfully harvested Dreamina Output URLs via signature-safe tab:', returnedUrls);
        return {
          success: true,
          outputUrls: returnedUrls,
          points: freshPoints,
          email: tokens.email,
          actualMeta,
          creditsUsed
        };
      }

      const timeoutTabState = await chrome.tabs.get(tab.id!).catch(() => null);
      const timeoutUrl = timeoutTabState ? timeoutTabState.url : "unknown";
      return { success: false, error: `Dreamina Polling Timeout after ${payload.mediaType === 'video' ? (maxRetries * 5) : '125'} seconds. Final URL: ${timeoutUrl}`, points: freshPoints, email: tokens.email, actualMeta, creditsUsed };

    } catch (err: any) {
      console.error('[DreaminaDriver] Fatal error during Dreamina API execution:', err.message);
      return { success: false, error: err.message };
    } finally {
      if (tab?.id) {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    }
  }
}
