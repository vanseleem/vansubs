'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 7860;

const SOURCE_1 = 'https://iamtjake-subdl.hf.space';
const SOURCE_2 = 'https://vanseleem-subf2m.hf.space';
const SOURCE_3 = 'https://iamtjake-subsource.hf.space';
const SOURCE_4 = 'https://iamtjake-opensubs.hf.space';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_PER_LANG     = 2;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    id:          'org.van.vansubs.pro',
    name:        'VanSubs+',
    description: 'Human-Verified Arabic & English Subtitles. Anti-AI.',
    version:     '1.0.0',
    resources:   ['subtitles'],
    types:       ['movie', 'series'],
    idPrefixes:  ['tt'],
    catalogs:    []
  });
});

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLang(lang) {
  if (!lang) return null;
  const l = lang.toLowerCase().trim();
  if (['en','eng','english','en-us','en-gb'].includes(l)) return 'english';
  if (['ar','ara','arabic','ar-ae','ar-sa'].includes(l)) return 'arabic';
  return null;
}

function topTwoFromSource(subs) {
  if (!Array.isArray(subs) || subs.length === 0) return { arabic: [], english: [] };
  const arabic = [];
  const english = [];
  for (const sub of subs) {
    if (!sub.url) continue;
    const lang = normalizeLang(sub.lang);
    if (lang === 'arabic' && arabic.length < MAX_PER_LANG) {
      arabic.push({ ...sub, lang: 'ar', format: 'srt' });
    }
    if (lang === 'english' && english.length < MAX_PER_LANG) {
      english.push({ ...sub, lang: 'en', format: 'srt' });
    }
    if (arabic.length >= MAX_PER_LANG && english.length >= MAX_PER_LANG) break;
  }
  return { arabic, english };
}

app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
  const { type, id } = req.params;
  const extra = req.params.extra ? `/${req.params.extra}` : '';

  const urls = [
    `${SOURCE_1}/subtitles/${type}/${id}${extra}.json`,
    `${SOURCE_2}/subtitles/${type}/${id}${extra}.json`,
    `${SOURCE_3}/subtitles/${type}/${id}${extra}.json`,
    `${SOURCE_4}/subtitles/${type}/${id}${extra}.json`,
  ];

  const fetchJson = async (url) => {
    try {
      const resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!resp.ok) {
        console.log(`[van] ${url} → HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      const subs = Array.isArray(data) ? data : (data?.subtitles || data?.data || []);
      console.log(`[van] ${url.split('?')[0]} → ${subs.length} subtitles`);
      return subs;
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timed out' : err.message;
      console.log(`[van] ${url.split('?')[0]} failed: ${reason}`);
      return null;
    }
  };

  const allResults = await Promise.all(urls.map(u => fetchJson(u)));

  const seenAr  = new Set();
  const seenEn  = new Set();
  const mergedAr = [];
  const mergedEn = [];

  for (let i = 0; i < allResults.length; i++) {
    const subs = allResults[i];
    if (!subs) continue;
    const { arabic, english } = topTwoFromSource(subs);
    for (const sub of arabic) {
      if (!seenAr.has(sub.url)) {
        seenAr.add(sub.url);
        mergedAr.push(sub);
        console.log(`[van] source ${i + 1} → Arabic: ${sub.url}`);
      }
    }
    for (const sub of english) {
      if (!seenEn.has(sub.url)) {
        seenEn.add(sub.url);
        mergedEn.push(sub);
        console.log(`[van] source ${i + 1} → English: ${sub.url}`);
      }
    }
  }

  const merged = [...mergedAr, ...mergedEn];
  console.log(`[van] Final: ${merged.length} subtitles (AR:${mergedAr.length} EN:${mergedEn.length})`);
  res.json({ subtitles: merged });
});

app.get('/', (req, res) => {
  const manifestUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
  const installUrl  = 'stremio://vanseleem-vansubs.hf.space/manifest.json';

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VanSubs+</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
      background: #050810;
      color: #dde6f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px 20px;
      background-image:
        radial-gradient(ellipse 70% 40% at 50% 0%, rgba(0,180,255,0.07) 0%, transparent 70%),
        radial-gradient(ellipse 40% 30% at 80% 80%, rgba(0,100,200,0.05) 0%, transparent 60%);
    }
    .wrap { width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 20px; }
    .header { display: flex; flex-direction: column; gap: 12px; }
    .logo { font-size: 2.6rem; font-weight: 800; letter-spacing: -1px; line-height: 1; }
    .logo .van { color: #00c6ff; }
    .logo .subs { color: #ffffff; }
    .badge-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(0,198,255,0.08); border: 1px solid rgba(0,198,255,0.18);
      color: #ffffff; padding: 4px 11px; border-radius: 100px;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase;
    }
    .badge.green { background: rgba(0,220,130,0.08); border-color: rgba(0,220,130,0.18); color: #00dc82; }
    .desc { color: #ffffff; font-size: 0.9rem; line-height: 1.6; margin-top: 2px; }
    .card {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 16px; padding: 20px 22px;
    }
    .card-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #ffffff; margin-bottom: 10px; }
    .url-box {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 0.8rem;
      color: #ffffff; background: rgba(0,0,0,0.25); border: 1px solid rgba(0,198,255,0.12);
      border-radius: 10px; padding: 11px 14px; word-break: break-all; line-height: 1.5;
    }
    .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .btn { padding: 10px 22px; border-radius: 10px; font-size: 0.84rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: all 0.15s; font-family: inherit; }
    .btn-primary { background: #00c6ff; color: #050810; }
    .btn-primary:hover { background: #00b0e8; }
    .btn-copy { background: #ffffff; color: #050810; border: 1px solid #ffffff; }
    .btn-copy:hover { background: #e6e6e6; border-color: #e6e6e6; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .stat {
      background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px; padding: 16px 12px; text-align: center;
    }
    .stat-val { font-size: 1.5rem; font-weight: 800; color: #fff; line-height: 1; margin-bottom: 5px; }
    .stat-lbl { font-size: 0.68rem; color: #3a5060; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .made-by { text-align: center; color: #ffffff; font-size: 0.85rem; margin-top: 6px; opacity: 0.8; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo"><span class="van">Van</span><span class="subs">Subs+</span></div>
      <div class="badge-row">
        <span class="badge anti-ai">🛡 Anti-AI</span>
        <span class="badge green">✔ Human-Verified</span>
      </div>
      <p class="desc">Human-Verified Arabic &amp; English Subtitles. Anti-AI.</p>
    </div>
    <div class="card">
      <div class="card-label">Stremio Install URL</div>
      <div class="url-box">${manifestUrl}</div>
      <div class="actions">
        <a href="${installUrl}" class="btn btn-primary">Install in Stremio</a>
        <button class="btn btn-copy" onclick="navigator.clipboard.writeText('${manifestUrl}').then(() => { this.textContent = '✔ Copied'; setTimeout(() => this.textContent = 'Copy URL', 2000); })">Copy URL</button>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-val">2</div><div class="stat-lbl">Languages</div></div>
      <div class="stat"><div class="stat-val">4</div><div class="stat-lbl">Sources</div></div>
      <div class="stat"><div class="stat-val">0</div><div class="stat-lbl">AI Subs</div></div>
    </div>
    <div class="made-by">Made With 🤍 By Van</div>
  </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Sources:\n  1. ${SOURCE_1}\n  2. ${SOURCE_2}\n  3. ${SOURCE_3}\n  4. ${SOURCE_4}`
  );
  console.log(`\nVanSubs+ (v1.0.9) running → http://0.0.0.0:${PORT}`);
});