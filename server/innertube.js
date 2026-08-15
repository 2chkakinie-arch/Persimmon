'use strict';
/**
 * InnerTube engine for llytpr-wl.v01nh.
 * Raw youtubei/v1 client with rotating free-proxy transport, visitor-data
 * handling, cipher repair via the vendored yt-dlp solver, and tolerant parsers
 * for every surface the app needs (search / watch / comments / channel /
 * playlist / home). Every response shape is probed, not assumed — YouTube
 * changes payload layouts constantly.
 *
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
const { proxyManager } = require('./proxies');
const { sigSolver } = require('./solver');
const { TTLCache } = require('./cache');

const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const HOST_WEB = 'https://www.youtube.com';
const CACHE_MIN = 60 * 1000;

class YTError extends Error {
  constructor(message, status = 502, code = 'UPSTREAM') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CLIENTS = {
  WEB: {
    key: API_KEY,
    ctx: { clientName: 'WEB', clientVersion: '2.20260708.00.00' },
    clientNameHeader: '1',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  },
  ANDROID: {
    key: API_KEY,
    ctx: {
      clientName: 'ANDROID', clientVersion: '21.26.364', androidSdkVersion: 30,
      osName: 'Android', osVersion: '11',
    },
    clientNameHeader: '3',
    ua: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
  },
};

const caches = {
  api: new TTLCache({ max: 800, ttl: 10 * CACHE_MIN }),
  visitor: new TTLCache({ max: 4, ttl: 25 * CACHE_MIN }),
  streams: new TTLCache({ max: 600, ttl: 5 * 60 * CACHE_MIN }), // googlevideo URLs expire ~6h
};

/* ---------------------------------------------------------------- transport */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rawFetch(url, { method = 'GET', headers = {}, body, dispatcher, timeout = 9000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, dispatcher, signal: ac.signal, redirect: 'follow' });
    return res;
  } finally {
    clearTimeout(t);
  }
}

function transports(preferProxy) {
  const list = [];
  const seen = new Set();
  const addProxy = () => {
    const u = proxyManager.pick([...seen]);
    if (u) { seen.add(u); list.push({ kind: 'proxy', url: u, dispatcher: proxyManager.dispatcherFor(u) }); }
  };
  const direct = { kind: 'direct', dispatcher: undefined };
  if (preferProxy === 'direct') return [direct];
  if (preferProxy === 'proxy') { addProxy(); addProxy(); addProxy(); list.push(direct); return list; }
  // auto: proxies first (block-safe), direct as the safety net
  addProxy(); addProxy(); list.push(direct);
  return list;
}

/**
 * POST to youtubei with automatic proxy rotation + direct fallback.
 * HTTP 4xx from YouTube is a *content* error (bad argument / login required),
 * not a transport error, so it is returned as-is (callers decide).
 */
async function callApi(endpoint, payload, client = CLIENTS.WEB, { hl = 'ja', gl = 'JP', visitorId, preferProxy, timeout = 9000, ret } = {}) {
  const body = JSON.stringify({
    ...payload,
    context: {
      ...(payload.context || {}),
      client: { hl, gl, ...client.ctx, ...((payload.context || {}).client || {}) },
    },
  });
  const url = `${HOST_WEB}/youtubei/v1/${endpoint}?key=${client.key}`;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': client.ua,
    'X-YouTube-Client-Name': client.clientNameHeader,
    'X-YouTube-Client-Version': client.ctx.clientVersion,
    'Origin': HOST_WEB,
    ...(visitorId ? { 'X-Goog-Visitor-Id': visitorId } : {}),
  };
  let lastErr = null;
  let lastJson = null;
  for (const t of transports(preferProxy)) {
    try {
      const start = Date.now();
      const res = await rawFetch(url, { method: 'POST', headers, body, dispatcher: t.dispatcher, timeout });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        lastJson = tryParse(txt);
        // 5xx or weird -> rotate transport. 4xx -> definitive API error.
        if (res.status >= 500 || res.status === 429) {
          if (t.kind === 'proxy') proxyManager.markBad(t.url);
          lastErr = new YTError(`YouTube HTTP ${res.status}`, 502, 'HTTP_' + res.status);
          continue;
        }
        const msg = lastJson?.error?.message || `YouTube HTTP ${res.status}`;
        throw new YTError(msg, res.status === 400 ? 400 : 502, lastJson?.error?.status || 'HTTP_' + res.status);
      }
      const json = await res.json();
      if (t.kind === 'proxy') proxyManager.markGood(t.url, Date.now() - start);
      if (ret) ret.transport = t;
      return json;
    } catch (e) {
      if (e instanceof YTError && e.status === 400) throw e; // bad payload: no point rotating
      if (e instanceof YTError && e.code === 'LOGIN_DATA') throw e;
      lastErr = e;
      if (t.kind === 'proxy') proxyManager.markBad(t.url);
    }
  }
  throw lastErr || new YTError('upstream unreachable', 502);
}

function tryParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

/** GET a text document (base.js, watch page) through the transport chain. */
async function fetchText(url, { preferProxy, timeout = 12000, ret } = {}) {
  let lastErr = null;
  for (const t of transports(preferProxy)) {
    try {
      const res = await rawFetch(url, {
        dispatcher: t.dispatcher,
        timeout,
        headers: { 'User-Agent': CLIENTS.WEB.ua, 'Accept-Language': 'ja,en;q=0.9' },
      });
      if (!res.ok) { if (t.kind === 'proxy') proxyManager.markBad(t.url); lastErr = new YTError('HTTP ' + res.status, 502); continue; }
      if (t.kind === 'proxy') proxyManager.markGood(t.url);
      if (ret) ret.transport = t;
      return await res.text();
    } catch (e) {
      if (t.kind === 'proxy') proxyManager.markBad(t.url);
      lastErr = e;
    }
  }
  throw lastErr || new YTError('fetch failed', 502);
}

