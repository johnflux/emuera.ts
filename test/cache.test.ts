import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { cached, LruCache } from "../web/cache.js";

test("LRU caches enforce byte and entry budgets, promote hits and skip oversized values", () => {
  const cache = new LruCache(20, 2);
  cache.set("a", "first", 6);
  cache.set("b", "second", 6);
  assert.equal(cache.bytes, 16);
  assert.equal(cache.get("a"), "first");
  cache.set("c", "third", 6);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "first");
  cache.set("a", "larger", 14);
  assert.equal(cache.get("c"), undefined);
  assert.equal(cache.bytes, 16);
  cache.set("huge", "uncached", 21);
  assert.equal(cache.get("huge"), undefined);
  assert.equal(cache.get("a"), "larger");
  cache.delete("a");
  assert.equal(cache.bytes, 0);
  for (const key of ["a", "b", "c"]) cache.set(key, key);
  assert.equal(cache.size, 2, "pending/zero-size entries also obey the entry cap");
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test("cached loads coalesce, account for resolved size and retry failures", async () => {
  const cache = new LruCache(30, 2);
  let loads = 0;
  const load = () => { loads++; return "loaded"; };
  const first = cached(cache, "one", load, (value: string) => value.length * 2);
  assert.equal(cached(cache, "one", load, (value: string) => value.length * 2), first);
  assert.equal(await first, "loaded");
  assert.equal(loads, 1);
  assert.equal(cache.bytes, 18);
  await cached(cache, "two", load, (value: string) => value.length * 2);
  assert.equal(cache.get("one"), undefined);
  assert.ok(cache.bytes <= 30);
  await assert.rejects(cached(cache, "bad", () => { throw new Error("load failed"); }, () => 1), /load failed/);
  assert.equal(cache.get("bad"), undefined);
  assert.equal(await cached(cache, "bad", load, () => 1), "loaded");
});

test("late async completions and failures cannot restore cleared entries or delete replacements", async () => {
  const cache = new LruCache(100, 2);
  let resolve!: (value: string) => void;
  const first = cached(cache, "key", () => new Promise<string>((done) => { resolve = done; }), () => 10);
  await Promise.resolve();
  cache.clear();
  const second = cached(cache, "key", () => "new", () => 10);
  resolve("old");
  await Promise.all([first, second]);
  assert.equal(cache.get("key"), second);
  let reject!: (error: Error) => void;
  const failed = cached(cache, "bad", () => new Promise((_done, fail) => { reject = fail; }), () => 10);
  await Promise.resolve();
  cache.clear();
  const replacement = cached(cache, "bad", () => "replacement", () => 10);
  reject(new Error("old failure"));
  await assert.rejects(failed, /old failure/);
  await replacement;
  assert.equal(cache.get("bad"), replacement);
  let finish!: (value: string) => void;
  const cleared = cached(cache, "pending", () => new Promise<string>((done) => { finish = done; }), () => 10);
  await Promise.resolve();
  cache.clear();
  finish("late");
  await cleared;
  assert.equal(cache.size, 0);
});

test("source images and painted canvases reuse loads and obey actual pixel budgets", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const routine = source.slice(source.indexOf("async function loadImage("), source.indexOf("function newCanvas("));
  let loads = 0, paints = 0, width = 4096;
  class Image {
    naturalWidth = width;
    naturalHeight = width;
    onload = () => {};
    set src(_url: string) { loads++; queueMicrotask(() => this.onload()); }
  }
  const api = runInNewContext(`${routine}\n({ sourceImage, paintPicture, sourceImages, paintedPictures });`, {
    cached, LruCache, Image, queueMicrotask, document: { hidden: true },
    paintOps: async () => { paints++; return { width: 2048, height: 2048 }; },
  });
  const first = api.sourceImage("one");
  assert.equal(api.sourceImage("one"), first);
  await first;
  // 4096 squared is 64 MiB before the key; larger entries are delivered but not retained.
  assert.equal(api.sourceImages.size, 0);
  width = 1024;
  const small = api.sourceImage("small");
  await small;
  assert.equal(api.sourceImage("small"), small);
  assert.equal(api.sourceImages.bytes, 1024 * 1024 * 4 + "small".length * 2);
  const picture = { width: 2048, height: 2048, ops: [] };
  const painted = api.paintPicture(picture);
  assert.equal(api.paintPicture(picture), painted);
  await painted;
  await api.paintPicture({ ...picture, ops: ["different"] });
  assert.equal(paints, 2);
  assert.equal(api.paintedPictures.size, 1, "two 16 MiB canvases plus keys exceed 32 MiB");
  assert.ok(api.paintedPictures.bytes <= 32 * 1024 * 1024);
  assert.equal(loads, 2);
});

