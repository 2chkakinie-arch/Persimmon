/* llytpr-wl.v01nh — frontend SPA.
 * InnerTube-backed YouTube experience: home / search / watch (progressive +
 * MSE HD "DashLite") / comments / channel / playlist / shorts.
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1 */
'use strict';
(() => {

/* ------------------------------------------------------------ tiny helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
window.toast = toast;

const fmtDur = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
};

function linkify(text) {
  const escT = esc(text);
  return escT
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_ー-龯ぁ-んァ-ヶ]+)/gu, (m, p1, p2) => p1 + `<a href="#/results?search_query=${encodeURIComponent('#' + p2)}">#${esc(p2)}</a>`);
}

/* ----------------------------------------------------------------- api kit */
const mem = new Map();
async function api(path, { ttl = 5 * 60e3 } = {}) {
  const hit = mem.get(path);
  if (hit && hit.exp > Date.now()) return hit.data;
  const inflight = api._inflight.get(path);
  if (inflight) return inflight;
  const p = fetch(path).then(async (res) => {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || ('HTTP ' + res.status)); e.payload = j; throw e; }
    mem.set(path, { data: j, exp: Date.now() + ttl });
    api._inflight.delete(path);
    return j;
  }).catch(e => { api._inflight.delete(path); throw e; });
  api._inflight.set(path, p);
  return p;
}
api._inflight = new Map();
api.invalidate = (prefix) => { for (const k of mem.keys()) if (String(k).includes(prefix)) mem.delete(k); };

/* infinite scroll helper */
function lazySentinel(container, onFire) {
  const io = new IntersectionObserver((es) => {
    if (es.some(e => e.isIntersecting)) onFire();
  }, { rootMargin: '1200px' });
  const el = document.createElement('div');
  el.className = 'sentinel';
  el.style.height = '1px';
  container.appendChild(el);
  io.observe(el);
  return {
    done() { io.disconnect(); el.remove(); },
    el,
  };
}

/* -------------------------------------------------------------- card maker */
const ICON_PLAY = '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="ic"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="verified"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2l-4-4L8.2 11l2.6 2.6 5-5L17.2 10z"/></svg>';

function thumbUrl(it) {
  if (it.thumb) return it.thumb;
  if (it.id && (it.kind === 'video' || it.kind === 'short')) return `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`;
  return '';
}

function videoCard(it, { rail = false } = {}) {
  if (it.kind === 'short') return shortCard(it, { rail });
  if (it.kind === 'channel') return channelRow(it);
  if (it.kind === 'playlist') return playlistCard(it);
  const href = it.url || ('#/watch?v=' + it.id);
  const meta = it.metaTop?.join(' • ') || [it.views, it.published].filter(Boolean).join(' • ');
  return `
  <div class="vcard" data-href="#${href.replace(/^#?/, '')}" data-vid="${esc(it.id)}">
    <div class="vthumb">
      <img loading="lazy" src="${esc(thumbUrl(it))}" alt="" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(it.id)}/hqdefault.jpg'">
      ${it.duration ? `<span class="dur">${esc(it.duration)}</span>` : (it.live ? '<span class="dur live-badge">LIVE</span>' : '')}
    </div>
    <div class="vmeta">
      <div class="vava"><svg viewBox="0 0 24 24" class="ic" style="fill:var(--text-3)"><path d="M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 18c-3.2 0-6-.5-6-1.5 0-2.5 3.5-4 6-4s6 1.5 6 4c0 1-2.8 1.5-6 1.5z"/></svg></div>
      <div class="vinfo">
        <div class="vtitle">${esc(it.title)}</div>
        <div class="vsub">${it.channel ? `<span class="vch">${esc(it.channel)}</span>` : ''}</div>
        <div class="vsub">${esc(meta || '')}</div>
      </div>
    </div>
  </div>`;
}

function railCard(it) {
  if (it.kind === 'short') {
    return `
    <div class="rcard" data-href="#/shorts/${esc(it.id)}" data-vid="${esc(it.id)}">
      <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
        <span class="dur" style="background:rgba(0,0,0,.8)">ショート</span>
      </div>
      <div class="vinfo">
        <div class="vtitle">${esc(it.title)}</div>
        <div class="vsub">${esc(it.views || '')}</div>
      </div>
    </div>`;
  }
  if (it.kind !== 'video') return '';
  const href = '#/watch?v=' + it.id;
  return `
  <div class="rcard" data-href="${href}" data-vid="${esc(it.id)}">
    <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
      ${it.duration ? `<span class="dur">${esc(it.duration)}</span>` : ''}
    </div>
    <div class="vinfo">
      <div class="vtitle">${esc(it.title)}</div>
      <div class="vsub">${esc(it.channel || '')}</div>
      <div class="vsub">${esc(it.metaTop?.join(' • ') || '')}</div>
    </div>
  </div>`;
}

function shortCard(it) {
  const href = '#/shorts/' + it.id;
  return `
  <div class="scard" data-href="${href}" data-vid="${esc(it.id)}">
    <div class="sthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt=""></div>
    <div class="stitle">${esc(it.title)}</div>
    <div class="sviews">${esc(it.views || '')}</div>
  </div>`;
}

function playlistCard(it) {
  return `
  <div class="vcard" data-href="#${(it.url || '/playlist?list=' + it.id).replace(/^#?/, '')}">
    <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
      <span class="dur">${esc(it.count || '再生リスト')}</span>
    </div>
    <div class="vmeta">
      <div class="vinfo">
        <div class="vtitle">${esc(it.title)}</div>
        <div class="vsub">${esc(it.channel || '')}</div>
        <div class="vsub">再生リストをすべて見る</div>
      </div>
    </div>
  </div>`;
}

function channelRow(it) {
  return `
  <div class="vcard" data-href="#${(it.url || '/channel/' + it.id).replace(/^#?/, '')}">
    <div class="result-channel-row">
      <div class="vava" style="width:96px;height:96px">${it.thumb ? `<img src="${esc(it.thumb)}" style="width:100%;height:100%">` : ''}</div>
      <div class="vinfo">
        <div class="vtitle" style="font-size:18px">${esc(it.title)}</div>
        <div class="vsub">${[esc(it.subs || ''), esc(it.videos || '')].filter(Boolean).join(' • ')}</div>
        <div class="vsub" style="margin-top:6px">${esc(it.description || '')}</div>
      </div>
      <button class="sub-btn" style="flex:none">チャンネル登録</button>
    </div>
  </div>`;
}

/* delegation for card clicks + hover prefetch */
document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-href]');
  if (card) { location.hash = card.dataset.href.startsWith('#') ? card.dataset.href.slice(1) : card.dataset.href; }
});
document.addEventListener('mouseover', debounce((e) => {
  const card = e.target.closest?.('[data-vid]');
  if (card && /^[\w-]{11}$/.test(card.dataset.vid)) {
    api('/api/watch/' + card.dataset.vid).catch(() => {});
  }
}, 120), { passive: true });