/** HLS manifest URL for live streams (transport-pinned, cached). */
async function getHls(videoId) {
  const key = 'hls:' + videoId;
  const cached = caches.streams.get(key) || caches.streams.getStale(key);
  if (cached?.url) return cached;
  const p = await player(videoId);
  const entry = {
    url: p.hls || null,
    proxyUrl: p.__transport?.kind === 'proxy' ? p.__transport.url : null,
  };
  caches.streams.set(key, entry, 2 * 3600 * 1000);
  return entry;
}

/* ------------------------------------------------------------- visitor data */

async function getVisitorId() {
  let vd = caches.visitor.get('vd');
  if (vd) return vd;
  try {
    const res = await callApi('search', { query: 'youtube' }, CLIENTS.WEB);
    vd = decodeURIComponent(res?.responseContext?.visitorData || '');
    if (vd) caches.visitor.set('vd', vd, 20 * CACHE_MIN);
  } catch (_) { /* stays undefined; most endpoints work without */ }
  return vd || undefined;
}

/* ------------------------------------------------------------------ helpers */

const deepFind = (obj, key, limit = 1) => {
  const out = [];
  const stack = [obj];
  while (stack.length && out.length < limit) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object') {
      if (Array.isArray(cur)) { for (const v of cur) stack.push(v); continue; }
      if (Object.prototype.hasOwnProperty.call(cur, key)) out.push(cur[key]);
      for (const k in cur) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return out.length ? out : null;
};

const textOf = (t) => {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText != null) return String(t.simpleText);
  if (typeof t.content === 'string') return t.content;
  if (t.text?.content != null) return String(t.text.content);
  if (t.dynamicTextViewModel) return textOf(t.dynamicTextViewModel.text);
  if (Array.isArray(t.runs)) return t.runs.map(r => r.text || '').join('');
  return '';
};

const bestThumb = (thumbs) => {
  if (!Array.isArray(thumbs) || !thumbs.length) return '';
  return String(thumbs[thumbs.length - 1].url || '');
};

const parseRuns = (runs) => (Array.isArray(runs) ? runs.map(r => r.text || '').join('') : '');

const durText = (t) => {
  const m = /^(\d+:)?\d{1,2}:\d{2}$/.test(t || '');
  return m ? t : '';
};

/* ------------------------------------------------------- item normalization */

function endpointToUrl(cmd) {
  if (!cmd || typeof cmd !== 'object') return null;
  const meta = cmd.commandMetadata?.webCommandMetadata?.url;
  if (cmd.watchEndpoint?.videoId) return '/watch?v=' + cmd.watchEndpoint.videoId;
  if (cmd.reelWatchEndpoint?.videoId) return '/shorts/' + cmd.reelWatchEndpoint.videoId;
  if (cmd.watchPlaylistEndpoint?.playlistId) return '/playlist?list=' + cmd.watchPlaylistEndpoint.playlistId;
  if (cmd.browseEndpoint?.browseId) {
    const cu = cmd.browseEndpoint.canonicalBaseUrl || '';
    if (cu.startsWith('/@')) return '/channel/' + cu.slice(1);
    return '/channel/' + cmd.browseEndpoint.browseId;
  }
  if (cmd.playlistEditEndpoint) return null;
  return meta || null;
}

/** modern unified renderer (2024+): lockupViewModel */
function parseLockup(lvm) {
  if (!lvm || typeof lvm !== 'object') return null;
  const contentId = lvm.contentId;
  const ctype = lvm.contentType || '';
  const md = lvm.metadata?.lockupMetadataViewModel;
  const title = textOf(md?.title);
  const rows = (md?.metadata?.contentMetadataViewModel?.metadataRows || [])
    .map(r => (r.metadataParts || []).map(p => textOf(p.text)).filter(Boolean))
    .filter(r => r.length);
  let url = null;
  const cmd = lvm.rendererContext?.commandContext?.onTap?.innertubeCommand
    || lvm.rendererContext?.commandContext?.onTap?.command?.innertubeCommand;
  url = endpointToUrl(cmd);

  let kind = 'video';
  if (ctype.includes('PLAYLIST')) kind = 'playlist';
  else if (ctype.includes('CHANNEL')) kind = 'channel';
  else if (ctype.includes('SHORT') || (url && url.startsWith('/shorts/'))) kind = 'short';
  else if (url && url.startsWith('/channel/')) kind = 'channel';
  else if (url && url.startsWith('/playlist')) kind = 'playlist';

  // thumbnail: video lockups use thumbnailViewModel; channels use avatar models
  let thumb = '';
  const ci = lvm.contentImage || {};
  const tvm = ci.thumbnailViewModel || ci.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel;
  if (tvm?.image?.sources) thumb = bestThumb(tvm.image.sources);
  if (!thumb) {
    const av = deepFind(ci, 'avatarViewModel', 1);
    if (av?.[0]?.image?.sources) thumb = bestThumb(av[0].image.sources);
  }
  if (!thumb) {
    const dec = deepFind(ci, 'decoratedAvatarViewModel', 1)?.[0];
    const srcs = dec?.avatar?.avatarViewModel?.image?.sources;
    if (srcs) thumb = bestThumb(srcs);
  }

  // duration badge
  let duration = '';
  const badges = deepFind(tvm || {}, 'thumbnailBadgeViewModel', 3) || [];
  for (const b of badges) {
    const t = textOf(b);
    const dt = durText((t || '').trim());
    if (dt) { duration = dt; break; }
  }

  const id = contentId
    || (url?.match(/[?&]v=([\w-]{11})/)?.[1])
    || (url?.match(/shorts\/([\w-]{11})/)?.[1]);
  if (!id && !url) return null;

  return {
    kind, id: id || '',
    url: url || (id ? '/watch?v=' + id : null),
    title,
    thumb,
    duration,
    metaTop: rows[0] || [],
    metaBottom: rows[1] || [],
  };
}

