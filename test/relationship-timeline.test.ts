import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { relationshipTimelineModel } from "../web/relationship-timeline.js";

const model = (favor: number, lover = false, casual = false, commitment = 0) =>
  relationshipTimelineModel({ favor, lover, casual, commitment });

test("relationship timeline fills exact favor intervals and clamps negative favor", () => {
  for (const [favor, progress] of [[-50, [0, 0]], [0, [0, 0]], [50, [.5, 0]],
    [100, [1, 0]], [300, [1, .5]], [499, [1, .9975]]] as const) {
    const state = model(favor);
    assert.deepEqual(state.progress, progress);
    assert.deepEqual(state.nodes.map((node) => node.label), ["Strangers", "Acquaintances", "Friends"]);
    assert.equal(state.nodes[1]!.reached, favor >= 100);
  }
  assert.deepEqual(model(500).nodes.map((node) => node.label), ["Strangers", "Friends", "Lovers", "Engaged", "Married"]);
  assert.deepEqual(model(500).progress, [1, 0, 0, 0]);
});

test("romantic timeline highlights commitments, never infers romance from favor", () => {
  assert.deepEqual(model(30000).progress, [1, 0, 0, 0]);
  assert.deepEqual(model(1000, true).progress, [1, 1, 0, 0]);
  assert.deepEqual(model(1000, true, false, 1).progress, [1, 1, 1, 0]);
  assert.deepEqual(model(1000, true, false, 2).progress, [1, 1, 1, 1]);
  assert.deepEqual(model(250, true).progress, [.5, 1, 0, 0]);
  assert.ok(!model(250, true).nodes.some((node) => node.label === "Acquaintances"));
});

test("In love appears only for its own flag and can coexist with Lovers", () => {
  for (const lover of [false, true]) {
    const state = relationshipTimelineModel({ favor: 1000, lover, casual: false, commitment: 0, inLove: true });
    assert.deepEqual(state.nodes.map((node) => node.label), ["Strangers", "Close Friend", "In love", "Lovers", "Engaged", "Married"]);
    assert.deepEqual(state.progress, [1, 1, lover ? 1 : 0, 0, 0]);
    assert.equal(state.nodes[2]!.reached, true);
    assert.equal(state.nodes[2]!.icon, "love");
    assert.equal(state.nodes[3]!.reached, lover);
  }
  assert.ok(!model(1000, true).nodes.some((node) => node.label === "In love"));
  for (const favor of [20, 1000]) {
    for (const commitment of [-2, 0, 1, 2]) {
      for (const casual of [false, true]) {
        const state = relationshipTimelineModel({ favor, lover: commitment > 0, casual, commitment, inLove: true });
        assert.equal(state.nodes[2]!.label, "In love");
        assert.equal(state.nodes[2]!.reached, true);
      }
    }
  }
});

test("friendship tiers replace the label and strengthen the flower without extra states", () => {
  for (const [favor, label, boost] of [[500, "Friends", 0], [999, "Friends", 0], [1000, "Close Friend", 1],
    [9999, "Close Friend", 1], [10000, "Best Friend", 2], [29999, "Best Friend", 2], [30000, "Almost Family", 3]] as const) {
    assert.equal(model(favor).nodes[1]!.label, label);
    assert.equal(model(favor).nodes[1]!.boost, boost);
  }
});

test("FWB and divorce branch from the right friendship stage, including combined states", () => {
  assert.deepEqual(model(1000, false, true).branches, [{ label: "FWB", icon: "spark", from: 1, to: 2 }]);
  assert.equal(model(1000, false, true).nodes[2]!.reached, false);
  assert.deepEqual(model(1000, false, false, -2).branches, [{ label: "Divorced", icon: "broken", from: 1, to: 2 }]);
  assert.deepEqual(model(499, false, false, -2).branches, [{ label: "Divorced", icon: "broken", from: 0, to: 1 }]);
  assert.equal(model(1000, true, true, -2).branches.length, 2);
  for (const favor of [20, 1000]) {
    const state = relationshipTimelineModel({ favor, lover: false, casual: true, commitment: -2, inLove: true });
    assert.deepEqual(state.branches.map(({ from, to }) => ({ from, to })), [{ from: 2, to: 3 }, { from: 2, to: 3 }]);
  }
});