/* skeleton screens */
function skGrid(n = 12, rail = false) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<div>
      <div class="sk sk-thumb"></div>
      <div class="sk-row" style="margin-top:12px"><div class="sk sk-ava"></div>
      <div style="flex:1"><div class="sk sk-line"></div><div class="sk sk-line w60"></div></div></div>
    </div>`;
  }
  return `<div class="grid">${s}</div>`;
}

function errBox(msg, retryFn) {
  app.innerHTML = `<div class="error-box">
    <p style="font-size:44px;margin-bottom:8px">:(</p>
    <p>${esc(msg)}</p>
    <button class="retry" id="err-retry">再試行</button>
  </div>`;
  $('#err-retry')?.addEventListener('click', retryFn);
}

/* ------------------------------------------------------------------ router */
const routes = [];
function route(pattern, handler) { routes.push([pattern, handler]); }

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}

let currentPage = null;
function render() {
  const { path, params } = parseHash();
  if (currentPage?.destroy) { try { currentPage.destroy(); } catch (_) {} }
  currentPage = null;
  window.scrollTo(0, 0);
  for (const [pat, fn] of routes) {
    const m = path.match(pat);
    if (m) { currentPage = fn(...m.slice(1), params) || null; return; }
  }
  renderHome();
}
window.addEventListener('hashchange', render);

/* ---------------------------------------------------------------- nav sync */
function setActiveNav(key) {
  $$('#mini-guide .guide-item').forEach(a => a.classList.toggle('active', a.dataset.nav === key));
}

/* ==================================================================== HOME */
const CHIPS = [
  ['すべて', 'all'], ['音楽', 'music'], ['ゲーム', 'gaming'], ['ニュース', 'news'],
  ['アニメ', 'anime'], ['料理', 'cooking'], ['スポーツ', 'sports'], ['テクノロジー', 'tech'], ['ASMR', 'asmr'],
];

function renderHome(chip = sessionStorage.getItem('chip') || 'all') {
  setActiveNav('home');
  sessionStorage.setItem('chip', chip);
  app.innerHTML = `
    <div class="chips">${CHIPS.map(([label, key]) =>
      `<button class="chip ${key === chip ? 'active' : ''}" data-chip="${key}">${label}</button>`).join('')}
    </div>
    <div id="home-body">${skGrid(12)}</div>`;
  $$('.chip', app).forEach(b => b.addEventListener('click', () => renderHome(b.dataset.chip)));
  api('/api/home?chip=' + encodeURIComponent(chip), { ttl: 15 * 60e3 })
    .then((d) => {
      const body = $('#home-body');
      if (!body) return;
      const vids = [], shorts = [];
      for (const it of d.items || []) (it.kind === 'short' ? shorts : vids).push(it);
      if (!vids.length) {
        body.innerHTML = `<div class="empty-state"><h1>まずは検索してみましょう</h1><p>おすすめ動画を表示するには、まず動画を視聴しましょう。</p></div>`;
        return;
      }
      const first = vids.slice(0, 8), rest = vids.slice(8);
      body.innerHTML =
        `<div class="grid">${first.map(v => videoCard(v)).join('')}</div>` +
        (shorts.length ? `
          <div class="shorts-row">
            <div class="shorts-title"><svg viewBox="0 0 24 24"><path d="M17.7 4.1a10 10 0 1 0 .7 15.7 12.4 12.4 0 0 1-2.2 1.6 8.3 8.3 0 1 1 1.5-17.3z"/><path d="M10 15l5.2-3L10 9z"/></svg>ショート</div>
            <div class="shorts-scroll">${shorts.map(s => shortCard(s)).join('')}</div>
          </div>` : '') +
        `<div class="grid">${rest.map(v => videoCard(v)).join('')}</div>`;
    })
    .catch(e => errBox('ホームを読み込めませんでした: ' + e.message, () => renderHome(chip)));
}

/* ================================================================== SEARCH */
function renderResults(params) {
  const q = params.get('search_query') || params.get('q') || '';
  setActiveNav('home');
  $('#search-input').value = q;
  if (!q) { renderHome(); return; }
  app.innerHTML = `<div class="results" id="res-body">${skGrid(6)}</div>`;
  let continuation = null;
  let loading = false;
  let sentinel = null;
  let filtered = 'all';

  function draw(list, reset) {
    const body = $('#res-body');
    if (!body) return;
    const show = list.filter(it => filtered === 'all' || it.kind === ({ '動画': 'video', 'チャンネル': 'channel', '再生リスト': 'playlist', 'ショート': 'short' }[filtered] || 'video'));
    body.innerHTML =
      `<div class="chips" style="position:static;padding:0 0 16px">
        ${['すべて', '動画', 'チャンネル', '再生リスト', 'ショート'].map(f => `<button class="chip ${f === filtered ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>` +
      (show.length
        ? `<div class="results-list">${show.map(it => it.kind === 'video' ? resultCard(it) : videoCard(it)).join('')}</div>`
        : `<div class="empty-state"><h1>結果が見つかりません</h1><p>別のキーワードで検索してみてください。</p></div>`);
    $$('.chip', body).forEach(b => b.addEventListener('click', () => { filtered = b.dataset.f; draw(allItems, true); }));
    if (sentinel) { sentinel.done(); sentinel = null; }
    if (continuation) sentinel = lazySentinel(body, loadMore);
  }

  function resultCard(it) {
    const meta = it.metaTop?.join(' • ') || [it.views, it.published].filter(Boolean).join(' • ');
    return `
    <div class="result-card" data-href="#/watch?v=${esc(it.id)}" data-vid="${esc(it.id)}">
      <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
        ${it.duration ? `<span class="dur">${esc(it.duration)}</span>` : ''}
      </div>
      <div class="vinfo result-info">
        <div class="vtitle">${esc(it.title)}</div>
        <div class="result-sub">${esc(meta)}</div>
        ${it.channel ? `<div class="result-ch"><div class="r-ava vava"></div><span>${esc(it.channel)}</span></div>` : ''}
      </div>
    </div>`;
  }

  let allItems = [];
  function loadMore() {
    if (loading || !continuation) return;
    loading = true;
    const spin = document.createElement('div');
    spin.className = 'mini-spin';
    $('#res-body')?.appendChild(spin);
    api('/api/search/next?c=' + encodeURIComponent(continuation), { ttl: 10 * 60e3 })
      .then(d => {
        spin.remove();
        loading = false;
        continuation = d.continuation;
        allItems = allItems.concat(d.items || []);
        draw(allItems);
      })
      .catch(() => { spin.remove(); loading = false; });
  }

  api('/api/search?q=' + encodeURIComponent(q), { ttl: 10 * 60e3 })
    .then(d => {
      allItems = d.items || [];
      continuation = d.continuation;
      draw(allItems, true);
    })
    .catch(e => errBox('検索に失敗しました: ' + e.message, () => renderResults(params)));
}

/* ================================================================== WATCH */

/* ---------- MSE "DashLite" engine for HD (adaptive video+audio) ---------- */
class DashLite {
  static isSupported(vTrack, aTrack) {
    if (!window.MediaSource || !vTrack || !aTrack) return false;
    const vc = `${vTrack.mime};codecs="${vTrack.codecs}"`;
    const ac = `${aTrack.mime};codecs="${aTrack.codecs}"`;
    try { return MediaSource.isTypeSupported(vc) && MediaSource.isTypeSupported(ac); } catch (_) { return false; }
  }

  constructor(video, videoId, vTrack, aTrack) {
    this.video = video;
    this.videoId = videoId;
    this.vTrack = vTrack;
    this.aTrack = aTrack;
    this.mse = new MediaSource();
    this.url = URL.createObjectURL(this.mse);
    this.dead = false;
    this.posV = 0; this.posA = 0;      // segment indexes
    this.pumpRunning = false;
    this.startAt = 0;
    this._onTime = () => this.pump();
    this._onSeek = () => this._handleSeek();
  }

  async _range(itag, start, end) {
    const res = await fetch(`/api/stream?v=${this.videoId}&itag=${itag}`, { headers: { Range: `bytes=${start}-${end}` } });
    if (!res.ok && res.status !== 206) throw new Error('range ' + res.status);
    return res.arrayBuffer();
  }

  _parseSidx(buf, indexEnd) {
    const dv = new DataView(buf);
    let off = 0;
    while (off + 8 <= dv.byteLength) {
      const size = dv.getUint32(off);
      const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
      if (type === 'sidx') {
        const version = dv.getUint8(off + 8);
        let p = off + 12; // skip fullbox
        /* reference_id(4) */ p += 4;
        const timescale = dv.getUint32(p); p += 4;
        let earliest, firstOffset;
        if (version === 0) { earliest = dv.getUint32(p); p += 4; firstOffset = dv.getUint32(p); p += 4; }
        else { earliest = Number(dv.getBigUint64(p)); p += 8; firstOffset = Number(dv.getBigUint64(p)); p += 8; }
        p += 2; // reserved
        const count = dv.getUint16(p); p += 2;
        const segs = [];
        let cumDur = 0;
        let cur = indexEnd + 1 + firstOffset;
        for (let i = 0; i < count; i++) {
          const ref = dv.getUint32(p); const dur = dv.getUint32(p + 4); p += 12;
          const refSize = ref & 0x7fffffff;
          const t0 = (earliest + cumDur) / timescale;
          const t1 = (earliest + cumDur + dur) / timescale;
          segs.push({ start: cur, end: cur + refSize - 1, t0, t1 });
          cur += refSize; cumDur += dur;
        }
        return segs;
      }
      if (!size || size < 8) break;
      off += size;
    }
    throw new Error('no sidx');
  }

  async init(startTime = 0) {
    const v = this.vTrack, a = this.aTrack;
    if (!v.initRange || !v.indexRange || !a.initRange || !a.indexRange) throw new Error('no index');
    const [vInit, vIdx, aInit, aIdx] = await Promise.all([
      this._range(v.itag, v.initRange.start, v.initRange.end),
      this._range(v.itag, +v.indexRange.start, +v.indexRange.end),
      this._range(a.itag, a.initRange.start, a.initRange.end),
      this._range(a.itag, +a.indexRange.start, +a.indexRange.end),
    ]);
    if (this.dead) return;
    this.vSegs = this._parseSidx(vIdx, +v.indexRange.end);
    this.aSegs = this._parseSidx(aIdx, +a.indexRange.end);
    this.vInit = vInit; this.aInit = aInit;
    this.video.src = this.url;
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('mse open timeout')), 8000);
      this.mse.addEventListener('sourceopen', () => { clearTimeout(to); res(); }, { once: true });
    });
    if (this.dead) return;
    this.vbuf = this.mse.addSourceBuffer(`${v.mime};codecs="${v.codecs}"`);
    this.abuf = this.mse.addSourceBuffer(`${a.mime};codecs="${a.codecs}"`);
    this.posV = this._segIndex(this.vSegs, startTime);
    this.posA = this._segIndex(this.aSegs, startTime);
    this.startAt = startTime;
    this.pending = [{ buf: this.abuf, data: aInit }, { buf: this.vbuf, data: vInit }];
    await this._flush();
    this.video.addEventListener('timeupdate', this._onTime);
    this.video.addEventListener('seeking', this._onSeek);
    this.pumpRunning = true;
    await this.pump();
  }

  _segIndex(segs, t) {
    for (let i = 0; i < segs.length; i++) if (t < segs[i].t1) return i;
    return segs.length - 1;
  }

  _append(buf, data) {
    return new Promise((res, rej) => {
      if (this.dead || this.mse.readyState !== 'open') return rej(new Error('destroyed'));
      const done = () => { cleanup(); res(); };
      const fail = () => { cleanup(); rej(new Error('append error')); };
      const cleanup = () => {
        buf.removeEventListener('updateend', done);
        buf.removeEventListener('error', fail);
      };
      buf.addEventListener('updateend', done, { once: true });
      buf.addEventListener('error', fail, { once: true });
      try { buf.appendBuffer(data); } catch (e) { cleanup(); rej(e); }
    });
  }

  async _flush() {
    while (this.pending?.length) {
      const { buf, data } = this.pending.shift();
      await this._append(buf, data);
      if (this.dead) return;
    }
  }

  _bufferedEnd(which) {
    const b = which === 'v' ? this.vbuf : this.abuf;
    try { const r = b.buffered; return r.length ? r.end(r.length - 1) : 0; } catch (_) { return 0; }
  }

  async pump() {
    if (!this.pumpRunning || this._pumping || this.dead) return;
    this._pumping = true;
    try {
      for (;;) {
        if (this.dead) return;
        const t = this.video.currentTime;
        const endV = this._bufferedEnd('v'), endA = this._bufferedEnd('a');
        if (endV - t > 24 && endA - t > 24) return;
        if (this.posV >= this.vSegs.length && this.posA >= this.aSegs.length) return;
        // fetch whichever buffer is shorter
        const pickVideo = this.posV < this.vSegs.length && (this.posA >= this.aSegs.length || endV <= endA + 0.5);
        if (pickVideo) {
          if (this.posV >= this.vSegs.length) return;
          const seg = this.vSegs[this.posV++];
          const data = await this._range(this.vTrack.itag, seg.start, seg.end);
          if (this.dead) return;
          await this._append(this.vbuf, data);
        } else {
          if (this.posA >= this.aSegs.length) return;
          const seg = this.aSegs[this.posA++];
          const data = await this._range(this.aTrack.itag, seg.start, seg.end);
          if (this.dead) return;
          await this._append(this.abuf, data);
        }
      }
    } finally {
      this._pumping = false;
    }
  }

  async _handleSeek() {
    if (this.dead || !this.vbuf) return;
    const t = this.video.currentTime;
    const inV = t >= 0 && t < this._bufferedEnd('v');
    const inA = t >= 0 && t < this._bufferedEnd('a');
    if (inV && inA) { this.pump(); return; }
    // re-sync both pipelines at t
    try {
      await this._clear(this.vbuf); await this._clear(this.abuf);
      this.posV = this._segIndex(this.vSegs, t);
      this.posA = this._segIndex(this.aSegs, t);
      this.pump();
    } catch (_) { /* leave it; progressive fallback handled by caller on fatal */ }
  }

  _clear(buf) {
    return new Promise((res) => {
      if (this.mse.readyState !== 'open' || buf.updating) { const h = () => { buf.removeEventListener('updateend', h); res(); }; if (buf.updating) { buf.addEventListener('updateend', h); return; } return res(); }
      const r = buf.buffered;
      if (!r.length) return res();
      buf.addEventListener('updateend', () => res(), { once: true });
      try { buf.remove(r.start(0), r.end(r.length - 1)); } catch (_) { res(); }
    });
  }

  destroy() {
    this.dead = true;
    this.pumpRunning = false;
    this.video.removeEventListener('timeupdate', this._onTime);
    this.video.removeEventListener('seeking', this._onSeek);
    try { if (this.mse.readyState === 'open') this.mse.endOfStream(); } catch (_) {}
    try { URL.revokeObjectURL(this.url); } catch (_) {}
  }
}