function parseVideoRenderer(v) {
  if (!v?.videoId) return null;
  const ownerRuns = v.ownerText?.runs || v.longBylineText?.runs || [];
  const ch = ownerRuns[0]?.navigationEndpoint?.browseEndpoint;
  return {
    kind: 'video',
    id: v.videoId,
    url: '/watch?v=' + v.videoId,
    title: textOf(v.title),
    thumb: bestThumb(v.thumbnail?.thumbnails) || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    duration: textOf(v.lengthText) || '',
    badges: [],
    views: textOf(v.viewCountText),
    published: textOf(v.publishedTimeText),
    channelId: ch?.browseId || '',
    channel: textOf(v.ownerText),
    metaTop: [textOf(v.viewCountText), textOf(v.publishedTimeText)].filter(Boolean),
    metaBottom: [],
  };
}

function parseCompactVideo(v) {
  if (!v?.videoId) return null;
  const base = parseVideoRenderer(v);
  return { ...base };
}

function parseReelItem(rr) {
  if (!rr?.videoId) return null;
  const onTap = rr.navigationEndpoint;
  return {
    kind: 'short',
    id: rr.videoId,
    url: '/shorts/' + rr.videoId,
    title: textOf(rr.headline),
    thumb: bestThumb(rr.thumbnail?.thumbnails) || `https://i.ytimg.com/vi/${rr.videoId}/oar2.jpg`,
    views: textOf(rr.viewCountText),
    accessibility: textOf(rr.accessibility?.accessibilityData?.label),
  };
}

function parsePlaylistVideo(v) {
  if (!v?.videoId) return null;
  return {
    kind: 'video',
    id: v.videoId,
    url: '/watch?v=' + v.videoId,
    title: textOf(v.title),
    thumb: bestThumb(v.thumbnail?.thumbnails) || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    duration: textOf(v.lengthText) || '',
    channel: textOf(v.shortBylineText),
    index: v.index ? Number(textOf(v.index)) : undefined,
  };
}

function parseChannelRenderer(c) {
  if (!c?.channelId) return null;
  const canon = c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
    || c.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
  return {
    kind: 'channel',
    id: c.channelId,
    url: '/channel/' + c.channelId,
    title: textOf(c.title),
    handle: canon.startsWith('/@') ? canon.slice(1) : '',
    subs: textOf(c.subscriberCountText),
    videos: textOf(c.videoCountText),
    thumb: bestThumb(c.thumbnail?.thumbnails),
    description: textOf(c.descriptionSnippet),
  };
}

function parsePlaylistRenderer(p) {
  if (!p?.playlistId) return null;
  return {
    kind: 'playlist',
    id: p.playlistId,
    url: '/playlist?list=' + p.playlistId,
    title: textOf(p.title),
    count: textOf(p.videoCountText) || textOf(p.videoCount),
    thumb: bestThumb(p.thumbnails || p.thumbnail?.thumbnails || p.thumbnailRenderer?.showCustomThumbnailRenderer?.thumbnail?.thumbnails),
    channel: textOf(p.shortBylineText),
  };
}

/**
 * Walk an InnerTube response tree once and pull out normalized content items
 * in visual order, plus the continuation token for the next page.
 */
function extractItems(root) {
  const items = [];
  const seen = new Set();
  let continuation = null;
  const push = (kind, it) => {
    if (!it) return;
    const key = kind + ':' + (it.id || it.url || it.title);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(it);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    const keys = Object.keys(node);
    if (node.lockupViewModel) { push('lockup', parseLockup(node.lockupViewModel)); return; }
    if (node.richItemRenderer?.content) { walk(node.richItemRenderer.content); return; }
    if (node.reelItemRenderer) { push('short', parseReelItem(node.reelItemRenderer)); return; }
    if (node.gridVideoRenderer) { push('video', parseVideoRenderer(node.gridVideoRenderer)); return; }
    if (node.compactVideoRenderer) { push('video', parseCompactVideo(node.compactVideoRenderer)); return; }
    if (node.videoRenderer) { push('video', parseVideoRenderer(node.videoRenderer)); return; }
    if (node.playlistVideoRenderer) { push('video', parsePlaylistVideo(node.playlistVideoRenderer)); return; }
    if (node.channelRenderer) { push('channel', parseChannelRenderer(node.channelRenderer)); return; }
    if (node.playlistRenderer) { push('playlist', parsePlaylistRenderer(node.playlistRenderer)); return; }
    if (node.continuationItemRenderer) {
      const tok = node.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token
        || deepFind(node.continuationItemRenderer, 'token', 1)?.[0];
      if (tok) continuation = tok;
      return;
    }
    // don't descend into ad/nudge renderers
    for (const k of keys) {
      if (k === 'adSlotRenderer' || k === 'feedNudgeRenderer' || k === 'statementBannerRenderer' || k === 'promotedSparklesWebRenderer') continue;
      walk(node[k]);
    }
  };
  walk(root);
  return { items, continuation };
}

/* ------------------------------------------------------------------- search */

async function search(query, { sp, hl = 'ja', gl = 'JP' } = {}) {
  const key = `s:${query}:${sp || ''}:${hl}${gl}`;
  return caches.api.wrap(key, 10 * CACHE_MIN, async () => {
    const visitorId = await getVisitorId();
    const payload = { query };
    if (sp) payload.params = sp;
    let lastSearchError = null;
    try {
      const res = await callApi('search', payload, CLIENTS.WEB, { visitorId });
      const root = res?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
        || res?.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems
        || res;
      const { items, continuation } = extractItems(root);
      if (items.length || sp) return { query, items, continuation };
    } catch (e) {
      // fall through to the youtube-search-api backup below
      lastSearchError = e;
    }
    // ---- backup path: youtube-search-api (scrapes the public results page).
    // Handy when the datacenter IP is served bot-walls for youtubei search.
    try {
      const yts = require('youtube-search-api');
      const out = await yts.GetListByKeyword(query, false, 20, [{ type: 'video' }]);
      const items = (out?.items || []).map(v => v?.id ? ({
        kind: 'video',
        id: v.id,
        url: '/watch?v=' + v.id,
        title: v.title || '',
        thumb: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        duration: v.length?.simpleText || '',
        channel: v.channelTitle || '',
        metaTop: [],
        metaBottom: [],
      }) : null).filter(Boolean);
      if (items.length) return { query, items, continuation: null, via: 'youtube-search-api' };
    } catch (_) { /* both paths failed */ }
    throw lastSearchError || new YTError('search unavailable', 502);
  });
}

