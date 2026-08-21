/* llytpr-wl.v01nh — frontend SPA.
 * InnerTube-backed YouTube experience: personalized home / search / watch
 * (direct-first playback with instant relay fallback, MSE HD "DashLite") /
 * comments / channel / playlist / dedicated shorts surfaces.
 * Local profile (history / likes / saved / subs) lives in localStorage only —
 * nothing personal ever leaves the browser except anonymous query signals.
 *
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

/* -------------------------------------------------- local profile storage */
const Store = {
  get(k, def) { try { const v = JSON.parse(localStorage.getItem('llytpr:' + k)); return v ?? def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem('llytpr:' + k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  del(k) { try { localStorage.removeItem('llytpr:' + k); } catch (_) { /* private mode */ } },
};
/** 期限付きローカル保存（直結学習など鮮度が命の情報用）。
 *  かつて directOk / directBlocked が無期限の localStorage フラグだったため、
 *  「一時的な直結失敗が永遠に残り、直結できる動画がプロキシされ続ける」
 *  バグが発生していた。期限切れ自動失効で構造的に再発防止する。 */
const DIRECT_OK_TTL = 24 * 3600e3;     // 「この回線は直結OK」学習の有効期限
const DIRECT_BLOCK_TTL = 10 * 60e3;    // 「直結不安定」判定の有効期限（10分で再挑戦）
Store.setExp = (k, v, ttl) => Store.set('exp:' + k, { v, e: Date.now() + ttl });
Store.getExp = (k, def) => {
  const r = Store.get('exp:' + k, null);
  if (r && typeof r === 'object' && typeof r.e === 'number') {
    if (r.e > Date.now()) return r.v;
    Store.del('exp:' + k); // 期限切れは即掃除
  }
  return def;
};

/** watch history: [{v,t,cn,ch,d,ts}] newest-first, unique per video */
const History = {
  list() { return Store.get('history', []); },
  add(entry) {
    if (!entry?.v) return;
    let list = History.list().filter(h => h.v !== entry.v);
    entry.ts = Date.now();
    list.unshift(entry);
    Store.set('history', list.slice(0, 200));
  },
  remove(v) { Store.set('history', History.list().filter(h => h.v !== v)); },
  clear() { Store.set('history', []); },
};
/** liked videos: {v: {v,t,cn,ch,ts}} */
const Likes = {
  map() { return Store.get('likes', {}); },
  has(v) { return !!Likes.map()[v]; },
  toggle(entry) {
    const m = Likes.map();
    if (m[entry.v]) { delete m[entry.v]; Store.set('likes', m); return false; }
    m[entry.v] = { ...entry, ts: Date.now() };
    const keys = Object.keys(m);
    if (keys.length > 200) delete m[keys.sort((a, b) => m[a].ts - m[b].ts)[0]];
    Store.set('likes', m);
    return true;
  },
  list() { return Object.values(Likes.map()).sort((a, b) => b.ts - a.ts); },
};
/** saved ("watch later") videos */
const Saves = {
  map() { return Store.get('saves', {}); },
  has(v) { return !!Saves.map()[v]; },
  toggle(entry) {
    const m = Saves.map();
    if (m[entry.v]) { delete m[entry.v]; Store.set('saves', m); return false; }
    m[entry.v] = { ...entry, ts: Date.now() };
    Store.set('saves', m);
    return true;
  },
  list() { return Object.values(Saves.map()).sort((a, b) => b.ts - a.ts); },
};
/** locally-subscribed channels: {id: {id,name,avatar,ts}} */
const Subs = {
  map() { return Store.get('subs', {}); },
  has(id) { return !!id && !!Subs.map()[id]; },
  toggle(ch) {
    if (!ch?.id) return false;
    const m = Subs.map();
    if (m[ch.id]) { delete m[ch.id]; Store.set('subs', m); return false; }
    m[ch.id] = { id: ch.id, name: ch.name || '', avatar: ch.avatar || '', ts: Date.now() };
    Store.set('subs', m);
    return true;
  },
  list() { return Object.values(Subs.map()).sort((a, b) => b.ts - a.ts); },
};
/** recent search phrases — strongest preference signal */
const Searches = {
  list() { return Store.get('searches', []); },
  add(q) {
    q = (q || '').trim();
    if (!q) return;
    let list = Searches.list().filter(s => s !== q);
    list.unshift(q);
    Store.set('searches', list.slice(0, 30));
  },
};

/** playlist context — クリック時点で文脈を sessionStorage 保存。
 *  視聴ページはサーバー往復を待たずローカルスナップショットから瞬時に
 *  パネルを描画し（バグの隙も無い）、裏で完全版に追従する。 */
const PlCtx = {
  key: (lid) => 'plctx:' + lid,
  save(lid, data) {
    try {
      if (!lid || !data?.items?.length) return;
      const slim = {
        id: lid, title: data.title || '', owner: data.owner || '',
        total: data.total || data.items.length || 0, ts: Date.now(),
        items: data.items.slice(0, 120).map(v => ({
          id: v.id, title: v.title || '', channel: v.channel || '',
          thumb: v.thumb ? String(v.thumb).slice(0, 120) : '', duration: v.duration || '',
        })),
      };
      sessionStorage.setItem(this.key(lid), JSON.stringify(slim));
    } catch (_) { /* quota — additive only */ }
  },
  load(lid) {
    try {
      const j = JSON.parse(sessionStorage.getItem(this.key(lid)) || 'null');
      if (j && j.items?.length && Date.now() - j.ts < 3600e3) return j;
    } catch (_) { /* parse — ignore */ }
    return null;
  },
};

/** preference profile inferred from history + likes + searches */
function buildProfile() {
  const hist = History.list();
  const likes = Likes.list();
  const searches = Searches.list();
  if (!hist.length && !likes.length && !searches.length) return null;
  const queries = [];
  const push = (q) => { q = String(q || '').trim(); if (q && !queries.includes(q) && queries.length < 4) queries.push(q); };
  searches.slice(0, 2).forEach(push);
  const chCount = {};
  for (const h of hist.slice(0, 40)) if (h.cn) chCount[h.cn] = (chCount[h.cn] || 0) + 1;
  for (const l of likes) if (l.cn) chCount[l.cn] = (chCount[l.cn] || 0) + 2;
  Object.entries(chCount).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([cn]) => push(cn));
  likes.slice(0, 2).forEach(l => push((l.t || '').slice(0, 50)));
  if (!queries.length) hist.slice(0, 2).forEach(h => push((h.t || '').slice(0, 50)));
  const relatedOf = [...likes.map(l => l.v), ...hist.map(h => h.v)]
    .filter(v => /^[\w-]{11}$/.test(v || '')).slice(0, 3);
  return { queries, relatedOf };
}

/* ----------------------------------------------------------------- api kit */
const mem = new Map();
async function api(path, { ttl = 5 * 60e3, method = 'GET', body } = {}) {
  const key = method + ':' + path + (body ? ':' + body : '');
  if (method === 'GET') {
    const hit = mem.get(key);
    if (hit && hit.exp > Date.now()) return hit.data;
  }
  const inflight = api._inflight.get(key);
  if (inflight) return inflight;
  const p = fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  }).then(async (res) => {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error || ('HTTP ' + res.status)); e.status = res.status; e.payload = j; throw e; }
    if (method === 'GET') mem.set(key, { data: j, exp: Date.now() + ttl });
    api._inflight.delete(key);
    return j;
  }).catch(e => { api._inflight.delete(key); throw e; });
  api._inflight.set(key, p);
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
const ICON_SHORTS = '<svg viewBox="0 0 24 24"><path d="M17.7 4.1a10 10 0 1 0 .7 15.7 12.4 12.4 0 0 1-2.2 1.6 8.3 8.3 0 1 1 1.5-17.3z"/><path d="M10 15l5.2-3L10 9z"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>';

function thumbUrl(it) {
  if (it.thumb) return it.thumb;
  if (it.id && (it.kind === 'video' || it.kind === 'short')) return `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`;
  return '';
}