/* --------------------------- custom player chrome --------------------------- */
class PlayerUI {
  constructor(wrap, video, getQualities) {
    this.wrap = wrap;
    this.video = video;
    this.getQualities = getQualities;
    this._build();
    this._bind();
  }
  _build() {
    this.wrap.insertAdjacentHTML('beforeend', `
      <div class="spin hidden" data-el="spin"></div>
      <div class="center-flash hidden" data-el="flash"></div>
      <div class="qmenu hidden" data-el="qmenu"></div>
      <div class="player-overlay">
        <input type="range" class="seek" data-el="seek" min="0" max="1000" value="0" step="1">
        <div class="ctl-row">
          <button class="icon-btn" data-el="play" title="再生 (k)">${ICON_PLAY}</button>
          <button class="icon-btn" data-el="vol" title="ミュート (m)"><svg viewBox="0 0 24 24" class="ic"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 2.2v2.1a7 7 0 0 1 0 15.4v2.1a9 9 0 0 0 0-19.6z"/></svg></button>
          <input type="range" class="seek" data-el="volrange" min="0" max="100" value="100" style="width:72px">
          <span class="p-time" data-el="time">0:00 / 0:00</span>
          <div class="p-spacer"></div>
          <button class="icon-btn" data-el="settings" title="設定"><svg viewBox="0 0 24 24" class="ic"><path d="M19.7 13.4a7.6 7.6 0 0 0 0-2.8l2-1.5a.5.5 0 0 0 .1-.7l-1.9-3.2a.5.5 0 0 0-.6-.2l-2.3.9a7.7 7.7 0 0 0-2.4-1.4L14.2 2a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4L9 4.5a7.7 7.7 0 0 0-2.4 1.4l-2.3-.9a.5.5 0 0 0-.6.2L1.8 8.4a.5.5 0 0 0 .1.7l2 1.5a7.6 7.6 0 0 0 0 2.8l-2 1.5a.5.5 0 0 0-.1.7l1.9 3.2c.14.24.42.34.68.22l2.3-.9c.72.56 1.53 1.03 2.4 1.4l.35 2.5c.04.24.24.4.5.4h3.8c.24 0 .45-.17.5-.4l.35-2.5a7.7 7.7 0 0 0 2.4-1.4l2.3.9c.24.1.52.02.65-.22l1.9-3.18a.5.5 0 0 0-.1-.73zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>
          <button class="icon-btn" data-el="fs" title="全画面表示 (f)"><svg viewBox="0 0 24 24" class="ic"><path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z"/></svg></button>
        </div>
      </div>`);
    this.el = {};
    $$('[data-el]', this.wrap).forEach(n => this.el[n.dataset.el] = n);
  }
  flash(icon) {
    const f = this.el.flash;
    f.innerHTML = `<div>${icon}</div>`;
    f.classList.remove('hidden');
    clearTimeout(this._ft);
    this._ft = setTimeout(() => f.classList.add('hidden'), 480);
  }
  /** big center play button when autoplay is blocked */
  showBigPlay() {
    if (this.el.bigplay) { this.el.bigplay.classList.remove('hidden'); return; }
    const b = document.createElement('button');
    b.className = 'center-play';
    b.dataset.el = 'bigplay';
    b.innerHTML = `<div style="background:rgba(0,0,0,.65);border-radius:50%;width:76px;height:76px;display:grid;place-items:center;cursor:pointer">${ICON_PLAY}</div>`;
    b.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:none';
    b.addEventListener('click', () => { this.video.play().catch(() => {}); b.classList.add('hidden'); });
    this.video.addEventListener('play', () => b.classList.add('hidden'));
    this.wrap.appendChild(b);
    this.el.bigplay = b;
  }
  _bind() {
    const v = this.video;
    const seek = this.el.seek;
    const setProg = () => {
      const d = v.duration || 0;
      seek.value = d ? Math.round(v.currentTime / d * 1000) : 0;
      seek.style.setProperty('--prog', (seek.value / 10) + '%');
      this.el.time.textContent = `${fmtDur(v.currentTime)} / ${fmtDur(d)}`;
    };
    v.addEventListener('timeupdate', setProg);
    v.addEventListener('durationchange', setProg);
    v.addEventListener('play', () => { this.el.play.innerHTML = ICON_PAUSE; this.flash(ICON_PLAY); });
    v.addEventListener('pause', () => { this.el.play.innerHTML = ICON_PLAY; this.flash(ICON_PAUSE); });
    v.addEventListener('waiting', () => this.el.spin.classList.remove('hidden'));
    v.addEventListener('playing', () => this.el.spin.classList.add('hidden'));
    v.addEventListener('canplay', () => this.el.spin.classList.add('hidden'));
    seek.addEventListener('input', () => {
      const d = v.duration || 0;
      if (d) v.currentTime = seek.value / 1000 * d;
      seek.style.setProperty('--prog', (seek.value / 10) + '%');
    });
    this.el.play.addEventListener('click', () => this.togglePlay());
    this.el.vol.addEventListener('click', () => { v.muted = !v.muted; });
    this.el.volrange.addEventListener('input', () => { v.volume = this.el.volrange.value / 100; v.muted = false; });
    this.el.fs.addEventListener('click', () => this.toggleFs());
    this.el.settings.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
    this.wrap.addEventListener('dblclick', (e) => { if (!e.target.closest('.qmenu')) this.toggleFs(); });
    v.addEventListener('click', () => this.togglePlay());
    document.addEventListener('keydown', (e) => {
      if (!document.body.contains(this.wrap)) return;
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'k' || (e.key === ' ' && document.fullscreenElement === this.wrap)) { e.preventDefault(); this.togglePlay(); }
      if (e.key === 'f') this.toggleFs();
      if (e.key === 'm') v.muted = !v.muted;
      if (e.key === 'ArrowRight') v.currentTime += 5;
      if (e.key === 'ArrowLeft') v.currentTime -= 5;
    });
  }
  togglePlay() { const v = this.video; v.paused ? v.play().catch(() => {}) : v.pause(); }
  toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else this.wrap.requestFullscreen?.().catch(() => {});
  }
  toggleMenu() {
    const q = this.el.qmenu;
    if (!q.classList.contains('hidden')) { q.classList.add('hidden'); return; }
    const { qualities, current, onPick, speeds, speed, onSpeed } = this.getQualities();
    q.innerHTML =
      `<div class="qhead">画質</div>` +
      qualities.map(ql => `<div class="qi ${ql.key === current ? 'sel' : ''}" data-q="${ql.key}"><span>${esc(ql.label)}</span>${ql.key === current ? '<span>✓</span>' : ''}</div>`).join('') +
      `<div class="qhead">再生速度</div>` +
      speeds.map(s => `<div class="qi" data-s="${s}" style="${s === speed ? 'color:#3ea6ff' : ''}"><span>${s === 1 ? '標準' : s + 'x'}</span>${s === speed ? '<span>✓</span>' : ''}</div>`).join('');
    q.classList.remove('hidden');
    const close = (e) => {
      if (!q.contains(e.target)) { q.classList.add('hidden'); document.removeEventListener('click', close); }
    };
    document.addEventListener('click', close);
    $$('.qi', q).forEach(n => n.addEventListener('click', () => {
      if (n.dataset.q) onPick(n.dataset.q);
      if (n.dataset.s) onSpeed(parseFloat(n.dataset.s));
      q.classList.add('hidden');
    }));
  }
  destroy() {}
}

