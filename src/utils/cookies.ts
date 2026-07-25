// Reusable Cookie Synchronization Helper for Universal Extension Drivers

/**
 * Synchronizes a list of cookie objects with the Chrome browser environment.
 * Enables drivers to make CORS-bypassing requests directly to AI backend servers.
 * 
 * @param cookies List of decrypted cookies retrieved from the database
 * @param targetUrl The target domain url (e.g. 'https://dreamina.capcut.com')
 * @param defaultDomain Optional default domain fallback (e.g. '.capcut.com')
 */
export async function syncCookies(
  cookies: any[],
  targetUrl: string,
  defaultDomain?: string
): Promise<void> {
  // Clear existing cookies for the domain to prevent multi-account hybrid session collision
  if (defaultDomain) {
    try {
      const domainToSearch = defaultDomain.startsWith('.') ? defaultDomain : `.${defaultDomain}`;
      const existing = await chrome.cookies.getAll({ domain: domainToSearch });
      console.log(`[CookieSync] Found ${existing.length} existing cookies for domain ${domainToSearch}. Clearing...`);
      for (const cookie of existing) {
        const isDomainCookie = cookie.domain.startsWith('.');
        const host = isDomainCookie ? cookie.domain.substring(1) : cookie.domain;
        const removeUrl = `https://${host}${cookie.path}`;
        await chrome.cookies.remove({
          url: removeUrl,
          name: cookie.name
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`[CookieSync] Failed to clear existing cookies:`, err.message);
    }
  }

  if (!cookies || cookies.length === 0) {
    console.warn(`[CookieSync] No cookies provided to sync for url: ${targetUrl}`);
    return;
  }

  const expirationDate = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  console.log(`[CookieSync] Syncing ${cookies.length} cookies. Sample fields: ${Object.keys(cookies[0] || {}).join(', ')}`);
  
  let successCount = 0;
  for (const cookie of cookies) {
    try {
      const origDomain = cookie.domain || defaultDomain || new URL(targetUrl).hostname;
      const isDomainCookie = origDomain.startsWith('.');
      const host = isDomainCookie ? origDomain.substring(1) : origDomain;
      const url = `https://${host}`;

      await chrome.cookies.set({
        url: url,
        name: cookie.name,
        value: cookie.value,
        domain: origDomain,
        path: cookie.path || '/',
        secure: cookie.secure !== false,  // Giữ secure flag từ cookie gốc hoặc default true
        expirationDate: cookie.expirationDate || expirationDate
      });
      successCount++;
    } catch (err: any) {
      console.error(`[CookieSync] Failed to set cookie ${cookie.name} for ${targetUrl}:`, err.message);
    }
  }
  console.log(`[CookieSync] ✅ Set ${successCount}/${cookies.length} cookies successfully.`);
}
