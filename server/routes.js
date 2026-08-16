'use strict';
/**
 * HTTP surface for llytpr-wl.v01nh.
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
const express = require('express');
const { request: undiciRequest } = require('undici');
const { proxyManager } = require('./proxies');
const { piped } = require('./piped');
const { hotChunks } = require('./media');
const it = require('./innertube');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

/** fetch the pinned itag-18 URL and pre-buffer its first bytes in RAM. */
async function warmDefault(v) {
  try {
    const { url, proxyUrl } = await it.getStreamUrl(v, 18);
    if (url) hotChunks.warm(v, 18, url, proxyUrl);
  } catch (_) { /* warm is best-effort */ }
}

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    const status = e.status && e.status < 600 ? e.status : 502;
    res.status(status).json({
      error: e.message || 'upstream error',
      code: e.code || 'UPSTREAM',
      status: e.statusHint,
    });
  });
};

/* ------------------------------------------------------------- media proxy */

const PIPED_HOSTS = new Set(piped.instances);

function isGoogleVideo(u) {
  try {
    const h = new URL(u).hostname;
    if (/(^|\.)googlevideo\.com$/.test(h) || /(^|\.)youtube\.com$/.test(h) || /(^|\.)ytimg\.com$/.test(h) || /(^|\.)googleapis\.com$/.test(h) || h === 'suggestqueries.google.com') return true;
    // piped proxy hosts (only the hardcoded provider list — no open relay)
    const bare = h.replace(/^pipedproxy\./, '').replace(/^proxy\./, '');
    return PIPED_HOSTS.has(h) || PIPED_HOSTS.has(bare) || /(^|\.)piped\./.test(h);
  } catch (_) { return false; }
}

router.get('/api/stream', wrap(async (req, res) => {
  const v = String(req.query.v || '');
  const itag = String(req.query.itag || '18');
  const rawRaw = req.query.raw ? String(req.query.raw) : null;
  if (!rawRaw && !/^[\w-]{11}$/.test(v)) { res.status(400).json({ error: 'bad id' }); return; }

  // HOT PATH: pre-buffered first bytes -> answer straight from RAM
  if (!rawRaw && hotChunks.serveIfHot(v, itag, req, res)) return;

  let attempt = 0;
  let lastErr = null;
  while (attempt < 2) {
    attempt++;
    try {
      let url, proxyUrl;
      if (rawRaw) {
        url = rawRaw;
        const p = req.query.p ? String(req.query.p) : null;
        // only accept proxies that are currently in our verified pool
        proxyUrl = p && proxyManager.pool.some(x => x.url === p) ? p : (hlsPins.get(v)?.proxyUrl || null);
      } else {
        ({ url, proxyUrl } = await it.getStreamUrl(v, itag));
      }
      if (!url || !isGoogleVideo(url)) throw new Error('no stream');
      const headers = {
        'User-Agent': 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
        'Accept': '*/*',
      };
      if (req.headers.range) headers.Range = String(req.headers.range);
      // stream URLs are IP-bound to whichever egress fetched them: reuse it
      const dispatcher = proxyUrl ? proxyManager.dispatcherFor(proxyUrl) : undefined;
      await pipeUpstream(url, headers, req, res, { dispatcher });
      return;
    } catch (e) {
      lastErr = e;
      if (res.headersSent) return;
      // URL probably expired -> rebuild the map once
      if (!rawRaw) { try { await it.refreshStreamMap(v); } catch (_) {} }
      else break;
    }
  }
  if (!res.headersSent) res.status(502).json({ error: lastErr?.message || 'stream failed' });
}));

/* ---------------- hls (live) proxy with playlist rewriting ---------------- */
const hlsPins = new Map(); // videoId -> {proxyUrl}

