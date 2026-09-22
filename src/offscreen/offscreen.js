/** Document offscreen : crée et libère les URL blob des fichiers convertis. */

const urls = new Set();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  try {
    if (msg.type === 'create-blob-url') {
      const parts = msg.bom ? ['\uFEFF', msg.text] : [msg.text];
      const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }));
      urls.add(url);
      sendResponse({ url });
    } else if (msg.type === 'revoke') {
      if (urls.delete(msg.url)) URL.revokeObjectURL(msg.url);
      sendResponse({ remaining: urls.size });
    } else {
      sendResponse({ error: `message inconnu : ${msg.type}` });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return false;
});
