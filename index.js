const express = require('express');
const path = require('path');
const youtubesearchapi = require('youtube-search-api');

const app = express();
const PORT = process.env.PORT || 3000;

const ORBY_HOSTS = [
  'https://orby-api.vercel.app',
  'https://orby-api.onrender.com'
];

app.use(express.static(path.join(__dirname, 'public')));

/* ---------- ORBY fetch with fallback ---------- */
async function orbyFetch(pathAndQuery){
  let lastErr;
  for(const host of ORBY_HOSTS){
    try{
      const r = await fetch(host + pathAndQuery, { headers:{ 'accept':'application/json' } });
      if(!r.ok) { lastErr = new Error(host+' -> '+r.status); continue; }
      const ct = r.headers.get('content-type')||'';
      if(ct.includes('application/json')) return await r.json();
      return await r.text();
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('All Orby hosts failed');
}

/* =============================================================
 *  API PROXIES
 * ============================================================= */
app.get('/api/search', async (req,res)=>{
  const q = (req.query.q||'').trim();
  const page = parseInt(req.query.page||'1',10);
  if(!q) return res.status(400).json({error:'q required'});
  try{
    const data = await youtubesearchapi.GetListByKeyword(q, false, 30, [{type:'video'},{type:'channel'}]);
    res.json(data);
  }catch(e){
    try{
      const fallback = await orbyFetch(`/orby/yt/search?q=${encodeURIComponent(q)}&page=${page}`);
      res.json({ items: (fallback.results||[]).map(v=>({
        id:v.videoId, type:'video',
        title:v.title,
        thumbnail:{thumbnails:[{url:v.thumbnail}]},
        channelTitle:v.channelName,
        length:{simpleText:v.duration},
        viewCount: v.views,
        publishedTime: v.publishedTime,
        channelThumbnail: v.channelThumbnail
      })), nextPage:fallback.nextPage });
    }catch(err){
      res.status(500).json({error:String(err.message||err)});
    }
  }
});

app.get('/api/meta/:videoId', async (req,res)=>{
  try{ res.json(await orbyFetch('/orby/yt/meta/'+encodeURIComponent(req.params.videoId))); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get('/api/channel/:channelId', async (req,res)=>{
  try{ res.json(await orbyFetch('/orby/yt/channel/'+encodeURIComponent(req.params.channelId))); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get('/api/comments/:videoId', async (req,res)=>{
  const page = req.query.page||1;
  const cont = req.query.continuation ? `&continuation=${encodeURIComponent(req.query.continuation)}` : '';
  try{ res.json(await orbyFetch(`/orby/yt/comments/${encodeURIComponent(req.params.videoId)}?page=${page}${cont}`)); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get('/api/recommend/:videoId', async (req,res)=>{
  try{ res.json(await orbyFetch('/orby/yt/recommend/'+encodeURIComponent(req.params.videoId))); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get('/api/formats/:videoId', async (req,res)=>{
  try{ res.json(await orbyFetch(`/orby/yt/${encodeURIComponent(req.params.videoId)}?format=json&provider=Orby-MAX`)); }
  catch(e){ res.status(500).json({error:String(e.message||e)}); }
});
app.get('/api/channel-videos', async (req,res)=>{
  const name = (req.query.name||'').trim();
  if(!name) return res.status(400).json({error:'name required'});
  try{
    const data = await youtubesearchapi.GetListByKeyword(name, false, 40, [{type:'video'}]);
    res.json(data);
  }catch(e){ res.status(500).json({error:String(e.message||e)}); }
});

/* =============================================================
 *  SHARED HTML SHELL
 * ============================================================= */
const SHARED_CSS = `
:root{
  --persimmon:#F2731A;--persimmon-dark:#D45A0A;--persimmon-soft:#FFE4CC;
  --leaf:#3E7C4A;--bg:#FFFBF7;--surface:#fff;--surface-2:#faf5f0;
  --text:#1a1a1a;--text-sub:#666;--text-mute:#999;
  --border:rgba(0,0,0,.08);--shadow:0 4px 20px rgba(0,0,0,.06);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;min-height:100vh}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%}
.topbar{
  position:sticky;top:0;z-index:100;background:rgba(255,251,247,.92);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:20px;
}
.topbar .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:22px;
  background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));
  -webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:-.5px}
.topbar .brand img{width:32px;height:32px}
.topbar .search{flex:1;max-width:640px;display:flex;background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:4px 4px 4px 20px;align-items:center;transition:box-shadow .2s}
.topbar .search:focus-within{box-shadow:0 4px 20px rgba(242,115,26,.15);border-color:var(--persimmon-soft)}
.topbar .search input{flex:1;border:none;outline:none;background:transparent;padding:10px 8px;font-size:14px;font-family:inherit}
.topbar .search button{background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));color:#fff;border:none;border-radius:999px;padding:8px 18px;font-weight:600;cursor:pointer;font-size:13px}
.topbar .home-link{color:var(--text-sub);font-size:13px;padding:8px 12px;border-radius:8px;transition:background .15s}
.topbar .home-link:hover{background:var(--surface-2)}
.container{max-width:1400px;margin:0 auto;padding:24px}
.skeleton{background:linear-gradient(90deg,#eee 0%,#f5f5f5 50%,#eee 100%);background-size:200% 100%;animation:sh 1.4s infinite;border-radius:8px}
@keyframes sh{from{background-position:200% 0}to{background-position:-200% 0}}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);padding:6px 12px;border-radius:999px;font-size:12px;color:var(--text-sub)}
button.btn{background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));color:#fff;border:none;border-radius:999px;padding:10px 20px;font-weight:600;cursor:pointer;font-size:14px;transition:transform .15s;font-family:inherit}
button.btn:hover{transform:translateY(-1px)}
button.btn.ghost{background:var(--surface);color:var(--text);border:1px solid var(--border);box-shadow:none}
`;

function shell(title, body, extraCss=''){
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="icon" href="/img/kaki.png">
<style>${SHARED_CSS}${extraCss}</style></head><body>
<header class="topbar">
  <a class="brand" href="/"><img src="/img/kaki.png" onerror="this.style.display='none'"/><span>柿Tube</span></a>
  <form class="search" onsubmit="var v=this.q.value.trim();if(!v)return false;var m=v.match(/([\\w-]{11})/);if(/youtu/.test(v)&&m){location.href='/watch?v='+m[1];}else{location.href='/search?q='+encodeURIComponent(v);}return false;">
    <input name="q" placeholder="柿Tubeを検索…" autocomplete="off"/>
    <button type="submit">検索</button>
  </form>
  <a class="home-link" href="/">ホーム</a>
</header>
${body}
</body></html>`;
}

/* =============================================================
 *  /search
 * ============================================================= */
app.get('/search', (req,res)=>{
  const q = req.query.q || '';
  const css = `
    .layout{display:grid;grid-template-columns:1fr;gap:16px;max-width:1100px;margin:0 auto}
    .result{display:grid;grid-template-columns:360px 1fr;gap:20px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px;transition:transform .2s,box-shadow .2s;cursor:pointer}
    .result:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(242,115,26,.12);border-color:var(--persimmon-soft)}
    .thumb{position:relative;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden}
    .thumb img{width:100%;height:100%;object-fit:cover}
    .duration{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.85);color:#fff;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600}
    .meta h3{font-size:18px;font-weight:700;margin-bottom:8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .channel-line{display:flex;align-items:center;gap:10px;margin:12px 0;color:var(--text-sub);font-size:13px}
    .channel-line img{width:28px;height:28px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
    .stats{color:var(--text-mute);font-size:13px}
    .stats span+span::before{content:"·";margin:0 8px}
    .channel-card{background:linear-gradient(135deg,#fff,var(--surface-2));border:1px solid var(--persimmon-soft);border-radius:16px;padding:16px 20px;display:flex;align-items:center;gap:20px;cursor:pointer}
    .channel-card img{width:80px;height:80px;border-radius:50%;object-fit:cover;background:#eee}
    .channel-card .n{font-weight:700;font-size:18px}
    .channel-card .s{color:var(--text-sub);font-size:13px;margin-top:4px}
    .heading{padding:20px 0 8px;font-size:14px;color:var(--text-sub);font-weight:600;letter-spacing:.5px;text-transform:uppercase}
    @media(max-width:720px){.result{grid-template-columns:1fr}}
    .empty{text-align:center;padding:80px 20px;color:var(--text-sub)}
  `;
  const body = `
  <main class="container">
    <div id="results" class="layout"></div>
  </main>
  <script>
  const q = ${JSON.stringify(q)};
  const box = document.getElementById('results');
  box.innerHTML = '<div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div>';

  function fmtViews(v){
    if(!v)return '';
    if(typeof v==='string') return v;
    if(v>=1e8)return (v/1e8).toFixed(1)+'億回視聴';
    if(v>=1e4)return (v/1e4).toFixed(1)+'万回視聴';
    return v.toLocaleString()+' 回視聴';
  }

  fetch('/api/search?q='+encodeURIComponent(q)).then(r=>r.json()).then(data=>{
    const items = data.items||[];
    if(!items.length){ box.innerHTML='<div class="empty">結果が見つかりませんでした</div>'; return; }
    const chans=[], vids=[];
    items.forEach(it=>{
      if(it.type==='channel') chans.push(it);
      else if(it.type==='video'||it.videoId||it.id) vids.push(it);
    });
    let html='';
    if(chans.length){
      html += '<div class="heading">チャンネル</div>';
      chans.slice(0,3).forEach(c=>{
        const cid = c.channelId || c.id;
        const av = (c.thumbnail && (c.thumbnail.thumbnails? c.thumbnail.thumbnails.slice(-1)[0].url : c.thumbnail)) || '';
        html += \`<a class="channel-card" href="/channel/\${cid}">
          <img src="\${av}" onerror="this.style.visibility='hidden'"/>
          <div><div class="n">\${c.title||c.name||''}</div>
          <div class="s">\${c.videoCount? c.videoCount+' 本の動画':''} \${c.subscriberCount||''}</div></div>
        </a>\`;
      });
    }
    html += '<div class="heading">動画</div>';
    vids.forEach(v=>{
      const id = v.id || v.videoId;
      const t  = v.title;
      const th = (v.thumbnail && (v.thumbnail.thumbnails? v.thumbnail.thumbnails.slice(-1)[0].url : v.thumbnail)) || '';
      const dur = (v.length && (v.length.simpleText||v.length)) || v.duration || '';
      const ch = v.channelTitle || v.channelName || (v.shortBylineText && v.shortBylineText.runs && v.shortBylineText.runs[0].text) || '';
      const cThumb = v.channelThumbnail || '';
      const views = fmtViews(v.viewCount || v.views);
      const pub = v.publishedTime || v.publishedTimeText || '';
      html += \`<a class="result" href="/watch?v=\${id}">
        <div class="thumb"><img loading="lazy" src="\${th}"/>\${dur?\`<span class="duration">\${dur}</span>\`:''}</div>
        <div class="meta">
          <h3>\${t}</h3>
          <div class="channel-line">
            \${cThumb?\`<img src="\${cThumb}"/>\`:'<div style="width:28px;height:28px;border-radius:50%;background:var(--surface-2)"></div>'}
            <span>\${ch}</span>
          </div>
          <div class="stats">\${views?\`<span>\${views}</span>\`:''}\${pub?\`<span>\${pub}</span>\`:''}</div>
        </div>
      </a>\`;
    });
    box.innerHTML = html;
  }).catch(e=>{ box.innerHTML='<div class="empty">エラー: '+e.message+'</div>'; });
  </script>`;
  res.send(shell('「'+q+'」の検索結果 · 柿Tube', body, css));
});

/* =============================================================
 *  /watch
 * ============================================================= */
app.get(/^\/watch\/?$/, (req,res)=>{
  const vid = req.query.v || '';
  const css = `
    .watch{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:28px;max-width:1600px;margin:0 auto}
    @media(max-width:1100px){.watch{grid-template-columns:1fr}}
    .player-wrap{background:#000;border-radius:16px;overflow:hidden;aspect-ratio:16/9;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.25)}
    .player-wrap video{width:100%;height:100%;background:#000}
    .player-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;background:radial-gradient(circle at center,#333,#000)}
    .player-loading .spin{width:48px;height:48px;border:3px solid rgba(255,255,255,.15);border-top-color:var(--persimmon);border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .quality-bar{position:absolute;bottom:12px;right:12px;display:flex;gap:6px;opacity:0;transition:opacity .25s;pointer-events:none}
    .player-wrap:hover .quality-bar,.quality-bar.open{opacity:1;pointer-events:auto}
    .quality-btn{background:rgba(0,0,0,.75);color:#fff;border:none;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;backdrop-filter:blur(6px)}
    .quality-menu{position:absolute;bottom:52px;right:12px;background:rgba(24,24,24,.95);backdrop-filter:blur(10px);border-radius:12px;padding:6px;min-width:160px;display:none;box-shadow:0 20px 40px rgba(0,0,0,.5)}
    .quality-menu.open{display:block}
    .quality-menu button{display:block;width:100%;background:transparent;color:#fff;border:none;padding:8px 12px;border-radius:8px;text-align:left;cursor:pointer;font-size:13px;font-family:inherit}
    .quality-menu button:hover{background:rgba(255,255,255,.1)}
    .quality-menu button.active{background:var(--persimmon)}
    .title{font-size:22px;font-weight:700;margin:20px 0 12px;line-height:1.4}
    .video-meta{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;padding:12px 0;border-bottom:1px solid var(--border)}
    .ch-info{display:flex;align-items:center;gap:14px}
    .ch-info img{width:48px;height:48px;border-radius:50%;object-fit:cover;background:var(--surface-2)}
    .ch-info .name{font-weight:700;font-size:15px}
    .ch-info .subs{color:var(--text-sub);font-size:12px;margin-top:2px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}
    .actions button{background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:9px 16px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;transition:background .15s}
    .actions button:hover{background:var(--persimmon-soft)}
    .actions button.active{background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));color:#fff;border-color:transparent}
    .subscribe{background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark))!important;color:#fff!important;border:none!important}
    .subscribe.subd{background:var(--surface-2)!important;color:var(--text)!important;border:1px solid var(--border)!important}
    .desc{background:var(--surface-2);border-radius:12px;padding:16px;margin-top:16px;white-space:pre-wrap;font-size:14px;line-height:1.7;max-height:150px;overflow:hidden;position:relative;cursor:pointer;transition:max-height .3s}
    .desc.open{max-height:none}
    .desc .fade{position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,var(--surface-2));pointer-events:none}
    .desc.open .fade{display:none}
    .desc .stats{color:var(--text-sub);font-size:13px;margin-bottom:8px;font-weight:600}
    .side{display:flex;flex-direction:column;gap:12px}
    .side h3{font-size:15px;font-weight:700;margin-bottom:4px}
    .rec{display:grid;grid-template-columns:168px 1fr;gap:10px;cursor:pointer;padding:6px;border-radius:10px;transition:background .15s}
    .rec:hover{background:var(--surface-2)}
    .rec .th{aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;position:relative}
    .rec .th img{width:100%;height:100%;object-fit:cover}
    .rec .dur{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.85);color:#fff;padding:1px 6px;border-radius:4px;font-size:11px}
    .rec .t{font-size:14px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .rec .c{color:var(--text-sub);font-size:12px;margin-top:4px}
    .comments{margin-top:32px}
    .comments h3{font-size:18px;font-weight:700;margin-bottom:20px}
    .comment{display:grid;grid-template-columns:40px 1fr;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)}
    .comment img{width:40px;height:40px;border-radius:50%;background:var(--surface-2);object-fit:cover}
    .comment .head{font-size:13px;font-weight:600;margin-bottom:4px}
    .comment .head span{color:var(--text-mute);font-weight:400;margin-left:8px;font-size:12px}
    .comment .body{font-size:14px;line-height:1.5;white-space:pre-wrap}
    .comment .like{color:var(--text-sub);font-size:12px;margin-top:6px}
    .load-more{background:var(--surface-2);border:1px solid var(--border);padding:12px;border-radius:12px;width:100%;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:var(--text-sub)}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:12px 24px;border-radius:999px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s,transform .3s;pointer-events:none}
    .toast.show{opacity:1;transform:translate(-50%,-8px)}
  `;
  const body = `
  <main class="container">
    <div class="watch">
      <div>
        <div class="player-wrap" id="playerWrap">
          <video id="video" playsinline controls></video>
          <video id="audio" style="display:none" playsinline></video>
          <div class="player-loading" id="loading"><div class="spin"></div></div>
          <div class="quality-bar">
            <button class="quality-btn" id="qBtn">画質: 360p ▾</button>
          </div>
          <div class="quality-menu" id="qMenu"></div>
        </div>
        <h1 class="title" id="title">読み込み中…</h1>
        <div class="video-meta">
          <div class="ch-info">
            <a id="chAvatarLink" href="#"><img id="chAvatar" src=""/></a>
            <div>
              <a id="chNameLink" href="#" class="name" style="display:block" id="chName">—</a>
              <div class="subs" id="chSubs"></div>
            </div>
            <button class="btn subscribe" id="subBtn">チャンネル登録</button>
          </div>
          <div class="actions">
            <button id="likeBtn">👍 <span id="likeCount">—</span></button>
            <button id="favBtn">☆ お気に入り</button>
            <button id="shareBtn">🔗 共有</button>
            <a id="ytOpen" target="_blank"><button>▶ YouTube で開く</button></a>
          </div>
        </div>
        <div class="desc" id="desc" onclick="this.classList.toggle('open')">
          <div class="stats" id="descStats"></div>
          <div id="descText"></div>
          <div class="fade"></div>
        </div>
        <div class="comments">
          <h3 id="commentsHeading">コメント</h3>
          <div id="commentsList"></div>
          <button class="load-more" id="loadMoreC" style="display:none">さらに読み込む</button>
        </div>
      </div>
      <aside class="side">
        <h3>関連動画</h3>
        <div id="recs"></div>
      </aside>
    </div>
  </main>
  <div class="toast" id="toast"></div>
  <script>
  const VID = ${JSON.stringify(vid)};
  if(!VID){ document.body.innerHTML='<p style="padding:40px">動画IDがありません</p>'; }

  const video = document.getElementById('video');
  const audio = document.getElementById('audio');
  const loading = document.getElementById('loading');
  const qBtn = document.getElementById('qBtn');
  const qMenu = document.getElementById('qMenu');
  const toast = document.getElementById('toast');

  function showToast(msg){ toast.textContent=msg; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),1800); }
  function fmtViews(v){ if(!v)return '';v=Number(v); if(v>=1e8)return(v/1e8).toFixed(1)+'億回視聴';if(v>=1e4)return(v/1e4).toFixed(1)+'万回視聴'; return v.toLocaleString()+' 回視聴'; }
  function fmtSubs(v){ if(!v)return '';v=Number(String(v).replace(/[^0-9]/g,''))||v;if(!v||isNaN(v))return arguments[0]||'';if(v>=1e8)return(v/1e8).toFixed(1)+'億人';if(v>=1e4)return(v/1e4).toFixed(1)+'万人';return v.toLocaleString()+'人'; }

  /* ---- Player: start with 360p (itag=18) as combined stream ---- */
  video.src = '/orby/yt/'+VID+'?itag=18';
  video.addEventListener('loadeddata',()=>{ loading.style.display='none'; });
  video.addEventListener('error',()=>{ loading.innerHTML='<div style="color:#fff">再生に失敗しました</div>'; });

  /* ---- Sync engine for adaptive formats ---- */
  let currentVideoUrl=null, currentAudioUrl=null, syncing=false, formats=null;
  const SYNC_THRESHOLD = 0.15;

  function attachSync(){
    if(syncing) return;
    syncing=true;
    audio.addEventListener('timeupdate', driftCheck);
    video.addEventListener('play',()=>{ audio.play().catch(()=>{}); });
    video.addEventListener('pause',()=>audio.pause());
    video.addEventListener('seeking',()=>{ audio.currentTime = video.currentTime; });
    video.addEventListener('ratechange',()=>{ audio.playbackRate = video.playbackRate; });
    video.addEventListener('volumechange',()=>{ audio.volume = video.volume; audio.muted = video.muted; });
  }
  function driftCheck(){
    if(!currentAudioUrl) return;
    const diff = video.currentTime - audio.currentTime;
    if(Math.abs(diff) > SYNC_THRESHOLD) audio.currentTime = video.currentTime;
  }

  function pickFormats(fmts){
    // Video-only (adaptive) list
    const videoOnly = fmts.filter(f=>f.hasVideo && !f.hasAudio && f.qualityLabel).sort((a,b)=>parseInt(b.qualityLabel)-parseInt(a.qualityLabel));
    const combined  = fmts.filter(f=>f.hasVideo && f.hasAudio && f.qualityLabel);
    const audioOnly = fmts.filter(f=>f.hasAudio && !f.hasVideo).sort((a,b)=>(b.bitrate||b.audioBitrate||0)-(a.bitrate||a.audioBitrate||0));
    return {videoOnly, combined, audioOnly};
  }

  async function loadQualityMenu(){
    try{
      const j = await fetch('/api/formats/'+VID).then(r=>r.json());
      const fmts = (j.formats || j.adaptiveFormats || []).concat(j.formats||[]);
      // Some providers put streams under different keys
      let all = [];
      if(Array.isArray(j.formats)) all = all.concat(j.formats);
      if(Array.isArray(j.adaptiveFormats)) all = all.concat(j.adaptiveFormats);
      if(Array.isArray(j.streams)) all = all.concat(j.streams);
      if(!all.length && Array.isArray(fmts)) all = fmts;
      const picked = pickFormats(all);
      formats = picked;
      const bestAudio = picked.audioOnly[0];
      const opts = [];
      // Always keep 360p combined option
      const combined360 = picked.combined.find(f=>/360/.test(f.qualityLabel)) || picked.combined[0];
      if(combined360) opts.push({label:'360p (標準)', url: combined360.url, mode:'combined'});
      picked.videoOnly.forEach(f=>{
        if(bestAudio) opts.push({label:f.qualityLabel, url:f.url, mode:'split', audioUrl:bestAudio.url});
      });
      // dedupe
      const seen = new Set();
      const uniq = opts.filter(o=>{ if(seen.has(o.label))return false; seen.add(o.label);return true;});
      renderQualityMenu(uniq);
    }catch(e){ /* silent */ }
  }

  function renderQualityMenu(opts){
    if(!opts.length) return;
    qMenu.innerHTML = opts.map((o,i)=>\`<button data-i="\${i}" class="\${i===0?'active':''}">\${o.label}</button>\`).join('');
    qBtn.addEventListener('click',()=>qMenu.classList.toggle('open'));
    qMenu.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click',()=>{
        const i = +b.dataset.i;
        const o = opts[i];
        qMenu.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        qBtn.textContent = '画質: '+o.label+' ▾';
        qMenu.classList.remove('open');
        switchQuality(o);
      });
    });
  }

  function switchQuality(o){
    const t = video.currentTime, wasPlaying = !video.paused;
    if(o.mode==='combined'){
      audio.pause(); audio.removeAttribute('src'); currentAudioUrl=null;
      video.muted = false;
      video.src = o.url;
    } else {
      // split: mute video, play audio track in parallel
      video.muted = true;
      video.src = o.url;
      audio.src = o.audioUrl;
      currentAudioUrl = o.audioUrl;
      attachSync();
    }
    video.addEventListener('loadedmetadata',function once(){
      video.currentTime = t;
      if(currentAudioUrl){ audio.currentTime = t; }
      if(wasPlaying){ video.play(); if(currentAudioUrl) audio.play(); }
      video.removeEventListener('loadedmetadata',once);
    });
  }

  /* ---- Metadata ---- */
  fetch('/api/meta/'+VID).then(r=>r.json()).then(m=>{
    document.title = (m.title||'') + ' · 柿Tube';
    document.getElementById('title').textContent = m.title||'';
    document.getElementById('descStats').textContent = [fmtViews(m.viewCount), m.publishedAt||''].filter(Boolean).join(' · ');
    document.getElementById('descText').textContent = m.description||'';
    document.getElementById('likeCount').textContent = m.likeCount? Number(m.likeCount).toLocaleString():'—';
    document.getElementById('ytOpen').href='https://www.youtube.com/watch?v='+VID;
    if(m.channelId){
      document.getElementById('chNameLink').href='/channel/'+m.channelId;
      document.getElementById('chAvatarLink').href='/channel/'+m.channelId;
      document.getElementById('chNameLink').textContent = m.author||'';
      fetch('/api/channel/'+m.channelId).then(r=>r.json()).then(c=>{
        if(c.avatar) document.getElementById('chAvatar').src = c.avatar;
        if(c.subscriberCount) document.getElementById('chSubs').textContent = fmtSubs(c.subscriberCount)+' チャンネル登録者';
      }).catch(()=>{});
      // subscribe state
      const subs = JSON.parse(localStorage.getItem('persimmon.subs')||'[]');
      const isSub = subs.includes(m.channelId);
      const sb = document.getElementById('subBtn');
      const paint=()=>{ sb.classList.toggle('subd',isSub); sb.textContent = isSub? '✓ 登録済み':'チャンネル登録'; };
      paint();
      sb.addEventListener('click',()=>{
        const s = JSON.parse(localStorage.getItem('persimmon.subs')||'[]');
        const i = s.indexOf(m.channelId);
        if(i>=0){ s.splice(i,1); showToast('登録解除しました'); }
        else{ s.push(m.channelId); showToast('チャンネル登録しました'); }
        localStorage.setItem('persimmon.subs',JSON.stringify(s));
        location.reload();
      });
    }
    loadQualityMenu();
  });

  /* ---- Favorite / Share ---- */
  const favs = JSON.parse(localStorage.getItem('persimmon.favs')||'[]');
  const favBtn = document.getElementById('favBtn');
  const isFav = ()=>favs.includes(VID);
  const paintFav=()=>{ favBtn.classList.toggle('active',isFav()); favBtn.innerHTML = isFav()?'★ お気に入り済み':'☆ お気に入り'; };
  paintFav();
  favBtn.addEventListener('click',()=>{
    const arr = JSON.parse(localStorage.getItem('persimmon.favs')||'[]');
    const i = arr.indexOf(VID);
    if(i>=0){arr.splice(i,1);showToast('お気に入りから削除');}
    else{arr.unshift(VID);showToast('お気に入りに追加');}
    localStorage.setItem('persimmon.favs',JSON.stringify(arr));
    paintFav();
  });
  document.getElementById('shareBtn').addEventListener('click',async()=>{
    const url = location.href;
    try{ await navigator.clipboard.writeText(url); showToast('リンクをコピーしました'); }
    catch{ prompt('リンクをコピー', url); }
  });

  /* ---- Recommendations ---- */
  fetch('/api/recommend/'+VID).then(r=>r.json()).then(d=>{
    const list = d.recommendations||[];
    const box = document.getElementById('recs');
    box.innerHTML = list.map(r=>\`
      <a class="rec" href="/watch?v=\${r.videoId}">
        <div class="th"><img loading="lazy" src="\${r.thumbnail||''}"/></div>
        <div><div class="t">\${r.title||''}</div><div class="c">\${r.author||''}</div></div>
      </a>\`).join('');
  }).catch(()=>{ document.getElementById('recs').innerHTML='<div style="color:#999;font-size:13px">関連動画を取得できませんでした</div>'; });

  /* ---- Comments ---- */
  let contToken=null, cPage=1;
  function loadComments(){
    const url = contToken? '/api/comments/'+VID+'?continuation='+encodeURIComponent(contToken) : '/api/comments/'+VID+'?page='+cPage;
    fetch(url).then(r=>r.json()).then(d=>{
      const list = d.comments||[];
      const box = document.getElementById('commentsList');
      list.forEach(c=>{
        const el = document.createElement('div');
        el.className='comment';
        el.innerHTML = \`
          <img src="\${c.authorThumbnail||''}"/>
          <div>
            <div class="head">\${c.author||''}<span>\${c.publishedTime||''}</span></div>
            <div class="body">\${(c.text||'').replace(/</g,'&lt;')}</div>
            <div class="like">👍 \${c.likeCountText||c.likeCount||0}</div>
          </div>\`;
        box.appendChild(el);
      });
      const btn = document.getElementById('loadMoreC');
      if(d.hasNextPage){
        contToken = d.continuationToken || null;
        cPage++;
        btn.style.display='block';
      } else { btn.style.display='none'; }
    }).catch(()=>{});
  }
  loadComments();
  document.getElementById('loadMoreC').addEventListener('click',loadComments);
  </script>`;
  res.send(shell('柿Tube 視聴', body, css));
});

/* =============================================================
 *  /channel/:id
 * ============================================================= */
app.get(/^\/channel\/([\w-]+)\/?$/, (req,res)=>{
  const cid = req.params[0];
  const css = `
    .banner{aspect-ratio:6/1;background:linear-gradient(135deg,var(--persimmon-soft),#fff);border-radius:20px;overflow:hidden;position:relative;background-size:cover;background-position:center}
    .ch-header{display:flex;gap:24px;align-items:center;padding:24px 0;flex-wrap:wrap}
    .ch-header img.av{width:120px;height:120px;border-radius:50%;background:var(--surface-2);object-fit:cover;box-shadow:0 10px 30px rgba(0,0,0,.1)}
    .ch-title{font-size:32px;font-weight:800;letter-spacing:-.5px}
    .ch-sub{color:var(--text-sub);margin-top:6px;font-size:14px}
    .ch-desc{max-width:800px;color:var(--text-sub);font-size:14px;margin-top:12px;line-height:1.6;white-space:pre-wrap;max-height:80px;overflow:hidden;cursor:pointer}
    .ch-desc.open{max-height:none}
    .ch-actions{margin-left:auto;display:flex;gap:8px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;margin-top:24px}
    .card{cursor:pointer;background:var(--surface);border-radius:14px;overflow:hidden;border:1px solid var(--border);transition:transform .2s,box-shadow .2s}
    .card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(0,0,0,.08)}
    .card .th{aspect-ratio:16/9;background:#000;position:relative;overflow:hidden}
    .card .th img{width:100%;height:100%;object-fit:cover}
    .card .th .d{position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.85);color:#fff;padding:2px 6px;border-radius:4px;font-size:11px}
    .card .info{padding:12px 14px}
    .card .t{font-weight:600;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .card .m{color:var(--text-sub);font-size:12px;margin-top:6px}
    .section-title{font-size:20px;font-weight:700;margin-top:32px}
    .empty{padding:60px;text-align:center;color:var(--text-sub)}
    .subscribe{background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));color:#fff;border:none;border-radius:999px;padding:12px 28px;font-weight:700;cursor:pointer;font-family:inherit;font-size:14px}
    .subscribe.subd{background:var(--surface-2);color:var(--text);border:1px solid var(--border)}
  `;
  const body = `
  <main class="container">
    <div class="banner" id="banner"></div>
    <div class="ch-header">
      <img class="av" id="avatar"/>
      <div style="flex:1;min-width:260px">
        <div class="ch-title" id="chName">読み込み中…</div>
        <div class="ch-sub" id="chSub"></div>
        <div class="ch-desc" id="chDesc" onclick="this.classList.toggle('open')"></div>
      </div>
      <div class="ch-actions">
        <button class="subscribe" id="subBtn">チャンネル登録</button>
      </div>
    </div>
    <div class="section-title">投稿動画</div>
    <div class="grid" id="grid"></div>
  </main>
  <script>
  const CID = ${JSON.stringify(cid)};
  function fmtSubs(v){if(!v)return '';v=Number(String(v).replace(/[^0-9]/g,''))||v;if(!v||isNaN(v))return '';if(v>=1e8)return(v/1e8).toFixed(1)+'億人';if(v>=1e4)return(v/1e4).toFixed(1)+'万人';return v.toLocaleString()+'人';}

  fetch('/api/channel/'+CID).then(r=>r.json()).then(c=>{
    document.title = (c.name||'')+ ' · 柿Tube';
    document.getElementById('chName').textContent = c.name||'';
    document.getElementById('chSub').textContent = [c.vanityUrl?'@'+c.vanityUrl.replace(/^@/,''):'', fmtSubs(c.subscriberCount)+' 登録者', (c.videoCount||'')+(c.videoCount?' 本の動画':'')].filter(Boolean).join(' · ');
    document.getElementById('chDesc').textContent = c.description||'';
    if(c.avatar) document.getElementById('avatar').src = c.avatar;
    if(c.banner) document.getElementById('banner').style.backgroundImage = 'url('+c.banner+')';

    const subs = JSON.parse(localStorage.getItem('persimmon.subs')||'[]');
    const sb = document.getElementById('subBtn');
    const paint=()=>{ const on=subs.includes(CID); sb.classList.toggle('subd',on); sb.textContent = on?'✓ 登録済み':'チャンネル登録'; };
    paint();
    sb.addEventListener('click',()=>{
      const arr = JSON.parse(localStorage.getItem('persimmon.subs')||'[]');
      const i = arr.indexOf(CID); if(i>=0)arr.splice(i,1); else arr.push(CID);
      localStorage.setItem('persimmon.subs',JSON.stringify(arr));
      location.reload();
    });

    // Load videos via youtube-search-api by channel name
    fetch('/api/channel-videos?name='+encodeURIComponent(c.name||'')).then(r=>r.json()).then(d=>{
      const grid = document.getElementById('grid');
      const items = (d.items||[]).filter(v=>v.type==='video'||v.videoId||v.id);
      if(!items.length){ grid.innerHTML='<div class="empty">投稿動画が取得できませんでした</div>'; return; }
      grid.innerHTML = items.slice(0,40).map(v=>{
        const id=v.id||v.videoId;
        const t=v.title;
        const th=(v.thumbnail&&(v.thumbnail.thumbnails?v.thumbnail.thumbnails.slice(-1)[0].url:v.thumbnail))||'';
        const dur=(v.length&&(v.length.simpleText||v.length))||v.duration||'';
        return \`<a class="card" href="/watch?v=\${id}">
          <div class="th"><img loading="lazy" src="\${th}"/>\${dur?\`<span class="d">\${dur}</span>\`:''}</div>
          <div class="info"><div class="t">\${t}</div><div class="m">\${v.channelTitle||v.channelName||''}</div></div>
        </a>\`;
      }).join('');
    });
  }).catch(()=>{ document.getElementById('chName').textContent='チャンネルを取得できませんでした'; });
  </script>`;
  res.send(shell('チャンネル · 柿Tube', body, css));
});

/* =============================================================
 *  /orby/yt/* — direct passthrough to Orby (302 or JSON)
 * ============================================================= */
app.get(/^\/orby\/yt\/([^\/]+)\/?$/, async (req,res)=>{
  const id = req.params[0];
  const qs = new URLSearchParams(req.query).toString();
  const target = `/orby/yt/${id}${qs?'?'+qs:''}`;
  if(req.query.format==='json'){
    try{ return res.json(await orbyFetch(target)); }
    catch(e){ return res.status(502).json({error:String(e.message||e)}); }
  }
  // Redirect chain (Orby returns 302). We proxy the redirect so the browser hits us for range requests.
  for(const host of ORBY_HOSTS){
    try{
      const r = await fetch(host+target, { redirect:'manual' });
      const loc = r.headers.get('location');
      if(loc){ return res.redirect(302, loc); }
      if(r.ok){ return res.redirect(302, host+target); }
    }catch(e){}
  }
  res.status(502).send('upstream unavailable');
});

/* =============================================================
 *  /embed.html — placeholder (user implements WebUnblocker)
 * ============================================================= */
app.get('/embed.html', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Proxy</title>
  <style>body{font-family:sans-serif;padding:40px;background:#FFFBF7;color:#333}</style></head>
  <body><h2>🔒 WebUnblocker</h2><p>ここにあなたのプロキシ実装を配置してください。URLは <code>location.hash</code> から取得できます。</p>
  <script>document.body.insertAdjacentHTML('beforeend','<p>Target: <code>'+decodeURIComponent(location.hash.slice(1)||'(none)')+'</code></p>');</script>
  </body></html>`);
});

/* ---------- Fallback ---------- */
app.use((req,res)=>{
  res.status(404).send(shell('404 · 柿Tube',
    '<main class="container" style="text-align:center;padding:80px 20px"><h1 style="font-size:48px;color:var(--persimmon)">404</h1><p style="color:#666;margin-top:12px">ページが見つかりませんでした</p><a href="/" style="display:inline-block;margin-top:24px;background:linear-gradient(135deg,var(--persimmon),var(--persimmon-dark));color:#fff;padding:12px 24px;border-radius:999px;font-weight:600">ホームへ戻る</a></main>'
  ));
});

module.exports = app;

if(require.main === module){
  app.listen(PORT, ()=>console.log('🍊 Persimmon running on :'+PORT));
}
