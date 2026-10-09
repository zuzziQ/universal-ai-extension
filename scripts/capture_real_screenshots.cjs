const { chromium } = require('/Users/imam/storymee/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const distPath = path.resolve(__dirname, '../dist');
const outDir = path.resolve(__dirname, '../docs/images');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

(async () => {
  const context = await chromium.launchPersistentContext('/tmp/ext-screenshot-profile', {
    headless: false,
    viewport: { width: 1440, height: 920 },
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  const extensionId = background.url().split('/')[2];
  console.log('Detected Extension ID:', extensionId);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await page.evaluate(async () => {
    const mockJobs = [
      {
        id: 'job-gflow-98214',
        mediaType: 'image',
        prompt: 'Cinematic portrait of Vietnamese cyberpunk girl with glowing neon lotus lantern, 8k octane render, hyper-detailed, neon reflections',
        provider: 'GFLOW',
        status: 'done',
        timestamp: Date.now() - 1000 * 60 * 3,
        resultUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80',
        modelDisp: 'Imagen 3 (Narwhal)',
        ratioDisp: '16:9',
        durationDisp: '—',
        executedBy: 'worker-desktop-mac-01'
      },
      {
        id: 'job-dream-43891',
        mediaType: 'video',
        prompt: 'Dynamic drone flythrough majestic misty mountain canyon with emerald waterfalls at sunrise, cinematic lighting 4k',
        provider: 'DREAMINA',
        status: 'done',
        timestamp: Date.now() - 1000 * 60 * 12,
        resultUrl: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80',
        modelDisp: 'Dreamina Video v3.0',
        ratioDisp: '16:9',
        durationDisp: '5s',
        executedBy: 'worker-desktop-mac-01'
      },
      {
        id: 'job-gflow-98215',
        mediaType: 'image',
        prompt: 'Watercolor storybook illustration of cute detective cat in cozy vintage library investigating mysterious ancient book, soft warm lighting',
        provider: 'GFLOW',
        status: 'processing',
        timestamp: Date.now() - 1000 * 25,
        modelDisp: 'Imagen 3',
        ratioDisp: '1:1',
        durationDisp: '—',
        executedBy: 'worker-desktop-mac-01'
      },
      {
        id: 'job-picsart-1029',
        mediaType: 'image',
        prompt: 'Pop-art retro comic character sticker with bold vibrant halftone outlines and pastel accents',
        provider: 'PICSART',
        status: 'done',
        timestamp: Date.now() - 1000 * 60 * 45,
        resultUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80',
        modelDisp: 'Picsart AI Gen',
        ratioDisp: '1:1',
        durationDisp: '—',
        executedBy: 'worker-desktop-mac-01'
      },
      {
        id: 'job-topview-5512',
        mediaType: 'video',
        prompt: 'Modern luxury organic tea tin unboxing with dynamic cinematic camera rotation and particle sparks',
        provider: 'TOPVIEW',
        status: 'done',
        timestamp: Date.now() - 1000 * 60 * 75,
        resultUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=800&q=80',
        modelDisp: 'TopView Commercial',
        ratioDisp: '9:16',
        durationDisp: '10s',
        executedBy: 'worker-desktop-mac-01'
      }
    ];

    const mockAccounts = {
      dreamina_accounts: [
        { email: 'studio.dream01@gmail.com', points: 150, status: 'active', pool: 'vip' },
        { email: 'creator.dream02@gmail.com', points: 84, status: 'active', pool: 'standard' },
        { email: 'render.dream03@gmail.com', points: 40, status: 'active', pool: 'backup' }
      ],
      gflow_accounts: [
        { email: 'flow.render01@gmail.com', points: 300, status: 'active', pool: 'default' },
        { email: 'flow.render02@gmail.com', points: 195, status: 'active', pool: 'default' },
        { email: 'creator.flow03@gmail.com', points: 120, status: 'active', pool: 'backup' }
      ],
      picsart_accounts: [
        { email: 'picsart.art01@gmail.com', points: 50, status: 'active', pool: 'default' }
      ],
      topview_accounts: [
        { email: 'topview.video01@gmail.com', points: 80, status: 'active', pool: 'default' }
      ],
      active_emails: {
        GFLOW: 'flow.render01@gmail.com',
        DREAMINA: 'studio.dream01@gmail.com',
        PICSART: 'picsart.art01@gmail.com',
        TOPVIEW: 'topview.video01@gmail.com'
      }
    };

    await chrome.storage.local.set({
      workerState: 'ONLINE',
      gflowUrl: 'https://hub.storymee.com',
      workerName: 'worker-desktop-mac-01',
      hub_api_key: 'sk-storymee-prod-worker-****************',
      selected_provider: 'GFLOW',
      recent_jobs_list: mockJobs,
      ...mockAccounts
    });
  });

  await page.reload();
  await page.waitForTimeout(1200);

  console.log('Capturing Dashboard (Jobs tab)...');
  await page.screenshot({ path: path.join(outDir, 'dashboard_jobs.png') });

  console.log('Switching to Accounts tab...');
  const accountsBtn = await page.locator('nav button:has-text("ACCOUNTS")');
  if (await accountsBtn.count() > 0) {
    await accountsBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'dashboard_accounts.png') });
  }

  console.log('Switching to Settings tab...');
  const settingsBtn = await page.locator('nav button:has-text("SETTINGS")');
  if (await settingsBtn.count() > 0) {
    await settingsBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, 'dashboard_settings.png') });
  }

  console.log('Capturing Sidepanel...');
  const sidepanelPage = await context.newPage();
  await sidepanelPage.setViewportSize({ width: 390, height: 750 });
  await sidepanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanelPage.waitForTimeout(1200);
  await sidepanelPage.screenshot({ path: path.join(outDir, 'sidepanel_view.png') });

  // Sidepanel settings/accounts tab
  const sidepanelTabBtn = await sidepanelPage.locator('button:has-text("CÀI ĐẶT")');
  if (await sidepanelTabBtn.count() > 0) {
    await sidepanelTabBtn.click();
    await sidepanelPage.waitForTimeout(600);
    await sidepanelPage.screenshot({ path: path.join(outDir, 'sidepanel_settings.png') });
  }

  await context.close();
  console.log('All real screenshots captured successfully!');
})();