test("translation revisits detached staged panels only once when the model starts or is enabled", async () => {
  const source = await readFile(new URL("../web/translate.js", import.meta.url), "utf8");
  let visits = 0;
  const states: string[] = [];
  const root = {
    isConnected: false,
    querySelectorAll: () => {
      assert.ok(++visits <= 3, "a detached root must not be revisited by live Set iteration");
      return [];
    },
  };
  const context = {
    LruCache,
    navigator: { language: "en" },
    localStorage: { getItem: () => "on", setItem: () => {} },
    document: { createTreeWalker: () => ({ nextNode: () => null }) },
    NodeFilter: { SHOW_TEXT: 4 },
    Translator: {
      availability: async () => "available",
      create: async () => ({ translate: async (value: string) => value }),
    },
    setTimeout: (callback: () => void, delay: number, ...args: unknown[]) => {
      const timer = setTimeout(callback, delay, ...args);
      timer.unref();
      return timer;
    },
  };
  const translation = runInNewContext(`${source.replace(/^import .+;\n/gm, "").replace(/^export /gm, "")}\ncreateTranslation`, context)({
    onChange: ({ state }: { state: string }) => states.push(state),
  });
  translation.translateTree(root);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(visits, 2, "model readiness translates the staged panel once");
  assert.deepEqual(states, ["starting", "ready"]);
  translation.setEnabled(true);
  assert.equal(visits, 3, "enabling translation translates the staged panel once");
});

test("translation cache stays bounded while preserving results and retrying errors", async () => {
  const source = await readFile(new URL("../web/translate.js", import.meta.url), "utf8");
  let translations = 0;
  const caches: { bytes: number; size: number }[] = [];
  class TranslationCache extends LruCache {
    constructor(maxBytes: number, maxEntries: number) {
      super(maxBytes, maxEntries);
      caches.push(this);
    }
  }
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const context = {
    LruCache: TranslationCache, clearTimeout,
    setTimeout: (callback: (...args: unknown[]) => void, delay: number, ...args: unknown[]) => {
      const timer = setTimeout(callback, delay, ...args);
      timer.unref();
      return timer;
    },
    navigator: { language: "en", userActivation: { isActive: true } },
    localStorage: { getItem: () => "on" },
    document: { createTreeWalker: () => ({ nextNode: () => null }) },
    NodeFilter: { SHOW_TEXT: 4 },
    Translator: {
      availability: async () => "available",
      create: async () => ({
        translate: async (value: string) => {
          translations++;
          if (value === "失敗" && translations === 1) throw new Error("Translator failed");
          return `Translated ${value}`;
        },
      }),
    },
  };
  const translation = runInNewContext(`${source.replace(/^import .+;\n/gm, "").replace(/^export /gm, "")}\ncreateTranslation`, context)({
    onChange: ({ state }: { state: string }) => { if (state === "ready") ready(); },
  });
  translation.translateTree({ isConnected: true, querySelectorAll: () => [] });
  await started;
  const translated = (value: string) => new Promise<string>((resolve) => translation.text(value, resolve));
  translation.text("失敗", () => assert.fail("failed translation must not report success"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await translated("失敗"), "Translated 失敗");
  for (let i = 0; i < 2001; i++) await translated(`日本語${i}`);
  const before = translations;
  assert.equal(await translated("日本語0"), "Translated 日本語0");
  assert.equal(translations, before + 1, "old translations are evicted rather than growing forever");
  assert.ok(caches[0]!.size <= 2000);
  const oversized = "日".repeat(600_000);
  const beforeOversized = translations;
  assert.equal(await translated(oversized), `Translated ${oversized}`);
  assert.equal(await translated(oversized), `Translated ${oversized}`);
  assert.equal(translations, beforeOversized + 2, "oversized results are returned without being retained");
  assert.ok(caches[0]!.bytes <= 2 * 1024 * 1024);
});
