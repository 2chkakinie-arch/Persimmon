'use strict';
/**
 * ProxyManager — fetches the free proxy list supplied by the project owner
 * (https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt),
 * health-checks candidates in parallel, keeps the fast/healthy ones in a pool
 * and persists them to disk so subsequent boots start instantly ("cache and
 * go fast" requirement). Pool is refreshed in the background; dead proxies are
 * evicted automatically. If the pool is empty we gracefully fall back to
 * direct connections, so the app keeps working even with zero proxies.
 *
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
const fs = require('node:fs');
const path = require('node:path');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const LIST_URL = 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt';
const DATA_DIR = process.env.VERCEL ? '/tmp/llytpr-data' : path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'proxy-cache.json');

const TEST_TARGET = 'https://www.youtube.com/generate_204';
const TEST_TIMEOUT = 3800;
const MAX_TEST_BATCH = 260;      // candidates per refresh round
const POOL_SIZE = 26;            // proxies kept hot
const REFRESH_INTERVAL = 12 * 60 * 1000;
const FAIL_EVICT = 3;

class ProxyManager {
  constructor() {
    this.pool = [];            // [{url, latency, fails, lastOk}]
    this.scanCursor = 0;
    this.list = [];
    this.rr = 0;
    this.agents = new Map();   // proxyUrl -> ProxyAgent
    this.refreshing = null;
    this.lastRefresh = 0;
    this.enabled = process.env.LLYTPR_NO_PROXY !== '1';
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* read-only fs */ }
    this._loadDisk();
    if (this.enabled) {
      this._refreshLoop = setInterval(() => this.refresh().catch(() => {}), REFRESH_INTERVAL);
      if (this._refreshLoop.unref) this._refreshLoop.unref();
      // kick off background refresh immediately (don't block boot)
      setTimeout(() => this.refresh().catch(() => {}), 50).unref?.();
    }
  }

  _loadDisk() {
    try {
      const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(raw.pool)) {
        this.pool = raw.pool
          .filter(p => p && typeof p.url === 'string')
          .map(p => ({ url: p.url, latency: p.latency || 1500, fails: 0, lastOk: p.lastOk || 0 }));
      }
      if (Array.isArray(raw.list) && raw.list.length) this.list = raw.list;
      this.scanCursor = raw.scanCursor || 0;
    } catch (_) { /* no cache yet */ }
  }

  _saveDisk() {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        savedAt: Date.now(),
        pool: this.pool.slice(0, 60),
        list: this.list.slice(0, 4000),
        scanCursor: this.scanCursor,
      }));
    } catch (_) { /* read-only fs (vercel) */ }
  }

  _agent(url) {
    let a = this.agents.get(url);
    if (!a) {
      a = new ProxyAgent({ uri: url, keepAliveTimeout: 8000, keepAliveMaxTimeout: 15000 });
      this.agents.set(url, a);
    }
    return a;
  }

  async _fetchList() {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    try {
      const res = await undiciFetch(LIST_URL, { signal: ac.signal });
      if (!res.ok) throw new Error('list http ' + res.status);
      const text = await res.text();
      const list = [...new Set(text.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(s)))];
      // randomize so we don't always hammer the head of the list
      for (let i = list.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    } finally {
      clearTimeout(t);
    }
  }

  async _testOne(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TEST_TIMEOUT);
    const start = Date.now();
    try {
      const res = await undiciFetch(TEST_TARGET, {
        dispatcher: this._agent(url),
        signal: ac.signal,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      // generate_204 -> 204 counts; anything that completes a TLS handshake through
      // the tunnel is a usable transport.
      if (res.status < 500) return { url, latency: Date.now() - start, fails: 0, lastOk: Date.now() };
      // drain to keep socket reusable
      res.body?.dump?.().catch(() => {});
      return null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async refresh({ force = false } = {}) {
    if (this.refreshing) return this.refreshing;
    if (!force && Date.now() - this.lastRefresh < 60000 && this.pool.length >= 8) return this.pool;
    this.refreshing = (async () => {
      // 1) re-validate existing pool first (cheap, keeps the good cache warm)
      if (this.pool.length) {
        const checked = await Promise.all(this.pool.map(p => this._testOne(p.url)));
        this.pool = checked.filter(Boolean).sort((a, b) => a.latency - b.latency);
      }
      // 2) top up from the list if needed
      if (this.pool.length < POOL_SIZE) {
        if (!this.list.length || this.scanCursor + MAX_TEST_BATCH > this.list.length * 2) {
          try {
            this.list = await this._fetchList();
            this.scanCursor = 0;
          } catch (_) { /* keep old list */ }
        }
        const known = new Set(this.pool.map(p => p.url));
        const rejected = new Set();
        while (this.pool.length < POOL_SIZE) {
          const batch = [];
          for (let i = 0; i < MAX_TEST_BATCH && this.scanCursor < this.list.length; i++, this.scanCursor++) {
            const cand = 'http://' + this.list[this.scanCursor];
            if (!known.has(cand) && !rejected.has(cand)) batch.push(cand);
          }
          if (!batch.length) break;
          // test in chunks so a cold boot never saturates the host
          for (let i = 0; i < batch.length; i += 36) {
            if (this.pool.length >= POOL_SIZE) break;
            const chunk = batch.slice(i, i + 36);
            const results = await Promise.all(chunk.map(u => this._testOne(u)));
            results.forEach((r, j) => { if (r) this.pool.push(r); else rejected.add(chunk[j]); });
            if (this.scanCursor >= this.list.length) break;
          }
          if (this.pool.length >= POOL_SIZE || this.scanCursor >= this.list.length) break;
        }
        this.pool = [...new Map(this.pool.map(p => [p.url, p])).values()]
          .sort((a, b) => a.latency - b.latency)
          .slice(0, POOL_SIZE * 2);
      }
      this.lastRefresh = Date.now();
      this._saveDisk();
      return this.pool;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** Best-effort pick of a healthy proxy (round robin over the fastest few). */
  pick(exclude = []) {
    if (!this.enabled || !this.pool.length) return null;
    const fast = this.pool.filter(p => p.latency < 6000).slice(0, 12);
    const usable = fast.length ? fast : this.pool.slice(0, 12);
    for (let i = 0; i < usable.length * 2; i++) {
      const p = usable[this.rr++ % usable.length];
      if (!exclude.includes(p.url)) return p.url;
    }
    return null;
  }

  dispatcherFor(url) {
    return url ? this._agent(url) : undefined;
  }

  markBad(url) {
    if (!url) return;
    const p = this.pool.find(p => p.url === url);
    if (!p) return;
    p.fails++;
    if (p.fails >= FAIL_EVICT) {
      this.pool = this.pool.filter(x => x.url !== url);
      const a = this.agents.get(url);
      if (a) { a.close?.().catch(() => {}); this.agents.delete(url); }
    }
  }

  markGood(url, latency) {
    const p = this.pool.find(p => p.url === url);
    if (!p) return;
    p.fails = 0;
    p.lastOk = Date.now();
    if (latency) p.latency = Math.round(p.latency * 0.7 + latency * 0.3);
  }

  status() {
    return {
      enabled: this.enabled,
      pool: this.pool.map(p => ({ url: p.url, latency: p.latency, fails: p.fails })),
      listSize: this.list.length,
      cursor: this.scanCursor,
      lastRefresh: this.lastRefresh,
    };
  }
}

const proxyManager = new ProxyManager();
module.exports = { proxyManager, ProxyManager };
