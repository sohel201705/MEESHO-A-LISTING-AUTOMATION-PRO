const BRIDGE_URL = 'https://sohel201705.github.io/MEESHO-A-LISTING-AUTOMATION-PRO/admin/auth-bridge.html';
let iframe = null;

function sendToServiceWorker(payload) {
  chrome.runtime.sendMessage({ type:'OFFSCREEN_AUTH_RESULT', payload }).catch(()=>{});
}

async function startAuth() {
  if (iframe) iframe.remove();
  iframe = document.createElement('iframe');
  iframe.src = BRIDGE_URL;
  iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;left:-10px;top:-10px;border:0;';
  document.documentElement.appendChild(iframe);

  const targetOrigin = new URL(BRIDGE_URL).origin;
  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow.postMessage({ initAuth:true }, targetOrigin);
    } catch (e) {
      sendToServiceWorker({ type:'AUTH_ERROR', error:e?.message || 'Could not start Firebase authentication.' });
    }
  }, {once:true});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'START_OFFSCREEN_AUTH') {
    startAuth();
    sendResponse({ok:true});
    return true;
  }
});

window.addEventListener('message', event => {
  if (event.source !== iframe?.contentWindow) return;
  const data = event.data;
  if (!data || data.source !== 'meesho-firebase-auth') return;
  sendToServiceWorker(data);
});

chrome.runtime.sendMessage({type:'OFFSCREEN_READY'}).catch(()=>{});