async function searchNext(continuation) {
  return caches.api.wrap('sn:' + continuation, 10 * CACHE_MIN, async () => {
    const visitorId = await getVisitorId();
    const res = await callApi('search', { continuation }, CLIENTS.WEB, { visitorId });
    const roots = res?.onResponseReceivedCommands || res?.onResponseReceivedEndpoints || [];
    const items = [];
    let cont = null;
    for (const ep of roots) {
      const bag = ep.appendContinuationItemsAction?.continuationItems
        || ep.reloadContinuationItemsCommand?.continuationItems
        || ep.appendContinuationItemsAction?.continuationItems || [];
      const r = extractItems(bag);
      items.push(...r.items);
      if (r.continuation) cont = r.continuation;
    }
    return { items, continuation: cont };
  });
}

/* -------------------------------------------------------------------- watch */

function parsePrimaryInfo(c) {
  const pri = deepFind(c, 'videoPrimaryInfoRenderer', 1)?.[0] || {};
  const sec = deepFind(c, 'videoSecondaryInfoRenderer', 1)?.[0] || {};
  const owner = deepFind(sec, 'videoOwnerRenderer', 1)?.[0] || {};
  const title = textOf(pri.title);
  const viewCount = textOf(pri.viewCount?.videoViewCountRenderer?.viewCount);
  const dateText = textOf(pri.dateText);
  // likes: the count rides in an accessibilityText like
  // "他 109,633 人もこの動画を高く評価しました" (entity-driven in 2026 payloads)
  let likeCount = '';
  try {
    const blob = JSON.stringify(c);
    const m = blob.match(/"accessibilityText":\s*"(?:[^"]*?\s)?([\d,\.万億千百]+)\s*(?:人もこの動画を高く評価|件の高評価)/)
      || blob.match(/"defaultText":\s*\{[^}]*"content":\s*"([\d,\.万億]+)"[^}]*\}[^}]*"accessibilityText":\s*"[^"]*高評価/);
    if (m) likeCount = m[1];
  } catch (_) { /* optional metric */ }
  const channelId = owner?.navigationEndpoint?.browseEndpoint?.browseId
    || owner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || '';
  // description
  let description = textOf(sec.attributedDescription?.content)
    || textOf(deepFind(sec, 'expandableVideoDescriptionBodyRenderer', 1)?.[0]?.descriptionBodyText)
    || '';
  return {
    title, viewCount, dateText, likeCount, description,
    channel: {
      id: channelId,
      name: textOf(owner.title),
      subs: textOf(owner.subscriberCountText),
      avatar: bestThumb(owner.thumbnail?.thumbnails),
      verified: !!deepFind(owner, 'badge', 4)?.some?.(b => /CHECK|BADGE_STYLE_TYPE_VERIFIED/.test(JSON.stringify(b))),
    },
  };
}

async function watchNext(videoId, { hl = 'ja', gl = 'JP' } = {}) {
  return caches.api.wrap('w:' + videoId + hl + gl, 10 * CACHE_MIN, async () => {
    const visitorId = await getVisitorId();
    const res = await callApi('next', { videoId, contentCheckOk: true, racyCheckOk: true }, CLIENTS.WEB, { visitorId });
    const watch = res?.contents?.twoColumnWatchNextResults || {};
    const results = watch?.results?.results?.contents || [];
    const meta = parsePrimaryInfo(results);
    // comments entry
    let commentsToken = null;
    let commentsCount = '';
    const panels = res?.engagementPanels || [];
    for (const p of panels) {
      const r = p?.engagementPanelSectionListRenderer;
      if (r?.panelIdentifier === 'engagement-panel-comments-section') {
        commentsToken = deepFind(r, 'continuationCommand', 4)?.map(x => x.token).find(Boolean) || null;
      }
    }
    const hd = deepFind(res, 'commentsEntryPointHeaderRenderer', 1)?.[0];
    if (hd) commentsCount = textOf(hd.commentCount);
    // related
    const sec = watch?.secondaryResults?.secondaryResults?.results || [];
    const { items: related, continuation: relatedContinuation } = extractItems(sec);
    // autoplay target
    const autoplay = deepFind(watch?.autoplay?.autoplay, 'watchEndpoint', 1)?.[0]?.videoId || null;
    return {
      videoId,
      ...meta,
      related,
      relatedContinuation,
      commentsToken,
      commentsCount,
      autoplay,
    };
  });
}

/* ------------------------------------------------------------------ streams */

function normalizeFormat(f, videoId) {
  const mime = f.mimeType || '';
  const isVideo = mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  return {
    itag: f.itag,
    mime: mime.split(';')[0],
    codecs: (mime.match(/codecs="([^"]+)"/) || [])[1] || '',
    qualityLabel: f.qualityLabel || (isAudio ? (f.audioQuality || '').replace('AUDIO_QUALITY_', '').toLowerCase() : ''),
    width: f.width, height: f.height, fps: f.fps,
    bitrate: f.bitrate, audioQuality: f.audioQuality,
    contentLength: Number(f.contentLength) || 0,
    initRange: f.initRange || null,
    indexRange: f.indexRange || null,
    isVideo, isAudio,
    hasUrl: !!f.url,
    cipher: f.signatureCipher || null,
    url: f.url || null,
  };
}

