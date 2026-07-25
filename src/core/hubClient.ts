import { getHubApiClient } from './api';

export async function checkoutAccount(provider: string) {
  try {
    const apiClient = await getHubApiClient();
    const data = await chrome.storage.local.get(["workerName"]);
    const workerId = data.workerName || "universal-worker";

    console.log(`[hubClient] Checking out account for ${provider}...`);
    const res = await apiClient.post('/worker/v1/account/cookies/checkout', {
      provider: provider.toUpperCase(),
      workerId
    });
    
    if (res && res.data) {
      return res.data; // Should contain accountId, email, cookiesJson
    }
    return null;
  } catch (err: any) {
    console.error(`[hubClient] Failed to checkout account:`, err.message);
    return null;
  }
}

export async function checkinAccount(accountId: string, pointsDeducted: number, status: string = 'ACTIVE', newCookiesJson?: string, jobResult?: any) {
  try {
    const apiClient = await getHubApiClient();
    console.log(`[hubClient] Checking in account ${accountId}...`);
    
    await apiClient.post('/worker/v1/account/cookies/checkin', {
      accountId,
      pointsDeducted,
      status,
      newCookiesJson,
      jobId: jobResult?.taskId,
      mediaUrls: jobResult?.outputUrls
    });
  } catch (err: any) {
    console.error(`[hubClient] Failed to checkin account ${accountId}:`, err.message);
  }
}

export async function submitJobResult(taskId: string, provider: string, result: any) {
  let wsReported = false;
  
  if (!result.email) {
    const storageIdentity = await chrome.storage.local.get(["googleEmail"]) as { googleEmail?: string };
    result.email = storageIdentity.googleEmail || "";
  }

  try {
    console.log(`[Background] Reporting task ${taskId} result via Offscreen WebSocket...`);
    const response = await chrome.runtime.sendMessage({
      type: "SUBMIT_RESULT_WS",
      taskId,
      provider,
      result
    }).catch(() => null);

    if (response && response.success) {
      wsReported = true;
    }
  } catch (err: any) {
    console.warn(`[Background] Failed to report result via Offscreen WS:`, err.message);
  }

  if (!wsReported) {
    try {
      const apiClient = await getHubApiClient();

      if (result.success) {
        await apiClient.post(`/worker/v1/jobs/${taskId}/complete`, {
          status: "done",
          outputUrls: result.outputUrls || [],
          errorMessage: result.error || undefined,
          executed_by: result.email
        });
      } else {
        await apiClient.post(`/worker/v1/jobs/${taskId}/complete`, {
          status: "failed",
          outputUrls: result.outputUrls || [],
          errorMessage: result.error || undefined,
          executed_by: result.email
        });
      }
    } catch (e: any) {
      console.error(`[Background] Failed to submit job result over HTTP Fallback:`, e.message);
    }
  }
}

export async function syncDirectJobsToHub(jobs: any[]) {
  try {
    const apiClient = await getHubApiClient();

    console.log(`[hubClient] Syncing ${jobs.length} direct jobs to Hub...`);
    const resJson = await apiClient.post('/worker/v1/jobs/direct-sync', { jobs });
    console.log(`[hubClient] Sync direct jobs result:`, JSON.stringify(resJson));
  } catch (err: any) {
    console.warn(`[hubClient] Failed to sync direct jobs:`, err.message);
  }
}