/* --------------------------------- watch page -------------------------------- */
function renderWatch(params, { vertical = false, shortId = null } = {}) {
  const id = shortId || params.get('v') || '';
  if (!/^[\w-]{11}$/.test(id)) { errBox('動画IDが不正です', () => render()); return; }
  setActiveNav(vertical ? 'shorts' : 'home');
  let destroyed = false;
  let dash = null;
  let hlsInst = null;
  let mode = 'auto'; // 'auto' | '360p' | itag string
  let ui = null;

  app.innerHTML = `
  <div class="watch">
    <div class="player-col">
      <div class="player-wrap ${vertical ? 'vertical' : ''}" id="pwrap">
        <video id="pvideo" playsinline autoplay ${vertical ? 'loop' : ''}></video>
        <div class="spin" data-spin></div>
      </div>
      <div class="wtitle"><div class="sk sk-line" style="width:70%"></div></div>
      <div class="action-row"><div class="sk sk-line" style="width:280px"></div></div>
      <div class="desc-card"><div class="sk sk-line"></div><div class="sk sk-line w60"></div></div>
      <div class="comments" id="comments"><h3>コメント</h3><div class="mini-spin"></div></div>
    </div>
    <div class="rail" id="rail"></div>
  </div>`;

  const video = $('#pvideo');
  const wrapEl = $('#pwrap');

  function cleanup() {
    destroyed = true;
    try { dash?.destroy(); } catch (_) {}
    try { hlsInst?.destroy(); } catch (_) {}
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
  }

  api('/api/watch/' + id, { ttl: 3 * 60e3 })
    .then(async (d) => {
      if (destroyed) return;
      document.title = (d.title || 'YouTube') + ' - llytpr-wl.v01nh';
      fillMeta(d);
      loadComments(d);
      fillRail(d);
      if (!d.playable) {
        wrapEl.innerHTML = `<div class="unplayable"><div>${esc(d.playability?.reason || 'この動画は再生できません')}<br><span style="opacity:.6;font-size:12px">${esc(d.playability?.status || '')}</span></div></div>`;
        return;
      }
      await setupPlayback(d);
    })
    .catch((e) => {
      if (destroyed) return;
      wrapEl.innerHTML = `<div class="unplayable"><div>再生に失敗しました<br><span style="opacity:.6;font-size:12px">${esc(e.message)}</span></div></div>`;
      fillRail({ related: [] });
    });

  async function setupPlayback(d) {
    const streams = d.streams || {};
    const prog = (streams.progressive || []).slice().sort((a, b) => (b.height || 0) - (a.height || 0));
    const bestProg = prog[0];
    // pick adaptive renditions: avc1/mp4 first (universal), then other mp4 codecs, then webm
    const allVids = (streams.videos || []);
    const container = (t) => String(t.mime || '').split('/')[1] || '';
    let vidTracks = allVids.filter(t => t.mime === 'video/mp4' && /avc1/.test(t.codecs));
    if (!vidTracks.length) vidTracks = allVids.filter(t => t.mime === 'video/mp4');
    if (!vidTracks.length) vidTracks = allVids.filter(t => t.mime === 'video/webm' && /vp9|vp09/.test(t.codecs));
    if (!vidTracks.length) vidTracks = allVids;
    const auds = (streams.audios || []).slice().sort((a, b) =>
      ((a.mime === 'audio/mp4' ? 0 : 1) - (b.mime === 'audio/mp4' ? 0 : 1)) || (b.bitrate || 0) - (a.bitrate || 0));
    const wantCont = container(vidTracks[0] || {});
    const audTrack = auds.find(a => container(a) === wantCont) || auds[0];

    const qList = [];
    const byLabel = new Map();
    for (const t of vidTracks) {
      const label = t.qualityLabel || (t.height + 'p');
      // keep the best (highest bitrate) per label, prefer <=30fps for compat unless only 60
      const prev = byLabel.get(label);
      if (!prev || ((prev.fps || 30) > 30 && (t.fps || 30) <= 30) || ((prev.fps || 0) === (t.fps || 0) && (t.bitrate || 0) > (prev.bitrate || 0))) byLabel.set(label, t);
    }
    const adapt = [...byLabel.values()].sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0));
    for (const t of adapt) qList.push({ key: String(t.itag), label: t.qualityLabel + ((t.fps || 0) > 30 ? '' : ''), track: t });
    if (bestProg) qList.push({ key: '360p', label: '360p', prog: bestProg });

    const autoTrack = pickAuto(adapt);
    const canDash = audTrack && autoTrack && DashLite.isSupported(autoTrack, audTrack);

    const qualities = [{ key: 'auto', label: canDash ? '自動 (' + autoTrack.qualityLabel + ')' : '自動 (360p)' }, ...qList];
    let speed = 1;

    ui = new PlayerUI(wrapEl, video, () => ({
      qualities, current: mode,
      speeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], speed,
      onPick: (k) => { mode = k; startMode(k, video.currentTime); },
      onSpeed: (s) => { speed = s; video.playbackRate = s; },
    }));
    wrapEl.querySelector('[data-spin]')?.remove(); // skeleton spinner -> UI owns one now

    if (streams.hls && !qList.length) {
      startHls(streams.hls);
      return;
    }
    startMode('auto', 0);

    function pickAuto(tracks) {
      if (!tracks.length) return null;
      const h = wrapEl.clientHeight || 640;
      const target = h >= 900 ? 1080 : h >= 600 ? 720 : h >= 400 ? 480 : 360;
      let best = tracks[0];
      for (const t of tracks) {
        if ((t.height || 0) <= target && ((t.fps || 30) <= 30 || (best.fps || 30) > 30)) { best = t; break; }
      }
      return best || tracks[tracks.length - 1];
    }

    async function startMode(k, resumeAt = 0) {
      if (destroyed) return;
      try { dash?.destroy(); dash = null; } catch (_) {}
      try { hlsInst?.destroy(); hlsInst = null; } catch (_) {}
      video.removeAttribute('src');
      video.load();
      $('#pwrap [data-spin]')?.classList.remove('hidden');
      if (k === 'auto') {
        if (canDash) { if (!await tryDash(autoTrack, resumeAt)) startProg(bestProg, resumeAt); }
        else startProg(bestProg, resumeAt);
      } else if (k === '360p') {
        startProg(bestProg, resumeAt);
      } else {
        const t = qList.find(q => q.key === k)?.track;
        if (!t || !await tryDash(t, resumeAt)) startProg(bestProg, resumeAt);
      }
    }

    function safePlay() {
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => {
        // autoplay blocked -> retry muted (YouTube does the same), else big play btn
        video.muted = true;
        video.play().catch(() => ui?.showBigPlay());
      });
    }

    async function tryDash(track, resumeAt) {
      try {
        dash = new DashLite(video, id, track, audTrack);
        await dash.init(resumeAt);
        if (destroyed) return false;
        video.currentTime = resumeAt || 0;
        wireEndGuard();
        safePlay();
        return true;
      } catch (e) {
        try { dash?.destroy(); } catch (_) {}
        dash = null;
        return false;
      }
    }

    function startProg(p, resumeAt) {
      if (!p) {
        wrapEl.innerHTML = `<div class="unplayable"><div>再生可能なフォーマットがありません</div></div>`;
        return;
      }
      dash?.destroy(); dash = null;
      video.src = `/api/stream?v=${id}&itag=${p.itag}`;
      video.currentTime = resumeAt || 0;
      safePlay();
    }

    async function startHls(man) {
      const proxied = '/api/hls?v=' + id;
      if (window.Hls && window.Hls.isSupported()) {
        hlsInst = new window.Hls({ maxBufferLength: 30 });
        hlsInst.loadSource(proxied);
        hlsInst.attachMedia(video);
        hlsInst.on(window.Hls.Events.MANIFEST_PARSED, () => safePlay());
        hlsInst.on(window.Hls.Events.ERROR, (_e, data) => { if (data?.fatal) startProg(bestProg, 0); });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxied;
        safePlay();
      } else startProg(bestProg, 0);
    }

    function wireEndGuard() {
      // near the end, if both buffers exhausted, endOfStream so 'ended' fires
      const iv = setInterval(() => {
        if (destroyed || !dash || dash.dead) { clearInterval(iv); return; }
        const d = video.duration || 0;
        if (d && video.currentTime > d - 0.4 && dash.posV >= dash.vSegs.length && dash.posA >= dash.aSegs.length) {
          try { if (dash.mse.readyState === 'open' && !dash.vbuf.updating && !dash.abuf.updating) dash.mse.endOfStream(); } catch (_) {}
          clearInterval(iv);
        }
      }, 700);
    }
  }

  function fillMeta(d) {
    const titleEl = $('.wtitle');
    if (titleEl) titleEl.textContent = d.title || '';
    const ch = d.channel || {};
    const stats = [d.viewCount, d.dateText].filter(Boolean).join(' • ');
    const actRow = $('.action-row');
    if (actRow) actRow.innerHTML = `
      <div class="ch-chip">
        <div class="ch-ava" data-href="${ch.id ? '#/channel/' + esc(ch.id) : '#'}">${ch.avatar ? `<img src="${esc(ch.avatar)}" alt="">` : ''}</div>
        <div class="ch-names">
          <div class="ch-name" data-href="${ch.id ? '#/channel/' + esc(ch.id) : '#'}">${esc(ch.name || '')} ${ch.verified ? ICON_CHECK : ''}</div>
          <div class="ch-subs">${esc(ch.subs || '')}</div>
        </div>
        <button class="sub-btn" id="sub-btn">チャンネル登録</button>
      </div>
      <div class="p-spacer" style="flex:1"></div>
      <div class="like-group">
        <button id="like-btn" title="高く評価"><svg viewBox="0 0 24 24" class="ic"><path d="M2 21h4V9H2zM22 10c0-1.1-.9-2-2-2h-6.3l.9-4.6v-.3c0-.4-.2-.8-.4-1.1L13.1 1 6.6 8.6c-.4.3-.6.8-.6 1.4v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg><span id="like-count">${esc(d.likeCount || '')}</span></button>
        <button id="dislike-btn" title="低く評価"><svg viewBox="0 0 24 24" class="ic"><path d="M18 3h4v12h-4zM2 14c0 1.1.9 2 2 2h6.3l-.9 4.6v.3c0 .4.2.8.4 1.1l1.1 1 6.5-6.5c.4-.4.6-.9.6-1.4V4.1c0-1.1-.9-2-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7z"/></svg></button>
      </div>
      <button class="btn-pill" id="share-btn"><svg viewBox="0 0 24 24" class="ic"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>共有</button>
      <button class="btn-pill" id="save-btn"><svg viewBox="0 0 24 24" class="ic"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-5 7 5V5a2 2 0 0 0-2-2z"/></svg>保存</button>`;
    let liked = false;
    $('#like-btn')?.addEventListener('click', () => {
      liked = !liked;
      $('#like-btn').style.color = liked ? 'var(--blue)' : '';
      toast(liked ? '高く評価しました' : '取り消しました');
    });
    $('#dislike-btn')?.addEventListener('click', () => toast('フィードバックありがとうございます'));
    $('#share-btn')?.addEventListener('click', async () => {
      const url = location.origin + location.pathname + '#/watch?v=' + id;
      try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }
      catch (_) { toast(url, 6000); }
    });
    $('#save-btn')?.addEventListener('click', () => toast('ログインが必要です'));
    $('#sub-btn')?.addEventListener('click', function () {
      this.classList.toggle('subbed');
      this.textContent = this.classList.contains('subbed') ? '登録済み' : 'チャンネル登録';
      if (this.classList.contains('subbed')) toast('チャンネル登録しました（ローカルのみ）');
    });

    const desc = $('.desc-card');
    if (desc) {
      desc.innerHTML = `
        <div class="desc-stats">${esc(stats)}</div>
        <div class="desc-body">${linkify(d.description || '概要欄はありません')}</div>
        <span class="desc-more">...続きを読む</span>`;
      $('.desc-more', desc).addEventListener('click', function () {
        desc.classList.toggle('open');
        this.textContent = desc.classList.contains('open') ? '一部を表示' : '...続きを読む';
      });
    }
  }

  function loadComments(d) {
    const box = $('#comments');
    if (!box) return;
    if (!d.commentsToken && !d.commentsCount) {
      // try anyway — some videos still return pages
    }
    api('/api/comments/' + id, { ttl: 5 * 60e3 })
      .then((c) => {
        if (destroyed || !document.body.contains(box)) return;
        if (c.disabled && !(c.comments || []).length) {
          box.innerHTML = `<h3>コメント</h3><div class="cm-disabled">コメントはオフになっています。</div>`;
          return;
        }
        let cont = c.continuation;
        let loading = false;
        box.innerHTML = `
          <h3><span id="cm-count">${c.count ? esc(c.count) + ' 件のコメント' : 'コメント'}</span>
          <span class="cm-sort"><svg viewBox="0 0 24 24" class="ic" style="width:20px;height:20px"><path d="M3 6h14v2H3zm0 5h10v2H3zm0 5h6v2H3z"/></svg>並べ替え</span></h3>
          <div class="cm-input-row">
            <div class="vava"></div><div class="cm-fake" id="cm-fake">コメントを追加...</div>
          </div>
          <div id="cm-list">${(c.comments || []).map(commentHtml).join('')}</div>`;
        $('#cm-fake')?.addEventListener('click', () => toast('ログインが必要です'));
        if (cont) {
          const sent = lazySentinel(box, () => {
            if (loading || !cont) return;
            loading = true;
            api('/api/comments/next?c=' + encodeURIComponent(cont), { ttl: 5 * 60e3 })
              .then((n) => {
                loading = false;
                cont = n.continuation;
                const list = $('#cm-list');
                if (list) list.insertAdjacentHTML('beforeend', (n.comments || []).map(commentHtml).join(''));
                if (!cont) sent.done();
              })
              .catch(() => { loading = false; sent.done(); });
          });
        }
      })
      .catch(() => { const b = $('#comments'); if (b) b.innerHTML = `<h3>コメント</h3><div class="cm-disabled">コメントを読み込めませんでした。</div>`; });
  }

  function commentHtml(cm) {
    const authorHref = cm.authorChannelId ? '#/channel/' + cm.authorChannelId : '#';
    const handle = cm.author?.startsWith('@') ? cm.author : (cm.author ? '@' + cm.author : '');
    return `
    <div class="cm">
      <div class="vava" data-href="${authorHref}">${cm.avatar ? `<img loading="lazy" src="${esc(cm.avatar)}" alt="">` : ''}</div>
      <div class="cm-body">
        <div class="cm-head"><span class="cm-author" data-href="${authorHref}">${esc(handle)}</span><span class="cm-time">${esc(cm.published || '')}</span></div>
        <div class="cm-text">${linkify(cm.text || '')}</div>
        <div class="cm-acts">
          <button class="icon-btn" onclick="toast('ログインが必要です')"><svg viewBox="0 0 24 24" class="ic"><path d="M2 21h4V9H2zM22 10c0-1.1-.9-2-2-2h-6.3l.9-4.6c0-.9-.8-1.5-.8-1.5L12.7 1 6.2 8.6C5.8 8.9 5 9.5 5 10v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg></button>
          <span class="cm-likes">${esc(cm.likes || '')}</span>
          <button class="icon-btn" onclick="toast('ログインが必要です')"><svg viewBox="0 0 24 24" class="ic"><path d="M18 3h4v12h-4zM2 14c0 1.1.9 2 2 2h6.3l-.9 4.6c0 .9.8 1.5.8 1.5l1.1 1 6.5-6.5c.4-.4.6-.9.6-1.4V4.1c0-1.1-.9-2-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7z"/></svg></button>
          ${cm.replyCount ? `<span class="cm-reply">返信 ${esc(String(cm.replyCount))} 件</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function fillRail(d) {
    const rail = $('#rail');
    if (!rail) return;
    const items = (d.related || []).filter(i => i.kind === 'video' || i.kind === 'short');
    rail.innerHTML = items.map(railCard).join('');
  }

  return { destroy() { cleanup(); } };
}

