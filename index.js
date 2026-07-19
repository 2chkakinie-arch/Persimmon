// ============================================================
//  Persimmon — 柿Tube (YouTube frontend) + WebUnblocker host
//  Author: Genspark for user
//  All pages except /home.html live inline here as regex routes.
// ============================================================

const express  = require('express');
const path     = require('path');
const ytsr     = require('youtube-search-api');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ---------- API base fallback ---------- */
const API_BASES = [
  'https://orby-api.vercel.app',
  'https://orby-api.onrender.com'
];
async function orby(pathAndQuery){
  let lastErr;
  for(const base of API_BASES){
    try{
      const r = await fetch(base + pathAndQuery, { headers:{ 'accept':'application/json' } });
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('All Orby API bases failed');
}

/* ---------- Static: only /home.html + /img + /embed.html live in /public ---------- */
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

/* ============================================================
   SHARED HTML — layout, header, styles, client bootstrap
   ============================================================ */
const SHARED_HEAD = /*html*/`
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="icon" href="/img/kaki.png">
<style>
:root{
  --bg-0:#0a0a0d; --bg-1:#111116; --bg-2:#1a1a22; --bg-3:#22222c;
  --fg-0:#f5f5f7; --fg-1:#a8a8b3; --fg-2:#6b6b78;
  --accent:#ff7a3d; --accent-2:#ff9a5a; --accent-glow:rgba(255,122,61,.35);
  --line:rgba(255,255,255,.08);
  --radius:16px;
  --ease:cubic-bezier(.22,1,.36,1);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg-0);color:var(--fg-0);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue","Hiragino Sans","Noto Sans JP",sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%}
button{font-family:inherit;cursor:pointer;border:0;background:none;color:inherit}
input,select{font-family:inherit}
::selection{background:var(--accent);color:#1a0e05}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2a2a35;border-radius:10px}
::-webkit-scrollbar-thumb:hover{background:#3a3a48}

/* Header */
.hdr{
  position:sticky;top:0;z-index:50;
  display:flex;align-items:center;gap:24px;
  padding:14px 28px;
  background:rgba(10,10,13,.75);
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-bottom:1px solid var(--line);
}
.hdr .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:-.02em}
.hdr .brand img{width:32px;height:32px;filter:drop-shadow(0 4px 12px var(--accent-glow))}
.hdr .brand span{background:linear-gradient(135deg,#fff,var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hdr form{flex:1;max-width:640px;margin:0 auto}
.hdr .sbox{
  display:flex;align-items:center;
  background:var(--bg-2);border:1px solid var(--line);
  border-radius:999px;padding:4px 4px 4px 20px;
  transition:all .3s var(--ease);
}
.hdr .sbox:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}
.hdr .sbox input{flex:1;background:transparent;border:0;outline:0;color:var(--fg-0);padding:12px 12px;font-size:14px}
.hdr .sbox button{
  background:linear-gradient(135deg,var(--accent),var(--accent-2));
  color:#1a0e05;border-radius:999px;padding:10px 18px;font-weight:600;font-size:13px;
  display:flex;align-items:center;gap:6px;transition:transform .25s var(--ease);
}
.hdr .sbox button:hover{transform:translateY(-1px)}
.hdr .home-link{
  color:var(--fg-1);font-size:13px;padding:8px 14px;border-radius:10px;
  transition:all .25s var(--ease);
}
.hdr .home-link:hover{background:var(--bg-2);color:var(--fg-0)}

main{max-width:1400px;margin:0 auto;padding:28px}

/* Card / Skeleton */
.skl{background:linear-gradient(90deg,#1a1a22 0%,#22222c 50%,#1a1a22 100%);
  background-size:200% 100%;animation:shimmer 1.5s linear infinite;border-radius:12px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* Toast */
.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
  background:var(--bg-2);border:1px solid var(--line);
  padding:12px 20px;border-radius:12px;font-size:14px;
  box-shadow:0 20px 60px rgba(0,0,0,.5);
  opacity:0;transition:all .4s var(--ease);z-index:1000;
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* Page fade */
main{animation:fadein .5s var(--ease) both}
@keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
</style>
`;

const SHARED_HEADER = /*html*/`
<div class="hdr">
  <a href="/" class="brand">
    <img src="/img/kaki.png" alt="柿" onerror="this.style.display='none'">
    <span>柿Tube</span>
  </a>
  <form onsubmit="event.preventDefault();const v=this.q.value.trim();if(!v)return;const m=v.match(/(?:youtu\\.be\\/|v=|shorts\\/)([A-Za-z0-9_-]{11})/);location.href=m?'/watch?v='+m[1]:'/search?q='+encodeURIComponent(v);">
    <div class="sbox">
      <input name="q" placeholder="動画・チャンネルを検索…" autocomplete="off">
      <button type="submit">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        検索
      </button>
    </div>
  </form>
  <a href="/" class="home-link">Home</a>
</div>
`;

const SHARED_TOAST_JS = /*js*/`
function toast(msg){
  let t = document.querySelector('.toast');
  if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);}
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(()=>t.classList.remove('show'), 2600);
}
function fmtViews(n){
  n = Number(n)||0;
  if(n>=1e8) return (n/1e8).toFixed(1)+'億';
  if(n>=1e4) return (n/1e4).toFixed(1)+'万';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}
function fmtDur(sec){
  sec = Number(sec)||0;
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=Math.floor(sec%60);
  return h ? h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')
           : m+':'+String(s).padStart(2,'0');
}
function timeAgo(iso){
  if(!iso) return '';
  const d = new Date(iso); if(isNaN(d)) return iso;
  const s = (Date.now()-d.getTime())/1000;
  if(s<60) return '数秒前';
  if(s<3600) return Math.floor(s/60)+'分前';
  if(s<86400) return Math.floor(s/3600)+'時間前';
  if(s<2592000) return Math.floor(s/86400)+'日前';
  if(s<31536000) return Math.floor(s/2592000)+'ヶ月前';
  return Math.floor(s/31536000)+'年前';
}
`;

/* ============================================================
   ROUTES
   ============================================================ */

// ---------- Home ----------
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// ---------- Suggest (uses youtube-search-api under the hood) ----------
app.get(/^\/api\/suggest$/, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if(!q) return res.json([]);
  try{
    const r = await ytsr.GetListByKeyword(q, false, 10, [{type:'video'}]);
    const titles = (r.items||[]).map(i=>i.title).filter(Boolean);
    res.json([...new Set(titles)].slice(0,8));
  }catch(e){ res.json([]); }
});

// ---------- Search API (youtube-search-api, richer result w/ channel) ----------
app.get(/^\/api\/search$/, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if(!q) return res.json({ items:[] });
  try{
    const r = await ytsr.GetListByKeyword(q, false, 30, [{type:'video'},{type:'channel'}]);
    res.json(r);
  }catch(e){
    res.status(500).json({ error:e.message });
  }
});

