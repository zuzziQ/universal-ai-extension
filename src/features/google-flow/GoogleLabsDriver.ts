import { IAIDriver, GeneratePayload, GenerateResult } from '../../core/AIDriver.interface';
import { 
  generateImage, 
  generateVideo, 
  generateText, 
  uploadReferenceImage, 
  checkVideoGenerationStatus,
  fetchFreshRecaptchaToken,
  resolveGoogleFlowProject,
  createGoogleLabsEntity
} from './googleLabsApi';

export function waitForTabComplete(tabId: number, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    let timer: any = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };

    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(true);
        }
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete' && !resolved) {
        resolved = true;
        cleanup();
        resolve(true);
      }
    }).catch(() => {});

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(false);
      }
    }, timeoutMs);
  });
}

export class GoogleLabsDriver implements IAIDriver {
  async generate(payload: GeneratePayload, tokens: { oauthToken?: string; cookies?: any[] }): Promise<GenerateResult> {
    const { tabId, isDedicated } = await this.getOrCreateLabsTab();
    try {
      return await this.executeGenerate(payload, tokens, tabId);
    } finally {
      if (isDedicated && tabId > 0) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  }

  private async executeGenerate(payload: GeneratePayload, tokens: { oauthToken?: string; cookies?: any[] }, tabId: number): Promise<GenerateResult> {
    console.log(`[GoogleLabsDriver] Dispatching task ${payload.taskId} | Type: ${payload.mediaType} | Prompt: "${payload.prompt}"`);

    // 1. Get tokens from storage if not explicitly provided
    let activeToken = tokens?.oauthToken;
    let extraTokens = await chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]);
    
    if (!activeToken) {
      activeToken = extraTokens.oauthToken as string;
    }

