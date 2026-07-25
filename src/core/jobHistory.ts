export interface SavedJob {
  id: string;
  mediaType: string;
  prompt: string;
  provider: string;
  status: 'pending' | 'processing' | 'done' | 'failed' | 'verifying';
  timestamp: number;
  resultUrl?: string;
  error?: string;
  projectId?: string;
  projectName?: string;
  projectLink?: string;
  inputParams?: any;
  source?: string;
  pool?: string;
  batchName?: string;
  executedBy?: string;
}

// Helper to save job history in local storage for the Sidepanel Dashboard
export async function saveOrUpdateJob(jobData: Partial<SavedJob>) {
  try {
    const storage = await chrome.storage.local.get(["recent_jobs_list"]) as { recent_jobs_list?: SavedJob[] };
    let list: SavedJob[] = storage.recent_jobs_list || [];
    const index = list.findIndex(j => j.id === jobData.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...jobData } as SavedJob;
    } else {
      list.unshift({
        id: jobData.id || "",
        mediaType: jobData.mediaType || "image",
        prompt: jobData.prompt || "",
        provider: jobData.provider || "GOOGLE_FLOW",
        status: jobData.status || "pending",
        timestamp: jobData.timestamp || Date.now(),
        resultUrl: jobData.resultUrl,
        error: jobData.error,
        projectId: jobData.projectId,
        projectName: jobData.projectName,
        projectLink: jobData.projectLink,
        inputParams: jobData.inputParams,
        source: jobData.source,
        pool: jobData.pool,
        batchName: jobData.batchName,
        executedBy: jobData.executedBy
      });
    }
    if (list.length > 50) {
      list = list.slice(0, 50);
    }
    await chrome.storage.local.set({ recent_jobs_list: list });
    chrome.runtime.sendMessage({ type: "JOB_UPDATED", list }).catch(() => {});
  } catch (e) {
    console.error("[Universal Ext] Error saving job in storage:", e);
  }
}

export function sanitizeLocationPrompt(prompt: string): string {
  if (!prompt) return prompt;
  
  const termsToRemove = [
    /expressive facial acting/gi,
    /comedic exaggeration/gi,
    /heroic cinematic posing/gi,
    /highly readable body language/gi,
    /smooth squash-and-stretch animation/gi,
    /smooth squash and stretch animation/gi,
    /action-comedy timing/gi,
    /playful but epicenergy/gi,
    /playful but epic energy/gi,
    /highreadability/gi,
    /high readability/gi,
    /body language/gi,
    /facial acting/gi,
    /facial expression/gi,
    /facial expressions/gi,
    /character pose/gi,
    /character poses/gi,
    /single character portrait/gi,
    /one single character pose/gi,
    /character sheet/gi,
    /turnaround/gi,
    /posing/gi,
    /squash-and-stretch/gi,
    /squash and stretch/gi
  ];
  
  let cleaned = prompt;
  for (const regex of termsToRemove) {
    cleaned = cleaned.replace(regex, "");
  }
  
  // Clean up punctuation (multiple commas, trailing commas, spaces)
  cleaned = cleaned.replace(/,\s*,/g, ',');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.trim().replace(/^,|,$/g, '').trim();
  
  // Append negative hints to prompt to enforce no characters
  if (!cleaned.toLowerCase().includes("no people")) {
    cleaned += ", No people";
  }
  if (!cleaned.toLowerCase().includes("no text")) {
    cleaned += ", No text";
  }
  
  return cleaned;
}
