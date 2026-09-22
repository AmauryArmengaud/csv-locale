/**
 * Injecté en MAIN world, à document_start, uniquement sur les sites configurés.
 *
 * 1. Rétention des Blob
 *    Beaucoup d'exports CSV font : createObjectURL(blob) → clic → revokeObjectURL().
 *    L'URL est révoquée avant que l'extension puisse la relire. On garde une
 *    référence aux Blob textuels et on diffère leur révocation de 5 minutes.
 *
 * 2. Téléchargements à usage unique
 *    Certains serveurs ne servent un fichier préparé qu'une seule fois
 *    (Oracle APEX : wwv_flow.ajax?...downloadFileId=...). Une relecture par
 *    l'extension renvoie alors 404. On intercepte la navigation de
 *    téléchargement (Navigation API), on effectue l'unique requête nous-mêmes,
 *    puis on remet le fichier à l'utilisateur via un Blob : octets et nom
 *    identiques, et l'extension peut le lire sans solliciter le serveur.
 *
 * Aucune donnée ne sort de la page : l'extension lit le Blob à la demande.
 * Toute erreur est absorbée : le hook ne doit jamais casser le site.
 */
(() => {
  'use strict';
  const KEY = '__csvLocaleFrHook';
  if (Object.prototype.hasOwnProperty.call(window, KEY)) return;

  /* ----------------------------- 1. Blobs ----------------------------- */

  const RETENTION_MS = 5 * 60 * 1000;
  const MAX_BYTES = 200 * 1024 * 1024;
  const TYPE_RE = /csv|text\/|octet-stream|excel|comma-separated/i;

  const nativeCreate = URL.createObjectURL;
  const nativeRevoke = URL.revokeObjectURL;
  const nativeFetch = window.fetch.bind(window);
  const store = new Map();
  const deferred = new Set();

  const isCandidate = (obj) => obj instanceof Blob && obj.size <= MAX_BYTES && (!obj.type || TYPE_RE.test(obj.type));

  function createObjectURL(obj) {
    const url = nativeCreate.call(URL, obj);
    try {
      if (isCandidate(obj)) {
        store.set(url, obj);
        setTimeout(() => {
          store.delete(url);
          if (deferred.delete(url)) nativeRevoke.call(URL, url);
        }, RETENTION_MS);
      }
    } catch {
      /* ne jamais casser la page */
    }
    return url;
  }

  function revokeObjectURL(url) {
    if (store.has(url)) {
      deferred.add(url); // révocation effectuée à expiration
      return undefined;
    }
    return nativeRevoke.call(URL, url);
  }

  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true, configurable: true });
  Object.defineProperty(window, KEY, {
    value: Object.freeze({ get: (url) => store.get(url) ?? null }),
    enumerable: false,
  });

  /* ------------------- 2. Téléchargements à usage unique ------------------- */

  // Règles dupliquées dans src/lib/urls.js (isOneTimeDownloadUrl) : garder synchronisées.
  function isOneTimeDownloadUrl(href) {
    try {
      const u = new URL(href, location.href);
      if (u.origin !== location.origin) return false;
      // Oracle APEX : rapports interactifs et grilles (fichier préparé puis servi une fois)
      if (/\/wwv_flow\.ajax$/i.test(u.pathname)) {
        let q = u.search;
        try {
          q = decodeURIComponent(q);
        } catch {
          /* on garde la version brute */
        }
        return q.includes('downloadFileId');
      }
      return false;
    } catch {
      return false;
    }
  }

  function filenameFromDisposition(header) {
    if (!header) return null;
    let m = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
    if (m) {
      try {
        return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
      } catch {
        /* on tente la forme simple */
      }
    }
    m = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header) || /filename\s*=\s*([^;]+)/i.exec(header);
    return m ? m[1].trim().replace(/\\(.)/g, '$1') : null;
  }

  /* ------------------------------ Journal ------------------------------ */

  // Journal de diagnostic lu par l'extension en cas d'échec (URL réduites au chemin).
  const HOOK_VERSION = 5;
  // Messages de console dans la langue du navigateur (français, sinon anglais).
  const FR = String(navigator.language || '').toLowerCase().startsWith('fr');
  const L = FR
    ? {
        active: 'hook actif', apex: 'API APEX détectée', intercept: 'interception', delivered: 'fichier remis',
        network: 'échec réseau', server: 'réponse serveur', deliveryFailed: 'remise impossible',
        notCancelable: 'navigation non annulable', noNavApi: 'Navigation API indisponible', error: 'erreur',
        htmlInsert: 'insertion HTML', observer: 'iframe insérée (observateur)', bytes: 'octets',
      }
    : {
        active: 'hook active', apex: 'APEX API detected', intercept: 'interception', delivered: 'file delivered',
        network: 'network failure', server: 'server response', deliveryFailed: 'delivery failed',
        notCancelable: 'navigation not cancelable', noNavApi: 'Navigation API unavailable', error: 'error',
        htmlInsert: 'HTML insertion', observer: 'inserted iframe (observer)', bytes: 'bytes',
      };
  const events = [];
  const shortUrl = (href) => {
    try {
      const u = new URL(href, location.href);
      return `${u.pathname}${u.search.includes('downloadFileId') ? ' [downloadFileId]' : ''}`;
    } catch {
      return '?';
    }
  };
  function log(kind, url, detail = '') {
    events.push({ t: Date.now(), kind, url: url ? shortUrl(url) : '', detail: String(detail).slice(0, 200) });
    if (events.length > 30) events.shift();
    console.info(`[CSV Locale FR] ${kind}`, url ? shortUrl(url) : '', detail);
  }

  /* --------------------------- Prise en charge --------------------------- */

  const inFlight = new Set();

  /**
   * Effectue l'unique requête, puis remet le fichier via un Blob.
   * @param {string} url
   * @param {string} via mécanisme intercepté (journal)
   * @param {(kind: 'network'|'http') => void} onFail repli : 'network' = rien n'a atteint le serveur
   */
  async function takeOver(url, via, onFail) {
    const abs = new URL(url, location.href).href;
    if (inFlight.has(abs)) return; // plusieurs mécanismes pour un même clic
    inFlight.add(abs);
    setTimeout(() => inFlight.delete(abs), 10000);
    log(L.intercept, abs, via);
    let res;
    try {
      res = await nativeFetch(abs, { credentials: 'include', cache: 'no-store' });
    } catch (e) {
      log(L.network, abs, e && e.message);
      onFail('network');
      return;
    }
    if (!res.ok) {
      log(L.server, abs, `HTTP ${res.status}`);
      onFail('http');
      return;
    }
    try {
      const blob = await res.blob();
      const name = filenameFromDisposition(res.headers.get('content-disposition')) || 'export.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); // passe par le hook : le Blob est conservé
      a.download = name;
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60 * 1000);
      log(L.delivered, abs, `${name} (${blob.size} ${L.bytes})`);
    } catch (e) {
      log(L.deliveryFailed, abs, e && e.message);
    }
  }

  const bypass = new Set();
  function navigateNatively(url) {
    const abs = new URL(url, location.href).href;
    bypass.add(abs);
    location.assign(abs);
  }

  /* a) Navigation du document (location.href, liens, formulaires GET) */
  const nav = window.navigation;
  if (nav && typeof nav.addEventListener === 'function') {
    nav.addEventListener('navigate', (event) => {
      try {
        if (event.navigationType === 'traverse' || event.hashChange || event.formData) return;
        const url = event.destination.url;
        if (bypass.delete(url)) return;
        if (!isOneTimeDownloadUrl(url)) return;
        if (!event.cancelable) {
          log(L.notCancelable, url);
          return;
        }
        event.preventDefault();
        takeOver(url, 'navigation', () => navigateNatively(url));
      } catch (e) {
        log(`${L.error} navigate`, '', e && e.message);
      }
    });
  } else {
    log(L.noNavApi);
  }

  /* b) Nouvelle fenêtre ou onglet (window.open, apex.navigation.openInNewWindow) */
  const nativeOpen = window.open;
  window.open = function open(url, ...rest) {
    try {
      if (url && isOneTimeDownloadUrl(String(url))) {
        takeOver(String(url), 'window.open', (kind) => kind === 'network' && nativeOpen.call(window, url, ...rest));
        // Fenêtre factice : l'appelant peut appeler focus() ou close() sans erreur.
        return { closed: true, focus() {}, blur() {}, close() {}, postMessage() {}, document: null, location: { href: '' } };
      }
    } catch (e) {
      log(`${L.error} window.open`, '', e && e.message);
    }
    return nativeOpen.call(window, url, ...rest);
  };

  /* c) Iframe cachée (src, setAttribute, insertion HTML) */
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      ...srcDesc,
      set(value) {
        if (value && isOneTimeDownloadUrl(String(value))) {
          takeOver(String(value), 'iframe.src', (kind) => kind === 'network' && srcDesc.set.call(this, value));
          return;
        }
        srcDesc.set.call(this, value);
      },
    });
  }
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function setAttribute(name, value) {
    if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'src' && isOneTimeDownloadUrl(String(value))) {
      takeOver(String(value), 'iframe.setAttribute', (kind) => kind === 'network' && nativeSetAttribute.call(this, name, value));
      return undefined;
    }
    return nativeSetAttribute.call(this, name, value);
  };
  // Iframes insérées toutes faites (jQuery, innerHTML) : neutralisées AVANT insertion.
  const nativeRemoveAttribute = Element.prototype.removeAttribute;
  function neutralizeTree(node, via) {
    if (!node || typeof node !== 'object') return;
    let frames = [];
    if (node instanceof HTMLIFrameElement) frames = [node];
    else if (typeof node.querySelectorAll === 'function') frames = node.querySelectorAll('iframe[src]');
    for (const f of frames) {
      const src = f.getAttribute('src');
      if (src && isOneTimeDownloadUrl(src)) {
        nativeRemoveAttribute.call(f, 'src');
        takeOver(src, via, (kind) => kind === 'network' && srcDesc.set.call(f, src));
      }
    }
  }
  const mayHoldIframe = (n) => n instanceof HTMLIFrameElement || n instanceof DocumentFragment || (n instanceof Element && n.childElementCount > 0);

  for (const [proto, names] of [
    [Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']],
    [Element.prototype, ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'insertAdjacentElement']],
  ]) {
    for (const name of names) {
      const native = proto[name];
      if (typeof native !== 'function') continue;
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: function (...args) {
          try {
            for (const a of args) if (mayHoldIframe(a)) neutralizeTree(a, `insertion (${name})`);
          } catch {
            /* ne jamais bloquer l'insertion */
          }
          return native.apply(this, args);
        },
      });
    }
  }

  // Chaînes HTML contenant une iframe de téléchargement : analysées dans un <template> inerte.
  const suspicious = (html) => typeof html === 'string' && /<iframe/i.test(html) && html.includes('downloadFileId');
  function safeFragment(html) {
    const t = document.createElement('template');
    t.innerHTML = html; // contenu inerte : aucune requête
    neutralizeTree(t.content, L.htmlInsert);
    return t.content;
  }
  const innerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerDesc && innerDesc.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ...innerDesc,
      set(html) {
        if (suspicious(html) && !(this instanceof HTMLTemplateElement)) {
          innerDesc.set.call(this, '');
          Element.prototype.replaceChildren.call(this, safeFragment(html));
          return;
        }
        innerDesc.set.call(this, html);
      },
    });
  }
  const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function insertAdjacentHTML(position, html) {
    if (suspicious(html)) {
      const frag = safeFragment(html);
      const map = { beforebegin: 'before', afterbegin: 'prepend', beforeend: 'append', afterend: 'after' };
      const method = map[String(position).toLowerCase()];
      if (method) return Element.prototype[method].call(this, frag);
    }
    return nativeInsertAdjacentHTML.call(this, position, html);
  };

  // Dernier filet (ex. document.write) : peut arriver trop tard si la requête est déjà partie.
  new MutationObserver((records) => {
    for (const r of records) for (const node of r.addedNodes) neutralizeTree(node, L.observer);
  }).observe(document, { childList: true, subtree: true });

  /* d) API APEX, enveloppée dès qu'elle est définie */
  function wrapApex() {
    try {
      const n = window.apex && window.apex.navigation;
      if (!n || n.__csvLocaleWrapped) return;
      const redirect = n.redirect;
      if (typeof redirect === 'function') {
        n.redirect = function (url, ...rest) {
          if (url && isOneTimeDownloadUrl(String(url))) {
            takeOver(String(url), 'apex.navigation.redirect', () => navigateNatively(String(url)));
            return undefined;
          }
          return redirect.call(this, url, ...rest);
        };
      }
      Object.defineProperty(n, '__csvLocaleWrapped', { value: true });
      log(L.apex);
    } catch (e) {
      log(`${L.error} APEX`, '', e && e.message);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapApex);
  else wrapApex(); // injection dans un onglet déjà chargé
  window.addEventListener('load', wrapApex);

  Object.defineProperty(window, '__csvLocaleFrDiag', {
    value: Object.freeze({ version: HOOK_VERSION, url: shortUrl(location.href), events: () => events.slice() }),
    enumerable: false,
  });
  log(L.active, location.href, `v${HOOK_VERSION}`);
})();