// ---------- Channel resolve by name (used by watch page for avatar) ----------
app.get(/^\/api\/resolve-channel$/, async (req, res) => {
  const name = String(req.query.name || '').trim();
  if(!name) return res.json({});
  try{
    const r = await ytsr.GetListByKeyword(name, false, 8, [{type:'channel'}]);
    const items = (r.items||[]).filter(i => (i.type==='channel'));
    // Try exact match, else fallback to first
    const exact = items.find(i => (i.title||i.name||'').toLowerCase() === name.toLowerCase());
    const pick = exact || items[0];
    if(!pick) return res.json({});
    const thumbs = pick.thumbnail && (pick.thumbnail.thumbnails || pick.thumbnail);
    const url = Array.isArray(thumbs) ? (thumbs[thumbs.length-1]?.url || thumbs[0]?.url) : (thumbs?.url || null);
    res.json({
      channelId: pick.id || pick.channelId,
      name: pick.title || pick.name,
      avatar: url ? (url.startsWith('//') ? 'https:'+url : url) : null
    });
  }catch(e){ res.json({}); }
});

// ---------- Channel videos via youtube-search-api ----------
app.get(/^\/api\/channel-videos$/, async (req, res) => {
  const name = String(req.query.name || '').trim();
  if(!name) return res.json({ items:[] });
  try{
    const r = await ytsr.GetListByKeyword(name + ' チャンネル', false, 30, [{type:'video'}]);
    res.json(r);
  }catch(e){ res.json({ items:[] }); }
});

// ---------- Meta / Comments / Channel / Recommend / Stream (proxy to Orby) ----------
async function proxyOrby(res, pathAndQuery){
  try{
    const data = await orby(pathAndQuery);
    res.json(data);
  }catch(e){ res.status(502).json({ error:e.message }); }
}
app.get(/^\/api\/meta\/([\w-]{11})$/,    (req,res)=>proxyOrby(res, `/orby/yt/meta/${req.params[0]}`));
app.get(/^\/api\/comments\/([\w-]{11})$/,(req,res)=>{
  const page = req.query.page ? `?page=${encodeURIComponent(req.query.page)}` : '';
  proxyOrby(res, `/orby/yt/comments/${req.params[0]}${page}`);
});
app.get(/^\/api\/channel\/(UC[\w-]{22})$/,(req,res)=>proxyOrby(res, `/orby/yt/channel/${req.params[0]}`));
app.get(/^\/api\/recommend\/([\w-]{11})$/,(req,res)=>proxyOrby(res, `/orby/yt/recommend/${req.params[0]}`));
app.get(/^\/api\/streams\/([\w-]{11})$/,  (req,res)=>proxyOrby(res, `/orby/yt/${req.params[0]}?format=json&provider=Orby-MAX`));

/* ============================================================
   /search  — 検索結果ページ
   ============================================================ */