router.get('/api/hls', wrap(async (req, res) => {
  const v = String(req.query.v || '');
  let url = req.query.raw ? String(req.query.raw) : null;
  let pin = hlsPins.get(v)?.proxyUrl || null;
  if (!url) {
    if (!/^[\w-]{11}$/.test(v)) { res.status(400).json({ error: 'bad id' }); return; }
    const h = await it.getHls(v);
    if (!h.url) { res.status(404).json({ error: 'no hls' }); return; }
    url = h.url;
    pin = h.proxyUrl;
    hlsPins.set(v, { proxyUrl: pin });
    if (hlsPins.size > 500) hlsPins.delete(hlsPins.keys().next().value);
  }
  if (!isGoogleVideo(url)) { res.status(400).json({ error: 'bad url' }); return; }
  const dispatcher = pin ? proxyManager.dispatcherFor(pin) : undefined;
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const upstream = await undiciRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip' },
    dispatcher, signal: ac.signal, headersTimeout: 12000,
  });
  if (upstream.statusCode >= 400) {
    upstream.body.dump().catch(() => {});
    res.status(502).json({ error: 'hls upstream ' + upstream.statusCode });
    return;
  }
  const text = await upstream.body.text();
  const base = new URL(url);
  const pinQ = pin ? '&p=' + encodeURIComponent(pin) : '';
  const rewritten = text.split('\n').map(line => {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const abs = new URL(t, base).toString();
      return /\.m3u8(\?|$)/.test(abs)
        ? `/api/hls?raw=${encodeURIComponent(abs)}${v ? '&v=' + v : ''}${pinQ}`
        : `/api/stream?raw=${encodeURIComponent(abs)}${v ? '&v=' + v : ''}${pinQ}`;
    }
    return line.replace(/URI="([^"]+)"/g, (_m, u) => {
      let abs;
      try { abs = new URL(u, base).toString(); } catch (_) { return _m; }
      const target = /\.m3u8(\?|$)/.test(abs)
        ? `/api/hls?raw=${encodeURIComponent(abs)}${v ? '&v=' + v : ''}${pinQ}`
        : `/api/stream?raw=${encodeURIComponent(abs)}${v ? '&v=' + v : ''}${pinQ}`;
      return `URI="${target}"`;
    });
  }).join('\n');
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(rewritten);
}));

async function pipeUpstream(url, headers, req, res, { dispatcher } = {}) {
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const upstream = await undiciRequest(url, {
    method: 'GET',
    headers,
    signal: ac.signal,
    dispatcher,
    maxRedirections: 2,
    headersTimeout: 15000,
  });
  if ([403, 410].includes(upstream.statusCode)) {
    upstream.body.dump().catch(() => {});
    throw new Error('expired ' + upstream.statusCode);
  }
  if (upstream.statusCode >= 400) {
    upstream.body.dump().catch(() => {});
    throw new Error('upstream ' + upstream.statusCode);
  }
  const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];
  const out = {};
  for (const k of pass) {
    const val = upstream.headers[k];
    if (val) out[k] = val;
  }
  out['Access-Control-Allow-Origin'] = '*';
  out['Cache-Control'] = out['Cache-Control'] || 'private, max-age=3600';
  res.writeHead(upstream.statusCode === 206 ? 206 : 200, out);
  try {
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
    }
  } catch (e) {
    // client aborted / mid-stream failure: headers already sent, just close
    try { res.destroy(); } catch (_) {}
    return;
  }
  res.end();
}

/* ------------------------------------------------------------------- APIs */

router.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now(), proxies: proxyManager.pool.length }));

router.get('/api/proxies', (req, res) => res.json(proxyManager.status()));

router.post('/api/proxies/refresh', wrap(async (req, res) => {
  const pool = await proxyManager.refresh({ force: true });
  res.json({ pool: pool.length });
}));

router.get('/api/home', wrap(async (req, res) => {
  res.json(await it.home(String(req.query.chip || 'all')));
}));