test("scorching follows saved ended commitments, not missing feelings or low favor", () => {
  const scorched = (commitment: number, lover = false) => model(1000, lover, false, commitment).nodes
    .filter((node) => node.scorched).map((node) => node.label);
  assert.deepEqual(scorched(-2), ["Lovers", "Engaged", "Married"]);
  assert.deepEqual(scorched(-1, true), ["Engaged", "Married"]);
  assert.deepEqual(scorched(-1), ["Engaged", "Married"]);
  for (const commitment of [0, 1, 2]) assert.deepEqual(scorched(commitment, commitment > 0), []);
  assert.ok(!model(20).nodes.some((node) => node.scorched));
  const feelings = relationshipTimelineModel({ favor: 1000, lover: false, casual: true, commitment: -2, inLove: true });
  assert.ok(!feelings.nodes.find((node) => node.label === "In love")!.scorched);
  assert.ok(!feelings.nodes.find((node) => node.label === "Close Friend")!.scorched);
});

test("timeline renderer draws partial lines, boost rings and non-overlapping branches with accessible labels", async () => {
  const source = await readFile(new URL("../web/relationship-timeline.js", import.meta.url), "utf8");
  class Element {
    children: Element[] = [];
    attributes = new Map<string, string>();
    textContent = "";
    className = "";
    constructor(public tag: string) {}
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    append(element: Element) { this.children.push(element); }
  }
  const render = runInNewContext(`${source.replace(/^export /gm, "")}\nrelationshipTimeline`, {
    document: { createElement: (tag: string) => new Element(tag), createElementNS: (_namespace: string, tag: string) => new Element(tag) },
  });
  const node = (values: Record<string, string>) => ({ getAttribute: (key: string) => values[key.slice(5)] ?? null });
  const attrs = { favor: "30000", lover: "0", "in-love": "0", casual: "1", commitment: "-2" };
  const root = render(node(attrs)) as Element;
  assert.equal(root.children[0]!.className, "era-relationship-track-scroll", "only the track scrolls; the ribbon stays outside the clipping region");
  const svg = root.children[0]!.children[0]!;
  assert.equal(svg.attributes.get("viewBox"), "0 0 820 374");
  assert.equal(svg.attributes.get("role"), "img");
  for (const values of [
    { ...attrs, favor: "20", casual: "0", commitment: "0" },
    { ...attrs, casual: "0", commitment: "0" },
    { ...attrs, "in-love": "1" },
  ]) {
    const renderedSvg = (render(node(values)) as Element).children[0]!.children[0]!;
    const viewWidth = Number(renderedSvg.attributes.get("viewBox")!.split(" ")[2]);
    const maxWidth = Number(/^max-width: ([\d.]+)px$/.exec(renderedSvg.attributes.get("style")!)![1]);
    assert.ok(Math.abs(66 * maxWidth / viewWidth - 70) < 1e-9, "caps badge diameter at 70px for every timeline length");
  }
  assert.match(svg.children[0]!.textContent, /Almost Family \(reached\).*FWB branches.*Divorced branches/);
  const all = (element: Element): Element[] => [element, ...element.children.flatMap(all)];
  const artwork = all(root).filter((element) => element.tag === "image");
  assert.ok(all(root).some((element) => element.attributes.get("class") === "era-timeline-glyph era-timeline-paired-hearts"));
  const shells = all(root).filter((element) => element.attributes.get("class") === "era-timeline-badge");
  assert.equal(shells.length, 7);
  for (const shell of shells) {
    assert.equal(shell.tag, "path");
    assert.equal((shell.attributes.get("d")!.match(/Q/g) ?? []).length, 12, "scalloped rather than circular badges");
  }
  assert.equal(artwork.filter((element) => element.attributes.get("class") === "era-timeline-scorch").length, 3);
  assert.match(svg.children[0]!.textContent, /Lovers \(ended\).*Married \(ended\)/);
  for (const image of artwork) {
    const asset = image.attributes.get("href")!;
    assert.match(asset, /^\/relationship-assets\/[a-z-]+\.svg$/);
    assert.match(await readFile(new URL(`../web${asset}`, import.meta.url), "utf8"), /<svg /);
  }
  assert.equal(all(root).filter((element) => element.attributes.get("class") === "era-timeline-boost").length, 3);
  const branches = all(root).filter((element) => element.attributes.get("class")?.startsWith("era-timeline-branch"));
  assert.equal(branches.length, 2);
  assert.equal(branches[0]!.attributes.get("class"), "era-timeline-branch is-fwb");
  assert.equal(branches[1]!.attributes.get("class"), "era-timeline-branch is-divorced");
  const checkFork = (element: Element, from: number, y: number) => {
    const match = /^M([\d.]+) 56H([\d.]+)C([\d.]+) 56 ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)H([\d.]+)$/.exec(element.attributes.get("d")!);
    assert.ok(match, "straight lead-in, cubic S with horizontal tangents, straight lead-out");
    const [start, curveStart, control1, control2, controlY, curveEnd, endY, end] = match.slice(1).map(Number);
    assert.equal(start, 82 + from * 164 + 35, "preserves circular clearance around the source");
    const width = end! - start!;
    assert.equal(curveStart! - start!, width * .25);
    assert.equal(curveEnd! - curveStart!, width * .5);
    assert.equal(end! - curveEnd!, width * .25);
    assert.ok(start! < curveStart! && curveStart! < control1! && control2! < curveEnd! && curveEnd! < end!);
    assert.equal(control1, control2);
    assert.equal(control1, (start! + end!) / 2, "symmetric curve control points");
    assert.equal(controlY, y);
    assert.equal(endY, y);
    assert.equal(end, 82 + (from + 1) * 164 - 30, "connects to the state circle");
  };
  checkFork(branches[0]!, 1, 176);
  checkFork(branches[1]!, 1, 286);
  const lowFavorDivorce = all(render(node({ ...attrs, favor: "20", casual: "0" })));
  checkFork(lowFavorDivorce.find((element) => element.attributes.get("class") === "era-timeline-branch is-divorced")!, 0, 176);
  for (const [casual, commitment] of [["1", "0"], ["0", "-2"]]) {
    const combined = all(render(node({ ...attrs, "in-love": "1", casual, commitment })));
    const love = combined.find((element) => element.attributes.get("class")?.includes("is-in-love"))!;
    assert.ok(love);
    assert.ok(love.children.some((element) => element.attributes.get("href") === "/relationship-assets/icon-in-love.svg"));
    assert.ok(love.children.some((element) => element.attributes.get("class") === "era-timeline-hearts"));
    assert.equal(combined.filter((element) => element.attributes.get("class") === "era-timeline-badge").length, 7);
    assert.equal(combined.filter((element) => element.attributes.get("class")?.startsWith("era-timeline-branch")).length, 1);
    checkFork(combined.find((element) => element.attributes.get("class")?.startsWith("era-timeline-branch"))!, 2, 176);
    const tracks = combined.filter((element) => element.attributes.get("class")?.startsWith("era-timeline-track"));
    assert.equal(tracks[1]!.attributes.get("d"), "M281 56H375", "incoming line preserves empty circular space");
    assert.equal(tracks[2]!.attributes.get("d"), "M445 56H539", "outgoing line preserves empty circular space");
    assert.ok(combined.some((element) => element.textContent === "In love"));
  }
  const partial = all(render(node({ ...attrs, favor: "300", casual: "0", commitment: "0" })));
  assert.equal(partial.filter((element) => element.attributes.get("class") === "era-timeline-fill")[1]!.attributes.get("d"), "M281 56H328");
  for (const favor of ["-50", "0", "20", "100", "500"]) {
    const paths = all(render(node({ ...attrs, favor, casual: "0", commitment: "0" })));
    const fills = paths.filter((element) => element.attributes.get("class") === "era-timeline-fill");
    assert.equal(fills.length, Number(favor) > 0 ? 1 : 0, `favor ${favor}: zero progress must not draw a round-capped dot`);
    for (const fill of fills) {
      const [, start, end] = /^M([\d.]+) 56H([\d.]+)$/.exec(fill.attributes.get("d")!)!;
      assert.ok(Number(end) > Number(start));
    }
  }
  for (const invalid of [{ favor: "NaN" }, { lover: "2" }, { casual: "-1" }, { commitment: "3" }])
    assert.throws(() => render(node({ ...attrs, ...invalid })), /Invalid relationship timeline/);
});