app.get(/^\/search$/, (req, res) => {
  const q = String(req.query.q || '');
  res.send(`<!DOCTYPE html><html lang="ja"><head><title>${escapeHtml(q)} — 柿Tube</title>${SHARED_HEAD}
<style>
.results{display:flex;flex-direction:column;gap:20px;max-width:960px;margin:0 auto}
.result{display:flex;gap:20px;padding:14px;border-radius:16px;transition:all .3s var(--ease)}
.result:hover{background:var(--bg-1);transform:translateX(4px)}
.result .thumb{position:relative;width:340px;aspect-ratio:16/9;flex-shrink:0;border-radius:12px;overflow:hidden;background:var(--bg-2)}
.result .thumb img{width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease)}
.result:hover .thumb img{transform:scale(1.06)}
.result .dur{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.85);padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}
.result .live{position:absolute;top:8px;left:8px;background:#e53935;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.05em}
.result .info{flex:1;min-width:0}
.result h3{font-size:18px;font-weight:600;line-height:1.35;margin-bottom:8px;color:var(--fg-0)}
.result .meta{color:var(--fg-1);font-size:13px;margin-bottom:12px}
.result .ch{display:flex;align-items:center;gap:8px;color:var(--fg-1);font-size:13px}
.result .ch img{width:24px;height:24px;border-radius:50%;object-fit:cover;background:var(--bg-2)}
.result .ch:hover{color:var(--fg-0)}
.channel-card{display:flex;align-items:center;gap:20px;padding:20px;background:var(--bg-1);border:1px solid var(--line);border-radius:16px}
.channel-card img{width:120px;height:120px;border-radius:50%;object-fit:cover;background:var(--bg-2)}
.channel-card h3{font-size:22px;margin-bottom:6px}
.channel-card .sub{color:var(--fg-1);font-size:13px}
.head{margin-bottom:24px;display:flex;align-items:baseline;gap:12px}
.head h2{font-size:22px;font-weight:600}
.head .count{color:var(--fg-1);font-size:14px}
.skl-row{display:flex;gap:20px;padding:14px}
.skl-row .thumb{width:340px;aspect-ratio:16/9;flex-shrink:0}
.skl-row .lines{flex:1;display:flex;flex-direction:column;gap:10px}
.skl-row .lines .l{height:16px;border-radius:8px}
.empty{padding:60px;text-align:center;color:var(--fg-1)}
@media(max-width:800px){.result{flex-direction:column}.result .thumb{width:100%}}
</style></head><body>
${SHARED_HEADER}
<main>
  <div class="head"><h2>検索結果</h2><span class="count">「${escapeHtml(q)}」</span></div>
  <div class="results" id="list">
    ${Array(6).fill(0).map(()=>`
      <div class="skl-row">
        <div class="thumb skl"></div>
        <div class="lines">
          <div class="l skl" style="width:80%"></div>
          <div class="l skl" style="width:40%"></div>
          <div class="l skl" style="width:60%"></div>
        </div>
      </div>`).join('')}
  </div>
</main>
<script>
${SHARED_TOAST_JS}
const q = ${JSON.stringify(q)};
(async()=>{
  const list = document.getElementById('list');
  try{
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const data = await r.json();
    const items = (data.items||[]).filter(i=>i.id||i.channelId);
    if(!items.length){ list.innerHTML = '<div class="empty">結果が見つかりませんでした</div>'; return; }
    list.innerHTML = items.map(it=>{
      if(it.type === 'channel'){
        const th = it.thumbnail?.thumbnails || it.thumbnail || [];
        const av = Array.isArray(th) ? (th[th.length-1]?.url || '') : (th.url||'');
        const url = av && av.startsWith('//') ? 'https:'+av : av;
        return \`
          <a href="/channel/\${it.id}" class="channel-card">
            <img src="\${url}" onerror="this.style.visibility='hidden'">
            <div>
              <h3>\${escapeHtml(it.title||it.name||'')}</h3>
              <div class="sub">チャンネル</div>
            </div>
          </a>\`;
      }
      const th = it.thumbnail?.thumbnails || [];
      const thumb = th[th.length-1]?.url || '';
      const dur = it.length?.simpleText || (it.isLive?'LIVE':'');
      const views = it.viewCount || (it.videoInfo?.text) || '';
      const pub = it.publishedTime || '';
      const chName = it.channelTitle || it.shortBylineText?.runs?.[0]?.text || '';
      return \`
        <div class="result">
          <a class="thumb" href="/watch?v=\${it.id}">
            <img src="\${thumb}" loading="lazy">
            \${it.isLive ? '<span class="live">LIVE</span>' : ''}
            \${dur && !it.isLive ? '<span class="dur">'+escapeHtml(dur)+'</span>' : ''}
          </a>
          <div class="info">
            <a href="/watch?v=\${it.id}"><h3>\${escapeHtml(it.title||'')}</h3></a>
            <div class="meta">\${escapeHtml(views)}\${views&&pub?' · ':''}\${escapeHtml(pub)}</div>
            <a class="ch" href="/search?q=\${encodeURIComponent(chName)}">
              <span>\${escapeHtml(chName)}</span>
            </a>
          </div>
        </div>\`;
    }).join('');
  }catch(e){
    list.innerHTML = '<div class="empty">読み込みに失敗しました: '+e.message+'</div>';
  }
})();
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
</script>
</body></html>`);
});

/* ============================================================
   /watch  — 動画ページ
   ============================================================ */