function buildStreamMaps(videoId, formats, playerResponse) {
  const normalized = formats.map(f => normalizeFormat(f, videoId));
  const withUrl = normalized.filter(f => f.hasUrl);
  const map = {};
  for (const f of withUrl) map[f.itag] = f.url;
  const progressive = withUrl.filter(f => f.isVideo && f.mime === 'video/mp4' && /avc1|vp9/.test(f.codecs) && (f.audioQuality || f.itag === 18 || f.itag === 22))
    .filter(f => f.itag === 18 || f.itag === 22 || f.itag === 59)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const videos = withUrl.filter(f => f.isVideo && !progressive.includes(f))
    .sort((a, b) => (b.height || 0) * (b.fps || 0) - (a.height || 0) * (a.fps || 0) || (a.mime === 'video/mp4' ? -1 : 1));
  const audios = withUrl.filter(f => f.isAudio)
    .sort((a, b) => ((a.mime === 'audio/mp4' ? 0 : 1) - (b.mime === 'audio/mp4' ? 0 : 1)) || (b.bitrate || 0) - (a.bitrate || 0));
  return { map, progressive, videos, audios };
}

async function solveCiphers(formats) {
  // formats with signatureCipher -> need base.js transforms
  const need = formats.filter(f => !f.url && f.cipher);
  if (!need.length) return formats;
  await sigSolver.ensure((u) => fetchText(u));
  const sigChallenges = [];
  const nChallenges = [];
  const parsed = need.map(f => {
    const p = new URLSearchParams(f.cipher);
    const base = p.get('url');
    const sp = p.get('sp') || 'sig';
    const s = p.get('s');
    let u = null;
    let n = null;
    try { u = new URL(base); n = u.searchParams.get('n'); } catch (_) { /* malformed */ }
    if (s) sigChallenges.push(s);
    if (n) nChallenges.push(n);
    return { f, u, sp, s, n };
  });
  const sigMap = sigChallenges.length ? sigSolver.solve('sig', sigChallenges) : {};
  const nMap = nChallenges.length ? sigSolver.solve('n', nChallenges) : {};
  for (const ent of parsed) {
    try {
      if (!ent.u) continue;
      if (ent.n && nMap[ent.n]) ent.u.searchParams.set('n', nMap[ent.n]);
      if (ent.s && sigMap[ent.s]) ent.u.searchParams.set(ent.sp, sigMap[ent.s]);
      ent.f.url = ent.u.toString();
    } catch (_) { /* leave url-less */ }
  }
  return formats;
}

async function player(videoId, { hl = 'ja', gl = 'JP' } = {}) {
  const variants = [
    // direct first: when the egress isn't bot-flagged it's by far the fastest.
    // proxy variants rescue us whenever the server IP is blocked (LOGIN_REQUIRED).
    { extra: { params: '2AMB' }, preferProxy: 'direct' },
    { extra: { params: '2AMB' }, preferProxy: undefined },
    { extra: {}, preferProxy: 'direct' },
    { extra: {}, preferProxy: 'proxy' },
  ];
  let lastErr = null;
  let lastStatus = null;
  let best = null; // richest OK response so far (max formats with direct urls)
  for (const v of variants) {
    let res;
    const ret = {};
    try {
      res = await callApi('player', {
        videoId, contentCheckOk: true, racyCheckOk: true, ...v.extra,
      }, CLIENTS.ANDROID, { preferProxy: v.preferProxy, timeout: 12000, ret });
    } catch (e) {
      lastErr = e;
      continue;
    }
    const ps = res?.playabilityStatus || {};
    lastStatus = ps;
    if (ps.status !== 'OK') {
      lastErr = new YTError(ps.reason || ps.status || '再生できません', 451, ps.status || 'UNPLAYABLE');
      if (ps.status === 'LOGIN_REQUIRED') continue; // rotate transport
      break;
    }
    const sd = res.streamingData || {};
    const fmt = sd.formats || [];
    const af = sd.adaptiveFormats || [];
    if (!fmt.length && !af.length && !sd.hlsManifestUrl) { lastErr = new YTError('no formats', 502); continue; }
    try { await solveCiphers([...fmt, ...af]); } catch (_) { /* solver unavailable: keep url'd ones */ }
    const usable = [...fmt, ...af];
    const urlCount = usable.filter(f => f.url).length;
    if (!urlCount && !sd.hlsManifestUrl) { lastErr = new YTError('no usable formats', 502); continue; }
    if (!best || urlCount > best.urlCount) best = { res, ret, urlCount, sd, usable };
    if (urlCount >= 5) break; // rich enough — stop burning variants
  }
  if (best) {
    const { res, ret, usable } = best;
    const sd = res.streamingData || {};
    const fmt = sd.formats || [];
    const maps = buildStreamMaps(videoId, usable, res);
    const vd = res.videoDetails || {};
    const mf = res.microformat?.playerMicroformatRenderer || {};
    return {
      videoId,
      __transport: ret.transport || null,
      title: vd.title || '',
      author: vd.author || '',
      channelId: vd.channelId || '',
      viewCount: vd.viewCount || '',
      lengthSeconds: Number(vd.lengthSeconds) || 0,
      isLive: !!vd.isLiveContent,
      isShort: vd.isShortsEligible || (Number(vd.lengthSeconds) > 0 && Number(vd.lengthSeconds) <= 180 && /\bshorts\b/i.test(vd.title || '')) || false,
      publishDate: mf.publishDate || '',
      uploadDate: mf.uploadDate || '',
      category: mf.category || '',
      keywords: vd.keywords || [],
      progressive: maps.progressive.map(stripUrl),
      videos: maps.videos.map(stripUrl),
      audios: maps.audios.map(stripUrl),
      hls: sd.hlsManifestUrl || null,
      expiresInSeconds: Number(fmt[0]?.expiresInSeconds) || 21540,
      __urlMap: maps.map,
    };
  }
  const err = lastErr || new YTError('player failed', 502);
  err.statusHint = lastStatus?.status;
  err.reason = lastStatus?.reason;
  throw err;
}

function stripUrl(f) {
  const { url, ...rest } = f;
  return rest;
}

