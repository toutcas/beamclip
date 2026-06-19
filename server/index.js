#!/usr/bin/env node
// beamclip — local web server.
//
// Flow:
//   1) POST /api/upload         browser sends the video file to this local server
//   2) POST /api/jobs/start     server uploads it to your storage (R2/S3/…) -> public URL
//   3) POST /api/jobs/:id/publish  creates the Buffer posts (per channel)
//   SSE  GET /api/jobs/:id/events   streams upload progress + per-post status live

import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadConfig, saveConfig, redactConfig } from './config.js';
import { listChannels, createVideoPost, getPostStatus } from './buffer.js';
import { uploadVideo, testStorage } from './storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4310;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  dest: path.join(os.tmpdir(), 'beamclip-uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2 GB
});

// ── in-memory state ──────────────────────────────────────────────
const tempFiles = new Map(); // fileId -> { path, originalName, mime, size }
const jobs = new Map();       // jobId  -> { sse:Set<res>, events:[], videoUrl, ... }

function newJob() {
  const id = crypto.randomUUID();
  jobs.set(id, { id, sse: new Set(), events: [], videoUrl: null });
  return jobs.get(id);
}
function emit(job, type, data) {
  const evt = { type, data, ts: Date.now() };
  job.events.push(evt);
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.sse) res.write(payload);
}

// ── config ───────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(redactConfig(loadConfig())));

app.post('/api/config', (req, res) => {
  const cur = loadConfig();
  const body = req.body || {};
  // Merge, but keep existing secrets if the client sent blank (means "unchanged").
  const next = structuredClone(cur);
  if (body.buffer?.apiKey !== undefined && body.buffer.apiKey !== '') next.buffer.apiKey = body.buffer.apiKey;
  if (body.storage) {
    if (body.storage.backend) next.storage.backend = body.storage.backend;
    const s = body.storage.s3 || {};
    for (const k of ['endpoint', 'region', 'bucket', 'publicBaseUrl', 'keyPrefix']) {
      if (s[k] !== undefined) next.storage.s3[k] = s[k];
    }
    if (s.accessKeyId)     next.storage.s3.accessKeyId = s.accessKeyId;
    if (s.secretAccessKey) next.storage.s3.secretAccessKey = s.secretAccessKey;
  }
  saveConfig(next);
  res.json(redactConfig(loadConfig()));
});

app.post('/api/test-storage', async (req, res) => {
  try { res.json(await testStorage(loadConfig())); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ── channels ─────────────────────────────────────────────────────
app.get('/api/channels', async (req, res) => {
  try { res.json(await listChannels(loadConfig().buffer.apiKey)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── 1) receive file from browser ─────────────────────────────────
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei empfangen.' });
  const fileId = crypto.randomUUID();
  tempFiles.set(fileId, {
    path: req.file.path,
    originalName: req.file.originalname,
    mime: req.file.mimetype || 'video/mp4',
    size: req.file.size
  });
  res.json({ fileId, originalName: req.file.originalname, size: req.file.size });
});

// ── 2) start storage upload (async, progress via SSE) ────────────
app.post('/api/jobs/start', async (req, res) => {
  const cfg = loadConfig();
  const job = newJob();
  const { fileId, manualUrl } = req.body || {};

  res.json({ jobId: job.id });

  (async () => {
    try {
      if (cfg.storage.backend === 'url') {
        emit(job, 'upload-progress', { percent: 100 });
        const r = await uploadVideo(cfg, { manualUrl });
        job.videoUrl = r.url;
        emit(job, 'uploaded', { url: r.url });
        return;
      }
      const f = tempFiles.get(fileId);
      if (!f) { emit(job, 'error', { message: 'Datei nicht gefunden (erneut auswählen).' }); return; }
      const safe = (f.originalName || 'video.mp4').replace(/[^\w.\-]+/g, '_');
      const key = `${Date.now()}-${safe}`;
      emit(job, 'upload-progress', { percent: 0 });
      const r = await uploadVideo(cfg, {
        filePath: f.path, key, contentType: f.mime,
        onProgress: (p) => emit(job, 'upload-progress', { percent: p.percent, loaded: p.loaded, total: p.total })
      });
      job.videoUrl = r.url;
      emit(job, 'uploaded', { url: r.url });
      // tidy temp file
      fs.rm(f.path, { force: true }, () => {});
      tempFiles.delete(fileId);
    } catch (e) {
      emit(job, 'error', { message: e.message });
    }
  })();
});

// ── SSE stream ───────────────────────────────────────────────────
app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  for (const evt of job.events) res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`); // replay
  job.sse.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); job.sse.delete(res); });
});

// ── 3) publish posts ─────────────────────────────────────────────
app.post('/api/jobs/:id/publish', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden.' });
  if (!job.videoUrl) return res.status(400).json({ error: 'Video noch nicht hochgeladen.' });
  const cfg = loadConfig();
  const posts = req.body?.posts || [];
  res.json({ ok: true, count: posts.length });

  (async () => {
    for (const p of posts) {
      emit(job, 'post-status', { channelId: p.channelId, status: 'publishing' });
      try {
        const created = await createVideoPost(cfg.buffer.apiKey, {
          channelId: p.channelId,
          service: p.service,
          text: p.text,
          videoUrl: job.videoUrl,
          schedulingType: p.schedulingType || 'automatic',
          mode: p.mode || 'shareNow',
          dueAt: p.dueAt,
          options: p.options || {}
        });
        emit(job, 'post-status', { channelId: p.channelId, status: created.status || 'created', postId: created.id, error: created.error || null });

        // best-effort live poll for a few rounds (shareNow -> sending -> sent)
        if (created.id && (created.status === 'sending' || created.status === 'scheduled')) {
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 4000));
            const s = await getPostStatus(cfg.buffer.apiKey, created.id);
            if (!s) break;
            emit(job, 'post-status', { channelId: p.channelId, status: s.status, postId: created.id, error: s.error || null });
            if (s.status === 'sent' || s.status === 'error') break;
          }
        }
      } catch (e) {
        emit(job, 'post-status', { channelId: p.channelId, status: 'failed', error: e.message });
      }
    }
    emit(job, 'done', {});
  })();
});

app.listen(PORT, () => {
  console.log(`\n  beamclip läuft auf  http://localhost:${PORT}\n`);
});
