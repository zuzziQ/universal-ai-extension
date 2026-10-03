/**
 * Content script running in MAIN world on flow.google.com and labs.google/fx/*
 * Provides direct access to window.grecaptcha for fast, reliable reCAPTCHA token minting.
 * Eliminates slow DOM polling and script injection delays.
 */
const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

let captchaMintTail: Promise<void> = Promise.resolve();

async function mintCaptcha(pageAction: string): Promise<string> {
  const previous = captchaMintTail.catch(() => {});
  let release: () => void = () => {};
  captchaMintTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await waitForGrecaptcha();
    return await (window as any).grecaptcha.enterprise.execute(SITE_KEY, {
      action: pageAction,
    });
  } finally {
    release();
  }
}

function waitForGrecaptcha(timeout = 25000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if ((window as any).grecaptcha?.enterprise?.execute) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('grecaptcha enterprise not available on page'));
      setTimeout(check, 150);
    };
    check();
  });
}

window.addEventListener('GET_CAPTCHA', async (e: any) => {
  const { requestId, pageAction } = e.detail || {};
  try {
    const token = await mintCaptcha(pageAction || 'IMAGE_GENERATION');
    window.dispatchEvent(
      new CustomEvent('CAPTCHA_RESULT', {
        detail: { requestId, token },
      })
    );
  } catch (err: any) {
    window.dispatchEvent(
      new CustomEvent('CAPTCHA_RESULT', {
        detail: { requestId, error: err?.message || String(err) },
      })
    );
  }
});

console.log('[Universal Ext] Google Flow Fast-reCAPTCHA Bridge (MAIN world) initialized');
