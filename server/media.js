'use strict';
/**
 * HotChunks — "instant first frame" media warmer for llytpr-wl.v01nh.
 *
 * The 360p progressive start path is optimized to the limit:
 *  - As soon as the server knows a video's stream map (watch API hit or card
 *    hover), the FIRST BYTES of the itag-18 file are fetched in the
 *    background through the same transport that minted the URL and kept in
 *    RAM for a few minutes.
 *  - /api/stream then answers any Range request fully covered by those bytes
 *    from memory (sub-millisecond), turning time-to-first-frame into a pure
 *    local-memory read instead of a proxied round trip.
 *  - Pending warm jobs are deduplicated, so hover storms cost nothing.
 *
 * No external APIs are involved — this is pure transport/cache engineering.
 *
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
const { request: undiciRequest } = require('undici');
const { proxyManager } = require('./proxies');

const WARM_BYTES = 768 * 1024;      // ~enough for the first seconds of 360p
const MAX_ENTRIES = 48;             // ~36 MB worst-case RAM
const TTL = 6 * 60 * 1000;

class HotChunks {
  constructor() {
    this.map = new Map();      // key "v:itag" -> {buf:Buffer, exp}
    this.warming = new Set();  // keys currently being fetched
  }

  _key(v, itag) { return v + ':' + itag; }

  /** Returns Buffer slice when `start` is cached (partial tail allowed), else null. */
  get(v, itag, start, end) {
    const e = this.map.get(this._key(v, itag));
    if (!e) return null;
    if (e.exp < Date.now()) { this.map.delete(this._key(v, itag)); return null; }
    const s = Number(start);
    if (!(s >= 0) || s >= e.buf.length) return null;
    const en = end == null ? e.buf.length - 1 : Math.min(Number(end), e.buf.length - 1);
    if (en < s) return null;
    this.map.delete(this._key(v, itag)); this.map.set(this._key(v, itag), e); // recency
    return e.buf.subarray(s, en + 1);
  }

  /** Serve-from-memory if possible. Returns true when the response was fully handled. */
  serveIfHot(v, itag, req, res) {
    // only Range requests are safely answerable with a partial prefix —
    // a plain full-file GET must go upstream so the client gets everything.
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
    if (!m) return false;
    const start = Number(m[1]);
    if (m[2]) {
      // explicit end (MSE segment math!): only serving a FULLY covered range
      // is safe — a truncated segment would corrupt the append pipeline.
      const entry = this.map.get(this._key(v, itag));
      if (!entry || entry.exp < Date.now() || Number(m[2]) > entry.buf.length - 1) return false;
    }
    const end = m[2] ? Number(m[2]) : null;
    const buf = this.get(v, itag, start, end);
    if (!buf) return false;
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Length': buf.length,
      'Content-Range': `bytes ${start}-${start + buf.length - 1}/*`,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
      'X-Hot-Cache': 'HIT',
    });
    res.end(buf);
    return true;
  }

  /**
   * Background warm. url/proxyUrl must come from the (already IP-pinned)
   * stream map — we never re-resolve here.
   */
  warm(v, itag, url, proxyUrl) {
    if (!url) return;
    const key = this._key(v, itag);
    const e = this.map.get(key);
    if ((e && e.exp > Date.now()) || this.warming.has(key)) return;
    this.warming.add(key);
    (async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      try {
        const dispatcher = proxyUrl ? proxyManager.dispatcherFor(proxyUrl) : undefined;
        const up = await undiciRequest(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
            'Range': `bytes=0-${WARM_BYTES - 1}`,
            'Accept': '*/*',
          },
          dispatcher,
          signal: ac.signal,
          headersTimeout: 12000,
        });
        if (up.statusCode >= 400) { up.body.dump().catch(() => {}); return; }
        const chunks = [];
        for await (const c of up.body) {
          chunks.push(c);
          let len = 0; for (const x of chunks) len += x.length;
          if (len >= WARM_BYTES) break;
        }
        ac.abort(); // we took what we need
        const buf = Buffer.concat(chunks).subarray(0, WARM_BYTES);
        if (buf.length >= 64 * 1024) {
          this.map.set(key, { buf, exp: Date.now() + TTL });
          while (this.map.size > MAX_ENTRIES) this.map.delete(this.map.keys().next().value);
        }
      } catch (_) {
        /* warming is best-effort — the relay path still works without it */
      } finally {
        clearTimeout(t);
        this.warming.delete(key);
      }
    })();
  }

  status() {
    return {
      entries: this.map.size,
      warming: this.warming.size,
      bytes: [...this.map.values()].reduce((a, e) => a + e.buf.length, 0),
    };
  }
}

const hotChunks = new HotChunks();
module.exports = { hotChunks };