/* ================================================================= CHANNEL */
function renderChannel(rawId, params) {
  setActiveNav('subs');
  const id = decodeURIComponent(rawId);
  const tabParams = params.get('params') || undefined;
  const cont = params.get('c') || undefined;

  app.innerHTML = `
    <div id="ch-wrap">
      <div class="sk" style="height:210px;margin:16px 24px 0"></div>
      <div class="ch-head"><div class="sk big-ava"></div><div style="flex:1"><div class="sk sk-line" style="width:240px;height:28px"></div><div class="sk sk-line" style="width:320px"></div></div></div>
      ${skGrid(8)}
    </div>`;

  api(`/api/channel/${encodeURIComponent(id)}${tabParams ? '?params=' + encodeURIComponent(tabParams) : ''}${cont ? (tabParams ? '&' : '?') + 'c=' + encodeURIComponent(cont) : ''}`, { ttl: 8 * 60e3 })
    .then((d) => {
      const tabsHtml = (d.tabs || []).map(t =>
        `<a class="ch-tab ${t.selected || (!tabParams && t.title === 'ホーム') ? 'active' : ''}" href="#/channel/${encodeURIComponent(id)}${t.params ? '?params=' + encodeURIComponent(t.params) : ''}">${esc(t.title)}</a>`).join('');
      const vids = (d.items || []).filter(i => i.kind === 'video' || i.kind === 'short');
      const others = (d.items || []).filter(i => i.kind === 'playlist');
      app.innerHTML = `
      <div class="ch-page">
        ${d.banner ? `<div class="ch-banner"><img src="${esc(d.banner)}" alt=""></div>` : ''}
        <div class="ch-head">
          <div class="big-ava">${d.avatar ? `<img src="${esc(d.avatar)}" alt="">` : ''}</div>
          <div style="min-width:0">
            <div class="ch-title">${esc(d.name || '')}</div>
            <div class="ch-meta"><span class="handle">${esc(d.handle || '')}</span>${d.subs ? ' • ' + esc(d.subs) : ''}${d.videos ? ' • ' + esc(d.videos) : ''}</div>
            <div class="ch-desc">${esc(d.description || '')}</div>
            <div style="margin-top:12px"><button class="sub-btn" id="ch-sub">チャンネル登録</button></div>
          </div>
        </div>
        <div class="ch-tabs">${tabsHtml}</div>
        <div id="ch-content">
          ${others.length ? `<div class="section-title" style="padding:16px 24px 0;font-size:16px;font-weight:600">作成した再生リスト</div><div class="grid">${others.map(playlistCard).join('')}</div>` : ''}
          <div class="grid">${vids.map(v => videoCard(v)).join('')}</div>
        </div>
      </div>`;
      $('#ch-sub')?.addEventListener('click', function () {
        this.classList.toggle('subbed');
        this.textContent = this.classList.contains('subbed') ? '登録済み' : 'チャンネル登録';
      });
      if (d.continuation) {
        let cont2 = d.continuation, loading = false;
        lazySentinel($('#ch-content'), () => {
          if (loading) return;
          loading = true;
          api(`/api/channel/${encodeURIComponent(id)}?c=${encodeURIComponent(cont2)}`, { ttl: 8 * 60e3 })
            .then((n) => {
              loading = false;
              cont2 = n.continuation;
              const grid = $('#ch-content .grid:last-child');
              grid?.insertAdjacentHTML('beforeend', (n.items || []).filter(i => i.kind === 'video').map(v => videoCard(v)).join(''));
              if (!cont2) return;
            })
            .catch(() => { loading = false; });
        });
      }
    })
    .catch(e => errBox('チャンネルを読み込めませんでした: ' + e.message, () => renderChannel(rawId, params)));
}

