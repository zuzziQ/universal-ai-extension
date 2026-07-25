// Injected Content Script for Google Labs FX
console.log("[Universal Ext] Content script injected into Google Labs...");

function extractToken() {
  const scripts = document.getElementsByTagName('script');
  for (let i = 0; i < scripts.length; i++) {
    const text = scripts[i].innerText || scripts[i].textContent;
    if (text && text.includes('ya29.')) {
      const tokenMatch = text.match(/(ya29\.[a-zA-Z0-9_\-\.]+)/);
      if (tokenMatch && tokenMatch[1].length > 20) {
        console.log('[Universal Ext] OAuth Token extracted from script tags');
        chrome.runtime.sendMessage({ action: 'saveToken', token: tokenMatch[1] }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

function extractIdentity() {
  try {
    let avatarUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    let email = '';
    let name = 'Google User';

    const elementsWithAria = document.querySelectorAll('[aria-label]');
    for (let i = 0; i < elementsWithAria.length; i++) {
      const ariaText = elementsWithAria[i].getAttribute('aria-label');
      if (ariaText && ariaText.includes('@')) {
        const emailMatch = ariaText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
        if (emailMatch) {
          email = emailMatch[1];
          let nameStr = ariaText.split('(')[0];
          if (nameStr.includes(':')) {
            nameStr = nameStr.split(':')[1];
          }
          nameStr = nameStr.replace('Google Account', '').replace('Tài khoản Google', '').trim();
          if (nameStr.length > 0) name = nameStr;
          break;
        }
      }
    }

    const images = document.getElementsByTagName('img');
    for (let i = 0; i < images.length; i++) {
      if (images[i].src && images[i].src.includes('lh3.googleusercontent.com/a/')) {
        avatarUrl = images[i].src;
        break;
      }
    }

    if (!email) {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].innerText || scripts[i].textContent;
        if (text && text.includes('@')) {
          const emailMatch = text.match(/"([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)"/);
          if (emailMatch) {
            email = emailMatch[1];
            break;
          }
        }
      }
    }

    const finalDisplayName = (name !== 'Google User' ? name + ' (' + email + ')' : email) || 'Google User';

    if (email) {
      chrome.runtime.sendMessage({ 
        action: 'saveIdentity', 
        avatar: avatarUrl, 
        email: finalDisplayName 
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[Universal Ext] Error extracting Google Identity:', e);
  }
}

// Fallback search in localStorage
if (!extractToken()) {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (value && value.includes('ya29.')) {
      const match = value.match(/(ya29\.[a-zA-Z0-9_\-\.]+)/);
      if (match && match[1].length > 20) {
        chrome.runtime.sendMessage({ action: 'saveToken', token: match[1] }).catch(() => {});
        break;
      }
    }
  }
}

// Periodic extraction to handle client-side rendering lag
setTimeout(extractIdentity, 2000);
setTimeout(extractIdentity, 6000);
setTimeout(extractIdentity, 12000);

// Listener to compress image URL via canvas
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'COMPRESS_IMAGE_URL' && request.url) {
    console.log("[Universal Ext] Received compression request for:", request.url);
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Avoid CORS tainted canvas issues
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxWidth = request.maxWidth || 1024;
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Compress as JPEG quality 0.8 to keep it lightweight (30-80KB)
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        console.log("[Universal Ext] Compression done. Base64 length:", base64.length);
        sendResponse({ success: true, base64 });
      } catch (e: any) {
        console.error("[Universal Ext] Canvas draw error:", e.message);
        sendResponse({ success: false, error: e.message });
      }
    };
    
    img.onerror = () => {
      console.error("[Universal Ext] Failed to load image for compression:", request.url);
      sendResponse({ success: false, error: 'Failed to load image' });
    };
    
    img.src = request.url;
    return true; // Keep message channel open for async response
  }
  return false;
});

