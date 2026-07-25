const { chromium } = require('playwright');
const fs = require('fs');

const API_KEY = 'sk-hub-3sn2dcdxue9kx9pv00xw';
const API_URL = 'https://hub.storymee.com/api/accounts';
const PROVIDER = 'DREAMINA';
const POOL = 'internal_test_5';

async function fetchAccount() {
  const response = await fetch(`${API_URL}/checkout`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      provider: PROVIDER,
      pool: POOL,
      lock_duration: 300,
      workerId: 'automation_test_worker'
    })
  });
  const data = await response.json();
  if (data.success && data.account) {
    return data.account;
  }
  console.log('No account returned:', data);
  return null;
}

async function checkInAccount(accountId, status) {
  const response = await fetch(`${API_URL}/checkin`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      accountId: accountId,
      status: status,
      workerId: 'automation_test_worker'
    })
  });
  const data = await response.json();
  console.log(`Checked in account ${accountId} as ${status}. Response:`, data);
}

async function testAccounts() {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    
    let processedCount = 0;
    while (processedCount < 5) {
      console.log(`\n--- Fetching account ${processedCount + 1}/5 ---`);
      const account = await fetchAccount();
      if (!account) {
        console.log('No more accounts available or error fetching.');
        break;
      }
      
      console.log(`Testing account ID: ${account.id}, Username: ${account.username}`);
      
      const context = await browser.newContext();
      
      try {
        let cookies = [];
        if (account.cookie_data) {
          try {
             // Some cookies might be base64 encoded strings
             const decoded = Buffer.from(account.cookie_data, 'base64').toString('utf-8');
             if (decoded.startsWith('[') || decoded.startsWith('{')) {
               cookies = JSON.parse(decoded);
             } else {
               // Try raw JSON parse first
               cookies = JSON.parse(account.cookie_data);
             }
          } catch(e) {
             try {
               cookies = JSON.parse(account.cookie_data);
             } catch(e2) {
               console.error('Failed to parse cookies:', e2);
             }
          }
        }
        
        if (cookies && cookies.length > 0) {
          // Normalize cookies (Playwright expects name, value, domain, path, etc.)
          cookies = cookies.map(c => {
             // Remove invalid fields for Playwright setCookies
             const { hostOnly, session, storeId, ...validCookie } = c;
             // Ensure url or domain is set, if domain starts with . it's fine, otherwise sometimes it needs url. Playwright setCookies works best with domain/path.
             return validCookie;
          });
          await context.addCookies(cookies);
          console.log(`Injected ${cookies.length} cookies.`);
        } else {
          console.log('No cookies found for account.');
        }

        const page = await context.newPage();
        await page.goto('https://dreamina.capcut.com/', { waitUntil: 'networkidle', timeout: 30000 });
        
        // Let the page render and check for logged-in indicators
        await page.waitForTimeout(5000);
        
        // Dreamina specific: check if sign in button exists or if avatar exists
        // Wait for potential login status elements
        const notLoggedIn = await page.evaluate(() => {
          // check if there's a login/sign in text button
          const textMatches = Array.from(document.querySelectorAll('button, a, div')).some(el => {
            const text = el.textContent?.trim().toLowerCase();
            return (text === 'sign in' || text === 'log in' || text === 'login' || text === 'đăng nhập') && el.offsetParent !== null;
          });
          return textMatches;
        });
        
        const screenshotPath = `/Users/imam/storymee/5-Extension-Automations/universal-ai-extension/scratch/dreamina_acc_${account.id}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to ${screenshotPath}`);
        
        if (notLoggedIn) {
          console.log(`Account ${account.id} seems to be EXPIRED (Sign In button found).`);
          await checkInAccount(account.id, 'EXPIRED');
        } else {
          console.log(`Account ${account.id} seems to be ACTIVE (Logged in).`);
          await checkInAccount(account.id, 'ACTIVE');
        }
        
      } catch (err) {
        console.error(`Error testing account ${account.id}:`, err);
        await checkInAccount(account.id, 'ERROR');
      } finally {
        await context.close();
      }
      
      processedCount++;
    }
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testAccounts();
