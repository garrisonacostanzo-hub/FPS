// Durable storage for progress: every save goes to BOTH cookies and localStorage, and loading picks whichever copy
// is newer. Cookies are what the player asked for; localStorage is the safety net, because some browsers ignore
// cookies on pages opened straight from a file (file://). Values are JSON, split across several cookies if large.
const COOKIE_CHUNK = 3500;          // characters per cookie (browsers allow ~4 KB each)
const COOKIE_DAYS = 3650;           // ten years

function cookieNames() {
  try { return document.cookie ? document.cookie.split('; ') : []; } catch { return []; }
}

function readCookie(name) {
  for (const part of cookieNames()) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

function writeCookie(name, value, days = COOKIE_DAYS) {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax${secure}`;
  } catch { /* cookies unavailable */ }
}

function saveCookies(key, json) {
  const encoded = encodeURIComponent(json);
  const chunks = Math.ceil(encoded.length / COOKIE_CHUNK) || 1;
  const old = Number(readCookie(key + '_n')) || 0;
  for (let i = 0; i < chunks; i++) writeCookie(`${key}_${i}`, encoded.slice(i * COOKIE_CHUNK, (i + 1) * COOKIE_CHUNK));
  for (let i = chunks; i < old; i++) writeCookie(`${key}_${i}`, '', -1);
  writeCookie(key + '_n', String(chunks));
}

function loadCookies(key) {
  const n = Number(readCookie(key + '_n')) || 0;
  if (!n) return null;
  let encoded = '';
  for (let i = 0; i < n; i++) {
    const part = readCookie(`${key}_${i}`);
    if (part === null) return null;
    encoded += part;
  }
  try { return JSON.parse(decodeURIComponent(encoded)); } catch { return null; }
}

function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

/** Saves an object (it should carry a numeric `ts` timestamp) to cookies and localStorage. */
export function saveData(key, obj) {
  const json = JSON.stringify(obj);
  try { localStorage.setItem(key, json); } catch { /* storage unavailable */ }
  saveCookies(key, json);
}

/** Loads the newest copy from cookies or localStorage, or null. */
export function loadData(key) {
  const a = loadCookies(key), b = loadLocal(key);
  if (a && b) return (a.ts || 0) >= (b.ts || 0) ? a : b;
  return a || b;
}

/** Which storage actually works here (shown in the profile screen). */
export function storageStatus() {
  let cookies = false, local = false;
  try {
    writeCookie('vg_probe', '1', 1);
    cookies = readCookie('vg_probe') === '1';
  } catch { /* ignore */ }
  try { localStorage.setItem('vg_probe', '1'); local = localStorage.getItem('vg_probe') === '1'; } catch { /* ignore */ }
  return { cookies, local };
}

/** Portable backup code (copy/paste between browsers or devices). */
export function exportCode(obj) {
  const json = JSON.stringify(obj);
  return 'VG1.' + btoa(unescape(encodeURIComponent(json)));
}

export function importCode(code) {
  const text = String(code || '').trim();
  if (!text.startsWith('VG1.')) throw new Error('That is not a VANGUARD backup code.');
  return JSON.parse(decodeURIComponent(escape(atob(text.slice(4)))));
}