async function getVideoFull(videoId, opts = {}) {
  const [pl, nx] = await Promise.allSettled([player(videoId, opts), watchNext(videoId, opts)]);
  if (pl.status === 'rejected' && nx.status === 'rejected') throw pl.reason;
  const p = pl.status === 'fulfilled' ? pl.value : null;
  const n = nx.status === 'fulfilled' ? nx.value : null;
  const out = {
    videoId,
    title: n?.title || p?.title || '',
    description: n?.description || '',
    viewCount: n?.viewCount || (p?.viewCount ? Number(p.viewCount).toLocaleString('ja-JP') + ' 回視聴' : ''),
    dateText: n?.dateText || '',
    likeCount: n?.likeCount || '',
    publishDate: p?.publishDate || '',
    category: p?.category || '',
    isLive: p?.isLive || false,
    lengthSeconds: p?.lengthSeconds || 0,
    channel: n?.channel?.id ? n.channel : { id: p?.channelId || '', name: p?.author || '', subs: '', avatar: '' },
    related: n?.related || [],
    relatedContinuation: n?.relatedContinuation || null,
    commentsToken: n?.commentsToken || null,
    commentsCount: n?.commentsCount || '',
    autoplay: n?.autoplay || null,
    streams: p ? {
      progressive: p.progressive,
      videos: p.videos,
      audios: p.audios,
      hls: p.hls,
    } : null,
    playable: !!p && (p.progressive.length > 0 || p.videos.length > 0 || !!p.hls),
    playability: p ? null : { status: pl.reason?.statusHint || 'ERROR', reason: pl.reason?.reason || pl.reason?.message || 'この動画は再生できません' },
  };
  if (p?.__urlMap) {
    caches.streams.set('map:' + videoId, {
      map: p.__urlMap,
      proxyUrl: p.__transport?.kind === 'proxy' ? p.__transport.url : null,
    }, Math.min(5 * 3600 * 1000, (p.expiresInSeconds - 300) * 1000));
  }
  if (n && !out.title) out.title = n.videoId;
  return out;
}

async function getStreamUrl(videoId, itag) {
  let entry = caches.streams.get('map:' + videoId);
  if (!entry || (itag && !entry.map[itag])) {
    const p = await player(videoId);
    entry = {
      map: p.__urlMap,
      proxyUrl: p.__transport?.kind === 'proxy' ? p.__transport.url : null,
    };
    caches.streams.set('map:' + videoId, entry, 5 * 3600 * 1000);
  }
  return { url: entry.map?.[itag] || entry.map?.[18] || Object.values(entry.map || {})[0] || null, proxyUrl: entry.proxyUrl };
}

async function refreshStreamMap(videoId) {
  caches.streams.delete('map:' + videoId);
  const p = await player(videoId);
  const entry = {
    map: p.__urlMap,
    proxyUrl: p.__transport?.kind === 'proxy' ? p.__transport.url : null,
  };
  caches.streams.set('map:' + videoId, entry, Math.min(5 * 3600 * 1000, (p.expiresInSeconds - 300) * 1000));
  return entry;
}

/* ----------------------------------------------------------------- comments */

function buildCommentEntityMap(res) {
  const map = new Map();
  const muts = res?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  for (const m of muts) {
    const p = m?.payload?.commentEntityPayload;
    if (p && m.entityKey) map.set(m.entityKey, p);
  }
  return map;
}

function parseCommentThread(ctr, entities) {
  const vm = ctr?.commentViewModel?.commentViewModel || ctr?.commentViewModel || {};
  const replies = ctr?.replies?.commentRepliesRenderer;
  const repliesToken = replies ? deepFind(replies, 'continuationCommand', 2)?.[0]?.token || null : null;
  // 2025+ entity payload (authoritative)
  const payload = vm.commentKey ? entities?.get(vm.commentKey) : null;
  if (payload) {
    return {
      id: payload.properties?.commentId || '',
      author: payload.author?.displayName || '',
      authorChannelId: payload.author?.channelId || '',
      avatar: payload.author?.avatarThumbnailUrl || '',
      text: payload.properties?.content?.content || '',
      likes: String(payload.toolbar?.likeCountNotliked || payload.toolbar?.likeCountLiked || ''),
      published: payload.properties?.publishedTime || '',
      repliesToken,
      replyCount: String(payload.toolbar?.replyCount || ''),
    };
  }
  // legacy commentRenderer fallback
  const cr = ctr?.comment?.commentRenderer;
  if (cr) {
    return {
      id: cr.commentId || '',
      author: textOf(cr.authorText),
      authorChannelId: cr.authorEndpoint?.browseEndpoint?.browseId || '',
      avatar: bestThumb(cr.authorThumbnail?.thumbnails),
      text: textOf(cr.contentText),
      likes: String(cr.likeCount ?? ''),
      published: textOf(cr.publishedTimeText),
      repliesToken,
      replyCount: textOf(replies?.moreText) || '',
    };
  }
  // vm-only legacy variant
  if (vm.commentId || vm.authorName) {
    return {
      id: vm.commentId || '',
      author: vm.authorName || '',
      authorChannelId: vm.authorChannelId || '',
      avatar: vm.avatarImageUrl || '',
      text: typeof vm.commentText === 'string' ? vm.commentText : textOf(vm.commentText),
      likes: String(vm.likeCount ?? ''),
      published: typeof vm.publishedTimeText === 'string' ? vm.publishedTimeText : textOf(vm.publishedTimeText),
      repliesToken,
      replyCount: textOf(replies?.moreText) || '',
    };
  }
  return null;
}

function parseCommentPage(res) {
  const entities = buildCommentEntityMap(res);
  const eps = res?.onResponseReceivedEndpoints || res?.onResponseReceivedCommands || [];
  const comments = [];
  let continuation = null;
  let count = '';
  for (const ep of eps) {
    for (const k of ['reloadContinuationItemsCommand', 'appendContinuationItemsCommand', 'appendContinuationItemsAction']) {
      const bag = ep[k]?.continuationItems;
      if (!bag) continue;
      for (const it of bag) {
        if (it.commentsHeaderRenderer) count = textOf(it.commentsHeaderRenderer.countText) || textOf(it.commentsHeaderRenderer.commentsCount);
        else if (it.commentThreadRenderer) { const c = parseCommentThread(it.commentThreadRenderer, entities); if (c && (c.text || c.author)) comments.push(c); }
        else if (it.commentRenderer) { const c = parseCommentThread({ comment: { commentRenderer: it.commentRenderer } }, entities); if (c && (c.text || c.author)) comments.push(c); }
        else if (it.continuationItemRenderer) {
          const t = it.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token
            || deepFind(it.continuationItemRenderer, 'token', 1)?.[0];
          if (t) continuation = t;
        }
      }
    }
  }
  return { comments, continuation, count };
}

