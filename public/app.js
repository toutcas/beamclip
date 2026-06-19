const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let state = {
  fileId: null,
  channels: [],
  backend: 's3'
};

// ── config ───────────────────────────────────────────────────────
async function loadConfig() {
  const c = await fetch('/api/config').then(r => r.json());
  state.backend = c.storage.backend;
  $('#backend').value = c.storage.backend;
  $('#bufferKey').placeholder = c.buffer.apiKeySet ? '•••• gesetzt (leer = unverändert)' : 'eintragen';
  const s = c.storage.s3;
  $('#s3endpoint').value = s.endpoint || '';
  $('#s3region').value = s.region || '';
  $('#s3bucket').value = s.bucket || '';
  $('#s3prefix').value = s.keyPrefix || '';
  $('#s3public').value = s.publicBaseUrl || '';
  $('#s3akid').placeholder = s.accessKeyIdSet ? '•••• gesetzt' : 'eintragen';
  $('#s3secret').placeholder = s.secretAccessKeySet ? '•••• gesetzt' : 'eintragen';
  applyBackend();
}

function applyBackend() {
  const b = $('#backend').value;
  state.backend = b;
  $('#s3fields').classList.toggle('hidden', b !== 's3');
  $('#urlMode').classList.toggle('hidden', b !== 'url');
  $('#fileMode').classList.toggle('hidden', b === 'url');
}
$('#backend').addEventListener('change', applyBackend);

$('#saveCfg').addEventListener('click', async () => {
  const body = {
    buffer: { apiKey: $('#bufferKey').value },
    storage: {
      backend: $('#backend').value,
      s3: {
        endpoint: $('#s3endpoint').value, region: $('#s3region').value,
        bucket: $('#s3bucket').value, keyPrefix: $('#s3prefix').value,
        publicBaseUrl: $('#s3public').value,
        accessKeyId: $('#s3akid').value, secretAccessKey: $('#s3secret').value
      }
    }
  };
  await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#bufferKey').value = ''; $('#s3akid').value = ''; $('#s3secret').value = '';
  setStatus('#cfgStatus', 'gespeichert ✓', 'ok');
  loadConfig();
});

$('#testStorage').addEventListener('click', async () => {
  setStatus('#cfgStatus', 'teste …');
  const r = await fetch('/api/test-storage', { method: 'POST' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }));
  if (r.ok) setStatus('#cfgStatus', r.note || 'Speicher erreichbar ✓', 'ok');
  else setStatus('#cfgStatus', 'Fehler: ' + r.error, 'err');
});

function setStatus(sel, msg, cls = '') { const el = $(sel); el.textContent = msg; el.className = 'status ' + cls; }

// ── mode / schedule ──────────────────────────────────────────────
$('#mode').addEventListener('change', () => {
  $('#dueWrap').style.display = $('#mode').value === 'customScheduled' ? 'inline-flex' : 'none';
});

// ── channels ─────────────────────────────────────────────────────
const SVC = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook' };
const DEFAULT_TEXT = '';

$('#loadChannels').addEventListener('click', async () => {
  const r = await fetch('/api/channels').then(r => r.json());
  if (r.error) { $('#channels').innerHTML = `<p class="status err">${r.error}</p>`; return; }
  state.channels = r.channels || [];
  renderChannels();
});

function renderChannels() {
  const wrap = $('#channels');
  if (!state.channels.length) { wrap.innerHTML = '<p class="hint">Keine Kanäle gefunden.</p>'; return; }
  wrap.innerHTML = '';
  for (const ch of state.channels) {
    const svc = SVC[ch.service] ? ch.service : 'other';
    const div = document.createElement('div');
    div.className = 'chan';
    div.dataset.channelId = ch.id;
    div.dataset.service = ch.service;
    div.innerHTML = `
      <img class="av" src="${ch.avatar || ''}" alt="" onerror="this.style.visibility='hidden'">
      <div>
        <div><strong>${ch.name || ch.id}</strong> <span class="svc ${svc}">${SVC[ch.service] || ch.service}</span></div>
        <div class="meta">${ch.organizationName || ''}</div>
        <label class="toggle"><input type="checkbox" class="use" checked> posten</label>
        <textarea class="text" placeholder="Beschreibung + Hashtags …">${DEFAULT_TEXT}</textarea>
        ${ch.service === 'youtube' ? `
          <div class="grid2">
            <label>YouTube-Titel <input class="ytTitle" placeholder="Titel des Shorts"></label>
            <label>Kategorie-ID <input class="ytCat" value="20"></label>
          </div>` : ''}
      </div>`;
    wrap.appendChild(div);
  }
}