/* ================================================================ PLAYLIST */
function renderPlaylist(params) {
  const list = params.get('list') || '';
  if (!list) { errBox('再生リストIDが不正です', render); return; }
  app.innerHTML = skGrid(10);
  api('/api/playlist/' + encodeURIComponent(list), { ttl: 10 * 60e3 })
    .then(d => {
      app.innerHTML = `
      <div class="pl-page">
        <div class="pl-side">
          ${d.items[0] ? `<div class="pl-thumb"><img src="${esc(thumbUrl(d.items[0]))}" alt=""></div>` : ''}
          <h1>${esc(d.title || '再生リスト')}</h1>
          <div class="pl-meta">${esc(d.channelName || '')}<br>${esc(d.views || '')}<br>${d.items.length} 本の動画</div>
        </div>
        <div id="pl-items">
          ${d.items.map((v, i) => `
            <div class="pl-item" data-href="#/watch?v=${esc(v.id)}&list=${esc(list)}">
              <span class="idx">${i + 1}</span>
              <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(v))}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
              <div class="vinfo"><div class="vtitle">${esc(v.title)}</div><div class="vsub">${esc(v.channel || '')}</div></div>
            </div>`).join('')}
        </div>
      </div>`;
      if (d.continuation) {
        let cont = d.continuation, loading = false;
        lazySentinel($('#pl-items'), () => {
          if (loading || !cont) return;
          loading = true;
          api('/api/playlist/next?c=' + encodeURIComponent(cont), { ttl: 10 * 60e3 })
            .then(n => {
              loading = false; cont = n.continuation;
              const box = $('#pl-items');
              if (!box) return;
              const base = box.children.length;
              box.insertAdjacentHTML('beforeend', (n.items || []).map((v, i) => `
                <div class="pl-item" data-href="#/watch?v=${esc(v.id)}&list=${esc(list)}">
                  <span class="idx">${base + i + 1}</span>
                  <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(v))}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
                  <div class="vinfo"><div class="vtitle">${esc(v.title)}</div><div class="vsub">${esc(v.channel || '')}</div></div>
                </div>`).join(''));
            })
            .catch(() => { loading = false; });
        });
      }
    })
    .catch(e => errBox('再生リストを読み込めませんでした: ' + e.message, () => renderPlaylist(params)));
}