async function comments(videoId) {
  return caches.api.wrap('c0:' + videoId, 5 * CACHE_MIN, async () => {
    const visitorId = await getVisitorId();
    const res = await callApi('next', { videoId, contentCheckOk: true }, CLIENTS.WEB, { visitorId });
    const panels = res?.engagementPanels || [];
    let token = null;
    for (const p of panels) {
      const r = p?.engagementPanelSectionListRenderer;
      if (r?.panelIdentifier === 'engagement-panel-comments-section') {
        token = deepFind(r, 'continuationCommand', 4)?.map(x => x.token).find(Boolean) || null;
      }
    }
    const hd = deepFind(res, 'commentsEntryPointHeaderRenderer', 1)?.[0];
    const entryCount = hd ? (textOf(hd.commentCount) || '') : '';
    if (!token) return { comments: [], continuation: null, count: entryCount, disabled: true };
    const page1 = await callApi('next', { continuation: token }, CLIENTS.WEB, { visitorId });
    const parsed = parseCommentPage(page1);
    return { ...parsed, count: parsed.count || entryCount, disabled: false };
  });
}

async function commentsNext(continuation) {
  return caches.api.wrap('cx:' + continuation.slice(-24), 5 * CACHE_MIN, async () => {
    const visitorId = await getVisitorId();
    const res = await callApi('next', { continuation }, CLIENTS.WEB, { visitorId });
    return parseCommentPage(res);
  });
}

/* ------------------------------------------------------------------ channel */

function parseChannelHeader(res) {
  const phv = deepFind(res, 'pageHeaderViewModel', 1)?.[0];
  if (!phv) {
    const c4 = deepFind(res, 'c4TabbedHeaderRenderer', 1)?.[0];
    if (c4) return {
      name: textOf(c4.title), handle: '', subs: textOf(c4.subscriberCountText),
      videos: textOf(c4.videosCountText),
      avatar: bestThumb(c4.avatar?.thumbnails),
      banner: bestThumb(c4.banner?.thumbnails),
    };
    return null;
  }
  const md = phv.metadata?.contentMetadataViewModel;
  const rows = (md?.metadataRows || []).map(r => (r.metadataParts || []).map(p => textOf(p.text)).filter(Boolean));
  const flat = rows.flat();
  const avatarSources = phv.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources
    || deepFind(phv.image || {}, 'sources', 1)?.[0];
  const bannerVM = phv.banner?.imageBannerViewModel || deepFind(phv, 'imageBannerViewModel', 1)?.[0];
  return {
    name: textOf(phv.title) || textOf(phv.pageTitle) || '',
    handle: flat.find(t => t.startsWith('@')) || '',
    subs: flat.find(t => /登録者/.test(t)) || '',
    videos: flat.find(t => /本の動画|動画/.test(t) && !/登録者/.test(t)) || '',
    description: textOf(phv.description?.descriptionPreviewViewModel?.description),
    avatar: bestThumb(avatarSources),
    banner: bestThumb(bannerVM?.image?.sources || bannerVM?.image?.images?.sources),
    country: '',
  };
}

function parseChannelTabs(res) {
  const tabs = res?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  return tabs.map(t => {
    const tr = t.tabRenderer || t.expandableTabRenderer;
    if (!tr || !tr.title) return null;
    return {
      title: tr.title,
      selected: !!tr.selected,
      params: tr.endpoint?.browseEndpoint?.params || null,
    };
  }).filter(Boolean);
}

async function channel(idOrHandle, { params, continuation, hl = 'ja', gl = 'JP' } = {}) {
  const browseId = await resolveChannelId(idOrHandle);
  const visitorId = await getVisitorId();
  const payload = { browseId };
  if (params) payload.params = params;
  if (continuation) {
    const res = await callApi('browse', { continuation }, CLIENTS.WEB, { visitorId });
    const eps = res?.onResponseReceivedEndpoints || [];
    let items = [];
    let cont = null;
    for (const ep of eps) {
      const bag = ep.appendContinuationItemsAction?.continuationItems || ep.reloadContinuationItemsCommand?.continuationItems || [];
      const r = extractItems(bag);
      items = items.concat(r.items);
      if (r.continuation) cont = r.continuation;
    }
    return { items, continuation: cont };
  }
  const res = await callApi('browse', payload, CLIENTS.WEB, { visitorId });
  const header = parseChannelHeader(res);
  const tabs = parseChannelTabs(res);
  // content of selected tab
  const sel = (res?.contents?.twoColumnBrowseResultsRenderer?.tabs || [])
    .map(t => t.tabRenderer || t.expandableTabRenderer).find(t => t && t.selected);
  const content = sel?.content || null;
  const { items, continuation: cont } = extractItems(content || res);
  // sections (home tab) - keep flat
  return {
    id: browseId,
    ...header,
    tabs,
    items,
    continuation: cont,
  };
}