app.get(/^\/watch$/, (req, res) => {
  const v = String(req.query.v || '').trim();
  if(!/^[A-Za-z0-9_-]{11}$/.test(v)) return res.redirect('/');
  res.send(`<!DOCTYPE html><html lang="ja"><head><title>再生中 — 柿Tube</title>${SHARED_HEAD}
<style>
.watch{display:grid;grid-template-columns:1fr 380px;gap:32px}
@media(max-width:1100px){.watch{grid-template-columns:1fr}}
.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)}
video{width:100%;height:100%;background:#000;object-fit:contain}
.player-status{position:absolute;top:16px;left:16px;background:rgba(0,0,0,.7);padding:6px 12px;border-radius:20px;font-size:12px;color:var(--fg-1);display:flex;align-items:center;gap:8px;pointer-events:none;opacity:0;transition:opacity .3s}
.player-status.show{opacity:1}
.player-status .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.quality-btn{position:absolute;bottom:16px;right:16px;background:rgba(0,0,0,.75);color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;backdrop-filter:blur(10px);display:flex;align-items:center;gap:6px;transition:all .25s var(--ease);z-index:5}
.quality-btn:hover{background:rgba(0,0,0,.9)}
.quality-menu{position:absolute;bottom:60px;right:16px;background:rgba(20,20,26,.95);backdrop-filter:blur(20px);border:1px solid var(--line);border-radius:12px;padding:8px;min-width:150px;z-index:6;opacity:0;pointer-events:none;transform:translateY(6px);transition:all .25s var(--ease);max-height:280px;overflow-y:auto}
.quality-menu.show{opacity:1;pointer-events:auto;transform:translateY(0)}
.quality-menu button{display:flex;justify-content:space-between;align-items:center;width:100%;padding:8px 12px;border-radius:8px;font-size:13px;color:var(--fg-0);text-align:left}
.quality-menu button:hover{background:var(--bg-2)}
.quality-menu button.active{background:var(--accent);color:#1a0e05;font-weight:600}
.title{font-size:22px;font-weight:600;line-height:1.35;margin-top:20px}
.meta-row{display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-bottom:16px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:16px}
.channel-block{display:flex;align-items:center;gap:14px;flex:1;min-width:0}
.channel-block .av{width:48px;height:48px;border-radius:50%;background:var(--bg-2);flex-shrink:0;object-fit:cover}
.channel-block .info{min-width:0}
.channel-block .name{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.channel-block .subs{color:var(--fg-1);font-size:12px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.actions button, .actions a{
  display:flex;align-items:center;gap:8px;
  padding:10px 16px;border-radius:999px;
  background:var(--bg-2);border:1px solid var(--line);
  font-size:13px;font-weight:500;
  transition:all .25s var(--ease);
}
.actions button:hover, .actions a:hover{background:var(--bg-3);transform:translateY(-1px)}
.actions button.active{background:var(--accent);color:#1a0e05;border-color:var(--accent)}
.actions svg{width:16px;height:16px}
.sub-btn{background:linear-gradient(135deg,var(--accent),var(--accent-2)) !important;color:#1a0e05 !important;border:0 !important;font-weight:700 !important}
.sub-btn.subbed{background:var(--bg-2) !important;color:var(--fg-0) !important;border:1px solid var(--line) !important}
.desc{background:var(--bg-1);border-radius:12px;padding:16px;margin-top:16px;font-size:14px;color:var(--fg-1);line-height:1.6;white-space:pre-wrap;max-height:80px;overflow:hidden;position:relative;transition:max-height .4s var(--ease);cursor:pointer}
.desc.open{max-height:2000px}
.desc .stats{color:var(--fg-0);font-weight:600;margin-bottom:8px}
.desc:not(.open)::after{content:"…続きを表示";position:absolute;bottom:8px;right:16px;background:var(--bg-1);padding-left:20px;color:var(--accent);font-size:12px;font-weight:600}

.side h3{font-size:16px;font-weight:600;margin-bottom:16px;color:var(--fg-1)}
.reco{display:flex;flex-direction:column;gap:12px}
.reco a{display:flex;gap:10px;padding:6px;border-radius:10px;transition:background .25s var(--ease)}
.reco a:hover{background:var(--bg-1)}
.reco .th{width:168px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;flex-shrink:0;background:var(--bg-2);position:relative}
.reco .th img{width:100%;height:100%;object-fit:cover}
.reco .th .d{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.85);padding:1px 6px;border-radius:4px;font-size:11px}
.reco .t{font-size:13px;font-weight:500;line-height:1.35;color:var(--fg-0);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.reco .c{color:var(--fg-1);font-size:12px;margin-top:6px}

.comments{margin-top:32px}
.comments h3{font-size:18px;font-weight:600;margin-bottom:20px}
.comment{display:flex;gap:12px;margin-bottom:20px}
.comment .av{width:40px;height:40px;border-radius:50%;background:var(--bg-2);flex-shrink:0;object-fit:cover}
.comment .body{flex:1;min-width:0}
.comment .top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.comment .top .n{font-weight:600;font-size:13px}
.comment .top .p{color:var(--fg-1);font-size:12px}
.comment .top .pin{background:var(--accent);color:#1a0e05;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700}
.comment .text{font-size:14px;line-height:1.5;color:var(--fg-0);white-space:pre-wrap;word-wrap:break-word}
.comment .likes{display:flex;align-items:center;gap:14px;margin-top:6px;color:var(--fg-1);font-size:12px}
.comment .likes svg{width:14px;height:14px}
.load-more{display:block;margin:20px auto;padding:10px 24px;background:var(--bg-2);border:1px solid var(--line);border-radius:999px;font-size:13px;transition:all .25s var(--ease)}
.load-more:hover{background:var(--bg-3)}

.share-modal{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);z-index:100;display:none;align-items:center;justify-content:center;opacity:0;transition:opacity .3s var(--ease)}
.share-modal.show{display:flex;opacity:1}
.share-box{background:var(--bg-1);border:1px solid var(--line);border-radius:20px;padding:28px;width:min(440px,92vw);transform:scale(.9);transition:transform .3s var(--ease)}
.share-modal.show .share-box{transform:scale(1)}
.share-box h3{font-size:18px;margin-bottom:20px}
.share-input{display:flex;gap:8px}
.share-input input{flex:1;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--fg-0);font-size:13px;outline:none}
.share-input button{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#1a0e05;padding:12px 20px;border-radius:10px;font-weight:600}
.share-close{margin-top:16px;padding:10px;width:100%;background:var(--bg-2);border-radius:10px;font-size:13px}
</style></head><body>
${SHARED_HEADER}
<main>
<div class="watch">
  <div>
    <div class="player-wrap">
      <video id="player" controls playsinline crossorigin="anonymous"></video>
      <audio id="audio" crossorigin="anonymous" style="display:none"></audio>
      <div class="player-status" id="pstatus"><span class="dot"></span><span id="pstext">読み込み中…</span></div>
      <button class="quality-btn" id="qBtn" style="display:none">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        <span id="qLabel">360p</span>
      </button>
      <div class="quality-menu" id="qMenu"></div>
    </div>

    <h1 class="title" id="title"><div class="skl" style="height:24px;width:80%"></div></h1>

    <div class="meta-row">
      <div class="channel-block">
        <img class="av" id="chAv" src="" alt="" onerror="this.style.visibility='hidden'">
        <div class="info">
          <div class="name" id="chName"><div class="skl" style="height:14px;width:120px"></div></div>
          <div class="subs" id="chSubs"></div>
        </div>
        <button class="sub-btn" id="subBtn" style="margin-left:14px;padding:10px 18px;border-radius:999px;font-size:13px">チャンネル登録</button>
      </div>
      <div class="actions">
        <button id="likeBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/></svg><span id="likeTxt">高評価</span></button>
        <button id="favBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>お気に入り</button>
        <button id="shareBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>共有</button>
        <a href="https://www.youtube.com/watch?v=${v}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>YouTube</a>
      </div>
    </div>

    <div class="desc" id="desc" onclick="this.classList.toggle('open')"><div class="skl" style="height:60px"></div></div>

    <div class="comments">
      <h3 id="commentsHead">コメント</h3>
      <div id="commentsList"></div>
      <button class="load-more" id="loadMore" style="display:none">もっと読み込む</button>
    </div>
  </div>

  <aside class="side">
    <h3>おすすめの動画</h3>
    <div class="reco" id="reco">
      ${Array(8).fill(0).map(()=>'<div style="display:flex;gap:10px;padding:6px"><div class="skl" style="width:168px;aspect-ratio:16/9;flex-shrink:0"></div><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="skl" style="height:14px"></div><div class="skl" style="height:14px;width:70%"></div><div class="skl" style="height:12px;width:50%"></div></div></div>').join('')}
    </div>
  </aside>
</div>
</main>

<div class="share-modal" id="shareModal">
  <div class="share-box">
    <h3>この動画を共有</h3>
    <div class="share-input">
      <input id="shareUrl" readonly>
      <button id="shareCopy">コピー</button>
    </div>
    <button class="share-close" onclick="document.getElementById('shareModal').classList.remove('show')">閉じる</button>
  </div>
</div>

<script>
${SHARED_TOAST_JS}
const VID = ${JSON.stringify(v)};
const video = document.getElementById('player');
const audio = document.getElementById('audio');
const pstatus = document.getElementById('pstatus');
const pstext = document.getElementById('pstext');

function setStatus(t, show=true){ pstext.textContent = t; pstatus.classList.toggle('show', show); }

/* -- Sync audio+video for HQ streams -- */
let syncMode = false;
video.addEventListener('play',  ()=>{ if(syncMode){ audio.currentTime = video.currentTime; audio.play().catch(()=>{}); }});
video.addEventListener('pause', ()=>{ if(syncMode){ audio.pause(); }});
video.addEventListener('seeking',()=>{ if(syncMode){ audio.currentTime = video.currentTime; }});
video.addEventListener('ratechange',()=>{ if(syncMode){ audio.playbackRate = video.playbackRate; }});
video.addEventListener('volumechange',()=>{ audio.volume = video.volume; audio.muted = video.muted });
setInterval(()=>{ if(syncMode && !video.paused){
  const diff = Math.abs(video.currentTime - audio.currentTime);
  if(diff > 0.35) audio.currentTime = video.currentTime;
}}, 800);

/* -- 1) Start with 360p redirect stream ASAP -- */
setStatus('360p を読み込み中…');
video.src = '/stream/' + VID;
video.muted = false;

video.addEventListener('loadeddata', ()=>{ setStatus('再生準備完了', false); });
video.addEventListener('error', ()=>{ setStatus('動画の読み込みに失敗しました'); });

/* -- 2) Load full stream list & build quality menu -- */
let allStreams = null;
let currentItag = 18;
const qBtn  = document.getElementById('qBtn');
const qMenu = document.getElementById('qMenu');
qBtn.addEventListener('click', e=>{ e.stopPropagation(); qMenu.classList.toggle('show'); });
document.addEventListener('click', ()=>qMenu.classList.remove('show'));

fetch('/api/streams/' + VID).then(r=>r.json()).then(data=>{
  if(!data || data.error){ return; }
  allStreams = data;
  const formats = data.formats || [];
  const adaptive = data.adaptiveFormats || [];
  const videoStreams = [
    ...formats.filter(f=>f.mimeType?.startsWith('video/') && f.hasAudio!==false && f.qualityLabel),
    ...adaptive.filter(f=>f.mimeType?.startsWith('video/') && f.qualityLabel)
  ];
  const audioStreams = adaptive.filter(f=>f.mimeType?.startsWith('audio/')).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
  const bestAudio = audioStreams[0];

  // Dedupe by qualityLabel, prefer combined (audio+video) if exists
  const byLabel = new Map();
  videoStreams.forEach(f=>{
    const label = f.qualityLabel;
    if(!label) return;
    const hasA = f.hasAudio !== false && !!f.audioCodec;
    const existing = byLabel.get(label);
    if(!existing || (hasA && !existing._hasA)){
      byLabel.set(label, { ...f, _hasA: hasA });
    }
  });
  const sorted = [...byLabel.values()].sort((a,b)=>parseInt(b.qualityLabel)-parseInt(a.qualityLabel));

  if(!sorted.length) return;
  qBtn.style.display = 'flex';
  qMenu.innerHTML = sorted.map(f=>{
    const active = f.itag === 18 ? ' active' : '';
    return \`<button data-itag="\${f.itag}" data-hasa="\${f._hasA?1:0}" data-url="\${encodeURIComponent(f.url||'')}" class="\${active.trim()}"><span>\${f.qualityLabel}\${f.fps>30?' '+f.fps:''}</span><span style="color:var(--fg-2);font-size:11px">\${f._hasA?'♪':''}</span></button>\`;
  }).join('');

  qMenu.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const itag = Number(btn.dataset.itag);
      const hasA = btn.dataset.hasa === '1';
      const url  = decodeURIComponent(btn.dataset.url);
      switchQuality(itag, hasA, url, btn.querySelector('span').textContent, bestAudio);
      qMenu.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      qMenu.classList.remove('show');
    });
  });
});

function switchQuality(itag, hasA, url, label, bestAudio){
  currentItag = itag;
  document.getElementById('qLabel').textContent = label;
  const t = video.currentTime, wasPlaying = !video.paused;
  setStatus(label + ' に切替中…');

  if(hasA){
    syncMode = false;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    video.src = url && url !== 'undefined' ? url : '/stream/' + VID + '?itag=' + itag;
  } else {
    if(!bestAudio || !bestAudio.url){ toast('音声ストリームが見つかりません'); return; }
    syncMode = true;
    video.src = url;
    audio.src = bestAudio.url;
  }
  video.addEventListener('loadedmetadata', function once(){
    video.removeEventListener('loadedmetadata', once);
    video.currentTime = t;
    if(syncMode){ audio.currentTime = t; }
    if(wasPlaying){ video.play(); if(syncMode) audio.play().catch(()=>{}); }
    setStatus('', false);
  });
}

/* -- Meta -- */
fetch('/api/meta/' + VID).then(r=>r.json()).then(m=>{
  if(m.error) return;
  document.title = (m.title||'動画') + ' — 柿Tube';
  document.getElementById('title').textContent = m.title || '';
  document.getElementById('chName').innerHTML = '<a href="/channel/'+ (m.channelId||'') +'">'+ escapeHtml(m.author||'') +'</a>';
  const stats = [
    fmtViews(m.viewCount) + ' 回視聴',
    timeAgo(m.publishedAt)
  ].filter(Boolean).join(' · ');
  document.getElementById('desc').innerHTML =
    '<div class="stats">'+ escapeHtml(stats) +'</div>' + escapeHtml(m.description||'').replace(/\\n/g,'<br>');
  document.getElementById('likeTxt').textContent = m.likeCount ? fmtViews(m.likeCount) : '高評価';

  // Channel meta (subs, avatar via API)
  if(m.channelId){
    fetch('/api/channel/' + m.channelId).then(r=>r.json()).then(c=>{
      if(c.avatar) document.getElementById('chAv').src = c.avatar;
      if(c.subscriberCount) document.getElementById('chSubs').textContent = fmtViews(c.subscriberCount)+' 人の登録者';
      applySubState(m.channelId);
    }).catch(()=>{});
  }
  // Also try to find channel avatar via youtube-search-api by author name (spec-required)
  if(m.author){
    fetch('/api/resolve-channel?name=' + encodeURIComponent(m.author)).then(r=>r.json()).then(c=>{
      if(c.avatar && !document.getElementById('chAv').src) document.getElementById('chAv').src = c.avatar;
    }).catch(()=>{});
  }
}).catch(()=>{});

/* -- Recommendations -- */
fetch('/api/recommend/' + VID).then(r=>r.json()).then(d=>{
  const list = d.recommendations || [];
  if(!list.length){ document.getElementById('reco').innerHTML = '<div style="color:var(--fg-2);padding:20px;text-align:center">おすすめが見つかりませんでした</div>'; return; }
  document.getElementById('reco').innerHTML = list.map(r=>\`
    <a href="/watch?v=\${r.videoId}">
      <div class="th">
        <img src="\${r.thumbnail||('https://i.ytimg.com/vi/'+r.videoId+'/mqdefault.jpg')}" loading="lazy">
      </div>
      <div>
        <div class="t">\${escapeHtml(r.title||'')}</div>
        <div class="c">\${escapeHtml(r.author||r.channelName||'')}</div>
      </div>
    </a>\`).join('');
}).catch(()=>{});

/* -- Comments -- */
let commentPage = 1, loadingComments = false;
const commentsList = document.getElementById('commentsList');
const loadMoreBtn = document.getElementById('loadMore');
loadMoreBtn.addEventListener('click', ()=>loadComments());

async function loadComments(){
  if(loadingComments) return;
  loadingComments = true;
  try{
    const r = await fetch('/api/comments/' + VID + '?page=' + commentPage);
    const d = await r.json();
    const arr = d.comments || [];
    if(commentPage === 1) document.getElementById('commentsHead').textContent = 'コメント ' + (d.totalComments ? fmtViews(d.totalComments) : arr.length);
    arr.forEach(c=>{
      const el = document.createElement('div');
      el.className = 'comment';
      el.innerHTML = \`
        <img class="av" src="\${c.authorThumbnail||''}" onerror="this.style.visibility='hidden'">
        <div class="body">
          <div class="top">
            <span class="n">\${escapeHtml(c.author||'')}</span>
            \${c.isPinned?'<span class="pin">📌 固定</span>':''}
            <span class="p">\${escapeHtml(c.publishedTime||'')}</span>
          </div>
          <div class="text">\${escapeHtml(c.text||'').replace(/\\n/g,'<br>')}</div>
          <div class="likes">
            <span>👍 \${escapeHtml(c.likeCountText||String(c.likeCount||0))}</span>
            \${c.replyCount?('<span>💬 '+c.replyCount+' 件の返信</span>'):''}
          </div>
        </div>\`;
      commentsList.appendChild(el);
    });
    loadMoreBtn.style.display = d.hasNextPage ? 'block':'none';
    commentPage++;
  }catch(e){}
  loadingComments = false;
}
loadComments();

/* -- Subscribe / Like / Favorite (localStorage) -- */
const subBtn = document.getElementById('subBtn');
function applySubState(cid){
  const subs = JSON.parse(localStorage.getItem('kt_subs')||'{}');
  const on = !!subs[cid];
  subBtn.classList.toggle('subbed', on);
  subBtn.textContent = on ? '登録済み' : 'チャンネル登録';
  subBtn.onclick = ()=>{
    const s = JSON.parse(localStorage.getItem('kt_subs')||'{}');
    if(s[cid]){ delete s[cid]; toast('登録を解除しました'); }
    else { s[cid] = { at: Date.now() }; toast('チャンネル登録しました'); }
    localStorage.setItem('kt_subs', JSON.stringify(s));
    applySubState(cid);
  };
}
const likeBtn = document.getElementById('likeBtn');
function applyLikeState(){
  const l = JSON.parse(localStorage.getItem('kt_likes')||'{}');
  likeBtn.classList.toggle('active', !!l[VID]);
}
likeBtn.addEventListener('click', ()=>{
  const l = JSON.parse(localStorage.getItem('kt_likes')||'{}');
  if(l[VID]){ delete l[VID]; toast('高評価を取り消しました'); }
  else { l[VID] = 1; toast('高評価しました'); }
  localStorage.setItem('kt_likes', JSON.stringify(l));
  applyLikeState();
});
applyLikeState();

const favBtn = document.getElementById('favBtn');
function applyFavState(){
  const f = JSON.parse(localStorage.getItem('kt_favs')||'{}');
  favBtn.classList.toggle('active', !!f[VID]);
}
favBtn.addEventListener('click', ()=>{
  const f = JSON.parse(localStorage.getItem('kt_favs')||'{}');
  if(f[VID]){ delete f[VID]; toast('お気に入りから削除しました'); }
  else {
    f[VID] = { title: document.getElementById('title').textContent, at: Date.now() };
    toast('お気に入りに追加しました');
  }
  localStorage.setItem('kt_favs', JSON.stringify(f));
  applyFavState();
});
applyFavState();

/* -- Share -- */
document.getElementById('shareBtn').addEventListener('click', ()=>{
  const url = location.origin + '/watch?v=' + VID;
  document.getElementById('shareUrl').value = url;
  document.getElementById('shareModal').classList.add('show');
});
document.getElementById('shareCopy').addEventListener('click', async ()=>{
  const url = document.getElementById('shareUrl').value;
  try{
    if(navigator.share){ await navigator.share({ url, title: document.title }); }
    else { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }
  }catch(e){ try{ await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); }catch(_){} }
});
document.getElementById('shareModal').addEventListener('click', e=>{
  if(e.target.id === 'shareModal') e.target.classList.remove('show');
});

function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
</script>
</body></html>`);
});