/** personalized home — profile comes from client-local history/likes */
router.post('/api/home/personal', wrap(async (req, res) => {
  const p = req.body && typeof req.body === 'object' ? req.body : {};
  res.json(await it.personal(p));
}));

/** dedicated shorts feed (vertical videos only) */
router.get('/api/shorts', wrap(async (req, res) => {
  res.json(await it.shortsFeed());
}));

/** rescue: drop every cached stream/watch entry for a video and rebuild */
router.post('/api/player/refresh', wrap(async (req, res) => {
  const v = String((req.body?.v ?? req.query.v) || '');
  if (!/^[\w-]{11}$/.test(v)) { res.status(400).json({ error: 'bad id' }); return; }
  it.invalidateVideo(v);
  const full = await it.getVideoFull(v);
  res.json({ ok: true, playable: full.playable, playability: full.playability, source: full.streams?.source || null });
}));

router.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200);
  if (!q) { res.status(400).json({ error: 'q required' }); return; }
  res.json(await it.search(q, { sp: req.query.sp ? String(req.query.sp) : undefined }));
}));

router.get('/api/search/next', wrap(async (req, res) => {
  const c = String(req.query.c || '');
  if (!c) { res.status(400).json({ error: 'c required' }); return; }
  res.json(await it.searchNext(c));
}));

router.get('/api/watch/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{11}$/.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
  const list = String(req.query.list || '');
  const data = await it.getVideoFull(id, list && /^[\w-]{1,64}$/.test(list) ? { playlistId: list } : {});
  res.json(data);
  // speculative warm: by the time the user presses play, the first bytes
  // of the default 360p stream are already in RAM.
  if (data.playable) warmDefault(id);
}));

/** explicit warmer: fired by card-hover on the client */
router.get('/api/warm/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{11}$/.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
  warmDefault(id);
  res.json({ ok: true });
}));

router.get('/api/hotstat', (req, res) => res.json(hotChunks.status()));

router.get('/api/comments/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{11}$/.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
  res.json(await it.comments(id));
}));

router.get('/api/comments/next', wrap(async (req, res) => {
  const c = String(req.query.c || '');
  if (!c) { res.status(400).json({ error: 'c required' }); return; }
  res.json(await it.commentsNext(c));
}));

router.get('/api/channel/:id', wrap(async (req, res) => {
  const raw = req.params.id || '';
  res.json(await it.channel(raw, {
    params: req.query.params ? String(req.query.params) : undefined,
    continuation: req.query.c ? String(req.query.c) : undefined,
  }));
}));

router.get('/api/playlist/:id', wrap(async (req, res) => {
  res.json(await it.playlist(String(req.params.id || '').replace(/[^\w-]/g, '')));
}));

router.get('/api/playlist/next', wrap(async (req, res) => {
  const c = String(req.query.c || '');
  if (!c) { res.status(400).json({ error: 'c required' }); return; }
  res.json(await it.playlistNext(c));
}));

/** mix/panel continuation (`next` endpoint family) */
router.get('/api/playlist/panel-next', wrap(async (req, res) => {
  const c = String(req.query.c || '');
  if (!c) { res.status(400).json({ error: 'c required' }); return; }
  res.json(await it.panelNext(c));
}));

router.get('/api/suggest', wrap(async (req, res) => {
  const q = String(req.query.q || '').slice(0, 100);
  if (!q) { res.json({ suggestions: [] }); return; }
  res.json(await it.suggest(q));
}));

router.get('/api/resolve/:target', wrap(async (req, res) => {
  res.json({ id: await it.resolveChannelId(String(req.params.target)) });
}));

// thumbnail proxy (avoids mixed-content issues & i.ytimg blocks on some networks)
router.get('/api/thumb', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  if (!isGoogleVideo(u)) { res.status(400).json({ error: 'bad url' }); return; }
  await pipeUpstream(u, { 'User-Agent': 'Mozilla/5.0' }, req, res);
}));

module.exports = { router };
