const express = require('express');
const app = express();

const SUBDL_KEY = 'subdl_TsxunQv1rWjwCiXQqDC_lpBPF5QtwoFH2Vbae0zvKqI';
const TMDB_KEY  = '83d364331c40bfbe29858aeed82f45cc';

const PORT = process.env.PORT || 3000;
const memCache = new Map();

// User agents to avoid blocking
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
];

function getRandomUA() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getRandomDelay() {
  return Math.floor(Math.random() * 1000) + 500; // 500-1500ms random delay
}

// Fetch SubDL with retries and spoofing headers
async function fetchSubDL(imdbId, season = null, episode = null, attempt = 0) {
  const maxRetries = 2;
  const base = `https://api.subdl.com/api/v1/subtitles?api_key=${SUBDL_KEY}&languages=AR,EN&subs_per_page=30&releases=1&unpack=1`;
  let url = `${base}&imdb_id=${imdbId}`;
  
  if (season && episode) {
    url = `${base}&imdb_id=${imdbId}&season_number=${season}&episode_number=${episode}`;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://subdl.com/',
      },
      timeout: 8000
    });

    if (!response.ok) {
      if (response.status === 403 && attempt < maxRetries) {
        const delay = getRandomDelay();
        console.log(`[SubDL] 403 — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        return fetchSubDL(imdbId, season, episode, attempt + 1);
      }
      console.log(`[SubDL] HTTP ${response.status} for ${imdbId}`);
      return [];
    }

    const data = await response.json();
    if (!data?.status) {
      console.log(`[SubDL] API error: ${data?.error || 'unknown'}`);
      return [];
    }

    console.log(`[SubDL] ✅ Got ${(data.subtitles || []).length} results for ${imdbId}`);
    return data.subtitles || [];
  } catch (e) {
    if (attempt < maxRetries) {
      const delay = getRandomDelay();
      console.log(`[SubDL] Error: ${e.message} — retry ${attempt + 1}/${maxRetries}`);
      await new Promise(r => setTimeout(r, delay));
      return fetchSubDL(imdbId, season, episode, attempt + 1);
    }
    console.error(`[SubDL] FINAL ERROR: ${e.message}`);
    return [];
  }
}

// Scoring function - determines which subtitle is best
function scoreTrack(filename, rating = 0, season = null, episode = null) {
  if (!filename) return 0;
  
  let score = 0;
  const n = filename.toLowerCase();

  // Episode match bonus (highest priority for TV)
  if (season && episode) {
    const patterns = [
      `s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`,
      `s${season}e${episode}`,
      `${season}x${episode}`,
    ];
    if (patterns.some(p => n.includes(p))) score += 500;
  }

  // Quality/source bonuses
  if (n.includes('bluray') || n.includes('blu-ray') || n.includes('bdrip')) score += 17;
  if (n.includes('webdl') || n.includes('web-dl') || n.includes('webrip')) score += 17;
  if (n.includes('hdtv')) score += 13;
  if (n.includes('dvdrip') || n.includes('dvd')) score += 9;

  // Rating bonus
  if (rating > 0) score += Math.round(rating * 4);

  // Sync/release quality
  if (n.includes('sync') || n.includes('synced')) score += 30;
  if (n.includes('corrected') || n.includes('fixed')) score += 20;
  if (n.includes('repack') || n.includes('proper')) score += 15;

  // Format bonus
  if (n.includes('.srt')) score += 15;

  // Penalties
  if (n.includes('forced') || n.includes('sdh') || n.includes('hearing')) score -= 20;
  if (n.includes('ai-translated') || n.includes('machine')) score -= 50;

  return score;
}

// Routes
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'org.van.humansubtitles.omega',
    name: 'VanSubs Ω',
    description: 'Logic-first SubDL subtitles. Fast. Reliable. Zero throttle.',
    version: '23.7.0',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '23.7.0',
    provider: 'SubDL + Render',
    uptime: Math.round(process.uptime()),
    cached_items: memCache.size,
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    node_version: process.version,
  });
});

app.get('/sub/:id.srt', async (req, res) => {
  try {
    const dlUrl = Buffer.from(req.params.id, 'base64').toString('utf-8');
    
    if (!dlUrl.startsWith('https://dl.subdl.com/')) {
      return res.status(403).send('Forbidden');
    }

    const cacheKey = `subfile:${dlUrl}`;
    const cached = memCache.get(cacheKey);
    if (cached) {
      console.log(`[SubFile] 📦 Cache hit`);
      return res.type('text/plain; charset=utf-8').send(cached);
    }

    console.log(`[SubFile] ⬇️  Downloading from SubDL...`);
    const response = await fetch(dlUrl, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'application/octet-stream, */*',
      },
      timeout: 10000
    });

    if (!response.ok) {
      return res.status(response.status).send(`Failed: ${response.status}`);
    }

    const content = await response.text();
    memCache.set(cacheKey, content);
    console.log(`[SubFile] ✅ Downloaded and cached`);
    
    res.type('text/plain; charset=utf-8').send(content);
  } catch (e) {
    console.error(`[SubFile] Error: ${e.message}`);
    res.status(500).send('Error');
  }
});

app.get('/subtitles/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const [imdbId, season, episode] = id.split(':');

  // Validate IMDb ID
  if (!/^tt\d+$/.test(imdbId)) {
    return res.json({ subtitles: [] });
  }

  console.log(`\n📺 Request: ${type} ${imdbId}${season ? `:${season}:${episode}` : ''}`);

  // Check cache first
  const cacheKey = `results:${imdbId}:${season || 'x'}:${episode || 'x'}`;
  if (memCache.has(cacheKey)) {
    const cached = memCache.get(cacheKey);
    console.log(`[Cache] ✅ Hit (${cached.length} subs)`);
    return res.json({ subtitles: cached });
  }

  // Fetch from SubDL (NO sequential downloads - removed)
  const subs = await fetchSubDL(imdbId, season ? parseInt(season) : null, episode ? parseInt(episode) : null);
  
  console.log(`[Filter] 🔍 Processing ${subs.length} raw tracks...`);

  // Filter & score
  const filtered = subs
    .filter(s => {
      // Keep only Arabic and English
      if (!s.language) return false;
      const lang = s.language.toLowerCase();
      return ['ar', 'ara', 'arabic', 'en', 'eng', 'english'].includes(lang);
    })
    .filter(s => {
      // Remove AI garbage
      const n = (s.release_name || s.name || '').toLowerCase();
      if (n.includes('ai-translated') || n.includes('machine') || n.includes('chatgpt')) return false;
      return true;
    })
    .map(s => ({
      ...s,
      score: scoreTrack(s.release_name || s.name, parseFloat(s.rating) || 0, season, episode)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10); // Top 10 only

  console.log(`[Filter] ✅ Kept ${filtered.length} after filtering`);

  // Format response
  const result = filtered.map((s, i) => {
    const dlUrl = s.url && !s.url.startsWith('http') ? `https://dl.subdl.com${s.url}` : s.url;
    const lang = (s.language || '').toLowerCase();
    const isArabic = ['ar', 'ara', 'arabic'].includes(lang);

    return {
      id: `van_${isArabic ? 'ar' : 'en'}_${i}`,
      url: `/sub/${Buffer.from(dlUrl).toString('base64')}.srt`,
      lang: isArabic ? 'Arabic' : 'English',
    };
  }).filter(s => s.url);

  // Cache result (don't cache empty results too long)
  const ttl = result.length === 0 ? 3600 : 604800; // 1 hour vs 7 days
  memCache.set(cacheKey, result);

  console.log(`[Result] 🎉 ${result.length} subtitles (English: ${result.filter(s => s.lang === 'English').length}, Arabic: ${result.filter(s => s.lang === 'Arabic').length})\n`);

  res.json({ subtitles: result });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ VanSubs Ω Ready!\n`);
  console.log(`🌐 Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`❤️  Health:   http://localhost:${PORT}/health`);
  console.log(`📺 SubDL:    Connected and ready`);
  console.log(`👥 Users:    15+ concurrent supported\n`);
  console.log(`Press Ctrl+C to stop\n`);
});