async function resolveChannelId(idOrHandle) {
  if (!idOrHandle) throw new YTError('channel required', 400);
  let id = String(idOrHandle).trim();
  if (/^UC[\w-]{20,}$/.test(id)) return id;
  let handle = id;
  if (id.startsWith('@')) handle = id.slice(1);
  else if (id.startsWith('channel/')) id = id.slice(8);
  if (/^UC[\w-]{20,}$/.test(id)) return id;
  const cacheKey = 'rh:' + handle.toLowerCase();
  const cached = caches.api.get(cacheKey);
  if (cached) return cached;
  // 1) HTML page via transport — target the *owner* id specifically
  try {
    const html = await fetchText(`${HOST_WEB}/@${encodeURIComponent(handle)}`);
    const jsUrl = html.match(/"PLAYER_JS_URL":"([^"]+)"/)?.[1];
    if (jsUrl) sigSolver.notePlayerUrl(jsUrl.replace(/\\u0026/g, '&'));
    const hEsc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m =
      html.match(new RegExp(`"browseId":"(UC[\\w-]+)","canonicalBaseUrl":"/@${hEsc}"`, 'i'))
      || html.match(/"externalId":"(UC[\w-]+)"/)
      || html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/)
      || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/)
      || html.match(/"ownerUrls":\[[^\]]*"https?:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
    if (m) { caches.api.set(cacheKey, m[1], 3600e3); return m[1]; }
  } catch (_) { /* fall through to search */ }
  // 2) search fallback — prefer exact @handle match
  const res = await search('@' + handle.replace(/^@/, ''));
  const exact = res.items.find(i => i.kind === 'channel' && i.handle && i.handle.toLowerCase() === '@' + handle.toLowerCase());
  const ch = exact || res.items.find(i => i.kind === 'channel');
  const found = ch?.id?.startsWith('UC') ? ch.id : null;
  if (!found) throw new YTError('チャンネルが見つかりません', 404, 'NOT_FOUND');
  caches.api.set(cacheKey, found, 3600e3);
  return found;
}

/* ----------------------------------------------------------------- playlist */

async function playlist(listId) {
  const id = String(listId).startsWith('VL') ? String(listId) : 'VL' + listId;
  const visitorId = await getVisitorId();
  const res = await callApi('browse', { browseId: id }, CLIENTS.WEB, { visitorId });
  const title = textOf(deepFind(res, 'playlistSidebarRenderer', 1)?.[0]?.title) || textOf(deepFind(res, 'pageTitle', 1)?.[0]);
  const sub = deepFind(res, 'playlistSidebarRenderer', 1)?.[0] || {};
  const { items, continuation } = extractItems(res?.contents?.twoColumnBrowseResultsRenderer || res);
  const ownerCh = deepFind(sub, 'playlistOwnerEndpoint', 1)?.[0];
  return {
    id: listId,
    title,
    description: textOf(sub.description),
    views: textOf(sub.viewCountText),
    channelId: ownerCh?.browseEndpoint?.browseId || '',
    channelName: textOf(deepFind(sub, 'playlistOwnerText', 1)?.[0]),
    items: items.filter(i => i.kind === 'video' || i.kind === 'short'),
    continuation,
  };
}

async function playlistNext(continuation) {
  const visitorId = await getVisitorId();
  const res = await callApi('browse', { continuation }, CLIENTS.WEB, { visitorId });
  const eps = res?.onResponseReceivedEndpoints || [];
  let items = [], cont = null;
  for (const ep of eps) {
    const bag = ep.appendContinuationItemsAction?.continuationItems || [];
    const r = extractItems(bag);
    items = items.concat(r.items);
    if (r.continuation) cont = r.continuation;
  }
  return { items: items.filter(i => i.kind === 'video'), continuation: cont };
}

/* --------------------------------------------------------------------- home */

const HOME_PRESETS = {
  all: [
    { q: '今人気の動画 2026' },
    { q: '急上昇 音楽' },
    { q: '話題の動画' },
    { q: 'バズった' },
  ],
  music: [{ q: '最新曲 ランキング' }, { q: 'ミュージックビデオ 人気' }, { q: 'カラオケ 人気曲' }],
  gaming: [{ q: 'ゲーム実況 人気' }, { q: 'ゲーム 新作' }],
  news: [{ q: 'ニュース 最新' }, { q: 'ニュースライブ' }],
  anime: [{ q: 'アニメ 話題' }, { q: 'アニメ 2026' }],
  cooking: [{ q: '料理 レシピ 人気' }, { q: '簡単レシピ' }],
  sports: [{ q: 'スポーツ ハイライト' }, { q: 'スポーツ 名場面' }],
  tech: [{ q: 'テクノロジー 解説' }, { q: 'ガジェット レビュー' }],
  asmr: [{ q: 'ASMR 人気' }, { q: 'ASMR 睡眠' }],
};

async function home(chip = 'all') {
  return caches.api.wrap('home:' + chip, 15 * CACHE_MIN, async () => {
    const presets = HOME_PRESETS[chip] || HOME_PRESETS.all;
    const pages = await Promise.allSettled(presets.map(p => search(p.q)));
    const items = [];
    const seen = new Set();
    for (const pg of pages) {
      if (pg.status !== 'fulfilled') continue;
      for (const it of pg.value.items) {
        const k = (it.kind === 'video' || it.kind === 'short') ? it.id : null;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        items.push(it);
      }
    }
    // interleave-ish shuffle for variety but stable within TTL
    items.sort((a, b) => ((a.id || '').charCodeAt(2) || 0) - ((b.id || '').charCodeAt(2) || 0));
    return { chip, items, continuation: null };
  });
}

/* ------------------------------------------------------------------ suggest */

async function suggest(q) {
  return caches.api.wrap('sg:' + q, 10 * CACHE_MIN, async () => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ja&gl=jp&q=${encodeURIComponent(q)}`;
    let lastErr = null;
    for (const t of transports('direct')) {
      try {
        const res = await rawFetch(url, { dispatcher: t.dispatcher, timeout: 5000, headers: { 'User-Agent': CLIENTS.WEB.ua } });
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); if (t.kind === 'proxy') proxyManager.markBad(t.url); continue; }
        const json = await res.json();
        if (t.kind === 'proxy') proxyManager.markGood(t.url);
        return { q, suggestions: Array.isArray(json?.[1]) ? json[1] : [] };
      } catch (e) {
        lastErr = e;
        if (t.kind === 'proxy') proxyManager.markBad(t.url);
      }
    }
    throw lastErr || new YTError('suggest failed', 502);
  });
}

module.exports = {
  search, searchNext, watchNext, getVideoFull, player, getStreamUrl, refreshStreamMap,
  comments, commentsNext, channel, playlist, playlistNext, home, suggest,
  resolveChannelId, getVisitorId, getHls, fetchText, YTError, caches,
};
