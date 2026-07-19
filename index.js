// ============================================================
//  Persimmon (柿Tube) - The ultimate YouTube frontend
//  No compromise edition — 2026
// ============================================================
const express = require('express');
const path = require('path');
const ytsr = require('youtube-search-api');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- API base (fallback対応) ----------
const API_BASES = [
  'https://orby-api.vercel.app',
  'https://orby-api.onrender.com'
];

const _fetch = (typeof fetch !== 'undefined')
  ? fetch
  : ((...a) => import('node-fetch').then(({default:f}) => f(...a)));

async function apiFetch(pathAndQuery, { timeout = 15000 } = {}) {
  const errors = [];
  for (const base of API_BASES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await _fetch(base + pathAndQuery, { signal: ctrl.signal, headers: { 'accept': 'application/json' } });
      clearTimeout(t);
      if (!res.ok) { errors.push(base + ' -> ' + res.status); continue; }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      return await res.text();
    } catch (e) { errors.push(base + ' -> ' + e.message); }
  }
  throw new Error('All API bases failed: ' + errors.join(' | '));
}

// ============================================================
//  Static: /  →  public/home.html
// ============================================================
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/home.html')));

// ============================================================
//  Shared CSS / JS - injected into every dynamic page
// ============================================================
const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#0a0a0a;--bg2:#111;--card:#161616;--card2:#1c1c1c;--border:#252525;--border2:#333;
--text:#f5f5f5;--sub:#a0a0a0;--sub2:#707070;--accent:#ff7a2f;--accent2:#ff5722;--red:#f44;--shadow:0 12px 40px rgba(0,0,0,.5)}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%}
button{font-family:inherit;cursor:pointer}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:#333;border-radius:5px}
::-webkit-scrollbar-thumb:hover{background:#444}

.header{position:sticky;top:0;z-index:100;background:rgba(10,10,10,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.5px;flex-shrink:0}
.brand img{width:32px;height:32px;object-fit:contain}
.brand span{background:linear-gradient(135deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.hbar{flex:1;max-width:640px;position:relative}
.hbar input{width:100%;padding:12px 48px 12px 20px;background:var(--card);border:1px solid var(--border);border-radius:100px;color:var(--text);font-size:15px;outline:none;transition:all .2s}
.hbar input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(255,122,47,.12)}
.hbar button{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;display:flex;align-items:center;justify-content:center}
.hbar button svg{width:16px;height:16px}
.hbar button:hover{filter:brightness(1.1)}
.navLink{color:var(--sub);font-size:14px;font-weight:600;padding:8px 14px;border-radius:100px;transition:all .2s;flex-shrink:0}
.navLink:hover{color:var(--text);background:var(--card)}

.wrap{max-width:1400px;margin:0 auto;padding:24px}

.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(120%);background:var(--card2);border:1px solid var(--border);color:var(--text);padding:12px 22px;border-radius:100px;font-size:14px;z-index:9999;transition:transform .3s;box-shadow:var(--shadow)}
.toast.show{transform:translateX(-50%) translateY(0)}

.skel{background:linear-gradient(90deg,#1a1a1a 0%,#252525 50%,#1a1a1a 100%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:8px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.spinner{width:38px;height:38px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

.pill{display:inline-block;padding:4px 12px;border-radius:100px;background:var(--card);border:1px solid var(--border);font-size:12px;color:var(--sub)}
.hidden{display:none!important}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px 18px}
.vcard{cursor:pointer;transition:transform .2s}
.vcard:hover{transform:translateY(-2px)}
.vcard .thumb{position:relative;aspect-ratio:16/9;background:#111;border-radius:12px;overflow:hidden}
.vcard .thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.vcard:hover .thumb img{transform:scale(1.03)}
.vcard .dur{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.85);color:#fff;font-size:12px;font-weight:600;padding:2px 6px;border-radius:4px}
.vcard .meta{display:flex;gap:12px;margin-top:12px}
.vcard .cava{width:36px;height:36px;border-radius:50%;background:#222;flex-shrink:0;object-fit:cover}
.vcard .info h3{font-size:15px;font-weight:600;line-height:1.4;color:var(--text);display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vcard .info .ch{color:var(--sub);font-size:13px;margin-top:6px}
.vcard .info .sub{color:var(--sub2);font-size:13px;margin-top:2px}
`;

const layout = (title, body, extraHead = '') => `<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="icon" href="/img/kaki.png">
<style>${BASE_CSS}</style>${extraHead}</head><body>
<header class="header">
  <a href="/" class="brand"><img src="/img/kaki.png" alt=""><span>柿Tube</span></a>
  <form class="hbar" onsubmit="event.preventDefault();const q=this.q.value.trim();if(q)location.href='/search?q='+encodeURIComponent(q)">
    <input name="q" type="text" placeholder="検索..." autocomplete="off" id="hbarInput">
    <button type="submit" aria-label="検索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></button>
  </form>
  <a href="/library" class="navLink">ライブラリ</a>
</header>
<div class="toast" id="toast"></div>
${body}
<script>
  (function(){
    const u=new URLSearchParams(location.search);const q=u.get('q');
    if(q){const i=document.getElementById('hbarInput');if(i)i.value=q}
  })();
  window.toast=function(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('show'),2200)};
  window.fmtNum=function(n){n=Number(n)||0;if(n>=1e9)return(n/1e9).toFixed(1).replace(/\\.0$/,'')+'B';if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+'M';if(n>=1e3)return(n/1e3).toFixed(1).replace(/\\.0$/,'')+'K';return String(n)};
  window.escapeHtml=function(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  window.timeAgo=function(iso){if(!iso)return'';const d=new Date(iso);if(isNaN(d))return iso;const s=(Date.now()-d.getTime())/1000;const t=[[31536000,'年'],[2592000,'ヶ月'],[86400,'日'],[3600,'時間'],[60,'分']];for(const[k,l]of t){if(s>=k)return Math.floor(s/k)+l+'前'}return'たった今'};
  window.PS={
    subs(){try{return JSON.parse(localStorage.getItem('ps_subs')||'{}')}catch(e){return{}}},
    isSub(id){return !!this.subs()[id]},
    toggleSub(id,name,avatar){const s=this.subs();if(s[id]){delete s[id];toast('登録解除しました')}else{s[id]={name,avatar,at:Date.now()};toast('チャンネル登録しました')}localStorage.setItem('ps_subs',JSON.stringify(s));return !!s[id]},
    favs(){try{return JSON.parse(localStorage.getItem('ps_favs')||'{}')}catch(e){return{}}},
    isFav(id){return !!this.favs()[id]},
    toggleFav(id,data){const f=this.favs();if(f[id]){delete f[id];toast('お気に入りから削除')}else{f[id]=Object.assign({at:Date.now()},data||{});toast('お気に入りに追加')}localStorage.setItem('ps_favs',JSON.stringify(f));return !!f[id]},
    hist(){try{return JSON.parse(localStorage.getItem('ps_hist')||'[]')}catch(e){return[]}},
    addHist(v){let h=this.hist();h=h.filter(x=>x.videoId!==v.videoId);h.unshift(Object.assign({at:Date.now()},v));if(h.length>200)h=h.slice(0,200);localStorage.setItem('ps_hist',JSON.stringify(h))}
  };
</script></body></html>`;

// ============================================================
//  /search  -  Search Page
// ============================================================
app.get(/^\/search\/?$/, (req, res) => {
  const q = (req.query.q || '').toString();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const safeQ = q.replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c]));
  const body = `
<div class="wrap">
  <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:20px;flex-wrap:wrap">
    <h2 style="font-size:22px;font-weight:700">「<span style="color:var(--accent)">${safeQ}</span>」の検索結果</h2>
    <span id="cnt" class="pill"></span>
  </div>
  <div id="results" class="grid"></div>
  <div id="loading" style="display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>
  <div id="pager" style="display:flex;justify-content:center;gap:10px;margin:30px 0"></div>
</div>
<script>
const Q=${JSON.stringify(q)};
const PAGE=${page};
const results=document.getElementById('results');
const loading=document.getElementById('loading');
const cnt=document.getElementById('cnt');
const pager=document.getElementById('pager');

function skelCard(){const d=document.createElement('div');d.className='vcard';d.innerHTML=\`
  <div class="thumb skel"></div>
  <div class="meta">
    <div class="cava skel"></div>
    <div class="info" style="flex:1">
      <div class="skel" style="height:14px;width:95%;margin-bottom:8px"></div>
      <div class="skel" style="height:12px;width:60%;margin-bottom:6px"></div>
      <div class="skel" style="height:12px;width:40%"></div>
    </div>
  </div>\`;return d}

for(let i=0;i<12;i++)results.appendChild(skelCard());

fetch('/api/search?q='+encodeURIComponent(Q)+'&page='+PAGE).then(r=>r.json()).then(data=>{
  loading.style.display='none';
  results.innerHTML='';
  const items=(data.items||[]);
  cnt.textContent=items.length+' 件';
  if(items.length===0){results.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--sub);padding:60px">結果が見つかりませんでした</div>';return}
  items.forEach(v=>{
    const card=document.createElement('a');card.className='vcard';card.href='/watch?v='+v.videoId;
    card.innerHTML=\`
      <div class="thumb">
        <img src="\${v.thumbnail}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/\${v.videoId}/hqdefault.jpg'">
        \${v.duration?\`<div class="dur">\${escapeHtml(v.duration)}</div>\`:''}
      </div>
      <div class="meta">
        <a href="/channel/\${v.channelId||''}" onclick="event.stopPropagation()" style="flex-shrink:0">
          <img class="cava" src="\${v.channelThumbnail||'/img/kaki.png'}" onerror="this.src='/img/kaki.png'" loading="lazy">
        </a>
        <div class="info">
          <h3>\${escapeHtml(v.title)}</h3>
          <div class="ch">\${escapeHtml(v.channelName||'')}</div>
          <div class="sub">\${v.views?fmtNum(v.views)+' 回視聴':''}\${v.views&&v.publishedTime?' • ':''}\${escapeHtml(v.publishedTime||'')}</div>
        </div>
      </div>\`;
    results.appendChild(card);
  });
  pager.innerHTML='';
  const mkBtn=(label,p,disabled)=>{const b=document.createElement('a');b.textContent=label;b.className='pill';b.style.cssText='padding:10px 22px;cursor:'+(disabled?'not-allowed':'pointer')+';opacity:'+(disabled?.4:1);if(!disabled)b.href='/search?q='+encodeURIComponent(Q)+'&page='+p;return b};
  if(PAGE>1)pager.appendChild(mkBtn('← 前のページ',PAGE-1,false));
  pager.appendChild(mkBtn('ページ '+PAGE,PAGE,true));
  if(data.hasNextPage!==false)pager.appendChild(mkBtn('次のページ →',PAGE+1,false));
}).catch(e=>{loading.style.display='none';results.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--red);padding:60px">検索エラー: '+escapeHtml(e.message)+'</div>'});
</script>`;
  res.send(layout(`${q} - 柿Tube 検索`, body));
});

// ============================================================
//  /watch  -  Video Page
// ============================================================
app.get(/^\/watch\/?$/, (req, res) => {
  const vid = (req.query.v || '').toString();
  if (!/^[\w-]{6,20}$/.test(vid)) return res.status(400).send(layout('Error', '<div class="wrap"><h2>無効な動画IDです</h2></div>'));
  const body = `
<div class="wrap" style="max-width:1600px">
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:28px" id="watchGrid">
    <div>
      <div id="playerBox" style="position:relative;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden;box-shadow:var(--shadow)">
        <video id="player" style="width:100%;height:100%;background:#000" controls playsinline crossorigin="anonymous"></video>
        <audio id="audio" style="display:none" crossorigin="anonymous"></audio>
        <div id="ploading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#000;gap:14px">
          <div class="spinner"></div>
          <div style="color:var(--sub);font-size:13px">ストリームを準備中...</div>
        </div>
      </div>
      <div id="qualityBar" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <span style="color:var(--sub);font-size:13px;margin-right:4px">画質:</span>
        <div id="qOpts" style="display:flex;gap:6px;flex-wrap:wrap"><span class="pill">読み込み中...</span></div>
      </div>
      <h1 id="vtitle" style="font-size:22px;font-weight:700;margin-top:20px;line-height:1.4">
        <span class="skel" style="display:inline-block;width:80%;height:24px"></span>
      </h1>
      <div id="vmeta" style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div id="chBox" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
          <div class="cava skel" style="width:48px;height:48px"></div>
          <div style="min-width:0"><div class="skel" style="height:16px;width:140px;margin-bottom:6px"></div><div class="skel" style="height:12px;width:80px"></div></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="subBtn" class="actBtn">チャンネル登録</button>
          <button id="favBtn" class="actBtn">☆ お気に入り</button>
          <button id="shareBtn" class="actBtn">🔗 共有</button>
        </div>
      </div>
      <div id="vdesc" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-top:16px;font-size:14px;color:var(--sub);white-space:pre-wrap;word-wrap:break-word;max-height:120px;overflow:hidden;position:relative;cursor:pointer" onclick="this.style.maxHeight=this.style.maxHeight==='none'?'120px':'none'">
        <div class="skel" style="height:14px;width:100%;margin-bottom:8px"></div>
        <div class="skel" style="height:14px;width:90%;margin-bottom:8px"></div>
        <div class="skel" style="height:14px;width:70%"></div>
      </div>
      <div style="margin-top:24px">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:16px" id="cmtHeader">コメント</h3>
        <div id="comments"></div>
        <div id="cmtMore" style="text-align:center;margin-top:20px"></div>
      </div>
    </div>
    <aside id="recs">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:14px">おすすめ</h3>
      <div id="recList"></div>
    </aside>
  </div>
</div>
<style>
  .actBtn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:100px;font-size:13px;font-weight:600;transition:all .2s}
  .actBtn:hover{background:var(--card2);border-color:var(--border2)}
  .actBtn.on{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff}
  .qbtn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:100px;font-size:12px;font-weight:600}
  .qbtn.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .cmt{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)}
  .cmt img{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#222;flex-shrink:0}
  .cmt .cbody{flex:1;min-width:0}
  .cmt .chdr{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
  .cmt .cname{font-size:13px;font-weight:600}
  .cmt .ctime{font-size:12px;color:var(--sub2)}
  .cmt .ctext{font-size:14px;color:var(--text);margin-top:4px;white-space:pre-wrap;word-wrap:break-word;line-height:1.5}
  .cmt .clikes{font-size:12px;color:var(--sub);margin-top:6px}
  .rec{display:flex;gap:10px;margin-bottom:12px;cursor:pointer}
  .rec .rthumb{width:168px;aspect-ratio:16/9;background:#111;border-radius:8px;overflow:hidden;flex-shrink:0;position:relative}
  .rec .rthumb img{width:100%;height:100%;object-fit:cover}
  .rec .rthumb .dur{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.85);color:#fff;font-size:11px;padding:2px 5px;border-radius:3px;font-weight:600}
  .rec .rinfo{flex:1;min-width:0}
  .rec .rinfo h4{font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .rec .rinfo .ch{color:var(--sub);font-size:12px;margin-top:4px}
  .rec .rinfo .sub{color:var(--sub2);font-size:12px;margin-top:2px}
  @media(max-width:1000px){#watchGrid{grid-template-columns:1fr!important}#recs .rec .rthumb{width:140px}}
</style>
<script>
const VID=${JSON.stringify(vid)};
const player=document.getElementById('player');
const audio=document.getElementById('audio');
const ploading=document.getElementById('ploading');

let allFormats=null;
let currentItag=null;
let videoDetails=null;
let syncMode=false;

// ---- 1. Load 360p immediately ----
player.src='/orby/yt/'+VID;
player.addEventListener('loadedmetadata',()=>{ploading.style.display='none'},{once:true});
player.addEventListener('error',()=>{
  ploading.innerHTML='<div style="color:var(--red);text-align:center;padding:20px">動画の読み込みに失敗しました<br><button onclick="location.reload()" class="actBtn" style="margin-top:16px">再読み込み</button></div>';
});

// ---- Sync video+audio for HD streams ----
player.addEventListener('play',()=>{if(syncMode){audio.currentTime=player.currentTime;audio.play().catch(()=>{})}});
player.addEventListener('pause',()=>{if(syncMode)audio.pause()});
player.addEventListener('seeking',()=>{if(syncMode)audio.currentTime=player.currentTime});
player.addEventListener('waiting',()=>{if(syncMode)audio.pause()});
player.addEventListener('playing',()=>{if(syncMode){audio.currentTime=player.currentTime;audio.play().catch(()=>{})}});
player.addEventListener('volumechange',()=>{if(syncMode){audio.volume=player.volume;audio.muted=player.muted}});
player.addEventListener('ratechange',()=>{if(syncMode)audio.playbackRate=player.playbackRate});
setInterval(()=>{if(!syncMode||player.paused)return;const drift=Math.abs(player.currentTime-audio.currentTime);if(drift>0.3)audio.currentTime=player.currentTime},1500);

function pickBestAudio(fmts){
  const auds=fmts.filter(f=>((f.mimeType||'').includes('audio'))||(f.hasAudio&&!f.hasVideo));
  auds.sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
  return auds[0];
}

async function selectQuality(itag){
  if(String(itag)===String(currentItag))return;
  const fmt=allFormats.find(f=>String(f.itag)===String(itag));
  if(!fmt)return;
  const wasPaused=player.paused;const t=player.currentTime;
  document.querySelectorAll('.qbtn').forEach(b=>b.classList.toggle('on',String(b.dataset.itag)===String(itag)));
  currentItag=itag;
  if(fmt.hasAudio&&fmt.hasVideo){
    audio.pause();audio.removeAttribute('src');audio.load();
    syncMode=false;
    player.src=fmt.url;
    player.currentTime=t;if(!wasPaused)player.play().catch(()=>{});
  }else{
    const aud=pickBestAudio(allFormats);
    if(!aud){toast('音声ストリームが見つかりません');return}
    syncMode=true;
    audio.src=aud.url;
    player.src=fmt.url;
    player.currentTime=t;audio.currentTime=t;
    if(!wasPaused){Promise.all([player.play(),audio.play()]).catch(()=>{})}
  }
}

// ---- 2. Load full format list ----
fetch('/api/formats/'+VID).then(r=>r.json()).then(data=>{
  if(!data.formats){document.getElementById('qOpts').innerHTML='<span class="pill" style="color:var(--sub2)">画質選択は利用できません</span>';return}
  allFormats=data.formats;
  const videoFmts=allFormats.filter(f=>f.hasVideo&&f.qualityLabel);
  const byLabel={};
  videoFmts.forEach(f=>{
    const k=f.qualityLabel;
    if(!byLabel[k])byLabel[k]=f;
    else if((f.hasAudio && !byLabel[k].hasAudio)||((f.bitrate||0)>(byLabel[k].bitrate||0)))byLabel[k]=f;
  });
  const sorted=Object.values(byLabel).sort((a,b)=>(parseInt(b.qualityLabel)||0)-(parseInt(a.qualityLabel)||0));
  const opts=document.getElementById('qOpts');opts.innerHTML='';
  sorted.forEach(f=>{
    const b=document.createElement('button');b.className='qbtn';b.dataset.itag=f.itag;b.textContent=f.qualityLabel+(f.hasAudio?'':' ⚡');
    b.title=(f.hasAudio?'音声込み':'音声を別ストリームと同期');
    b.onclick=()=>selectQuality(f.itag);
    opts.appendChild(b);
  });
  const cur=sorted.find(f=>String(f.itag)==='18')||sorted.find(f=>/360/.test(f.qualityLabel))||sorted[sorted.length-1];
  if(cur){currentItag=cur.itag;document.querySelectorAll('.qbtn').forEach(b=>b.classList.toggle('on',String(b.dataset.itag)===String(cur.itag)))}
}).catch(()=>{document.getElementById('qOpts').innerHTML='<span class="pill" style="color:var(--sub2)">画質情報の取得に失敗</span>'});

// ---- 3. Load metadata ----
fetch('/api/meta/'+VID).then(r=>r.json()).then(async m=>{
  videoDetails=m;
  document.title=(m.title||'動画')+' - 柿Tube';
  document.getElementById('vtitle').textContent=m.title||'';
  const desc=document.getElementById('vdesc');
  desc.textContent=m.description||'説明はありません';
  desc.insertAdjacentHTML('afterbegin','<div style="color:var(--text);font-size:14px;font-weight:600;margin-bottom:10px">'+fmtNum(m.viewCount)+' 回視聴 • '+timeAgo(m.publishedAt||m.publishDate)+'</div>');
  const chBox=document.getElementById('chBox');
  let chData={channelId:m.channelId,name:m.author,avatar:''};
  try{
    const r=await fetch('/api/channel-lookup?name='+encodeURIComponent(m.author||'')+'&channelId='+encodeURIComponent(m.channelId||''));
    const j=await r.json();
    if(j&&j.avatar)chData.avatar=j.avatar;
    if(j&&j.channelId)chData.channelId=j.channelId;
  }catch(e){}
  chBox.innerHTML=\`
    <a href="/channel/\${chData.channelId||''}" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
      <img class="cava" src="\${chData.avatar||'/img/kaki.png'}" style="width:48px;height:48px" onerror="this.src='/img/kaki.png'">
      <div style="min-width:0">
        <div style="font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${escapeHtml(chData.name||'')}</div>
        <div style="color:var(--sub);font-size:12px" id="subCount"></div>
      </div>
    </a>\`;
  if(chData.channelId){
    fetch('/api/meta-channel/'+chData.channelId).then(r=>r.json()).then(c=>{
      if(c&&c.subscriberCount){const el=document.getElementById('subCount');if(el)el.textContent=c.subscriberCount+' 人のチャンネル登録者'}
    }).catch(()=>{});
  }
  const subBtn=document.getElementById('subBtn');
  const refreshSub=()=>{const on=PS.isSub(chData.channelId);subBtn.classList.toggle('on',on);subBtn.textContent=on?'✓ 登録済み':'チャンネル登録'};
  refreshSub();
  subBtn.onclick=()=>{if(!chData.channelId){toast('チャンネル情報がありません');return}PS.toggleSub(chData.channelId,chData.name,chData.avatar);refreshSub()};
  const favBtn=document.getElementById('favBtn');
  const refreshFav=()=>{const on=PS.isFav(VID);favBtn.classList.toggle('on',on);favBtn.textContent=on?'★ お気に入り':'☆ お気に入り'};
  refreshFav();
  favBtn.onclick=()=>{PS.toggleFav(VID,{title:m.title,author:m.author,thumbnail:(m.thumbnails&&m.thumbnails.slice(-1)[0]&&m.thumbnails.slice(-1)[0].url)||''});refreshFav()};
  PS.addHist({videoId:VID,title:m.title,author:m.author,thumbnail:(m.thumbnails&&m.thumbnails.slice(-1)[0]&&m.thumbnails.slice(-1)[0].url)||''});
}).catch(()=>{document.getElementById('vtitle').textContent='(タイトル取得失敗)'});

document.getElementById('shareBtn').onclick=async()=>{
  const url=location.href;
  if(navigator.share){try{await navigator.share({title:document.title,url});return}catch(e){}}
  try{await navigator.clipboard.writeText(url);toast('リンクをコピーしました')}catch(e){prompt('リンクをコピー:',url)}
};

// ---- 4. Recommendations ----
fetch('/api/recommend/'+VID).then(r=>r.json()).then(data=>{
  const list=document.getElementById('recList');list.innerHTML='';
  const recs=(data.recommendations||data.results||[]);
  if(recs.length===0){list.innerHTML='<div style="color:var(--sub);font-size:13px">おすすめが見つかりませんでした</div>';return}
  recs.forEach(v=>{
    const id=v.videoId||v.id;if(!id)return;
    const a=document.createElement('a');a.href='/watch?v='+id;a.className='rec';
    a.innerHTML=\`
      <div class="rthumb"><img src="\${v.thumbnail||('https://i.ytimg.com/vi/'+id+'/hqdefault.jpg')}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/'+\${JSON.stringify(id)}+'/hqdefault.jpg'">\${v.duration?'<div class="dur">'+escapeHtml(v.duration)+'</div>':''}</div>
      <div class="rinfo">
        <h4>\${escapeHtml(v.title||'')}</h4>
        <div class="ch">\${escapeHtml(v.channelName||v.author||'')}</div>
        <div class="sub">\${v.views?fmtNum(v.views)+' 回視聴':''}\${v.publishedTime?' • '+escapeHtml(v.publishedTime):''}</div>
      </div>\`;
    list.appendChild(a);
  });
}).catch(()=>{document.getElementById('recList').innerHTML='<div style="color:var(--sub);font-size:13px">おすすめの取得に失敗しました</div>'});

// ---- 5. Comments ----
let cmtCont=null;let cmtPage=1;
function loadComments(){
  const q=cmtCont?'?continuation='+encodeURIComponent(cmtCont):'?page='+cmtPage;
  fetch('/api/comments/'+VID+q).then(r=>r.json()).then(data=>{
    const list=document.getElementById('comments');
    const arr=data.comments||[];
    if(cmtPage===1&&!cmtCont&&arr.length===0){list.innerHTML='<div style="color:var(--sub);font-size:14px;padding:20px 0">コメントはありません</div>';return}
    arr.forEach(c=>{
      const d=document.createElement('div');d.className='cmt';
      d.innerHTML=\`
        <img src="\${c.authorThumbnail||'/img/kaki.png'}" onerror="this.src='/img/kaki.png'" loading="lazy">
        <div class="cbody">
          <div class="chdr"><span class="cname">\${escapeHtml(c.author||'')}</span><span class="ctime">\${escapeHtml(c.publishedTime||'')}</span>\${c.isPinned?'<span class="pill" style="font-size:10px">📌 固定</span>':''}</div>
          <div class="ctext">\${escapeHtml(c.text||'')}</div>
          <div class="clikes">👍 \${escapeHtml(String(c.likeCountText||c.likeCount||0))}\${c.replyCount?' • 💬 '+c.replyCount+' 件の返信':''}</div>
        </div>\`;
      list.appendChild(d);
    });
    document.getElementById('cmtHeader').textContent='コメント'+(data.commentCount?' ('+fmtNum(data.commentCount)+')':'');
    const more=document.getElementById('cmtMore');more.innerHTML='';
    if(data.hasNextPage){
      const btn=document.createElement('button');btn.className='actBtn';btn.textContent='もっと読み込む';
      btn.onclick=()=>{cmtCont=data.continuationToken||null;if(!cmtCont)cmtPage++;btn.disabled=true;btn.textContent='読み込み中...';loadComments()};
      more.appendChild(btn);
    }
  }).catch(()=>{if(cmtPage===1)document.getElementById('comments').innerHTML='<div style="color:var(--sub);font-size:14px;padding:20px 0">コメントを取得できませんでした</div>'});
}
loadComments();
</script>`;
  res.send(layout('動画 - 柿Tube', body));
});

// ============================================================
//  /channel/:id  -  Channel Page
// ============================================================
app.get(/^\/channel\/([^\/]+)\/?$/, (req, res) => {
  const cid = req.params[0];
  const body = `
<div id="banner" style="width:100%;aspect-ratio:6.2/1;background:linear-gradient(135deg,#222,#111);background-size:cover;background-position:center"></div>
<div class="wrap">
  <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-top:-40px;position:relative">
    <img id="cava" src="/img/kaki.png" style="width:130px;height:130px;border-radius:50%;object-fit:cover;background:#222;border:5px solid var(--bg);box-shadow:var(--shadow)" onerror="this.src='/img/kaki.png'">
    <div style="flex:1;min-width:200px">
      <h1 id="cname" style="font-size:28px;font-weight:800"><span class="skel" style="display:inline-block;width:220px;height:28px"></span></h1>
      <div id="cmeta" style="color:var(--sub);font-size:14px;margin-top:6px"><span class="skel" style="display:inline-block;width:180px;height:14px"></span></div>
      <div id="cdesc" style="color:var(--sub);font-size:13px;margin-top:10px;max-width:800px;white-space:pre-wrap;max-height:60px;overflow:hidden;cursor:pointer" onclick="this.style.maxHeight=this.style.maxHeight==='none'?'60px':'none'"></div>
    </div>
    <button id="csub" class="actBtn" style="padding:12px 26px">チャンネル登録</button>
  </div>

  <div style="margin-top:36px;border-bottom:1px solid var(--border);display:flex;gap:0" id="tabs">
    <button data-tab="videos" class="tabBtn active">動画</button>
    <button data-tab="about" class="tabBtn">概要</button>
  </div>

  <div id="tabVideos" class="tabPanel" style="margin-top:24px">
    <div id="vidGrid" class="grid"></div>
    <div id="vidLoad" style="display:flex;justify-content:center;padding:40px"><div class="spinner"></div></div>
  </div>
  <div id="tabAbout" class="tabPanel hidden" style="margin-top:24px;max-width:800px">
    <h3 style="font-size:16px;font-weight:700;margin-bottom:12px">説明</h3>
    <div id="aboutDesc" style="color:var(--sub);white-space:pre-wrap;line-height:1.6"></div>
    <h3 style="font-size:16px;font-weight:700;margin:24px 0 12px">情報</h3>
    <div id="aboutMeta" style="color:var(--sub);line-height:1.8"></div>
  </div>
</div>
<style>
.actBtn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:100px;font-size:13px;font-weight:600;transition:all .2s}
.actBtn:hover{background:var(--card2);border-color:var(--border2)}
.actBtn.on{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#fff}
.tabBtn{background:none;border:none;color:var(--sub);padding:14px 24px;font-size:14px;font-weight:600;border-bottom:2px solid transparent;transition:all .2s}
.tabBtn.active{color:var(--text);border-bottom-color:var(--accent)}
.tabBtn:hover{color:var(--text)}
</style>
<script>
const CID=${JSON.stringify(cid)};
let channelData=null;

fetch('/api/meta-channel/'+CID).then(r=>r.json()).then(c=>{
  if(!c||c.error){document.getElementById('cname').textContent='(チャンネル情報の取得失敗)';return}
  channelData=c;
  document.title=(c.name||'チャンネル')+' - 柿Tube';
  if(c.banner)document.getElementById('banner').style.backgroundImage='url("'+c.banner+'")';
  document.getElementById('cava').src=c.avatar||'/img/kaki.png';
  document.getElementById('cname').textContent=c.name||'';
  const meta=[];
  if(c.vanityUrl)meta.push('@'+String(c.vanityUrl).replace(/^@/,''));
  if(c.subscriberCount)meta.push(c.subscriberCount+' 人のチャンネル登録者');
  if(c.videoCount)meta.push(c.videoCount+' 本の動画');
  document.getElementById('cmeta').textContent=meta.join(' • ');
  document.getElementById('cdesc').textContent=c.description||'';
  document.getElementById('aboutDesc').textContent=c.description||'説明はありません';
  const am=document.getElementById('aboutMeta');
  if(c.channelUrl)am.innerHTML+='YouTube URL: <a href="'+c.channelUrl+'" target="_blank" style="color:var(--accent)">'+c.channelUrl+'</a><br>';
  if(c.channelId)am.innerHTML+='チャンネルID: '+escapeHtml(c.channelId)+'<br>';
  const sb=document.getElementById('csub');
  const refresh=()=>{const on=PS.isSub(c.channelId);sb.classList.toggle('on',on);sb.textContent=on?'✓ 登録済み':'チャンネル登録'};
  refresh();
  sb.onclick=()=>{PS.toggleSub(c.channelId,c.name,c.avatar);refresh()};
  loadVideos(c.name);
}).catch(()=>{document.getElementById('cname').textContent='(取得エラー)'});

async function loadVideos(name){
  const grid=document.getElementById('vidGrid');
  const load=document.getElementById('vidLoad');
  try{
    const r=await fetch('/api/channel-videos?name='+encodeURIComponent(name||'')+'&channelId='+encodeURIComponent(CID));
    const j=await r.json();
    load.style.display='none';
    const items=j.items||[];
    if(items.length===0){grid.innerHTML='<div style="grid-column:1/-1;color:var(--sub);padding:40px;text-align:center">動画が見つかりませんでした</div>';return}
    items.forEach(v=>{
      const a=document.createElement('a');a.href='/watch?v='+v.videoId;a.className='vcard';
      a.innerHTML=\`
        <div class="thumb"><img src="\${v.thumbnail}" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/\${v.videoId}/hqdefault.jpg'">\${v.duration?'<div class="dur">'+escapeHtml(v.duration)+'</div>':''}</div>
        <div class="meta">
          <img class="cava" src="\${(channelData&&channelData.avatar)||'/img/kaki.png'}" onerror="this.src='/img/kaki.png'">
          <div class="info">
            <h3>\${escapeHtml(v.title)}</h3>
            <div class="ch">\${escapeHtml(v.channelName||'')}</div>
            <div class="sub">\${v.views?fmtNum(v.views)+' 回視聴':''}\${v.publishedTime?' • '+escapeHtml(v.publishedTime):''}</div>
          </div>
        </div>\`;
      grid.appendChild(a);
    });
  }catch(e){load.style.display='none';grid.innerHTML='<div style="grid-column:1/-1;color:var(--red);padding:40px;text-align:center">動画取得エラー</div>'}
}

document.querySelectorAll('.tabBtn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tabBtn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tabPanel').forEach(x=>x.classList.add('hidden'));
  document.getElementById('tab'+b.dataset.tab.charAt(0).toUpperCase()+b.dataset.tab.slice(1)).classList.remove('hidden');
}));
</script>`;
  res.send(layout('チャンネル - 柿Tube', body));
});

// ============================================================
//  /library  -  Subscriptions / Favorites / History
// ============================================================
app.get(/^\/library\/?$/, (req, res) => {
  const body = `
<div class="wrap">
  <h2 style="font-size:24px;font-weight:800;margin-bottom:20px">ライブラリ</h2>
  <div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:24px">
    <button class="tabBtn active" data-tab="subs">登録チャンネル</button>
    <button class="tabBtn" data-tab="favs">お気に入り</button>
    <button class="tabBtn" data-tab="hist">履歴</button>
  </div>
  <div id="p_subs" class="tp"></div>
  <div id="p_favs" class="tp hidden"></div>
  <div id="p_hist" class="tp hidden"></div>
</div>
<style>
.tabBtn{background:none;border:none;color:var(--sub);padding:14px 24px;font-size:14px;font-weight:600;border-bottom:2px solid transparent;cursor:pointer}
.tabBtn.active{color:var(--text);border-bottom-color:var(--accent)}
</style>
<script>
function render(){
  const subs=PS.subs();const favs=PS.favs();const hist=PS.hist();
  const ps=document.getElementById('p_subs');
  const entries=Object.entries(subs);
  if(entries.length===0)ps.innerHTML='<div style="color:var(--sub);padding:40px;text-align:center">登録チャンネルはありません</div>';
  else ps.innerHTML='<div class="grid">'+entries.map(([id,s])=>\`
    <a href="/channel/\${id}" style="background:var(--card);border:1px solid var(--border);padding:20px;border-radius:12px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
      <img src="\${s.avatar||'/img/kaki.png'}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;background:#222" onerror="this.src='/img/kaki.png'">
      <div style="font-weight:600;font-size:14px">\${escapeHtml(s.name||'')}</div>
    </a>\`).join('')+'</div>';

  const pf=document.getElementById('p_favs');
  const fav=Object.entries(favs).sort((a,b)=>(b[1].at||0)-(a[1].at||0));
  if(fav.length===0)pf.innerHTML='<div style="color:var(--sub);padding:40px;text-align:center">お気に入りはありません</div>';
  else pf.innerHTML='<div class="grid">'+fav.map(([id,v])=>\`
    <a href="/watch?v=\${id}" class="vcard">
      <div class="thumb"><img src="\${v.thumbnail||('https://i.ytimg.com/vi/'+id+'/hqdefault.jpg')}" loading="lazy"></div>
      <div class="meta"><div class="info"><h3>\${escapeHtml(v.title||'')}</h3><div class="ch">\${escapeHtml(v.author||'')}</div></div></div>
    </a>\`).join('')+'</div>';

  const ph=document.getElementById('p_hist');
  if(hist.length===0)ph.innerHTML='<div style="color:var(--sub);padding:40px;text-align:center">履歴はありません</div>';
  else ph.innerHTML='<div class="grid">'+hist.map(v=>\`
    <a href="/watch?v=\${v.videoId}" class="vcard">
      <div class="thumb"><img src="\${v.thumbnail||('https://i.ytimg.com/vi/'+v.videoId+'/hqdefault.jpg')}" loading="lazy"></div>
      <div class="meta"><div class="info"><h3>\${escapeHtml(v.title||'')}</h3><div class="ch">\${escapeHtml(v.author||'')}</div></div></div>
    </a>\`).join('')+'</div>';
}
render();
document.querySelectorAll('.tabBtn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tabBtn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tp').forEach(x=>x.classList.add('hidden'));
  document.getElementById('p_'+b.dataset.tab).classList.remove('hidden');
}));
</script>`;
  res.send(layout('ライブラリ - 柿Tube', body));
});

// ============================================================
//  API PROXIES
// ============================================================

// --- Search (youtube-search-api 必須)
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    if (!q) return res.json({ items: [], hasNextPage: false });

    const perPage = 20;
    const total = perPage * page;
    let items = [];
    let hasNext = true;
    try {
      const data = await ytsr.GetListByKeyword(q, false, total, [{ type: 'video' }]);
      const arr = (data && data.items) || [];
      hasNext = !!(data && data.nextPage && data.nextPage.nextPageToken);
      items = arr.slice((page - 1) * perPage, page * perPage);
    } catch (e) {
      const j = await apiFetch('/orby/yt/search?q=' + encodeURIComponent(q) + '&page=' + page);
      return res.json({
        items: (j.results || []).map(v => ({
          videoId: v.videoId, title: v.title, thumbnail: v.thumbnail,
          channelName: v.channelName, channelId: v.channelId,
          channelThumbnail: v.channelThumbnail, duration: v.duration,
          views: v.views, publishedTime: v.publishedTime, isLive: v.isLive
        })), hasNextPage: !!j.hasNextPage
      });
    }

    // 並列でチャンネル画像を取得
    const chanCache = {};
    const uniqChans = [...new Set(items.map(v => v.channelTitle).filter(Boolean))];
    await Promise.all(uniqChans.slice(0, 8).map(async name => {
      try {
        const r = await ytsr.GetListByKeyword(name, false, 3, [{ type: 'channel' }]);
        const c = (r.items || []).find(x => x.type === 'channel' && (x.title || '').toLowerCase() === name.toLowerCase())
                || (r.items || []).find(x => x.type === 'channel');
        if (c) {
          const thumb = (c.thumbnail && c.thumbnail.thumbnails && c.thumbnail.thumbnails.slice(-1)[0] && c.thumbnail.thumbnails.slice(-1)[0].url) || '';
          chanCache[name] = { avatar: thumb, channelId: c.id || c.channelId };
        }
      } catch (e) {}
    }));

    const mapped = items.map(v => {
      const t = (v.thumbnail && v.thumbnail.thumbnails && v.thumbnail.thumbnails.slice(-1)[0] && v.thumbnail.thumbnails.slice(-1)[0].url) || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
      const ch = chanCache[v.channelTitle] || {};
      const duration = v.length && v.length.simpleText ? v.length.simpleText : '';
      return {
        videoId: v.id,
        title: v.title,
        thumbnail: t,
        channelName: v.channelTitle || '',
        channelId: ch.channelId || '',
        channelThumbnail: ch.avatar || '',
        duration: duration,
        views: v.viewCount ? Number(String(v.viewCount).replace(/\D/g, '')) : 0,
        publishedTime: (v.publishedTime && v.publishedTime.simpleText) || v.publishedText || '',
        isLive: !!v.isLive
      };
    });
    res.json({ items: mapped, hasNextPage: hasNext });
  } catch (e) {
    res.status(500).json({ error: e.message, items: [] });
  }
});

app.get(/^\/api\/meta\/([^\/]+)$/, async (req, res) => {
  try { const d = await apiFetch('/orby/yt/meta/' + encodeURIComponent(req.params[0])); res.json(d); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/^\/api\/meta-channel\/([^\/]+)$/, async (req, res) => {
  try { const d = await apiFetch('/orby/yt/channel/' + encodeURIComponent(req.params[0])); res.json(d); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/^\/api\/recommend\/([^\/]+)$/, async (req, res) => {
  try { const d = await apiFetch('/orby/yt/recommend/' + encodeURIComponent(req.params[0])); res.json(d); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/^\/api\/comments\/([^\/]+)$/, async (req, res) => {
  try {
    const q = req.query.continuation
      ? '?continuation=' + encodeURIComponent(req.query.continuation)
      : '?page=' + encodeURIComponent(req.query.page || 1);
    const d = await apiFetch('/orby/yt/comments/' + encodeURIComponent(req.params[0]) + q);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get(/^\/api\/formats\/([^\/]+)$/, async (req, res) => {
  try {
    const d = await apiFetch('/orby/yt/' + encodeURIComponent(req.params[0]) + '?format=json&provider=Orby-MAX');
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 動画ページで author 名から channel avatar を取得
app.get('/api/channel-lookup', async (req, res) => {
  const name = (req.query.name || '').toString().trim();
  const channelId = (req.query.channelId || '').toString().trim();
  if (!name && !channelId) return res.json({});
  try {
    const r = await ytsr.GetListByKeyword(name || channelId, false, 5, [{ type: 'channel' }]);
    const items = (r.items || []).filter(x => x.type === 'channel');
    let match = items.find(x => (x.title || '').toLowerCase() === name.toLowerCase());
    if (!match && channelId) match = items.find(x => x.id === channelId || x.channelId === channelId);
    if (!match) match = items[0];
    if (!match) return res.json({});
    const avatar = (match.thumbnail && match.thumbnail.thumbnails && match.thumbnail.thumbnails.slice(-1)[0] && match.thumbnail.thumbnails.slice(-1)[0].url) || '';
    res.json({ name: match.title, avatar, channelId: match.id || match.channelId });
  } catch (e) { res.json({ error: e.message }); }
});

// チャンネルの投稿動画（youtube-search-api で名前検索）
app.get('/api/channel-videos', async (req, res) => {
  const name = (req.query.name || '').toString().trim();
  if (!name) return res.json({ items: [] });
  try {
    const r = await ytsr.GetListByKeyword(name, false, 40, [{ type: 'video' }]);
    const arr = (r.items || []);
    const matched = arr.filter(v => (v.channelTitle || '').toLowerCase() === name.toLowerCase());
    const items = (matched.length ? matched : arr).slice(0, 30).map(v => ({
      videoId: v.id,
      title: v.title,
      thumbnail: (v.thumbnail && v.thumbnail.thumbnails && v.thumbnail.thumbnails.slice(-1)[0] && v.thumbnail.thumbnails.slice(-1)[0].url) || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      channelName: v.channelTitle || '',
      duration: (v.length && v.length.simpleText) || '',
      views: v.viewCount ? Number(String(v.viewCount).replace(/\D/g, '')) : 0,
      publishedTime: (v.publishedTime && v.publishedTime.simpleText) || v.publishedText || ''
    }));
    res.json({ items });
  } catch (e) { res.json({ items: [], error: e.message }); }
});

// ============================================================
//  /orby/yt/:videoId  -  直接 302 で 360p ストリームに転送
// ============================================================
app.get(/^\/orby\/yt\/([^\/]+)$/, async (req, res) => {
  const vid = req.params[0];
  const qs = new URLSearchParams(req.query).toString();
  for (const base of API_BASES) {
    try {
      const url = base + '/orby/yt/' + encodeURIComponent(vid) + (qs ? '?' + qs : '');
      const r = await _fetch(url, { redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (loc) return res.redirect(302, loc);
      }
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) return res.type('application/json').send(await r.text());
      }
    } catch (e) {}
  }
  res.status(502).send('Stream unavailable');
});

// ============================================================
//  404
// ============================================================
app.get('*', (req, res) => {
  res.status(404).send(layout('404',
    '<div class="wrap" style="text-align:center;padding:80px 20px">' +
    '<h1 style="font-size:80px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent">404</h1>' +
    '<p style="color:var(--sub);margin-top:12px">ページが見つかりませんでした</p>' +
    '<a href="/" class="pill" style="display:inline-block;margin-top:20px;padding:12px 24px">ホームへ戻る</a></div>'));
});

app.listen(PORT, () => console.log('🍊 Persimmon running on port ' + PORT));

module.exports = app;