/* -- Direct stream redirect wrapper (for CORS-avoidance in some cases) -- */
app.get(/^\/stream\/([A-Za-z0-9_-]{11})$/, async (req, res) => {
  const id = req.params[0];
  const itag = req.query.itag ? `?itag=${encodeURIComponent(req.query.itag)}` : '';
  // Just redirect to Orby's 302 endpoint
  res.redirect(302, `${API_BASES[0]}/orby/yt/${id}${itag}`);
});

/* ============================================================
   /channel/:id — チャンネルページ
   ============================================================ */
app.get(/^\/channel\/(UC[\w-]{22})$/, (req, res) => {
  const cid = req.params[0];
  res.send(`<!DOCTYPE html><html lang="ja"><head><title>チャンネル — 柿Tube</title>${SHARED_HEAD}
<style>
.banner{width:100%;aspect-ratio:6.2/1;background:linear-gradient(135deg,#22222c,#0a0a0d);border-radius:16px;overflow:hidden;position:relative}
.banner img{width:100%;height:100%;object-fit:cover}
.ch-header{display:flex;align-items:flex-end;gap:24px;margin-top:-40px;padding:0 24px;position:relative;z-index:2;flex-wrap:wrap}
.ch-header .av{width:130px;height:130px;border-radius:50%;object-fit:cover;background:var(--bg-2);border:6px solid var(--bg-0);flex-shrink:0}
.ch-header .info h1{font-size:28px;font-weight:700;letter-spacing:-.02em}
.ch-header .info .handle{color:var(--fg-1);font-size:14px;margin-top:4px}
.ch-header .info .stats{color:var(--fg-1);font-size:13px;margin-top:10px}
.ch-header .info .desc{color:var(--fg-1);font-size:13px;margin-top:8px;max-width:640px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ch-header .sub-btn{margin-left:auto;padding:14px 28px;border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#1a0e05;font-weight:700;font-size:14px;box-shadow:0 10px 24px var(--accent-glow)}
.ch-header .sub-btn.subbed{background:var(--bg-2);color:var(--fg-0);border:1px solid var(--line);box-shadow:none}
.tabs{margin-top:32px;border-bottom:1px solid var(--line);display:flex;gap:8px}
.tabs button{padding:14px 20px;font-size:14px;font-weight:600;color:var(--fg-1);border-bottom:2px solid transparent;transition:all .25s var(--ease)}
.tabs button.active{color:var(--fg-0);border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin-top:24px}
.vcard{transition:transform .3s var(--ease)}
.vcard:hover{transform:translateY(-4px)}
.vcard .th{aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--bg-2);position:relative}
.vcard .th img{width:100%;height:100%;object-fit:cover;transition:transform .5s var(--ease)}
.vcard:hover .th img{transform:scale(1.06)}
.vcard .th .d{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.85);padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}
.vcard .t{margin-top:10px;font-size:14px;font-weight:600;line-height:1.35;color:var(--fg-0);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vcard .m{color:var(--fg-1);font-size:12px;margin-top:4px}
.about{margin-top:24px;background:var(--bg-1);border:1px solid var(--line);border-radius:16px;padding:24px;line-height:1.6;font-size:14px;color:var(--fg-1);white-space:pre-wrap;max-width:900px}
</style></head><body>
${SHARED_HEADER}
<main>
  <div class="banner" id="banner"><div class="skl" style="width:100%;height:100%;border-radius:16px"></div></div>
  <div class="ch-header">
    <img class="av" id="chAv" src="" onerror="this.style.visibility='hidden'">
    <div class="info" style="flex:1;min-width:200px">
      <h1 id="chName"><div class="skl" style="height:24px;width:200px"></div></h1>
      <div class="handle" id="chHandle"></div>
      <div class="stats" id="chStats"></div>
      <div class="desc" id="chDesc"></div>
    </div>
    <button class="sub-btn" id="subBtn">チャンネル登録</button>
  </div>

  <div class="tabs">
    <button class="active" data-tab="videos">動画</button>
    <button data-tab="about">概要</button>
  </div>

  <div id="tab-videos" class="grid" style="display:grid">
    ${Array(8).fill(0).map(()=>'<div><div class="skl" style="aspect-ratio:16/9"></div><div class="skl" style="height:16px;margin-top:10px;width:80%"></div><div class="skl" style="height:12px;margin-top:6px;width:50%"></div></div>').join('')}
  </div>
  <div id="tab-about" style="display:none">
    <div class="about" id="aboutText"></div>
  </div>
</main>
<script>
${SHARED_TOAST_JS}
const CID = ${JSON.stringify(cid)};
let CHANNEL_NAME = '';

fetch('/api/channel/' + CID).then(r=>r.json()).then(c=>{
  if(c.error) throw c;
  CHANNEL_NAME = c.name || '';
  document.title = CHANNEL_NAME + ' — 柿Tube';
  if(c.banner) document.getElementById('banner').innerHTML = '<img src="'+c.banner+'" onerror="this.style.display=\\'none\\'">';
  if(c.avatar) document.getElementById('chAv').src = c.avatar;
  document.getElementById('chName').textContent = c.name || '';
  document.getElementById('chHandle').textContent = c.vanityUrl ? '@'+c.vanityUrl : '';
  const parts=[];
  if(c.subscriberCount) parts.push(fmtViews(c.subscriberCount)+' 人の登録者');
  if(c.videoCount) parts.push(c.videoCount+' 本の動画');
  document.getElementById('chStats').textContent = parts.join(' · ');
  document.getElementById('chDesc').textContent = c.description || '';
  document.getElementById('aboutText').textContent = c.description || '説明はありません';
  applySub();
  loadVideos();
}).catch(()=>{
  document.getElementById('chName').textContent = 'チャンネルが見つかりません';
});

function loadVideos(){
  if(!CHANNEL_NAME) return;
  fetch('/api/channel-videos?name=' + encodeURIComponent(CHANNEL_NAME)).then(r=>r.json()).then(d=>{
    const items = (d.items||[]).filter(i=>i.id && i.type==='video').slice(0,30);
    if(!items.length){
      document.getElementById('tab-videos').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--fg-1)">動画が見つかりませんでした</div>';
      return;
    }
    document.getElementById('tab-videos').innerHTML = items.map(it=>{
      const th = it.thumbnail?.thumbnails || [];
      const thumb = th[th.length-1]?.url || '';
      const dur = it.length?.simpleText || (it.isLive?'LIVE':'');
      return \`<a class="vcard" href="/watch?v=\${it.id}">
        <div class="th">
          <img src="\${thumb}" loading="lazy">
          \${dur?'<span class="d">'+escapeHtml(dur)+'</span>':''}
        </div>
        <div class="t">\${escapeHtml(it.title||'')}</div>
        <div class="m">\${escapeHtml(it.channelTitle||'')}</div>
      </a>\`;
    }).join('');
  });
}

/* Tabs */
document.querySelectorAll('.tabs button').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t = b.dataset.tab;
    document.getElementById('tab-videos').style.display = t==='videos'?'grid':'none';
    document.getElementById('tab-about').style.display  = t==='about' ?'block':'none';
  });
});

/* Subscribe */
const subBtn = document.getElementById('subBtn');
function applySub(){
  const s = JSON.parse(localStorage.getItem('kt_subs')||'{}');
  const on = !!s[CID];
  subBtn.classList.toggle('subbed', on);
  subBtn.textContent = on ? '登録済み' : 'チャンネル登録';
}
subBtn.addEventListener('click',()=>{
  const s = JSON.parse(localStorage.getItem('kt_subs')||'{}');
  if(s[CID]){ delete s[CID]; toast('登録を解除しました'); }
  else { s[CID] = { at:Date.now(), name:CHANNEL_NAME }; toast('チャンネル登録しました'); }
  localStorage.setItem('kt_subs', JSON.stringify(s));
  applySub();
});

function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
</script>
</body></html>`);
});