/* ================================================================== SHORTS */
function renderShortsHome() {
  setActiveNav('shorts');
  app.innerHTML = skGrid(10);
  api('/api/search?q=' + encodeURIComponent('ショート おもしろ'), { ttl: 15 * 60e3 })
    .then(d => {
      const shorts = d.items.filter(i => i.kind === 'short');
      const vids = d.items.filter(i => i.kind === 'video');
      app.innerHTML = `
        <div class="chips" style="position:static"></div>
        ${shorts.length ? `<div class="shorts-row"><div class="shorts-title">ショート</div><div class="shorts-scroll">${shorts.map(shortCard).join('')}</div></div>` : ''}
        <div class="grid">${vids.map(v => videoCard(v)).join('')}</div>`;
    })
    .catch(() => errBox('読み込めませんでした', renderShortsHome));
}

function renderShort(id) {
  // vertical watch experience
  return renderWatch(new URLSearchParams('v=' + id), { vertical: true, shortId: id });
}

/* ================================================================ fake pages */
function renderSimpleFeed(title) {
  app.innerHTML = `<div class="empty-state" style="margin-top:64px"><h1>${esc(title)}</h1><p>この機能は V1 では簡易表示です。<br>検索から探してみてください。</p></div>`;
}

/* routes */
route(/^\/$/, () => renderHome());
route(/^\/results$/, (params) => renderResults(params));
route(/^\/watch$/, (params) => renderWatch(params));
route(/^\/channel\/(.+)$/, (id, params) => renderChannel(id, params));
route(/^\/playlist$/, (params) => renderPlaylist(params));
route(/^\/shorts$/, () => renderShortsHome());
route(/^\/shorts\/([\w-]{11})$/, (id) => renderShort(id));
route(/^\/feed\/subscriptions$/, () => renderSimpleFeed('登録チャンネル'));
route(/^\/feed\/you$/, () => renderSimpleFeed('マイページ'));

