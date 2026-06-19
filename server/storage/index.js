// Storage backend factory. Pick a backend in config; add more here easily.

import * as s3 from './s3.js';

export async function testStorage(cfg) {
  if (cfg.storage.backend === 'url') return { ok: true, note: 'Manueller URL-Modus: kein Upload, kein Test nötig.' };
  if (cfg.storage.backend === 's3') { await s3.testConnection(cfg.storage.s3); return { ok: true }; }
  throw new Error(`Unbekanntes Storage-Backend: ${cfg.storage.backend}`);
}

// Returns { url, key? }. For "url" backend there is no upload — the public URL is
// provided by the caller (the user pasted it in the UI).
export async function uploadVideo(cfg, { filePath, key, contentType, manualUrl, onProgress }) {
  if (cfg.storage.backend === 'url') {
    if (!manualUrl) throw new Error('URL-Modus: bitte eine öffentliche Video-URL angeben.');
    onProgress?.({ loaded: 1, total: 1, percent: 100 });
    return { url: manualUrl };
  }
  if (cfg.storage.backend === 's3') {
    return s3.upload(cfg.storage.s3, { filePath, key, contentType, onProgress });
  }
  throw new Error(`Unbekanntes Storage-Backend: ${cfg.storage.backend}`);
}
