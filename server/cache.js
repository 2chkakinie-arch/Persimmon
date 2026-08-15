'use strict';
/**
 * Tiny dependency-free TTL + LRU cache.
 * Made by Kakinie with llytpr-wl.v01nh TEAM. V1
 */
class TTLCache {
  constructor({ max = 1000, ttl = 5 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }
  _expired(entry) {
    return !entry || (entry.exp !== 0 && entry.exp < Date.now());
  }
  get(key) {
    const e = this.map.get(key);
    if (this._expired(e)) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  getStale(key) {
    const e = this.map.get(key);
    return e ? e.value : undefined;
  }
  set(key, value, ttl) {
    const exp = ttl === 0 ? 0 : Date.now() + (ttl === undefined ? this.ttl : ttl);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, exp });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    return value;
  }
  has(key) {
    return this.get(key) !== undefined;
  }
  delete(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
  /**
   * Cache-aside helper: returns cached value or computes, stores and returns it.
   */
  async wrap(key, ttl, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.set(key, value, ttl);
    return value;
  }
}

module.exports = { TTLCache };