/* ------------------------------------------------------------ masthead wire */
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) location.hash = '/results?search_query=' + encodeURIComponent(q);
  $('#suggest').classList.add('hidden');
});

const sInput = $('#search-input');
const sBox = $('#suggest');
let sgItems = [], sgIndex = -1;
const doSuggest = debounce(async () => {
  const q = sInput.value.trim();
  if (!q) { sBox.classList.add('hidden'); return; }
  try {
    const d = await api('/api/suggest?q=' + encodeURIComponent(q), { ttl: 10 * 60e3 });
    sgItems = d.suggestions || [];
    sgIndex = -1;
    if (!sgItems.length || document.activeElement !== sInput) { sBox.classList.add('hidden'); return; }
    sBox.innerHTML = sgItems.map((s, i) => `
      <div class="sg" data-i="${i}">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" fill="currentColor"/></svg>
        <span>${esc(s)}</span>
      </div>`).join('');
    sBox.classList.remove('hidden');
    $$('.sg', sBox).forEach(n => n.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pick = sgItems[+n.dataset.i];
      sInput.value = pick;
      sBox.classList.add('hidden');
      location.hash = '/results?search_query=' + encodeURIComponent(pick);
    }));
  } catch (_) { /* suggestions optional */ }
}, 180);
sInput.addEventListener('input', doSuggest);
sInput.addEventListener('focus', doSuggest);
sInput.addEventListener('blur', () => setTimeout(() => sBox.classList.add('hidden'), 140));
sInput.addEventListener('keydown', (e) => {
  if (sBox.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sgIndex += e.key === 'ArrowDown' ? 1 : -1;
    if (sgIndex < 0) sgIndex = sgItems.length - 1;
    if (sgIndex >= sgItems.length) sgIndex = 0;
    $$('.sg', sBox).forEach((n, i) => n.classList.toggle('active', i === sgIndex));
    if (sgItems[sgIndex]) sInput.value = sgItems[sgIndex];
  } else if (e.key === 'Escape') sBox.classList.add('hidden');
});

/* options menu */
$('#opts-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#opts-menu').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#opts-menu') && !e.target.closest('#opts-btn')) $('#opts-menu').classList.add('hidden');
});
$('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('llytpr-theme', dark ? 'dark' : 'light');
  $('#theme-label').textContent = dark ? 'ライト モードに切り替え' : 'ダーク モードに切り替え';
  $('meta[name=theme-color]').setAttribute('content', dark ? '#0f0f0f' : '#ffffff');
});
if ((localStorage.getItem('llytpr-theme') || 'light') === 'dark') {
  document.documentElement.classList.add('dark');
  $('#theme-label').textContent = 'ライト モードに切り替え';
}

$('#menu-btn').addEventListener('click', () => {
  const g = $('#mini-guide');
  g.style.display = g.style.display === 'none' ? '' : 'none';
});

/* done callback to signal full load */
console.log('%c llytpr-wl.v01nh %c Made by Kakinie with llytpr-wl.v01nh TEAM. V1 ', 'background:#f03;color:#fff;border-radius:4px;padding:2px 6px', 'color:#888');
render();

})();