/* ============================================================
   /favorites, /subscriptions — user pages
   ============================================================ */
app.get(/^\/favorites$/, (_req,res)=>{
  res.send(`<!DOCTYPE html><html lang="ja"><head><title>お気に入り — 柿Tube</title>${SHARED_HEAD}</head><body>
${SHARED_HEADER}
<main>
  <h1 style="font-size:24px;margin-bottom:20px">お気に入り</h1>
  <div id="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px"></div>
</main>
<script>
const f = JSON.parse(localStorage.getItem('kt_favs')||'{}');
const list = document.getElementById('list');
const keys = Object.keys(f);
if(!keys.length){ list.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--fg-1);padding:60px">お気に入りはまだありません</div>'; }
else{
  list.innerHTML = keys.map(id=>\`
    <a href="/watch?v=\${id}" style="display:block">
      <div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--bg-2)">
        <img src="https://i.ytimg.com/vi/\${id}/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover">
      </div>
      <div style="margin-top:10px;font-size:14px;font-weight:600">\${(f[id].title||id)}</div>
    </a>\`).join('');
}
</script>
</body></html>`);
});

/* ============================================================
   404
   ============================================================ */
app.use((_req,res)=>{
  res.status(404).send(`<!DOCTYPE html><html><head><title>404 — 柿Tube</title>${SHARED_HEAD}</head><body>
${SHARED_HEADER}
<main style="text-align:center;padding:80px 20px">
  <div style="font-size:120px;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900">404</div>
  <h1 style="font-size:24px;margin-top:20px">ページが見つかりません</h1>
  <a href="/" style="display:inline-block;margin-top:24px;padding:14px 28px;border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#1a0e05;font-weight:700">ホームに戻る</a>
</main>
</body></html>`);
});

/* ---------- helpers ---------- */
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}

app.listen(PORT, ()=>console.log(`🍊 Persimmon listening on ${PORT}`));

module.exports = app;
