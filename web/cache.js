/** Bounds retained values by estimated bytes and entry count, including pending loads. */
export class LruCache {
  constructor(maxBytes, maxEntries) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.bytes = 0;
  }
  get size() { return this.entries.size; }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, bytes = 0) {
    this.delete(key);
    const size = key.length * 2 + bytes;
    if (size > this.maxBytes) return;
    this.entries.set(key, { value, bytes: size });
    this.bytes += size;
    while (this.bytes > this.maxBytes || this.size > this.maxEntries)
      this.delete(this.entries.keys().next().value);
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** Coalesces loads and accounts for the resolved value without resurrecting evicted or cleared entries. */
export function cached(cache, key, load, size) {
  let promise = cache.get(key);
  if (!promise) {
    promise = Promise.resolve().then(load).then((value) => {
      if (cache.get(key) === promise) cache.set(key, promise, size(value));
      return value;
    }, (error) => {
      if (cache.get(key) === promise) cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return promise;
}
