// Loads and saves beamclip configuration.
//
// Secrets (Buffer key, storage credentials) live in a local config.json that is
// gitignored. Nothing here is ever committed. Environment variables, if present,
// take precedence so the app can also run headless / in CI.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.BEAMCLIP_CONFIG || path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  buffer: { apiKey: '' },
  storage: {
    // "s3"  -> any S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, MinIO …)
    // "url" -> no upload; you paste an already-public video URL yourself
    backend: 's3',
    s3: {
      endpoint: '',        // e.g. https://<accountid>.r2.cloudflarestorage.com  (leave blank for AWS S3)
      region: 'auto',      // R2: "auto"; AWS: e.g. "eu-central-1"
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      // Public base URL that maps to the bucket so beamclip can hand a fetchable
      // link to Buffer. R2: your r2.dev URL or custom domain. S3: website/CDN URL.
      publicBaseUrl: '',
      keyPrefix: 'beamclip/'
    }
  }
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

export function loadConfig() {
  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch (e) { console.warn('⚠️  config.json ist ungültiges JSON, ignoriere:', e.message); }
  }
  const cfg = deepMerge(DEFAULTS, fileCfg);

  // Environment overrides (optional)
  if (process.env.BUFFER_API_KEY)      cfg.buffer.apiKey = process.env.BUFFER_API_KEY;
  if (process.env.S3_ENDPOINT)         cfg.storage.s3.endpoint = process.env.S3_ENDPOINT;
  if (process.env.S3_REGION)           cfg.storage.s3.region = process.env.S3_REGION;
  if (process.env.S3_BUCKET)           cfg.storage.s3.bucket = process.env.S3_BUCKET;
  if (process.env.S3_ACCESS_KEY_ID)    cfg.storage.s3.accessKeyId = process.env.S3_ACCESS_KEY_ID;
  if (process.env.S3_SECRET_ACCESS_KEY)cfg.storage.s3.secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (process.env.S3_PUBLIC_BASE_URL)  cfg.storage.s3.publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
  return cfg;
}

export function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return loadConfig();
}

// Never leak secrets to the browser: return booleans for the sensitive fields.
export function redactConfig(cfg) {
  return {
    buffer: { apiKeySet: Boolean(cfg.buffer.apiKey) },
    storage: {
      backend: cfg.storage.backend,
      s3: {
        endpoint: cfg.storage.s3.endpoint,
        region: cfg.storage.s3.region,
        bucket: cfg.storage.s3.bucket,
        accessKeyIdSet: Boolean(cfg.storage.s3.accessKeyId),
        secretAccessKeySet: Boolean(cfg.storage.s3.secretAccessKey),
        publicBaseUrl: cfg.storage.s3.publicBaseUrl,
        keyPrefix: cfg.storage.s3.keyPrefix
      }
    }
  };
}

export { CONFIG_PATH };
