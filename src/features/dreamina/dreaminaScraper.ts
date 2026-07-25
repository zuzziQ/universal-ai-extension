export async function scrapeDreaminaPoints(tabId: number, retryOnNull = true): Promise<number | "logged_out" | null> {
  const runScrape = async (): Promise<number | "logged_out" | null> => {
    try {
      const pointsResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          return new Promise<any>((resolve) => {
            let attempts = 0;
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
                      
                      // 1. Parse from benefit_details array (for vip/benefit_info)
                      if (data.benefit_details && Array.isArray(data.benefit_details)) {
                        const creditDetail = data.benefit_details.find((b: any) => b.benefit_type === 'aigc_credits');
                        if (creditDetail && creditDetail.left_amount !== undefined && creditDetail.left_amount !== null) {
                          resolveCallback(Number(creditDetail.left_amount));
                          return;
                        }
                      }
                      
                      // 2. Parse directly
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

            const interval = setInterval(() => {
              attempts++;

              // 1. Thử lấy qua API trước
              if (attempts === 1 || attempts % 5 === 0) {
                tryFetchAPI((apiPoints) => {
                  if (apiPoints !== null && apiPoints >= 0) {
                    clearInterval(interval);
                    resolve(apiPoints);
                  }
                });
              }

              // 2. Tự động click đóng modal quảng cáo đè lên nếu có
              const closeButtons = document.querySelectorAll(
                '[class*="modal-close"], [class*="close-btn"], [class*="close-icon"], button[class*="close"], [class*="Modal"] [class*="close"]'
              );
              for (const btn of Array.from(closeButtons)) {
                (btn as HTMLElement).click();
              }

              // 3. Kiểm tra logout qua DOM
              const bodyText = document.body.innerText || "";
              const isLoginPage = window.location.href.includes('/login') || 
                                  bodyText.includes("Sign in") || 
                                  bodyText.includes("Đăng nhập") ||
                                  !!document.querySelector('[class*="login-button"]') ||
                                  !!document.querySelector('button.login-btn');
              if (isLoginPage) {
                clearInterval(interval);
                resolve("logged_out");
                return;
              }
              
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

              // 4. Hover vào credit element chính
              const creditEl = document.querySelector('#SiderMenuCredit') as HTMLElement;
              if (creditEl) {
                creditEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                creditEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                const txt = creditEl.textContent || "";
                const parsed = cleanPoints(txt);
                if (parsed !== null && parsed >= 0) {
                  clearInterval(interval);
                  resolve(parsed);
                  return;
                }
              }

              // 5. Hover & quét các class chứa keyword credit/balance/point
              const els = document.querySelectorAll(
                '[class*="credit-amount-text"], [class*="credit_amount"], [class*="credit"], [class*="Credit"], [class*="balance"], [class*="Balance"], [class*="coin"], [data-testid*="credit"], [class*="point"], [class*="Point"]'
              );
              for (const el of Array.from(els)) {
                (el as HTMLElement).dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                (el as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                const txt = el.textContent || "";
                if (txt.length < 20) {
                  const parsed = cleanPoints(txt);
                  if (parsed !== null && parsed >= 0 && parsed < 100000) {
                    clearInterval(interval);
                    resolve(parsed);
                    return;
                  }
                }
              }

              // 6. Quét fallback trong toàn bộ các thẻ text ngắn
              const allElements = document.querySelectorAll('span, div, p');
              for (const el of Array.from(allElements)) {
                const txt = el.textContent?.trim() || "";
                if (txt.length > 0 && txt.length < 30) {
                  const hasMatch = /([\d,.]+)\s*(điểm|tín dụng|credits?|points?|daily points?|k)/i.test(txt) || 
                                   /^\+\s*([\d,.]+)\s*(k)?$/i.test(txt);
                  if (hasMatch) {
                    const parsed = cleanPoints(txt);
                    if (parsed !== null && parsed >= 0 && parsed < 100000) {
                      clearInterval(interval);
                      resolve(parsed);
                      return;
                    }
                  }
                }
              }

              // 7. Timeout sau 30 attempts (15 giây)
              if (attempts >= 30) {
                clearInterval(interval);
                resolve(null);
              }
            }, 500);
          });
        }
      });
      return pointsResult?.[0]?.result ?? null;
    } catch (err: any) {
      console.warn("[scrapeDreaminaPoints] executeScript error:", err.message);
      return null;
    }
  };

  console.log(`[scrapeDreaminaPoints] Starting scraping for tabId ${tabId}...`);
  let res = await runScrape();
  if (res === null && retryOnNull) {
    console.log("[scrapeDreaminaPoints] Result was null. Waiting 10 seconds to retry...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    console.log("[scrapeDreaminaPoints] Retrying scraping after 10s...");
    res = await runScrape();
  }
  return res;
}