    if (!activeToken) {
      // Direct instructions: open the tab to fetch credentials
      // Wait for credentials to populate
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 800));
        extraTokens = await chrome.storage.local.get(["oauthToken", "xBrowserValidation", "xClientData"]);
        if (extraTokens.oauthToken) {
          activeToken = extraTokens.oauthToken as string;
          break;
        }
      }
      if (!activeToken) {
        throw new Error("Missing Google Labs credentials. Please open & sign-in on: https://labs.google/fx/tools/flow");
      }
    }

    // Combine captured tokens
    const creds = {
      oauthToken: activeToken,
      xBrowserValidation: extraTokens.xBrowserValidation,
      xClientData: extraTokens.xClientData
    };

    // 2. Locate or launch active Labs Google Tab to solve reCAPTCHA
    // Resolve Google Flow Project ID using mapping logic
    const activeProjectId = await resolveGoogleFlowProject({
      projectId: payload.projectId,
      projectName: payload.projectName
    }, tabId);
    console.log(`[GoogleLabsDriver] Using Google Flow Project ID: ${activeProjectId}`);

    // Navigate Google Labs tab to target project to make it visible & active on UI
    if (tabId > 0 && activeProjectId && activeProjectId !== "default" && activeProjectId !== "012b7b28-f3f0-4441-9926-f5c9dc59deb3") {
      try {
        const tab = await chrome.tabs.get(tabId);
        const targetUrl = `https://labs.google/fx/tools/flow/project/${activeProjectId}`;
        if (tab && tab.url && !tab.url.includes(activeProjectId) && tab.url !== targetUrl) {
          console.log(`[GoogleLabsDriver] Navigating Google Labs tab to project: ${activeProjectId}`);
          await chrome.tabs.update(tabId, { url: targetUrl, active: false });
          // Wait briefly for navigation to process
          await waitForTabComplete(tabId, 4000);
        }
      } catch (navErr: any) {
        console.warn(`[GoogleLabsDriver] Optional project navigation failed:`, navErr.message);
      }
    }

    // 3. Solve reCAPTCHA v3
    let recaptchaToken = "";
    try {
      const captchaAction = payload.mediaType === 'video' ? 'VIDEO_GENERATION' : 'IMAGE_GENERATION';
      recaptchaToken = await fetchFreshRecaptchaToken(tabId, captchaAction);
      console.log(`[GoogleLabsDriver] reCAPTCHA solved! Token length: ${recaptchaToken.length}`);
    } catch (e: any) {
      console.warn(`[GoogleLabsDriver] reCAPTCHA solve warning (attempting direct request without token):`, e.message);
    }

    // 4. Handle reference images if any (best-effort — never hard-fail the whole job on one bad ref)
    const mediaIds: string[] = [];
    if (payload.referenceImageUrls && payload.referenceImageUrls.length > 0) {
      console.log(`[GoogleLabsDriver] Uploading ${payload.referenceImageUrls.length} reference image(s)`);
      for (const imgUrl of payload.referenceImageUrls) {
        try {
          let base64 = imgUrl;
          if (!imgUrl.startsWith("data:")) {
            const fetchRes = await fetch(imgUrl, { credentials: "omit", cache: "no-store" });
            if (!fetchRes.ok) {
              throw new Error(`Ref download HTTP ${fetchRes.status} for ${imgUrl.slice(0, 80)}`);
            }
            const blob = await fetchRes.blob();
            // Prefer arrayBuffer → base64 (FileReader can be flaky in SW)
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            const mime = blob.type || "image/jpeg";
            base64 = `data:${mime};base64,${btoa(binary)}`;
          }
          const uploadResult = await uploadReferenceImage(
            { base64Image: base64, projectId: activeProjectId },
            creds
          );
          console.log(`[GoogleLabsDriver] Reference image uploaded: ${uploadResult.mediaId}`);
          mediaIds.push(uploadResult.mediaId);
        } catch (uploadErr: any) {
          console.error(`[GoogleLabsDriver] Reference image upload failed (skipping this ref):`, uploadErr.message);
        }
      }
      if (mediaIds.length === 0) {
        console.warn(
          `[GoogleLabsDriver] All reference uploads failed — continuing as text-only image gen`
        );
      }
    }

    // 5. Execute generation based on type
    if (payload.mediaType === 'image') {
      let entityContext: any = null;
      const modelIdLower = String(payload.modelId || "").toLowerCase();
      const isXray = modelIdLower.includes("xray") || String(payload.generatorMode) === "xray";
      const entityTypeLower = String(payload.entityType || "").toLowerCase();
      const isLocation = entityTypeLower === "location" || entityTypeLower === "setting" || entityTypeLower === "scene";

      if (isXray) {
        console.log(`[GoogleLabsDriver] X-Ray Mode: Keeping only the storyboard reference image.`);
        if (mediaIds.length > 0) {
          mediaIds.splice(1);
        }
      }

      // Soft character entity (optional). Refs bind via IMAGE_INPUT_TYPE_REFERENCE only —
      // never SUBJECT/STYLE (those fields broke batchGenerateImages protobuf schema).
      const roles = payload.referenceImageRoles || [];
      const looksLikeCharacter =
        entityTypeLower === "character" ||
        entityTypeLower === "person" ||
        entityTypeLower === "hero" ||
        entityTypeLower === "cast" ||
        roles.some((r: string) => /character|subject|person|face|cast/i.test(String(r))) ||
        (mediaIds.length > 0 && !isLocation && !isXray);

      if (mediaIds.length > 0 && !isXray && !isLocation && looksLikeCharacter) {
        console.log(`[GoogleLabsDriver] Creating Character Entity for ${mediaIds.length} ref(s)...`);
        try {
          const entityId = await createGoogleLabsEntity(activeProjectId, creds, tabId, mediaIds);
          console.log(`[GoogleLabsDriver] Entity created: ${entityId}`);
          entityContext = {
            entityId,
            characterSlot: { imageReferenceIndex: 0 },
          };
        } catch (e: any) {
          console.warn(
            `[GoogleLabsDriver] Entity create failed — will rely on imageInputs REFERENCE only:`,
            e.message
          );
        }
      } else if (mediaIds.length > 0) {
        console.log(`[GoogleLabsDriver] Refs present (${mediaIds.length}) without entity — imageInputs REFERENCE only`);
      } else {
        console.warn(`[GoogleLabsDriver] No mediaIds after upload — text-only generation (will NOT match user REFS)`);
      }

      const genRes = await generateImage({
        prompt: payload.prompt,
        mediaIds: mediaIds,
        projectId: activeProjectId,
        modelId: isXray ? "xray" : payload.modelId,
        aspectRatio: payload.aspectRatio,
        entityContext: entityContext,
        numOutputs: 1
      }, creds, recaptchaToken, tabId);

      if (genRes.success && genRes.images && genRes.images.length > 0) {
        if (payload.referenceImageUrls?.length && !(genRes as any).usedRefCount) {
          console.warn(
            `[GoogleLabsDriver] WARNING: user sent ${payload.referenceImageUrls.length} REFS but generation used 0 — likeness will not match`
          );
        }
        return {
          success: true,
          outputUrls: genRes.images.map((img: any) => img.url),
          rawResponse: genRes,
          actualMeta: {
            projectId: genRes.projectId || activeProjectId,
            usedRefCount: (genRes as any).usedRefCount ?? mediaIds.length,
            requestedRefCount: payload.referenceImageUrls?.length || 0,
            imageModelName: (genRes as any).imageModelName,
          }
        };
      }
      throw new Error("No output URLs generated from Google Labs Pinhole");
    } 
    
    if (payload.mediaType === 'video') {
      const activeModelId = payload.modelId || "veo-lite";
      const isR2V = mediaIds.length > 0;
      const rawModelKey = this.normalizeVideoModelKey(isR2V ? "r2v" : "t2v", activeModelId, payload.duration);

      const genRes = await generateVideo({
        prompt: payload.prompt,
        mediaIds: mediaIds,
        projectId: activeProjectId,
        aspectRatio: payload.aspectRatio,
        videoModelKey: rawModelKey,
        duration: payload.duration,
        numOutputs: 1
      }, creds, recaptchaToken, tabId);

      if (!genRes.success || !genRes.operationIds || genRes.operationIds.length === 0) {
        throw new Error("Failed to initialize video generation task on Google Labs");
      }

      console.log(`[GoogleLabsDriver] Video task queued. Operations:`, genRes.operationIds);
      
      // 6. Polling for video generation (Veo video model takes 10s - 45s)
      const maxPollAttempts = 40;
      let attempt = 0;
      const mediaIdToCheck = genRes.operationIds[0];

      while (attempt < maxPollAttempts) {
        attempt++;
        console.log(`[GoogleLabsDriver] Polling video status (Attempt ${attempt}/${maxPollAttempts}) for media: ${mediaIdToCheck}`);
        await new Promise(r => setTimeout(r, 4000));

        try {
          const statusRes = await checkVideoGenerationStatus([mediaIdToCheck], creds, genRes.projectId || activeProjectId);
          const mediaObj = statusRes?.media?.[0];
          if (!mediaObj) continue;

          const status = mediaObj.mediaMetadata?.mediaStatus?.mediaGenerationStatus || mediaObj.mediaStatus?.mediaGenerationStatus;
          console.log(`[GoogleLabsDriver] Current status: ${status}`);

          if (status === 'MEDIA_GENERATION_STATUS_SUCCEEDED' || status === 'MEDIA_GENERATION_STATUS_DONE' || status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') {
            const finalUrl = mediaObj?.video?.generatedVideo?.fifeUrl || mediaObj?.video?.generatedVideo?.url;
            if (finalUrl) {
              return {
                success: true,
                outputUrls: [finalUrl],
                rawResponse: statusRes
              };
            }
          } else if (status === 'MEDIA_GENERATION_STATUS_FAILED' || status === 'MEDIA_GENERATION_STATUS_ERROR') {
            const errDetail = mediaObj.mediaMetadata?.mediaStatus?.errorMessage || "Unknown error";
            throw new Error(`Google Labs video generation failed: ${errDetail}`);
          }
        } catch (pollErr: any) {
          console.warn(`[GoogleLabsDriver] Polling error on attempt ${attempt}:`, pollErr.message);
        }
      }
      throw new Error(`Video generation timed out after polling for 160 seconds.`);
    }

    if (payload.mediaType === 'text') {
      const textRes = await generateText({
        prompt: payload.prompt
      }, creds, recaptchaToken, tabId);
      
      return {
        success: true,
        outputUrls: [],
        rawResponse: textRes
      };
    }

    throw new Error(`Unsupported mediaType: ${payload.mediaType}`);
  }

  private normalizeVideoModelKey(mode: "t2v" | "r2v", modelId: string, durationSeconds?: number): string {
    const model = String(modelId || "").trim().toLowerCase();
    const durationVal = durationSeconds ? parseInt(String(durationSeconds).replace("s", ""), 10) : 0;
    const suffix = (durationVal === 4) ? "_4s" : ((durationVal === 6) ? "_6s" : "");

    if (!model || model === "auto" || model === "default" || model === "veo-lite" || model === "veo-2") {
      if (mode === "r2v") {
        return "veo_3_1_r2v_lite_low_priority";
      } else {
        if (suffix) {
          return `veo_3_1_t2v_lite${suffix}_low_priority`;
        }
        return "veo_3_1_t2v_lite_low_priority";
      }
    }
    
    if (model === "veo-pro") {
      if (mode === "r2v") {
        return "veo_3_1_r2v_fast_landscape";
      } else {
        if (suffix) {
          return `veo_3_1_t2v_fast${suffix}`;
        }
        return "veo_3_1_t2v_fast_ultra";
      }
    }
    
    let normalized = model;
    if (mode === "r2v") {
      normalized = model.includes("t2v") ? model.replace("t2v", "r2v") : model;
    } else {
      normalized = model.includes("r2v") ? model.replace("r2v", "t2v") : model;
    }
    return normalized;
  }

  private async getOrCreateLabsTab(): Promise<{ tabId: number; isDedicated: boolean }> {
    return new Promise((resolve) => {
      // 1. Prioritize any open project tab
      chrome.tabs.query({ url: "*://labs.google/fx/tools/flow/project/*" }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id) {
          resolve({ tabId: tabs[0].id, isDedicated: false });
          return;
        }
        // 2. Any labs.google tab
        chrome.tabs.query({ url: "*://labs.google/*" }, (tabs) => {
          if (tabs && tabs.length > 0 && tabs[0].id) {
            resolve({ tabId: tabs[0].id, isDedicated: false });
            return;
          }
          // 3. Fallback: create dedicated tab
          chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: false }, async (newTab) => {
            if (newTab && newTab.id) {
              await waitForTabComplete(newTab.id, 6000);
              resolve({ tabId: newTab.id, isDedicated: true });
            } else {
              resolve({ tabId: -1, isDedicated: true });
            }
          });
        });
      });
    });
  }
}