function videoCard(it, { rail = false } = {}) {
  if (it.kind === 'short') return shortCard(it, { rail });
  if (it.kind === 'channel') return channelRow(it);
  if (it.kind === 'playlist') return playlistCard(it);
  const href = it.url || ('/watch?v=' + it.id);
  const meta = it.metaTop?.join(' • ') || [it.views, it.published].filter(Boolean).join(' • ');
  return `
  <div class="vcard" data-href="#${href.replace(/^#?/, '')}" data-vid="${esc(it.id)}">
    <div class="vthumb">
      <img loading="lazy" src="${esc(thumbUrl(it))}" alt="" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${esc(it.id)}/hqdefault.jpg'">
      ${it.duration ? `<span class="dur">${esc(it.duration)}</span>` : (it.live ? '<span class="dur live-badge">LIVE</span>' : '')}
    </div>
    <div class="vmeta">
      <div class="vava">${it.channelAvatar ? `<img src="${esc(it.channelAvatar)}" alt="">` : '<svg viewBox="0 0 24 24" class="ic" style="fill:var(--text-3)"><path d="M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 18c-3.2 0-6-.5-6-1.5 0-2.5 3.5-4 6-4s6 1.5 6 4c0 1-2.8 1.5-6 1.5z"/></svg>'}</div>
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

/** dedicated shorts shelf — vertical videos get their own section */
function shortsShelf(shorts, { compact = false } = {}) {
  if (!shorts?.length) return '';
  return `
  <div class="shorts-row ${compact ? 'compact' : ''}">
    <div class="shorts-title">${ICON_SHORTS}ショート</div>
    <div class="shorts-scroll">${shorts.map(s => shortCard(s)).join('')}</div>
  </div>`;
}

function playlistCard(it) {
  return `
  <div class="vcard" data-href="#${(it.url || '/playlist?list=' + it.id).replace(/^#?/, '')}">
    <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
      <span class="pl-strip"><svg viewBox="0 0 24 24" class="ic"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm13-8v9l7-4.5z"/></svg>${esc(it.count || '再生リスト')}</span>
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

/** search-result-style playlist row (fixes the "giant thumbnail" bug) */
function playlistRow(it) {
  const href = (it.url || '/playlist?list=' + it.id).replace(/^#?/, '');
  const count = it.count || '';
  return `
  <div class="result-card" data-href="#${esc(href)}">
    <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(it))}" alt="">
      <span class="pl-strip"><svg viewBox="0 0 24 24" class="ic"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm13-8v9l7-4.5z"/></svg>${esc(count || '再生リスト')}</span>
    </div>
    <div class="vinfo result-info">
      <div class="vtitle">${esc(it.title)}</div>
      <div class="pl-kind">再生リスト</div>
      ${it.channel ? `<div class="result-ch" style="margin-top:2px"><span>${esc(it.channel)}</span></div>` : ''}
      <div class="result-sub" style="margin-top:10px">再生リストをすべて見る</div>
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

/** shorts playback queue — ショートカード群から文脈ごと保存（下スクロール遷移の土台） */
const SHQ_KEY = 'llytpr:shq';
function shqLoad() {
  try {
    const j = JSON.parse(sessionStorage.getItem(SHQ_KEY) || 'null');
    if (j && j.ids?.length && Date.now() - j.ts < 3600e3) return j;
  } catch (_) { /* ignore */ }
  return null;
}
function shqSave(ids, meta = {}) {
  try { sessionStorage.setItem(SHQ_KEY, JSON.stringify({ ids: ids.slice(0, 250), meta, ts: Date.now() })); } catch (_) { /* quota */ }
}

/** card for local-storage entries (history/likes/saves) */
function storedCard(h, { onRemove } = {}) {
  return `
  <div class="vcard" data-href="#/watch?v=${esc(h.v)}" data-vid="${esc(h.v)}">
    <div class="vthumb"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(h.v)}/hqdefault.jpg" alt="">
      ${h.d ? `<span class="dur">${esc(fmtDur(h.d))}</span>` : ''}
    </div>
    <div class="vmeta">
      <div class="vava"><svg viewBox="0 0 24 24" class="ic" style="fill:var(--text-3)"><path d="M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 18c-3.2 0-6-.5-6-1.5 0-2.5 3.5-4 6-4s6 1.5 6 4c0 1-2.8 1.5-6 1.5z"/></svg></div>
      <div class="vinfo">
        <div class="vtitle">${esc(h.t || h.v)}</div>
        <div class="vsub">${esc(h.cn || '')}</div>
      </div>
      ${onRemove ? `<button class="icon-btn stored-del" data-del-hist="${esc(h.v)}" title="履歴から削除"><svg viewBox="0 0 24 24" class="ic"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>` : ''}
    </div>
  </div>`;
}

/* delegation for card clicks + hover prefetch */
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del-hist]');
  if (del) {
    e.stopPropagation();
    History.remove(del.dataset.delHist);
    toast('履歴から削除しました');
    render();
    return;
  }
  const card = e.target.closest('[data-href]');
  if (!card) return;
  // ショートカード: 同一シェルフ/グリッドの並びをそのまま再生キューに保存
  const sc = e.target.closest('.scard');
  if (sc) {
    const box = sc.closest('.shorts-scroll, .shorts-grid');
    if (box) {
      const cards = [...box.querySelectorAll('.scard')];
      const ids = cards.map(c => c.dataset.vid).filter(v => /^[\w-]{11}$/.test(v || ''));
      const meta = {};
      cards.forEach(c => {
        if (c.dataset.vid) meta[c.dataset.vid] = {
          title: c.querySelector('.stitle')?.textContent || '',
          views: c.querySelector('.sviews')?.textContent || '',
        };
      });
      if (ids.length) shqSave(ids, meta);
    }
  }
  location.hash = card.dataset.href.startsWith('#') ? card.dataset.href.slice(1) : card.dataset.href;
});
// ---- 先読みプリフェッチ（メタ情報限界高速化）------------------------------
// カードに 120ms ホバーした時点で /api/watch（メタ+直結判定＋先頭チャンクwarm）を
// 裏取得し、クリック時にはメモリキャッシュから即座に反映されるようにする。
// data-vid 属性も data-href の URL も両方を解析する（検索行カード等も網羅）。
const _prefetched = new Map(); // vid -> ts
document.addEventListener('mouseover', debounce((e) => {
  const card = e.target.closest?.('[data-vid],[data-href]');
  if (!card) return;
  let vid = card.dataset.vid || '';
  if (!/^[\w-]{11}$/.test(vid)) {
    // 修正: 旧パターンは "?v=" 形式（プレイリスト行など）に一致せず先読みが
    // 働いていなかった。?v= / /shorts/ の両形式を確実に捕まえる。
    const m = String(card.dataset.href || '').match(/[?&]v=([\w-]{11})|\/shorts\/([\w-]{11})/);
    vid = m ? (m[1] || m[2] || '') : '';
  }
  if (!/^[\w-]{11}$/.test(vid)) return;
  const last = _prefetched.get(vid) || 0;
  if (Date.now() - last < 300000) return;
  _prefetched.set(vid, Date.now());
  api('/api/watch/' + vid).catch(() => {});            // メタ＋直結判定（SWRキャッシュ入り）
  fetch('/api/warm/' + vid).catch(() => {});           // 先頭 768KB をサーバーRAMへ保温
}, 120), { passive: true });
document.addEventListener('touchstart', (e) => { // モバイルはホバーが無いのでタッチ即先読み
  const card = e.target.closest?.('[data-vid],[data-href]');
  if (!card) return;
  const vid = card.dataset.vid || '';
  if (!/^[\w-]{11}$/.test(vid)) return;
  api('/api/watch/' + vid).catch(() => {});
  fetch('/api/warm/' + vid).catch(() => {});
}, { passive: true });

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

/** YouTube logged-out style nudge */
function nudgeHtml(title, body, icon = ICON_SEARCH) {
  return `
  <div class="nudge">
    <div class="nudge-card">
      <div class="nudge-icon">${icon}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(body)}</p>
    </div>
  </div>`;
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

function drawHomeItems(body, items, { personal = false } = {}) {
  const vids = [], shorts = [];
  for (const it of items || []) (it.kind === 'short' ? shorts : vids).push(it);
  if (!vids.length) {
    body.innerHTML = nudgeHtml('まずは検索してみましょう', '視聴した動画がここに表示されます。');
    return;
  }
  const first = vids.slice(0, 8), rest = vids.slice(8);
  body.innerHTML =
    (personal ? `<div class="sec-title">あなたにおすすめ</div>` : '') +
    `<div class="grid">${first.map(v => videoCard(v)).join('')}</div>` +
    (shorts.length ? shortsShelf(shorts) : '') +
    `<div class="grid">${rest.map(v => videoCard(v)).join('')}</div>`;
}

function renderHome(chip = sessionStorage.getItem('chip') || 'all') {
  setActiveNav('home');
  sessionStorage.setItem('chip', chip);
  const profile = buildProfile();

  // YouTube-faithful empty home: no chips, just the search nudge
  if (!profile && chip === 'all') {
    app.innerHTML = nudgeHtml(
      'まずは検索してみましょう',
      '視聴履歴がまだありません。上の検索バーから動画を検索すると、あなたの好みに合わせたおすすめがここに表示されます。'
    );
    return;
  }

  app.innerHTML = `
    <div class="chips">${CHIPS.map(([label, key]) =>
      `<button class="chip ${key === chip ? 'active' : ''}" data-chip="${key}">${label}</button>`).join('')}
    </div>
    <div id="home-body">${skGrid(12)}</div>`;
  $$('.chip', app).forEach(b => b.addEventListener('click', () => renderHome(b.dataset.chip)));

  const body = $('#home-body');

  if (chip === 'all' && profile) {
    // personalized: infer taste from history/likes/searches
    api('/api/home/personal', {
      method: 'POST', body: JSON.stringify(profile), ttl: 0,
    }).then((d) => {
      if (!document.body.contains(body)) return;
      const watched = new Set(History.list().map(h => h.v));
      const items = (d.items || []).filter(i => !watched.has(i.id));
      const shorts = (d.shorts || []).filter(i => !watched.has(i.id));
      if (!items.length) { renderHomePreset(body, chip); return; }
      drawHomeItems(body, [...items.slice(0, 8), ...shorts.map(s => ({ ...s, kind: 'short' })) /* shorts split again in draw */, ...items.slice(8)], { personal: true });
    }).catch(() => renderHomePreset(body, chip));
    return;
  }
  renderHomePreset(body, chip);

  function renderHomePreset(b, c) {
    api('/api/home?chip=' + encodeURIComponent(c), { ttl: 15 * 60e3 })
      .then((d) => { if (document.body.contains(b)) drawHomeItems(b, d.items || []); })
      .catch(e => errBox('ホームを読み込めませんでした: ' + e.message, () => renderHome(chip)));
  }
}

/* ================================================================== SEARCH */
function renderResults(params) {
  const q = params.get('search_query') || params.get('q') || '';
  setActiveNav('home');
  $('#search-input').value = q;
  if (!q) { renderHome(); return; }
  Searches.add(q);
  app.innerHTML = `<div class="results" id="res-body">${skGrid(6)}</div>`;
  let continuation = null;
  let loading = false;
  let sentinel = null;
  let filtered = 'すべて';

  function listCard(it) {
    if (it.kind === 'video') return resultCard(it);
    if (it.kind === 'playlist') return playlistRow(it);
    if (it.kind === 'short') return shortCard(it);
    return videoCard(it); // channels via channelRow inside
  }

  function draw(list) {
    const body = $('#res-body');
    if (!body) return;
    const KEY = { '動画': 'video', 'チャンネル': 'channel', '再生リスト': 'playlist', 'ショート': 'short' };
    const chipsHtml = `
      <div class="chips" style="position:static;padding:0 0 16px">
        ${['すべて', '動画', 'チャンネル', '再生リスト', 'ショート'].map(f => `<button class="chip ${f === filtered ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>`;

    let content = '';
    if (filtered === 'すべて') {
      // YouTube behavior: one dedicated Shorts shelf inside the vertical list
      const shorts = list.filter(it => it.kind === 'short');
      const others = list.filter(it => it.kind !== 'short');
      const head = others.slice(0, 3), tail = others.slice(3);
      content = `<div class="results-list">`
        + head.map(listCard).join('')
        + `</div>`
        + (shorts.length ? shortsShelf(shorts) : '')
        + `<div class="results-list">`
        + tail.map(listCard).join('')
        + `</div>`;
      if (!others.length && !shorts.length) content = emptyResult();
    } else if (filtered === 'ショート') {
      const shorts = list.filter(it => it.kind === 'short');
      content = shorts.length
        ? `<div class="sec-title" style="padding:0 0 12px">ショート</div><div class="shorts-grid">${shorts.map(shortCard).join('')}</div>`
        : emptyResult('この検索ではショート動画が見つかりませんでした。');
    } else {
      const show = list.filter(it => it.kind === KEY[filtered]);
      content = show.length
        ? `<div class="results-list">${show.map(listCard).join('')}</div>`
        : emptyResult();
    }
    body.innerHTML = chipsHtml + content;
    $$('.chip', body).forEach(b => b.addEventListener('click', () => { filtered = b.dataset.f; draw(allItems); }));
    if (sentinel) { sentinel.done(); sentinel = null; }
    if (continuation) sentinel = lazySentinel(body, loadMore);
  }

  function emptyResult(msg = '別のキーワードで検索してみてください。') {
    return `<div class="empty-state"><h1>結果が見つかりません</h1><p>${esc(msg)}</p></div>`;
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
      draw(allItems);
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
    this.retry403 = 0;
    this._onTime = () => this.pump().catch(() => {});
    this._onSeek = () => this._handleSeek().catch(() => {});
  }

  async _range(itag, start, end) {
    let res = await fetch(`/api/stream?v=${this.videoId}&itag=${itag}`, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status === 403 && this.retry403 < 2) {
      // upstream URL died (IP mismatch / expiry): make the server rebuild it once
      this.retry403++;
      await api('/api/player/refresh', { method: 'POST', body: JSON.stringify({ v: this.videoId }) }).catch(() => {});
      res = await fetch(`/api/stream?v=${this.videoId}&itag=${itag}&r=${Date.now()}`, { headers: { Range: `bytes=${start}-${end}` } });
    }
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
        p += 4; // reference_id
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
    if (this.video.error) return; // メディア要素がエラー状態なら append は常に失敗する
    this._pumping = true;
    try {
      for (;;) {
        if (this.dead) return;
        if (this.video.error) return;
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
    if (inV && inA) { this.pump().catch(() => {}); return; }
    // re-sync both pipelines at t
    try {
      await this._clear(this.vbuf); await this._clear(this.abuf);
      this.posV = this._segIndex(this.vSegs, t);
      this.posA = this._segIndex(this.aSegs, t);
      this.pump().catch(() => {});
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
          <button class="icon-btn" data-el="settings" title="設定"><svg viewBox="0 0 24 24" class="ic"><path d="M19.7 13.4a7.6 7.6 0 0 0 0-2.8l2-1.5a.5.5 0 0 0 .1-.7l-1.9-3.2a.5.5 0 0 0-.6-.2l-2.3.9a7.7 7.7 0 0 0-2.4-1.4L14.2 2a.5.5 0 0 0-.5-.4h-3.8a.5.5 0 0 0-.5.4L9 4.5a7.7 7.7 0 0 0-2.4 1.4l-2.3-.9a.5.5 0 0 0-.6.2L1.8 8.4a.5.5 0 0 0 .1.7l2 1.5a7.6 7.6 0 0 0 0 2.8l-2 1.5a.5.5 0 0 0-.1.7l1.9 3.2c.14.24.42.34.68.22l2.3-.9c.72.56 1.53 1.03 2.4 1.4l.35 2.5c.04.24.24.4.5.4h3.8c.24 0 .45.17.5-.4l.35-2.5a7.7 7.7 0 0 0 2.4-1.4l2.3.9c.24.1.52.02.65-.22l1.9-3.18a.5.5 0 0 0-.1-.73zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>
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
    // 修正: document レベルのキーハンドラは destroy() で必ず外す
    // （動画を渡り歩くたびにハンドラが累積し、ショートカットが多重発火していた）
    this._key = (e) => {
      if (!document.body.contains(this.wrap)) return;
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'k' || (e.key === ' ' && document.fullscreenElement === this.wrap)) { e.preventDefault(); this.togglePlay(); }
      if (e.key === 'f') this.toggleFs();
      if (e.key === 'm') v.muted = !v.muted;
      if (e.key === 'ArrowRight') v.currentTime += 5;
      if (e.key === 'ArrowLeft') v.currentTime -= 5;
    };
    document.addEventListener('keydown', this._key);
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
      qualities.map(ql => `<div class="qi ${ql.key === current ? 'sel' : ''}" data-q="${ql.key}"><span>${esc(ql.label)}</span></div>`).join('') +
      `<div class="qhead">再生速度</div>` +
      speeds.map(s => `<div class="qi" data-s="${s}" style="${s === speed ? 'color:#3ea6ff' : ''}"><span>${s === 1 ? '標準' : s + 'x'}</span></div>`).join('');
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
  destroy() {
    if (this._key) { document.removeEventListener('keydown', this._key); this._key = null; }
    clearTimeout(this._ft);
  }
}

/* --------------------------------- watch page -------------------------------- */
function renderWatch(params, { vertical = false, shortId = null } = {}) {
  const id = shortId || params.get('v') || '';
  if (!/^[\w-]{11}$/.test(id)) { errBox('動画IDが不正です', () => render()); return; }
  setActiveNav(vertical ? 'shorts' : 'home');
  const listId = params.get('list') || '';
  let destroyed = false;
  let dash = null;
  let hlsInst = null;
  let pair = null;              // {audio, iv} — HD video + separate audio sync
  let mode = 'auto'; // 'auto' | 'hdauto' | 'direct' | '360p' | itag string
  let ui = null;
  let rescues = 0;
  let suppressErrorHook = false;
  let instantAttached = false;

  app.innerHTML = `
  <div class="watch">
    <div class="player-col">
      <div class="player-wrap ${vertical ? 'vertical' : ''}" id="pwrap">
        <video id="pvideo" playsinline autoplay preload="auto" ${vertical ? 'loop' : ''}></video>
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

  // ---- INSTANT START: don't wait for the API round-trip. Attach the default
  // 360p relay immediately; the server resolves the (IP-pinned) URL and the
  // RAM hot-cache answers the first bytes. UI/meta fill in alongside.
  try {
    suppressErrorHook = true; // verdict arrives with /api/watch
    video.src = `/api/stream?v=${id}&itag=18`;
    instantAttached = true;
    const early = video.play();
    if (early?.catch) early.catch(() => { /* autoplay policy — safePlay later */ });
  } catch (_) { /* continue without instant attach */ }

  function killPair() {
    if (!pair) return;
    try { clearInterval(pair.iv); } catch (_) {}
    try { video.removeEventListener('play', pair.onPlay); } catch (_) {}
    try { video.removeEventListener('pause', pair.onPause); } catch (_) {}
    try { video.removeEventListener('seeked', pair.onSeeked); } catch (_) {}
    try { video.removeEventListener('waiting', pair.onWaiting); } catch (_) {}
    try { video.removeEventListener('playing', pair.onPlaying); } catch (_) {}
    try { video.removeEventListener('ratechange', pair.onRate); } catch (_) {}
    try { video.removeEventListener('volumechange', pair.onVol); } catch (_) {}
    try { pair.audio.pause(); pair.audio.removeAttribute('src'); pair.audio.load(); } catch (_) {}
    pair.audioEl?.remove?.();
    pair = null;
    video.muted = false;
  }

  function cleanup() {
    destroyed = true;
    try { dash?.destroy(); } catch (_) {}
    try { hlsInst?.destroy(); } catch (_) {}
    try { ui?.destroy(); } catch (_) {}
    killPair();
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
  }

  /* プレイリスト文脈は URL パラメータ非依存のローカル一次情報源から即時開始
   * （サーバー往復ゼロ）。サーバー応答にパネルが同梱された場合のみ後追い更新。
   * （パネル系シンボルは本スコープ末尾で初期化されるため 1 ティックだけ遅延） */
  let panelStarted = false;
  if (listId) {
    panelStarted = true;
    setTimeout(() => { if (!destroyed) setupPlaylistPanel(listId, id, null, PlCtx.load(listId)); }, 0);
  }

  loadWatch(id, false);

  /* 「ログインして bot ではないことを確認してください」を絶対に見せない仕組み。
   * LOGIN_REQUIRED / ERROR / 通信失敗が返った瞬間、ユーザー操作なしで最大3回まで
   * 自動でプロキシをローテーションし再取得する（サーバー側も同時に総入替）。
   * 本当に再生不能なケース（削除済み・年齢制限等）だけが最終メッセージに辿り着く。 */
  const MAX_RESCUES = 3;
  const DEFINITIVE = /UNPLAYABLE|AGE_CHECK|CONTENT_NOT_AVAILABLE|VIDEO_UNAVAILABLE|OFFLINE|PRIVATE|PLAYLIST_EMPTY|NOT_FOUND/i;
  const isDefinitive = (status) => {
    const s = String(status || '').toUpperCase();
    if (!s || s === 'ERROR' || s === 'LOGIN_REQUIRED' || s === 'NETWORK' || s === 'UPSTREAM') return false;
    return DEFINITIVE.test(s);
  };
  function rescueVeil(n) {
    if (!n || destroyed) { wrapEl.querySelector('[data-veil]')?.remove(); return; }
    let v = wrapEl.querySelector('[data-veil]');
    if (!v) {
      v = document.createElement('div');
      v.setAttribute('data-veil', '');
      v.className = 'rescue-veil';
      wrapEl.appendChild(v);
    }
    v.innerHTML = `<div class="mini-spin light"></div><p>接続経路を自動で切り替えています… <span>(${n}/${MAX_RESCUES})</span></p>`;
  }

  function loadWatch(vid, busted) {
    if (busted) api.invalidate('/api/watch/' + vid);
    api('/api/watch/' + vid, { ttl: busted ? 0 : 3 * 60e3 })
      .then(async (d) => {
        if (destroyed) return;
        document.title = (d.title || 'Vandal') + ' - Vandal';
        fillMeta(d);
        loadComments(d);
        fillRail(d);
        // 高速化: 関連動画の先頭2本のメタを先読み（視聴完了→次動画の初速短縮）。
        // ホバー先読みと同じ /api/watch なのでサーバー側 90 秒キャッシュに乗る。
        for (const r of (d.related || []).filter(i => i?.kind === 'video' && i.id).slice(0, 2)) {
          if (/^[\w-]{11}$/.test(r.id)) api('/api/watch/' + r.id, { ttl: 2 * 60e3 }).catch(() => {});
        }
        if (listId) {
          if (!panelStarted) { panelStarted = true; setupPlaylistPanel(listId, id, d.panel, PlCtx.load(listId)); }
          else if (d.panel?.items?.length) updatePlaylistPanel(d.panel);
        }
        if (!d.playable) {
          if (!isDefinitive(d.playability?.status) && rescues < MAX_RESCUES) { await fatalRescue(true); return; }
          unplayableBox(d.playability?.reason || 'この動画は再生できません', d.playability?.status || '');
          return;
        }
        rescueVeil(0);
        await setupPlayback(d);
      })
      .catch(async (e) => {
        if (destroyed) return;
        if (rescues < MAX_RESCUES) { await fatalRescue(true); return; }
        unplayableBox('再生に失敗しました', e.message);
        fillRail({ related: [] });
      });
  }

  function unplayableBox(msg, sub) {
    rescueVeil(0);
    wrapEl.innerHTML = `<div class="unplayable"><div>${esc(msg)}<br><span style="opacity:.6;font-size:12px">${esc(sub || '')}</span><br><button class="retry" id="un-retry" style="margin-top:14px;background:#fff;color:#000;border-radius:18px;padding:0 20px;height:36px;font-size:13px">もう一度試す</button></div></div>`;
    // 修正: 旧実装は location.hash 変更（hashchange→render）と手動 renderWatch の
    // 両方を起こし、watch ページが二重に初期化されていた。router 経由で
    // 旧ページを必ず destroy してから再構築する（同値 hash は手動 render）。
    $('#un-retry')?.addEventListener('click', () => {
      rescues = 0;
      api.invalidate('/api/watch/' + id);
      const target = vertical ? '/shorts/' + id : ('/watch?v=' + id + (listId ? '&list=' + encodeURIComponent(listId) : ''));
      if (location.hash === '#' + target) render(); else location.hash = target;
    });
  }

  /** full rebuild when every playback route fails (rotates proxies server-side) */
  async function fatalRescue(silent) {
    rescues++;
    rescueVeil(rescues);
    if (rescues > 1) await new Promise(r => setTimeout(r, 500 * rescues)); // ローテーション安定待ち
    if (!silent) toast('ストリームを復旧しています…');
    await api('/api/player/refresh', { method: 'POST', body: JSON.stringify({ v: id }) }).catch(() => null);
    if (destroyed) return;
    loadWatch(id, true);
  }

  async function setupPlayback(d) {
    const streams = d.streams || {};
    const prog = (streams.progressive || []).slice().sort((a, b) => (b.height || 0) - (a.height || 0));
    const bestProg = prog[0];
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
      const prev = byLabel.get(label);
      if (!prev || ((prev.fps || 30) > 30 && (t.fps || 30) <= 30) || ((prev.fps || 0) === (t.fps || 0) && (t.bitrate || 0) > (prev.bitrate || 0))) byLabel.set(label, t);
    }
    const adapt = [...byLabel.values()].sort((a, b) => (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0));
    for (const t of adapt) qList.push({ key: String(t.itag), label: t.qualityLabel, track: t });
    if (bestProg) qList.push({ key: '360p', label: '360p', prog: bestProg });
    const direct = streams.direct || null;

    const autoTrack = pickAuto(adapt);
    const canDash = !!(audTrack && autoTrack && DashLite.isSupported(autoTrack, audTrack));
    let activeTrack = null;

    // llytpr++ 直結: 生 URL がある限り常に「影武者プローブ」で直結を試す。
    // 従来はサーバー側実測 (streams.playDirect) が true の時しか試さず、
    // 「サーバー egress は 403 でも ユーザー網からは直接再生できる」動画が
    // 無条件にプロキシされ続けるバグがあった。影武者はリレー再生を一切妨げない
    // ため、判定は毎動画クライアント実機で行うのが最善。サーバー実測値と
    // directOk 学習は HD 直結の信頼度ボーナス（＝高速に開始できる保証）として使う。
    // ※ directOk / directBlocked は TTL 付き学習に変更（一時不調の永久化を防止）。
    const dBlocked = () => Store.getExp('directBlocked', false);
    const dOk = () => Store.getExp('directOk', false);
    const directReady0 = !!(direct?.url && !dBlocked() && (streams.playDirect || dOk()));
    const canDirect = () => !!(direct?.url && !dBlocked());
    const canHdRaw = () => !!(canDirect() && streams.directUrls && (streams.hdDirect || dOk()));
    const markDirectOn = () => { Store.del('exp:directBlocked'); Store.setExp('directOk', true, DIRECT_OK_TTL); };
    const markDirectOff = () => { Store.setExp('directBlocked', true, DIRECT_BLOCK_TTL); Store.del('exp:directOk'); };
    const qualities = [
      { key: 'auto', label: directReady0 ? ('自動 (' + (direct?.height || 360) + 'p・直結最速)') : '自動 (360p・最速)' },
      ...((canDash || (autoTrack && audTrack)) ? [{ key: 'hdauto', label: '自動HD (' + (autoTrack?.qualityLabel || '720p') + ')' }] : []),
      ...qList,
    ];
    let speed = 1;

    ui = new PlayerUI(wrapEl, video, () => ({
      qualities, current: mode,
      speeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], speed,
      onPick: (k) => { mode = k; startMode(k, video.currentTime); },
      onSpeed: (s) => { speed = s; video.playbackRate = s; },
    }));
    wrapEl.querySelector('[data-spin]')?.remove(); // skeleton spinner -> UI owns one now

    // a relayed stream can still die mid-playback (403): rebuild once
    video.addEventListener('error', () => {
      if (destroyed || suppressErrorHook || dash || pair) return;
      if (rescues < 2) fatalRescue(false);
      else unplayableBox('ストリームに接続できませんでした', '経路の再取得に失敗しました');
    });

    if (streams.hls && !qList.length && !bestProg) {
      startHls();
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
      const detach = () => {
        try { dash?.destroy(); dash = null; } catch (_) {}
        try { hlsInst?.destroy(); hlsInst = null; } catch (_) {}
        killPair();
        video.removeAttribute('src');
        video.load();
      };
      ui?.el.spin?.classList.remove('hidden');
      if (k === 'auto') {
        // 既定は最速プログレッシブ。直結可能と実測済みなら（ほとんどの動画が該当）
        // 影武者プローブで生 URL を試し、進行確認できた時だけ無停止で載せ替える。
        if (canDirect()) {
          if (await tryDirect(direct, resumeAt)) return;
        }
        if (instantAttached && bestProg && !video.error) { suppressErrorHook = false; safePlay(); armProgressWatchdog('relay-instant', resumeAt); return; }
        detach();
        startProg(bestProg, resumeAt);
        return;
      }
      detach();
      if (k === 'hdauto') {
        if (canHdRaw() && await tryPair(autoTrack, resumeAt, true)) return;
        if (canDash && await tryDash(autoTrack, resumeAt)) return;
        if (await tryPair(autoTrack, resumeAt)) return;
        startProg(bestProg, resumeAt);
      } else if (k === '360p') {
        startProg(bestProg, resumeAt);
      } else {
        const t = qList.find(q => q.key === k)?.track;
        if (canHdRaw() && t && await tryPair(t, resumeAt, true)) return;
        if (t && await tryDash(t, resumeAt)) return;
        if (t && await tryPair(t, resumeAt)) return;
        startProg(bestProg, resumeAt);
      }
    }

    /**
     * Dual-element HD: <video> が映像専用 adaptive、不可視の <audio> が音声を
     * 受け持ち、ドリフト補正でリップシンクを保つ。MSE が使えない/音声バッファが
     * 不安定な環境でも「360p以外で音が出ない」を確実に潰すための同期経路。
     */
    function tryPair(track, resumeAt, raw = false) {
      return new Promise((resolve) => {
        let audio = null;
        let timer = null;
        let settled = false;
        const finish = (val) => {
          if (settled) return;
          settled = true;
          try { clearTimeout(timer); } catch (_) {}
          if (!val && audio) { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {} }
          resolve(val);
        };
        try {
        if (!track || !audTrack) return finish(false);
        // raw モード(llytpr++ 直結HD): <video>/<audio> のメディア要素は CORS 不要の
        // ため、生 googlevideo URL をそのまま装着できる（MSE と違い fetch を通らない）。
        const vSrc = raw ? streams.directUrls?.[track.itag] : `/api/stream?v=${id}&itag=${track.itag}`;
        const aSrc = raw ? streams.directUrls?.[audTrack.itag] : `/api/stream?v=${id}&itag=${audTrack.itag}`;
        if (!vSrc || !aSrc) return finish(false);
        killPair();
        audio = new Audio();
        audio.preload = 'auto';
        timer = setTimeout(() => finish(false), 9000);
        const fail = () => finish(false);
        const ok = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          suppressErrorHook = false;
          activeTrack = track;
          const onPlay = () => audio.play().catch(() => {});
          const onPause = () => audio.pause();
          const onSeeked = () => { audio.currentTime = video.currentTime + 0.04; };
          const onWaiting = () => audio.pause();
          const onPlaying = () => {
            if (Math.abs(audio.currentTime - video.currentTime) > 0.35) audio.currentTime = video.currentTime + 0.04;
            audio.play().catch(() => {});
          };
          const onRate = () => { audio.playbackRate = video.playbackRate; };
          const onVol = () => { audio.volume = video.volume; audio.muted = video.muted; };
          video.addEventListener('play', onPlay);
          video.addEventListener('pause', onPause);
          video.addEventListener('seeked', onSeeked);
          video.addEventListener('waiting', onWaiting);
          video.addEventListener('playing', onPlaying);
          video.addEventListener('ratechange', onRate);
          video.addEventListener('volumechange', onVol);
          audio.volume = video.volume; audio.muted = video.muted;
          const iv = setInterval(() => {
            if (destroyed || !pair) return;
            if (video.paused || video.seeking) return;
            if (Math.abs(audio.currentTime - video.currentTime) > 0.38) {
              audio.currentTime = video.currentTime + 0.04;
            }
          }, 500);
          pair = { audio, iv, onPlay, onPause, onSeeked, onWaiting, onPlaying, onRate, onVol, audioEl: audio };
          audio.currentTime = resumeAt || 0;
          safePlay();
          // raw HD の stall 監視: 開始後に映像が進まなければ MSE→リレーへ降格
          if (raw) {
            const t0p = video.currentTime;
            setTimeout(() => {
              if (destroyed || !pair || dBlocked()) return;
              if (video.paused || video.seeking) return;
              if (video.currentTime - t0p < 0.15 && video.readyState < 3) {
                Store.setExp('directBlocked', true, DIRECT_BLOCK_TTL);
                toast('直結HDが不安定なため切り替えます');
                killPair();
                (async () => {
                  if (canDash && await tryDash(track, video.currentTime)) return;
                  if (await tryPair(track, video.currentTime, false)) return;
                  startProg(bestProg, video.currentTime);
                })();
              }
            }, 6000);
          }
          resolve(true);
        };
        let vReady = false, aReady = false;
        const maybe = () => { if (vReady && aReady) ok(); };
        video.addEventListener('error', fail, { once: true });
        audio.addEventListener('error', fail, { once: true });
        video.addEventListener('canplay', () => { vReady = true; maybe(); }, { once: true });
        audio.addEventListener('canplay', () => { aReady = true; maybe(); }, { once: true });
        video.src = vSrc;
        audio.src = aSrc;
        video.currentTime = resumeAt || 0;
        } catch (_) { finish(false); }
      });
    }

    /**
     * llytpr++ 直結スワップ: 生 googlevideo/Piped URL を不可視の「影武者」<video> で
     * 先行試聴し、実際に再生時間が進むことを確認できた時だけ本体に載せ替える。
     * 失敗しても本体（リレー再生中）は一切妨げられない = 直結判定を常に楽観試行できる。
     */
    function tryDirect(d, resumeAt) {
      if (!d?.url) return Promise.resolve(false);
      if (dBlocked()) return Promise.resolve(false);
      const shadowOk = instantAttached && !video.error;
      if (shadowOk) return new Promise((resolve) => {
        const probe = document.createElement('video');
        probe.muted = true;
        probe.playsInline = true;
        probe.preload = 'auto';
        let settled = false;
        const cleanup = () => { try { probe.pause(); probe.removeAttribute('src'); probe.load(); } catch (_) {} probe.remove(); };
        const timer = setTimeout(() => done(false), 5000);
        probe.addEventListener('error', () => done(false), { once: true });
        let mark = -1;
        probe.addEventListener('playing', () => {
          mark = probe.currentTime;
          setTimeout(() => {
            if (settled) return;
            if (probe.currentTime - mark > 0.25) done(true); // 実進行を確認
          }, 900);
        }, { once: true });
        probe.src = d.url;
        probe.currentTime = resumeAt || 0;
        probe.play().catch(() => {});
        function done(ok) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ok) {
            markDirectOn(); // 学習: この回線は生 URL 再生可能（24h キャッシュ）
            mode = 'auto'; // 「自動」のまま = 直結が既定動作
            if (qualities[0]) qualities[0].label = '自動 (' + (d.height || 360) + 'p・直結最速)';
            const carry = Math.max(probe.currentTime, video.currentTime || 0, resumeAt || 0);
            cleanup();
            video.src = d.url;
            video.currentTime = carry;
            safePlay();
            armProgressWatchdog('direct', carry);
            resolve(true);
          } else {
            cleanup(); // 本体は無傷（リレー再生継続）
            resolve(false);
          }
        }
      });
      // 本体がまだ空のときは従来どおり直下試行（2.6s watchdog→リレー）
      return new Promise((resolve) => {
        let settled = false;
        suppressErrorHook = true;
        const timer = setTimeout(() => done(false), 2600);
        const onErr = () => done(false);
        const onPlay = () => done(true);
        video.addEventListener('error', onErr, { once: true });
        video.addEventListener('playing', onPlay, { once: true });
        video.src = d.url;
        video.currentTime = resumeAt || 0;
        safePlay();
        function done(ok) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          video.removeEventListener('error', onErr);
          video.removeEventListener('playing', onPlay);
          suppressErrorHook = false;
          if (ok) {
            markDirectOn();                            // learned: this network can play raw urls
            if (qualities[0]) qualities[0].label = '自動 (' + (d.height || 360) + 'p・直結最速)';
            mode = 'auto';                             // 「自動」画質のまま = 直結が既定動作
            // post-success stall watchdog: 「playing は出たが秒数が進まない」
            // （発信元 IP レピュテーション等で途中 stall）を検知してリレーへ強制復帰
            const t0 = video.currentTime;
            setTimeout(() => {
              if (destroyed || dash || pair || dBlocked()) return;
              if (mode !== 'auto') return;
              if (video.paused || video.seeking || video.ended) return;
              if (video.currentTime - t0 < 0.15 && video.readyState < 3) {
                Store.setExp('directBlocked', true, DIRECT_BLOCK_TTL);
                toast('直結が不安定なためリレーに切り替えます');
                startProg(bestProg, video.currentTime || resumeAt || 0);
              }
            }, 5000);
            armProgressWatchdog('direct', resumeAt);
            resolve(true);
          } else {
            // 直結不可（ユーザ網が googlevideo を遮断等）: しばらく（10分）リレー固定
            markDirectOff();
            try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
            resolve(false);
          }
        }
      });
    }

    function safePlay() {
      const attempt = video.play();
      if (attempt?.catch) attempt.catch(() => {
        video.muted = true;
        video.play().catch(() => ui?.showBigPlay());
      });
    }

    async function tryDash(track, resumeAt) {
      try {
        activeTrack = track;
        dash = new DashLite(video, id, track, audTrack);
        await dash.init(resumeAt);
        if (destroyed) return false;
        suppressErrorHook = false;
        video.currentTime = resumeAt || 0;
        wireEndGuard();
        // 音声パイプライン・ウォッチドッグ: 映像が進むのに音声バッファが
        // 空のままなら、同期デュアルストリームに組み替える（無音HDの根治）。
        setTimeout(() => {
          if (destroyed || !dash || dash.dead) return;
          const aEnd = dash._bufferedEnd('a');
          if (aEnd < video.currentTime - 0.8) {
            const t = video.currentTime;
            try { dash?.destroy(); dash = null; } catch (_) {}
            toast('高画質モードの音声を再構成しています');
            tryPair(track, t).then(ok => { if (!ok) startProg(bestProg, t); });
          }
        }, 2600);
        safePlay();
        return true;
      } catch (e) {
        try { dash?.destroy(); } catch (_) {}
        dash = null;
        return false;
      }
    }

    /** 進行watchdog: src 装着後に再生が一向に進まない（経路 stall）場合の
     *  最終安全網。直結はリレーへ即無段階復帰、リレーは URL 再生成→再挑戦する。 */
    function armProgressWatchdog(tag, resumeAt) {
      const t0 = video.currentTime;
      setTimeout(() => {
        if (destroyed || dash || pair) return;
        if (video.paused || video.seeking || video.ended) return;
        if (video.currentTime - t0 >= 0.15 || video.readyState >= 3) return; // 健康
        if (tag === 'direct') {
          // 直結スワップ後に止まった: ページ全体を再構築せずリレーへ即復帰
          // （従来は fatalRescue で全面リロードしており、再生できる状態まで
          // 画面を落としてしまう過剰反応だった）
          console.warn('[llytpr++] direct stall detected — reverting to relay');
          Store.setExp('directBlocked', true, DIRECT_BLOCK_TTL);
          toast('直結が不安定なためリレーに切り替えます');
          startProg(bestProg, Math.max(video.currentTime, resumeAt || 0));
          return;
        }
        if (rescues < 3) {
          console.warn('[llytpr++] stall detected (' + tag + ') — rescuing');
          fatalRescue(true);
        } else {
          unplayableBox('ストリームに接続できませんでした', 'ネットワークが googlevideo への接続を制限している可能性があります');
        }
      }, 7000);
    }

    function startProg(p, resumeAt) {
      if (!p) {
        if (streams.hls) { startHls(); return; }
        if (rescues < 2) { fatalRescue(false); return; }
        unplayableBox('再生可能なフォーマットがありません', 'すべての取得経路が失敗しました');
        return;
      }
      dash?.destroy(); dash = null;
      killPair();
      suppressErrorHook = false;
      video.src = `/api/stream?v=${id}&itag=${p.itag}`;
      video.currentTime = resumeAt || 0;
      safePlay();
      armProgressWatchdog('relay', resumeAt);
    }

    async function startHls() {
      const proxied = '/api/hls?v=' + id;
      if (window.Hls && window.Hls.isSupported()) {
        hlsInst = new window.Hls({ maxBufferLength: 30 });
        hlsInst.loadSource(proxied);
        hlsInst.attachMedia(video);
        hlsInst.on(window.Hls.Events.MANIFEST_PARSED, () => safePlay());
        hlsInst.on(window.Hls.Events.ERROR, (_e, data) => {
          if (data?.fatal) { if (bestProg) startProg(bestProg, 0); else if (rescues < 2) fatalRescue(false); }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxied;
        safePlay();
      } else if (bestProg) startProg(bestProg, 0);
      else if (rescues < 2) fatalRescue(false);
    }

    function wireEndGuard() {
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
    // record the visit for the recommendation engine
    History.add({ v: id, t: d.title || '', cn: d.channel?.name || '', ch: d.channel?.id || '', d: d.lengthSeconds || 0 });

    const titleEl = $('.wtitle');
    if (titleEl) titleEl.textContent = d.title || '';
    const ch = d.channel || {};
    const stats = [d.viewCount, d.dateText].filter(Boolean).join(' • ');
    const actRow = $('.action-row');
    const liked0 = Likes.has(id);
    const saved0 = Saves.has(id);
    const subbed0 = Subs.has(ch.id);
    if (actRow) actRow.innerHTML = `
      <div class="ch-chip">
        <div class="ch-ava" data-href="${ch.id ? '#/channel/' + esc(ch.id) : '#'}">${ch.avatar ? `<img src="${esc(ch.avatar)}" alt="">` : ''}</div>
        <div class="ch-names">
          <div class="ch-name" data-href="${ch.id ? '#/channel/' + esc(ch.id) : '#'}">${esc(ch.name || '')} ${ch.verified ? ICON_CHECK : ''}</div>
          <div class="ch-subs">${esc(ch.subs || '')}</div>
        </div>
        <button class="sub-btn ${subbed0 ? 'subbed' : ''}" id="sub-btn">${subbed0 ? '登録済み' : 'チャンネル登録'}</button>
      </div>
      <div class="p-spacer" style="flex:1"></div>
      <div class="like-group">
        <button id="like-btn" title="高く評価" style="${liked0 ? 'color:var(--blue)' : ''}"><svg viewBox="0 0 24 24" class="ic"><path d="M2 21h4V9H2zM22 10c0-1.1-.9-2-2-2h-6.3l.9-4.6v-.3c0-.4-.2-.8-.4-1.1L13.1 1 6.6 8.6c-.4.3-.6.8-.6 1.4v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg><span id="like-count">${esc(d.likeCount || '')}</span></button>
        <button id="dislike-btn" title="低く評価"><svg viewBox="0 0 24 24" class="ic"><path d="M18 3h4v12h-4zM2 14c0 1.1.9 2 2 2h6.3l-.9 4.6v.3c0 .4.2.8.4 1.1l1.1 1 6.5-6.5c.4-.4.6-.9.6-1.4V4.1c0-1.1-.9-2-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7z"/></svg></button>
      </div>
      <button class="btn-pill" id="share-btn"><svg viewBox="0 0 24 24" class="ic"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>共有</button>
      <button class="btn-pill" id="save-btn" style="${saved0 ? 'color:var(--blue)' : ''}"><svg viewBox="0 0 24 24" class="ic"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-5 7 5V5a2 2 0 0 0-2-2z"/></svg>${saved0 ? '保存済み' : '保存'}</button>
      <button class="btn-pill ask-btn" id="ask-btn" title="AIに質問（概要欄を読み込み済み）"><span class="ask-gem">♦</span>Ask</button>`;
    const entry = () => ({ v: id, t: d.title || '', cn: ch.name || '', ch: ch.id || '', d: d.lengthSeconds || 0 });
    $('#like-btn')?.addEventListener('click', function () {
      const liked = Likes.toggle(entry());
      this.style.color = liked ? 'var(--blue)' : '';
      toast(liked ? '高く評価しました（この端末に保存）' : '取り消しました');
    });
    $('#dislike-btn')?.addEventListener('click', () => toast('フィードバックありがとうございます'));
    $('#share-btn')?.addEventListener('click', async () => {
      const url = location.origin + location.pathname + '#/watch?v=' + id;
      try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }
      catch (_) { toast(url, 6000); }
    });
    $('#save-btn')?.addEventListener('click', function () {
      const saved = Saves.toggle(entry());
      this.style.color = saved ? 'var(--blue)' : '';
      this.innerHTML = this.innerHTML.replace(saved ? '>保存<' : '>保存済み<', saved ? '>保存済み<' : '>保存<');
      toast(saved ? '保存しました（この端末に保存）' : '取り消しました');
    });
    $('#sub-btn')?.addEventListener('click', function () {
      if (!ch.id) { toast('チャンネル情報を取得できませんでした'); return; }
      const subbed = Subs.toggle({ id: ch.id, name: ch.name, avatar: ch.avatar });
      this.classList.toggle('subbed', subbed);
      this.textContent = subbed ? '登録済み' : 'チャンネル登録';
      toast(subbed ? 'チャンネル登録しました（この端末に保存）' : '登録を解除しました');
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
    setupAsk(d);
  }

  /* ---------------- ♦ Ask（HavocPianoAI 連携・概要欄を読み込んだAI） ------------- */
  function setupAsk(d) {
    const btn = $('#ask-btn');
    if (!btn) return;
    const ASK_KEY = 'llytpr:ask:' + id;
    let msgs = [];
    try { msgs = JSON.parse(sessionStorage.getItem(ASK_KEY) || '[]') || []; } catch (_) { msgs = []; }
    const saveMsgs = () => { try { sessionStorage.setItem(ASK_KEY, JSON.stringify(msgs.slice(-16))); } catch (_) {} };
    const mdLite = (s) => esc(String(s || ''))
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    let panel = null, sending = false, autoAsked = msgs.length > 0;

    function bubble(role, html, pending) {
      const box = panel.querySelector('.ask-msgs');
      const el = document.createElement('div');
      el.className = 'ask-msg ' + (role === 'user' ? 'user' : 'ai') + (pending ? ' pending' : '');
      el.innerHTML = (role === 'ai' ? '<span class="ask-gem sm">♦</span>' : '') + `<div class="ask-body">${html}</div>`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      return el;
    }
    async function send(q) {
      if (sending || !q) return;
      sending = true;
      msgs.push({ role: 'user', content: q });
      saveMsgs();
      bubble('user', esc(q));
      const wait = bubble('ai', '<span class="ask-dots"><i></i><i></i><i></i></span>', true);
      const inp = panel.querySelector('#ask-in');
      if (inp) { inp.value = ''; inp.focus(); }
      try {
        const r = await api('/api/ask', {
          method: 'POST', body: JSON.stringify({
            videoId: id, title: d.title || '', channel: d.channel?.name || '',
            description: d.description || '', question: q,
            history: msgs.slice(-9, -1),
          }),
        });
        wait.remove();
        msgs.push({ role: 'assistant', content: r.answer });
        saveMsgs();
        bubble('ai', mdLite(r.answer));
      } catch (e) {
        wait.remove();
        bubble('ai', esc(e.status === 429 ? e.message : '応答に失敗しました。少し待ってからもう一度お試しください。'));
      }
      sending = false;
    }
    function open() {
      if (panel) { panel.classList.add('open'); return; }
      const host = document.createElement('div');
      host.innerHTML = `
        <div class="ask-scrim" id="ask-scrim"></div>
        <div class="ask-panel open" id="ask-panel">
          <div class="ask-head">
            <span class="ask-gem">♦</span>
            <div class="ask-htx">
              <div class="ask-title">Ask</div>
              <div class="ask-sub">この動画の概要欄を読み込んで回答します</div>
            </div>
            <button class="icon-btn" id="ask-x" title="閉じる"><svg viewBox="0 0 24 24" class="ic"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
          </div>
          <div class="ask-msgs"></div>
          <div class="ask-chips">
            <button class="ask-chip" data-q="この動画の概要欄を3行で要約して">概要欄を要約</button>
            <button class="ask-chip" data-q="この動画の見どころを3つ教えて">見どころは？</button>
            <button class="ask-chip" data-q="概要欄のリンクやタイムスタンプを整理して">リンク・章を整理</button>
          </div>
          <form class="ask-form">
            <input id="ask-in" type="text" placeholder="この動画について質問…" autocomplete="off" maxlength="1000">
            <button class="ask-send" type="submit" title="送信" aria-label="送信"><svg viewBox="0 0 24 24" class="ic"><path d="M3 20v-6l8-2-8-2V4l19 8z"/></svg></button>
          </form>
          <div class="ask-foot">♦Ask by HavocPianoAI ・ Vandal</div>
        </div>`;
      app.appendChild(host);
      panel = host.querySelector('#ask-panel');
      host.querySelector('#ask-scrim').addEventListener('click', close);
      host.querySelector('#ask-x').addEventListener('click', close);
      host.querySelector('.ask-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = host.querySelector('#ask-in').value.trim();
        if (v) send(v);
      });
      host.querySelectorAll('.ask-chip').forEach(c => c.addEventListener('click', () => send(c.dataset.q)));
      for (const m of msgs) bubble(m.role, m.role === 'user' ? esc(m.content) : mdLite(m.content));
      if (!autoAsked) { autoAsked = true; send('この動画の概要欄を3行で要約して'); }
    }
    function close() {
      panel?.classList.remove('open');
      document.querySelector('#ask-scrim')?.classList.remove('open');
      panel?.closest('#app > div')?.remove?.(); // overlay ごと破棄（再オープンは再生成。msgs は sessionStorage で保持）
      panel = null;
    }
    btn.addEventListener('click', open);
    // ページ離脱時に掃除
    const obs = new MutationObserver(() => { if (!document.body.contains(btn)) { panel?.closest('#app > div')?.remove?.(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function loadComments(d) {
    const box = $('#comments');
    if (!box) return;
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
          <div id="cm-list">${(c.comments || []).map(commentHtml).join('')}</div>`;
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
          <span class="icon-btn cm-ico"><svg viewBox="0 0 24 24" class="ic"><path d="M2 21h4V9H2zM22 10c0-1.1-.9-2-2-2h-6.3l.9-4.6c0-.9-.8-1.5-.8-1.5L12.7 1 6.2 8.6C5.8 8.9 5 9.5 5 10v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg></span>
          <span class="cm-likes">${esc(cm.likes || '')}</span>
          <span class="icon-btn cm-ico"><svg viewBox="0 0 24 24" class="ic"><path d="M18 3h4v12h-4zM2 14c0 1.1.9 2 2 2h6.3l-.9 4.6c0 .9.8 1.5.8 1.5l1.1 1 6.5-6.5c.4-.4.6-.9.6-1.4V4.1c0-1.1-.9-2-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7z"/></svg></span>
          ${cm.replyCount ? `<span class="cm-reply">返信 ${esc(String(cm.replyCount))} 件</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  /* ---------------- YouTube-style playlist panel + auto-advance ---------------- */
  const ICON_LIST = '<svg viewBox="0 0 24 24" class="ic"><path d="M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-8v7.5a3 3 0 1 0 2 2.8V8h3V6z"/></svg>';
  const ICON_LOOP = '<svg viewBox="0 0 24 24" class="ic"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg>';
  const ICON_SHUFFLE = '<svg viewBox="0 0 24 24" class="ic"><path d="M10.6 9.2 8.9 7.5 4 7.5v2h4l1.7 1.7zm6.1 5.2-1.6 1.6-5.5-5.5 1.4-1.4 5.7 5.3zM14 4l4 4-4 4v-3c-4.95 0-7 3.5-8 8-.3-6 1.5-10 8-10z" opacity="0"/><path d="M14.1 7.4 10.6 3.9 14.1.4v2H18c3.3 0 6 2.7 6 6 0 1.6-.6 3-1.6 4.1l-1.4-1.4c.7-.8 1-1.7 1-2.7 0-2.2-1.8-4-4-4h-3.9zm-4.2 9.2 3.5 3.5-3.5 3.5v-2H6c-3.3 0-6-2.7-6-6 0-1.6.6-3 1.6-4.1l1.4 1.4c-.7.8-1 1.7-1 2.7 0 2.2 1.8 4 4 4h3.9z" transform="translate(-3 3)"/></svg>';
  const plState = { items: [], idx: -1, loop: false, shuffle: false, title: '', owner: '', total: 0 };

  /* プレイリスト文脈は sessionStorage 保存が一次情報源（即時・往復ゼロ・バグ耐性）。
   * 読み込み順: (1)ローカルスナップショット即描画 → (2)裏で完全版を取得して追従。 */
  const normPanelData = (p) => p?.items?.length ? {
    title: p.title || '', owner: p.owner || '', total: p.totalText || p.total || 0,
    items: p.items, continuation: p.continuation || null, usePanelNext: true,
  } : null;
  const normListData = (d) => d?.items?.length ? {
    title: d.title || '', owner: d.channelName || '', total: d.items.length,
    items: d.items, continuation: d.continuation || null, usePanelNext: !!d.panelNext,
  } : null;
  const normSnapData = (s) => s?.items?.length ? {
    title: s.title || '', owner: s.owner || '', total: s.total || 0,
    items: s.items, continuation: null, usePanelNext: true,
  } : null;

  let plCont = null, plUsePanelNext = true;

  function adoptPanel(n) {
    if (!n) return;
    plState.title = n.title || plState.title || '再生リスト';
    plState.owner = n.owner || plState.owner || '';
    plState.total = n.total || plState.total || 0;
    plState.items = n.items || plState.items;
    plCont = n.continuation ?? plCont;
    plUsePanelNext = !!n.usePanelNext;
    plState.idx = plState.items.findIndex(x => x.id === id);
  }

  async function setupPlaylistPanel(lid, currentVid, panelData, snapshot) {
    try {
      const seeded = !!(normPanelData(panelData) || normSnapData(snapshot));
      adoptPanel(normPanelData(panelData) || normSnapData(snapshot));
      if (!seeded) adoptPanel(normListData(await api('/api/playlist/' + encodeURIComponent(lid), { ttl: 10 * 60e3 })));
      if (destroyed || !document.body.contains(wrapEl)) return;
      const nextUrl = () => (plUsePanelNext ? '/api/playlist/panel-next?c=' : '/api/playlist/next?c=') + encodeURIComponent(plCont);
      // walk continuation pages until the current video shows up (max 3 more)
      let guard = 0;
      while (plState.idx < 0 && plCont && guard < 3) {
        guard++;
        const n = await api(nextUrl(), { ttl: 10 * 60e3 }).catch(() => null);
        if (!n) break;
        plCont = n.continuation;
        plState.items = plState.items.concat(n.items || []);
        plState.idx = plState.items.findIndex(x => x.id === currentVid);
      }
      // index unknown (huge list): treat as first
      if (plState.idx < 0) plState.items.unshift({ id: currentVid, title: document.title, thumb: '', channel: plState.owner, duration: '' }), plState.idx = 0;
      drawPanel();
      PlCtx.save(lid, { title: plState.title, owner: plState.owner, total: plState.total, items: plState.items });
      // auto-advance
      video.addEventListener('ended', () => advance(1));
      // スナップショット起点のときは、裏で完全版を取得して追従（タイトル/継続/残りの項目）
      if (snapshot && !panelData) {
        api('/api/playlist/' + encodeURIComponent(lid), { ttl: 10 * 60e3 }).then((full) => {
          if (destroyed) return;
          const n = normListData(full);
          if (!n) return;
          // ローカル保存済みの項目は信頼できるので、サーバー版が豊富なら差し替え
          if (n.items.length >= plState.items.length || !plState.title || plState.title === '再生リスト') {
            adoptPanel(n);
            if (plState.idx < 0) { plState.items.unshift({ id: currentVid, title: document.title, thumb: '', channel: plState.owner, duration: '' }); plState.idx = 0; }
            drawPanel();
            PlCtx.save(lid, { title: plState.title, owner: plState.owner, total: plState.total, items: plState.items });
          }
        }).catch(() => { /* snapshot stays */ });
      }
    } catch (_) { /* playlist panel is additive — never fatal */ }
  }

  /** watch 応答にパネルが同梱されていた場合の後追い更新 */
  function updatePlaylistPanel(panelData) {
    const n = normPanelData(panelData);
    if (!n) return;
    adoptPanel(n);
    if (plState.idx < 0) plState.idx = 0;
    drawPanel();
    PlCtx.save(listId, { title: plState.title, owner: plState.owner, total: plState.total, items: plState.items });
  }

  function drawPanel() {
    const rail = $('#rail');
    if (!rail) return;
    rail.querySelector('.plp')?.remove();
    const rows = plState.items.map((v, i) => `
      <div class="plp-item ${i === plState.idx ? 'active' : ''}" data-plgo="${i}">
        <span class="plp-idx">${i === plState.idx ? '<svg viewBox="0 0 24 24" class="ic" style="width:14px;height:14px"><path d="M8 5v14l11-7z"/></svg>' : (i + 1)}</span>
        <div class="vthumb"><img loading="lazy" src="${esc(v.thumb || ('https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'))}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
        <div class="vinfo"><div class="plp-tt">${esc(v.title || '')}</div><div class="vsub" style="font-size:12px">${esc(v.channel || '')}</div></div>
      </div>`).join('');
    const totalTxt = plState.total && Number(plState.total) > plState.items.length ? plState.total : plState.items.length;
    rail.insertAdjacentHTML('afterbegin', `
      <div class="plp">
        <div class="plp-head">
          <div class="plp-t1">
            <span class="plp-ic">${ICON_LIST}</span>
            <span class="plp-name">${esc(plState.title)}</span>
            <div class="plp-spacer"></div>
            <button class="icon-btn plp-btn ${plState.shuffle ? 'on' : ''}" data-plact="shuffle" title="シャッフル">${ICON_SHUFFLE}</button>
            <button class="icon-btn plp-btn ${plState.loop ? 'on' : ''}" data-plact="loop" title="ループ再生">${ICON_LOOP}</button>
            <button class="icon-btn plp-btn" data-plact="fold" title="折りたたむ"><svg viewBox="0 0 24 24" class="ic"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg></button>
          </div>
          <div class="plp-sub">${esc(plState.owner || '再生リスト')} ・ ${plState.idx + 1} / ${totalTxt}</div>
        </div>
        <div class="plp-items">${rows}</div>
      </div>`);
    const panel = rail.querySelector('.plp');
    panel.querySelectorAll('[data-plgo]').forEach(r => r.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +r.dataset.plgo;
      const v = plState.items[i];
      if (v) location.hash = '#/watch?v=' + v.id + '&list=' + encodeURIComponent(listId);
    }));
    panel.querySelectorAll('[data-plact]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = b.dataset.plact;
      if (act === 'loop') { plState.loop = !plState.loop; b.classList.toggle('on', plState.loop); }
      if (act === 'shuffle') { plState.shuffle = !plState.shuffle; b.classList.toggle('on', plState.shuffle); }
      if (act === 'fold') { panel.classList.toggle('folded'); b.querySelector('svg').style.transform = panel.classList.contains('folded') ? 'rotate(180deg)' : ''; }
    }));
    panel.querySelector('.plp-item.active')?.scrollIntoView({ block: 'center' });
  }

  function advance(step) {
    if (destroyed || !plState.items.length) return;
    let next;
    if (plState.shuffle) {
      do { next = Math.floor(Math.random() * plState.items.length); } while (plState.items.length > 1 && next === plState.idx);
    } else {
      next = plState.idx + step;
      if (next >= plState.items.length) {
        if (!plState.loop) return;
        next = 0;
      }
    }
    const v = plState.items[next];
    if (!v) return;
    toast('次の動画を再生: ' + (v.title || v.id).slice(0, 30), 1800);
    location.hash = '#/watch?v=' + v.id + '&list=' + encodeURIComponent(listId);
  }

  return { destroy() { cleanup(); } };

  function fillRail(d) {
    const rail = $('#rail');
    if (!rail) return;
    // 即時描画済みの再生リストパネルは生きたまま最上段に温存（イベントリスナごと）
    const plp = rail.querySelector('.plp');
    const vids = (d.related || []).filter(i => i.kind === 'video');
    const shorts = (d.related || []).filter(i => i.kind === 'short');
    rail.innerHTML =
      vids.slice(0, 6).map(railCard).join('') +
      (shorts.length ? shortsShelf(shorts, { compact: true }) : '') +
      vids.slice(6).map(railCard).join('');
    if (plp) rail.insertBefore(plp, rail.firstChild);
  }
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
      const shorts = vids.filter(v => v.kind === 'short');
      const longs = vids.filter(v => v.kind === 'video');
      const subbed0 = Subs.has(d.id);
      app.innerHTML = `
      <div class="ch-page">
        ${d.banner ? `<div class="ch-banner"><img src="${esc(d.banner)}" alt=""></div>` : ''}
        <div class="ch-head">
          <div class="big-ava">${d.avatar ? `<img src="${esc(d.avatar)}" alt="">` : ''}</div>
          <div style="min-width:0">
            <div class="ch-title">${esc(d.name || '')}</div>
            <div class="ch-meta"><span class="handle">${esc(d.handle || '')}</span>${d.subs ? ' • ' + esc(d.subs) : ''}${d.videos ? ' • ' + esc(d.videos) : ''}</div>
            <div class="ch-desc">${esc(d.description || '')}</div>
            <div style="margin-top:12px"><button class="sub-btn ${subbed0 ? 'subbed' : ''}" id="ch-sub">${subbed0 ? '登録済み' : 'チャンネル登録'}</button></div>
          </div>
        </div>
        <div class="ch-tabs">${tabsHtml}</div>
        <div id="ch-content">
          ${others.length ? `<div class="section-title" style="padding:16px 24px 0;font-size:16px;font-weight:600">作成した再生リスト</div><div class="grid">${others.map(playlistCard).join('')}</div>` : ''}
          ${shorts.length ? shortsShelf(shorts) : ''}
          <div class="grid">${longs.map(v => videoCard(v)).join('')}</div>
        </div>
      </div>`;
      $('#ch-sub')?.addEventListener('click', function () {
        const subbed = Subs.toggle({ id: d.id, name: d.name, avatar: d.avatar });
        this.classList.toggle('subbed', subbed);
        this.textContent = subbed ? '登録済み' : 'チャンネル登録';
        toast(subbed ? 'チャンネル登録しました（この端末に保存）' : '登録を解除しました');
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
      const allItems = [...(d.items || [])];
      // プレイリスト文脈をローカル保存（視聴ページはこれを一次情報源に即時描画）
      PlCtx.save(list, { title: d.title, owner: d.channelName, total: d.total || allItems.length, items: allItems });
      const rowHtml = (v, idx) => `
            <div class="pl-item" data-href="#/watch?v=${esc(v.id)}&list=${esc(list)}">
              <span class="idx">${idx}</span>
              <div class="vthumb"><img loading="lazy" src="${esc(thumbUrl(v))}" alt="">${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}</div>
              <div class="vinfo"><div class="vtitle">${esc(v.title)}</div><div class="vsub">${esc(v.channel || '')}</div></div>
            </div>`;
      app.innerHTML = `
      <div class="pl-page">
        <div class="pl-side">
          ${allItems[0] ? `<div class="pl-thumb"><img src="${esc(thumbUrl(allItems[0]))}" alt=""></div>` : ''}
          <h1>${esc(d.title || '再生リスト')}</h1>
          <div class="pl-meta">${esc(d.channelName || '')}<br>${d.views ? esc(d.views) + '<br>' : ''}${allItems.length} 本の動画${d.isInfinite ? '（ミックス）' : ''}</div>
        </div>
        <div id="pl-items">
          ${allItems.map((v, i) => rowHtml(v, i + 1)).join('')}
        </div>
      </div>`;
      if (d.continuation) {
        let cont = d.continuation, loading = false;
        // ミックス (panelNext=true) は browse 系ではなく next 系の続き読み込みへ正しく振り分け
        const nextBase = d.panelNext ? '/api/playlist/panel-next?c=' : '/api/playlist/next?c=';
        const box = $('#pl-items');
        let loaded = allItems.length; // 専用カウンタ（sentinel を件数に数えない）
        const sent = lazySentinel(box, () => {
          if (loading || !cont) return;
          loading = true;
          api(nextBase + encodeURIComponent(cont), { ttl: 10 * 60e3 })
            .then(n => {
              loading = false;
              const items = n.items || [];
              cont = n.continuation;
              if (!cont) sent.done();
              // sentinel 直前に挿入（構造の破壊・番号のズレを防ぐ）
              sent.el.insertAdjacentHTML('beforebegin', items.map((v, i) => rowHtml(v, loaded + i + 1)).join(''));
              loaded += items.length;
              allItems.push(...items);
              PlCtx.save(list, { title: d.title, owner: d.channelName, total: loaded, items: allItems });
            })
            .catch(() => { loading = false; });
        });
      }
    })
    .catch(e => errBox('再生リストを読み込めませんでした: ' + e.message, () => renderPlaylist(params)));
}

/* ================================================================== SHORTS */
const SHORT_CHIPS = [['おすすめ', null], ['おもしろ', 'ショート おもしろ'], ['音楽', 'ショート 音楽'], ['動物', 'ショート かわいい 動物'], ['ゲーム', 'ショート ゲーム'], ['コント', 'コント ショート']];

function renderShortsHome(chip = 0) {
  setActiveNav('shorts');
  app.innerHTML = `
    <div class="chips">${SHORT_CHIPS.map(([label], i) =>
      `<button class="chip ${i === chip ? 'active' : ''}" data-sc="${i}">${label}</button>`).join('')}
    </div>
    <div id="shorts-body"><div class="sec-title">ショート</div>${skGrid(10)}</div>`;
  $$('#app [data-sc]').forEach(b => b.addEventListener('click', () => renderShortsHome(+b.dataset.sc)));
  const body = $('#shorts-body');
  const draw = (shorts, title) => {
    if (!document.body.contains(body)) return;
    if (!shorts.length) { body.innerHTML = `<div class="sec-title">${esc(title)}</div><div class="empty-state"><h1>ショート動画が見つかりません</h1></div>`; return; }
    body.innerHTML = `<div class="sec-title">${esc(title)}</div><div class="shorts-grid">${shorts.map(shortCard).join('')}</div>`;
  };
  const q = SHORT_CHIPS[chip][1];
  if (!q) {
    api('/api/shorts', { ttl: 15 * 60e3 })
      .then(d => draw(d.items || [], 'ショート'))
      .catch(() => errBox('読み込めませんでした', () => renderShortsHome(chip)));
  } else {
    Promise.allSettled([api('/api/search?q=' + encodeURIComponent(q), { ttl: 15 * 60e3 }), api('/api/shorts', { ttl: 15 * 60e3 })])
      .then(([s, base]) => {
        const shorts = (s.status === 'fulfilled' ? s.value.items : []).filter(i => i.kind === 'short');
        const feed = base.status === 'fulfilled' ? base.value.items : [];
        const merged = []; const seen = new Set();
        for (const it of [...shorts, ...feed]) { if (!seen.has(it.id)) { seen.add(it.id); merged.push(it); } }
        draw(merged, 'ショート');
      });
  }
}

/* ---------------- dedicated Shorts player (本家ショート風・全画面縦型) --------
 * 下スクロール / スワイプ / ↓キーで次のショートへ移行。キューはクリック元の
 * シェルフから sessionStorage 経由で引き継ぎ、末尾近くでフィードを自動補充。 */
function renderShort(firstId) {
  setActiveNav('shorts');
  document.documentElement.classList.add('sh-lock');

  let q = shqLoad() || { ids: [], meta: {} };
  if (!q.ids.includes(firstId)) { q.ids.unshift(firstId); }
  let idx = q.ids.indexOf(firstId);
  let destroyed = false;
  let navCool = 0;
  let watchData = null;
  let rescuedFor = null; // 動画ごと1回だけのストリーム復旧

  app.innerHTML = `
  <div class="shp" id="shp">
    <div class="shp-stage" id="shp-stage">
      <video class="shp-video" id="shp-video" playsinline autoplay preload="auto"></video>
      <div class="shp-spin" data-sh-spin><div class="mini-spin light"></div></div>
      <div class="shp-grad"></div>
      <div class="shp-info">
        <div class="shp-title" id="shp-title"></div>
        <div class="shp-ch">
          <div class="shp-ava" id="shp-ava"></div>
          <span class="shp-chname" id="shp-chname"></span>
          <button class="shp-sub" id="shp-sub">登録</button>
        </div>
      </div>
      <div class="shp-progress"><div class="shp-bar" id="shp-bar"></div></div>
      <div class="shp-rail" id="shp-rail">
        <button class="shp-act" data-sh="like" title="高く評価"><svg viewBox="0 0 24 24" class="ic"><path d="M2 21h4V9H2zM22 10c0-1.1-.9-2-2-2h-6.3l.9-4.6c0-.9-.8-1.5-.8-1.5L12.7 1 6.2 8.6C5.8 8.9 5 9.5 5 10v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z"/></svg><span id="shp-likes"></span></button>
        <button class="shp-act" data-sh="comments" title="コメント"><svg viewBox="0 0 24 24" class="ic"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg><span id="shp-cmcount"></span></button>
        <button class="shp-act" data-sh="share" title="共有"><svg viewBox="0 0 24 24" class="ic"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg><span>共有</span></button>
        <button class="shp-act" data-sh="save" title="保存"><svg viewBox="0 0 24 24" class="ic"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-5 7 5V5a2 2 0 0 0-2-2z"/></svg><span>保存</span></button>
        <button class="shp-act" data-sh="open" title="通常プレイヤーで開く"><svg viewBox="0 0 24 24" class="ic"><path d="M4 4h7v2H6v12h12v-5h2v7H4zM14 4h6v6h-2V7.4l-6.3 6.3-1.4-1.4L16.6 6H14z"/></svg><span>詳細</span></button>
      </div>
    </div>
    <div class="shp-navs">
      <button class="shp-nav" id="shp-prev" title="前の動画 (↑)"><svg viewBox="0 0 24 24" class="ic"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg></button>
      <button class="shp-nav" id="shp-next" title="次の動画 (↓)"><svg viewBox="0 0 24 24" class="ic"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg></button>
    </div>
  </div>`;

  const video = $('#shp-video');
  const stage = $('#shp-stage');
  const spin = () => { const s = stage.querySelector('[data-sh-spin]'); return s; };
  const showSpin = (on) => spin()?.classList.toggle('hidden', !on);

  function entry() {
    const id = q.ids[idx];
    const m = (q.meta || {})[id] || {};
    return { v: id, t: watchData?.title || m.title || '', cn: watchData?.channel?.name || '', ch: watchData?.channel?.id || '', d: watchData?.lengthSeconds || 0 };
  }

  async function loadCurrent(animate) {
    const id = q.ids[idx];
    if (!id) return;
    watchData = null;
    rescuedFor = null;
    history.replaceState(null, '', '#/shorts/' + id);
    const m = (q.meta || {})[id] || {};
    $('#shp-title').textContent = m.title || '';
    $('#shp-chname').textContent = '';
    $('#shp-ava').innerHTML = '';
    $('#shp-likes').textContent = '';
    $('#shp-cmcount').textContent = '';
    showSpin(true);
    try {
      video.removeAttribute('src'); video.load();
      video.src = `/api/stream?v=${id}&itag=18`;
      video.muted = false;
      await video.play().catch(() => { video.muted = true; return video.play().catch(() => {}); });
      document.title = (m.title || 'ショート') + ' - Vandal';
    } catch (_) { /* watchdog below covers */ }
    // メタは裏で充填（タイトル/チャンネル/高評価数/コメント数）
    api('/api/watch/' + id, { ttl: 3 * 60e3 }).then((d) => {
      if (destroyed || q.ids[idx] !== id) return;
      watchData = d;
      $('#shp-title').textContent = d.title || m.title || '';
      $('#shp-chname').textContent = d.channel?.name || '';
      $('#shp-ava').innerHTML = d.channel?.avatar ? `<img src="${esc(d.channel.avatar)}" alt="">` : '';
      $('#shp-likes').textContent = d.likeCount || '';
      $('#shp-cmcount').textContent = d.commentsCount || '';
      document.title = (d.title || 'ショート') + ' - Vandal';
      const subbed = Subs.has(d.channel?.id);
      const sb = $('#shp-sub');
      if (sb) { sb.textContent = subbed ? '登録済み' : '登録'; sb.classList.toggle('subbed', !!subbed); }
    }).catch(() => {});
    History.add(entry());
    // 次の1本を温める（スクロールした瞬間に再生が始まるように）
    const nx = q.ids[idx + 1];
    if (nx) { fetch('/api/warm/' + nx).catch(() => {}); api('/api/watch/' + nx).catch(() => {}); }
    // 末尾接近: フィードでキューを自動補充
    if (idx + 3 >= q.ids.length) refill();
    if (animate) {
      stage.animate([{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
  }

  let refilling = false;
  async function refill() {
    if (refilling) return;
    refilling = true;
    try {
      const d = await api('/api/shorts', { ttl: 15 * 60e3 });
      const fresh = (d.items || []).map(i => i.id).filter(v => /^[\w-]{11}$/.test(v || ''));
      const seen = new Set(q.ids);
      for (const id of fresh) if (!seen.has(id)) { seen.add(id); q.ids.push(id); }
      for (const it of d.items || []) if (it.id && !q.meta[it.id]) q.meta[it.id] = { title: it.title || '', views: it.views || '' };
      shqSave(q.ids, q.meta);
    } catch (_) { /* additive */ }
    refilling = false;
  }

  function nav(step) {
    const now = Date.now();
    if (now - navCool < 420) return;
    const n = idx + step;
    if (n < 0 || n >= q.ids.length) {
      if (n >= q.ids.length) refill();
      return;
    }
    navCool = now;
    idx = n;
    stage.animate(
      [{ transform: `translateY(0)`, opacity: 1 }, { transform: `translateY(${step > 0 ? -26 : 26}px)`, opacity: 0 }],
      { duration: 130, easing: 'ease-in' });
    setTimeout(() => { if (!destroyed) loadCurrent(true); }, 120);
  }

  video.addEventListener('playing', () => showSpin(false));
  video.addEventListener('waiting', () => showSpin(true));
  video.addEventListener('ended', () => nav(1));
  video.addEventListener('click', () => { video.paused ? video.play().catch(() => {}) : video.pause(); });
  video.addEventListener('timeupdate', () => {
    const bar = $('#shp-bar');
    if (bar && video.duration) bar.style.width = ((video.currentTime / video.duration) * 100).toFixed(2) + '%';
  });
  video.addEventListener('error', async () => {
    const id = q.ids[idx];
    if (!id || rescuedFor === id) return;
    rescuedFor = id;
    showSpin(true);
    await api('/api/player/refresh', { method: 'POST', body: JSON.stringify({ v: id }) }).catch(() => null);
    if (destroyed || q.ids[idx] !== id) return;
    api.invalidate('/api/watch/' + id);
    video.src = `/api/stream?v=${id}&itag=18&_=${Date.now()}`;
    video.play().catch(() => {});
  });

  // wheel / touch / keyboard navigation
  const onWheel = (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 32) return;
    nav(e.deltaY > 0 ? 1 : -1);
  };
  let tsY = null;
  const onTs = (e) => { tsY = e.touches[0].clientY; };
  const onTe = (e) => {
    if (tsY == null) return;
    const dy = tsY - e.changedTouches[0].clientY;
    tsY = null;
    if (Math.abs(dy) > 52) nav(dy > 0 ? 1 : -1);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nav(-1); }
  };
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('touchstart', onTs, { passive: true });
  stage.addEventListener('touchend', onTe, { passive: true });
  document.addEventListener('keydown', onKey);

  $('#shp-prev').addEventListener('click', () => nav(-1));
  $('#shp-next').addEventListener('click', () => nav(1));
  $('#shp-rail').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sh]');
    if (!b) return;
    const act = b.dataset.sh;
    const en = entry();
    if (act === 'like') {
      const liked = Likes.toggle(en);
      b.classList.toggle('on', liked);
      toast(liked ? '高く評価しました（この端末に保存）' : '取り消しました');
    } else if (act === 'comments') {
      location.hash = '#/watch?v=' + en.v;
    } else if (act === 'share') {
      const url = location.origin + location.pathname + '#/shorts/' + en.v;
      try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch (_) { toast(url, 6000); }
    } else if (act === 'save') {
      const saved = Saves.toggle(en);
      b.classList.toggle('on', saved);
      toast(saved ? '保存しました（この端末に保存）' : '取り消しました');
    } else if (act === 'open') {
      location.hash = '#/watch?v=' + en.v;
    }
  });
  $('#shp-sub').addEventListener('click', function () {
    const ch = watchData?.channel;
    if (!ch?.id) return;
    const subbed = Subs.toggle({ id: ch.id, name: ch.name, avatar: ch.avatar });
    this.textContent = subbed ? '登録済み' : '登録';
    this.classList.toggle('subbed', subbed);
    toast(subbed ? 'チャンネル登録しました（この端末に保存）' : '登録を解除しました');
  });
  // ローカル保存状態の初期反映
  $('#shp-rail [data-sh="like"]').classList.toggle('on', false);
  app.querySelector('[data-sh="like"]')?.classList.toggle('on', Likes.has(q.ids[idx]));
  app.querySelector('[data-sh="save"]')?.classList.toggle('on', Saves.has(q.ids[idx]));

  loadCurrent(false);

  return { destroy() {
    destroyed = true;
    document.documentElement.classList.remove('sh-lock');
    document.removeEventListener('keydown', onKey);
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) { /* noop */ }
  } };
}

/* ================================================================= MY PAGE */
function renderMyPage() {
  setActiveNav('you');
  const hist = History.list();
  const likes = Likes.list();
  const saves = Saves.list();
  const subs = Subs.list();
  if (!hist.length && !likes.length && !saves.length && !subs.length) {
    app.innerHTML = nudgeHtml('まずは検索してみましょう', '視聴履歴・高く評価した動画・保存した動画がここに表示されます。');
    return;
  }
  app.innerHTML = `
    <div class="mypage">
      <h1 class="mp-title">マイページ</h1>
      ${subs.length ? `
        <div class="mp-sec-h">登録チャンネル</div>
        <div class="subs-avatars">
          ${subs.map(s => `<a class="subs-av" href="#/channel/${esc(s.id)}">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : '<div class="sk" style="width:100%;height:100%;border-radius:50%"></div>'}<span>${esc(s.name || '')}</span></a>`).join('')}
        </div>` : ''}
      <div class="mp-sec-h">履歴 ${hist.length ? `<button class="mp-clear" id="hist-clear">履歴をすべて削除</button>` : ''}</div>
      ${hist.length ? `<div class="grid">${hist.slice(0, 12).map(h => storedCard(h, { onRemove: true })).join('')}</div>`
        : '<p class="mp-empty">履歴はまだありません。</p>'}
      <div class="mp-sec-h">高く評価した動画</div>
      ${likes.length ? `<div class="grid">${likes.slice(0, 12).map(h => storedCard(h)).join('')}</div>`
        : '<p class="mp-empty">高く評価した動画はまだありません。</p>'}
      <div class="mp-sec-h">保存した動画</div>
      ${saves.length ? `<div class="grid">${saves.slice(0, 12).map(h => storedCard(h)).join('')}</div>`
        : '<p class="mp-empty">保存した動画はまだありません。</p>'}
    </div>`;
  $('#hist-clear')?.addEventListener('click', () => {
    History.clear();
    toast('履歴を削除しました');
    renderMyPage();
  });
}

/* ========================================================== SUBSCRIPTIONS */
function renderSubscriptions() {
  setActiveNav('subs');
  const subs = Subs.list();
  if (!subs.length) {
    app.innerHTML = nudgeHtml(
      '最新の動画をチェック',
      'チャンネルを登録すると、そのチャンネルの最新動画がここに表示されます。まずは検索してチャンネルを登録しましょう。',
      '<svg viewBox="0 0 24 24"><path d="M4 5h16v2H4zm0 4h16v2H4zm0 4h16v2H4zm0 4h10v2H4z"/></svg>'
    );
    return;
  }
  app.innerHTML = `
    <div class="mypage">
      <h1 class="mp-title">最新動画</h1>
      <div class="subs-avatars">
        ${subs.map(s => `<a class="subs-av" href="#/channel/${esc(s.id)}">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : '<div class="sk" style="width:100%;height:100%;border-radius:50%"></div>'}<span>${esc(s.name || '')}</span></a>`).join('')}
      </div>
      <div id="subs-feed"><div class="mini-spin"></div></div>
    </div>`;
  const feed = $('#subs-feed');
  const channels = subs.slice(0, 4);
  channels.forEach((s) => {
    api('/api/channel/' + encodeURIComponent(s.id), { ttl: 8 * 60e3 })
      .then(d => {
        if (!document.body.contains(feed)) return;
        feed.querySelector('.mini-spin')?.remove();
        const vids = (d.items || []).filter(i => i.kind === 'video').slice(0, 8);
        const shorts = (d.items || []).filter(i => i.kind === 'short').slice(0, 8);
        const sec = document.createElement('div');
        sec.innerHTML =
          `<div class="mp-sec-h" style="padding-left:0">${esc(d.name || s.name || '')}</div>` +
          (vids.length ? `<div class="grid">${vids.map(v => videoCard(v)).join('')}</div>` : '') +
          (shorts.length ? shortsShelf(shorts) : '') +
          (!vids.length && !shorts.length ? '<p class="mp-empty">動画が見つかりませんでした。</p>' : '');
        feed.appendChild(sec);
      })
      .catch(() => {
        if (!document.body.contains(feed)) return;
        feed.querySelector('.mini-spin')?.remove();
      });
  });
}

/* routes */
route(/^\/$/, () => renderHome());
route(/^\/results$/, (params) => renderResults(params));
route(/^\/watch$/, (params) => renderWatch(params));
route(/^\/channel\/(.+)$/, (id, params) => renderChannel(id, params));
route(/^\/playlist$/, (params) => renderPlaylist(params));
route(/^\/shorts$/, () => renderShortsHome());
route(/^\/shorts\/([\w-]{11})$/, (id) => renderShort(id));
route(/^\/feed\/subscriptions$/, () => renderSubscriptions());
route(/^\/feed\/you$/, () => renderMyPage());

/* ------------------------------------------------------------ masthead wire */
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) {
    Searches.add(q);
    location.hash = '/results?search_query=' + encodeURIComponent(q);
  }
  $('#suggest').classList.add('hidden');
});

const sInput = $('#search-input');
const sBox = $('#suggest');
let sgItems = [], sgIndex = -1;
const doSuggest = debounce(async () => {
  const q = sInput.value.trim();
  if (!q) {
    // empty query: surface recent searches like YouTube does
    const recent = Searches.list().slice(0, 8);
    if (!recent.length || document.activeElement !== sInput) { sBox.classList.add('hidden'); return; }
    sgItems = recent; sgIndex = -1;
    sBox.innerHTML = sgItems.map((s, i) => `
      <div class="sg" data-i="${i}">
        <svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 1 0 .9 18H13v-2h.1A7 7 0 1 1 13 5v3l4.5-4L13 0zM12 7v5l4.2 2.5.8-1.2-3.5-2V7z" fill="currentColor"/></svg>
        <span>${esc(s)}</span>
      </div>`).join('');
    sBox.classList.remove('hidden');
    wireSgPicks();
    return;
  }
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
    wireSgPicks();
  } catch (_) { /* suggestions optional */ }
}, 180);
function wireSgPicks() {
  $$('.sg', sBox).forEach(n => n.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const pick = sgItems[+n.dataset.i];
    sInput.value = pick;
    sBox.classList.add('hidden');
    Searches.add(pick);
    location.hash = '/results?search_query=' + encodeURIComponent(pick);
  }));
}
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
console.log('%c Vandal %c Made by Kakinie with llytpr-wl.v01nh TEAM. V1 ', 'background:#ff5a1e;color:#fff;border-radius:4px;padding:2px 6px;font-weight:800', 'color:#888');
render();

})();