// ── file pick / drag&drop ────────────────────────────────────────
$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', () => uploadLocal($('#file').files[0]));
const drop = $('#drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadLocal(f); });

function uploadLocal(file) {
  if (!file) return;
  $('#fileInfo').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB — wird zum lokalen Server übertragen …`;
  const fd = new FormData();
  fd.append('video', file);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  $('#localBarWrap').classList.remove('hidden');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) $('#localBar').style.width = Math.round(e.loaded / e.total * 100) + '%'; };
  xhr.onload = () => {
    try {
      const r = JSON.parse(xhr.responseText);
      if (r.fileId) { state.fileId = r.fileId; $('#fileInfo').textContent = `${r.originalName} · ${(r.size / 1024 / 1024).toFixed(1)} MB ✓ bereit`; }
      else $('#fileInfo').textContent = 'Fehler: ' + (r.error || 'unbekannt');
    } catch { $('#fileInfo').textContent = 'Upload fehlgeschlagen.'; }
  };
  xhr.onerror = () => { $('#fileInfo').textContent = 'Upload fehlgeschlagen.'; };
  xhr.send(fd);
}

// ── go: storage upload + publish ─────────────────────────────────
$('#go').addEventListener('click', async () => {
  const manualUrl = $('#manualUrl').value.trim();
  if (state.backend !== 'url' && !state.fileId) { setStatus('#goStatus', 'Erst ein Video auswählen.', 'err'); return; }
  if (state.backend === 'url' && !manualUrl) { setStatus('#goStatus', 'Bitte eine öffentliche URL angeben.', 'err'); return; }

  const selected = $$('.chan').filter(c => c.querySelector('.use').checked);
  if (!selected.length) { setStatus('#goStatus', 'Keinen Kanal ausgewählt.', 'err'); return; }

  setStatus('#goStatus', 'starte …');
  $('#results').innerHTML = '';
  $('#uploadBar').style.width = '0%'; $('#uploadPct').textContent = '0%';

  const { jobId } = await fetch('/api/jobs/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.fileId, manualUrl })
  }).then(r => r.json());

  const es = new EventSource(`/api/jobs/${jobId}/events`);

  es.addEventListener('upload-progress', (e) => {
    const d = JSON.parse(e.data); const p = d.percent ?? 0;
    $('#uploadBar').style.width = p + '%'; $('#uploadPct').textContent = p + '%';
  });

  es.addEventListener('error', (e) => {
    try { const d = JSON.parse(e.data); setStatus('#goStatus', 'Fehler: ' + d.message, 'err'); } catch {}
  });

  es.addEventListener('uploaded', async (e) => {
    const d = JSON.parse(e.data);
    $('#uploadBar').style.width = '100%'; $('#uploadPct').textContent = '100%';
    $('#urlOut').textContent = '🔗 ' + d.url;
    setStatus('#goStatus', 'Video online — poste auf Buffer …', 'ok');

    const mode = $('#mode').value;
    const dueAt = mode === 'customScheduled' && $('#dueAt').value ? new Date($('#dueAt').value).toISOString() : undefined;

    const posts = selected.map(c => {
      const service = c.dataset.service;
      const text = c.querySelector('.text').value.trim();
      const options = {};
      if (service === 'youtube') {
        options.youtubeTitle = c.querySelector('.ytTitle')?.value.trim() || (text.split('\n')[0] || 'Video');
        options.youtubeCategoryId = c.querySelector('.ytCat')?.value.trim() || '20';
      }
      addResult(c.dataset.channelId, c.querySelector('strong').textContent, 'queued');
      return { channelId: c.dataset.channelId, service, text, mode, dueAt, options };
    });

    await fetch(`/api/jobs/${jobId}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts })
    });
  });

  es.addEventListener('post-status', (e) => {
    const d = JSON.parse(e.data);
    updateResult(d.channelId, d.status, d.error);
  });

  es.addEventListener('done', () => { setStatus('#goStatus', 'fertig.', 'ok'); es.close(); });
});

function addResult(channelId, name, status) {
  if ($(`#res-${channelId}`)) return;
  const div = document.createElement('div');
  div.className = 'res'; div.id = `res-${channelId}`;
  div.innerHTML = `<span class="dot ${status}"></span><strong>${name}</strong><span class="st">${status}</span>`;
  $('#results').appendChild(div);
}
function updateResult(channelId, status, error) {
  const el = $(`#res-${channelId}`); if (!el) return;
  el.querySelector('.dot').className = 'dot ' + status;
  el.querySelector('.st').textContent = status + (error ? ' — ' + error : '');
}

loadConfig();
