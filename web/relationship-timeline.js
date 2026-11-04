const clamp = (value) => Math.max(0, Math.min(1, value));

export function relationshipTimelineModel({ favor, lover, casual, commitment, inLove = false }) {
  const friends = favor >= 500;
  const early = !friends && !lover && !inLove && !casual && commitment === 0;
  const tiers = [[30000, "Almost Family"], [10000, "Best Friend"], [1000, "Close Friend"], [500, "Friends"]];
  const tier = tiers.findIndex(([threshold]) => favor >= threshold);
  const friendship = tier < 0 ? "Friends" : tiers[tier][1];
  const boost = tier < 0 ? 0 : 3 - tier;
  const nodes = early
    ? [{ label: "Strangers", icon: "seed", reached: true },
      { label: "Acquaintances", icon: "sprout", reached: favor >= 100 },
      { label: "Friends", icon: "flower", reached: false }]
    : [{ label: "Strangers", icon: "seed", reached: true },
      { label: friendship, icon: "flower", reached: friends, boost },
      { label: "Lovers", icon: "heart", reached: lover },
      { label: "Engaged", icon: "diamond", reached: commitment > 0 },
      { label: "Married", icon: "rings", reached: commitment === 2 }];
  const progress = early ? [clamp(favor / 100), clamp((favor - 100) / 400)]
    : [clamp(favor / 500), lover ? 1 : 0, commitment > 0 ? 1 : 0, commitment === 2 ? 1 : 0];
  if (inLove) {
    nodes.splice(2, 0, { label: "In love", icon: "love", reached: true });
    progress.splice(1, 0, 1);
  }
  for (const item of nodes) {
    if ((commitment === -2 && item.icon === "heart")
      || (commitment < 0 && (item.icon === "diamond" || item.icon === "rings")))
      item.scorched = true;
  }
  const branches = [];
  if (casual) {
    const from = inLove ? 2 : 1;
    branches.push({ label: "FWB", icon: "spark", from, to: from + 1 });
  }
  if (commitment === -2) {
    const from = inLove ? 2 : friends ? 1 : 0;
    branches.push({ label: "Divorced", icon: "broken", from, to: from + 1 });
  }
  return { nodes, progress, branches, early };
}

const badges = {
  seed: "strangers", sprout: "strangers", flower: "close-friend", heart: "lovers",
  love: "in-love", diamond: "engaged", rings: "married", spark: "fwb", broken: "divorced",
};
const scallopedBadge = Array.from({ length: 12 }, (_, index) => {
  const angle = index * Math.PI / 6;
  const next = angle + Math.PI / 6;
  const middle = angle + Math.PI / 12;
  return `${index ? "" : `M${30 * Math.cos(angle)} ${30 * Math.sin(angle)}`}Q${37 * Math.cos(middle)} ${37 * Math.sin(middle)} ${30 * Math.cos(next)} ${30 * Math.sin(next)}`;
}).join("") + "Z";

export function relationshipTimeline(node) {
  const integer = (name) => {
    const raw = node.getAttribute(`data-${name}`);
    if (raw === null || !/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new Error(`Invalid relationship timeline ${name}: ${raw}`);
    return Number(raw);
  };
  const flag = (name) => {
    const value = integer(name);
    if (value !== 0 && value !== 1) throw new Error(`Invalid relationship timeline ${name}: ${value}`);
    return value === 1;
  };
  const commitment = integer("commitment");
  if (commitment < -2 || commitment > 2) throw new Error(`Invalid relationship timeline commitment: ${commitment}`);
  const model = relationshipTimelineModel({ favor: integer("favor"), lover: flag("lover"), inLove: flag("in-love"), casual: flag("casual"), commitment });
  const host = document.createElement("div");
  const plainFrame = !flag("lover") && !flag("in-love") && !flag("casual") && commitment <= 0;
  const frameClass = plainFrame ? integer("favor") >= 500 ? " is-friendship" : " is-early"
    : flag("casual") && !flag("lover") && !flag("in-love") && commitment <= 0 ? " is-casual" : "";
  host.className = `era-relationship-timeline${model.nodes.some((item) => item.icon === "love") ? " is-in-love" : ""}${frameClass}`;
  const scroll = document.createElement("div");
  scroll.className = "era-relationship-track-scroll";
  host.append(scroll);
  const svgElement = (tag, attributes, parent) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    parent?.append(element);
    return element;
  };
  const width = model.nodes.length * 164;
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${154 + model.branches.length * 110}`, style: `max-width: ${width * 70 / 66}px`, role: "img" });
  const title = svgElement("title", {}, svg);
  title.textContent = model.nodes.map((item) => `${item.label}${item.scorched ? " (ended)" : item.reached ? " (reached)" : ""}`).join(" → ")
    + model.branches.map((branch) => `; ${branch.label} branches from ${model.nodes[branch.from].label}`).join("");
  scroll.append(svg);
  const x = (index) => 82 + index * 164;
  const activeMarriage = (item) => item.icon === "rings" && item.reached && !item.scorched;
  const trackClearance = (index) => activeMarriage(model.nodes[index]) ? 53 : model.nodes[index].boost ? 40 : 35;
  for (let index = 0; index < model.progress.length; index++) {
    const start = x(index) + trackClearance(index), end = x(index + 1) - trackClearance(index + 1);
    const scorched = model.nodes[index + 1].scorched;
    svgElement("path", { d: `M${start} 56H${end}`, class: `era-timeline-track${scorched ? " is-scorched" : ""}` }, svg);
    if (scorched)
      svgElement("image", { href: "/relationship-assets/scorched-path.svg", x: start - 5, y: 16, width: end - start + 10, height: 55, preserveAspectRatio: "none", class: "era-timeline-scorch" }, svg);
    else if (model.progress[index] > 0)
      svgElement("path", { d: `M${start} 56H${start + (end - start) * model.progress[index]}`, class: `era-timeline-fill${model.nodes[index + 1].icon === "rings" && model.nodes[index + 1].reached ? " is-married" : ""}` }, svg);
  }
  const drawNode = (item, cx, cy, extra = "") => {
    const group = svgElement("g", { class: `era-timeline-node${item.reached ? " is-reached" : ""}${item.boost ? ` is-boosted is-boost-${item.boost}` : ""}${item.scorched ? " is-scorched" : ""} ${extra}`, transform: `translate(${cx} ${cy})` }, svg);
    if (item.boost)
      svgElement("circle", { r: 36, class: "era-timeline-boost" }, group);
    if (activeMarriage(item)) {
      svgElement("circle", { r: 49, class: "era-timeline-marriage-ring" }, group);
      const sparkles = svgElement("g", { class: "era-timeline-marriage-sparkles", "aria-hidden": "true" }, group);
      for (const [sx, sy, size] of [[-48, -40, 1.25], [57, -24, 1.1], [-59, -19, .7]]) {
        const star = svgElement("g", { transform: `translate(${sx} ${sy}) scale(${size})` }, sparkles);
        svgElement("path", { d: "M0-7L2-2L7 0L2 2L0 7L-2 2L-7 0L-2-2Z" }, star);
      }
    }
    if (item.icon !== "seed" && item.icon !== "sprout")
      svgElement("circle", { r: activeMarriage(item) ? 44 : 30, class: "era-timeline-badge" }, group);
    else
      svgElement("path", { d: scallopedBadge, class: "era-timeline-badge" }, group);
    if (item.boost) {
      const flowers = [[37, -31, 1], [47, -15, .65], [-38, 25, .9], [-32, -34, .8], [34, 30, .75], [-47, -16, .65], [18, -44, .7]];
      for (const [fx, fy, scale] of flowers.slice(0, 1 + item.boost * 2)) {
        const flower = svgElement("g", { transform: `translate(${fx} ${fy}) scale(${scale})`, class: "era-timeline-flowers", "aria-hidden": "true" }, group);
        for (let petal = 0; petal < 5; petal++)
          svgElement("ellipse", { cx: 0, cy: -3.5, rx: 2.3, ry: 3.6, transform: `rotate(${petal * 72})` }, flower);
        svgElement("circle", { r: 1.6, class: "era-timeline-flower-center" }, flower);
      }
    }
    const iconSize = activeMarriage(item) ? 112 : 80;
    svgElement("image", { href: `/relationship-assets/icon-${badges[item.icon]}.svg`, x: -iconSize / 2, y: -iconSize / 2, width: iconSize, height: iconSize, class: "era-timeline-glyph" }, group);
    if (activeMarriage(item)) {
      svgElement("image", { href: "/relationship-assets/marriage-bow.png", x: -20, y: 32, width: 40, height: 27, class: "era-timeline-marriage-bow", "aria-hidden": "true" }, group);
      const leaves = svgElement("g", { class: "era-timeline-marriage-leaves", "aria-hidden": "true" }, group);
      for (const flip of [1, -1]) {
        const sprig = svgElement("g", { transform: `scale(${flip} 1)` }, leaves);
        svgElement("image", { href: "/relationship-assets/marriage-laurel.png", x: -72, y: 55, width: 25, height: 30.5 }, sprig);
      }
    }
    if (item.icon === "spark") {
      svgElement("path", { d: "M43-11C30-19 36-29 43-23C50-29 56-19 43-11ZM34 42C21 34 27 24 34 30C41 24 47 34 34 42Z", class: "era-timeline-hearts" }, group);
      svgElement("path", { d: "M51-35v6M48-32h6M57-16v6M54-13h6M-15 9v6M-18 12h6", class: "era-timeline-rays" }, group);
      svgElement("path", { d: "M-19 51C0 59 39 48 49 38C54 33 52 31 47 33", transform: "translate(0 2)", class: "era-timeline-fwb-flourish" }, group);
    }
    if (item.icon === "love") {
      svgElement("path", { d: "M-39-22C-47-27-42-34-39-29C-35-34-31-27-39-22ZM39-27C31-32 36-39 39-34C43-39 47-32 39-27Z", class: "era-timeline-hearts" }, group);
      svgElement("path", { d: "M-43-15l-5-2M-40-10l-5 1M40-19l5-3M42-13l5 1", class: "era-timeline-rays" }, group);
    }
    const text = svgElement("text", { y: activeMarriage(item) ? 78 : item.icon === "spark" ? 50 : 62, "text-anchor": "middle" }, group);
    text.textContent = item.label;
  };
  model.nodes.forEach((item, index) => drawNode(item, x(index), 56, item.icon === "love" ? "is-in-love" : item.icon === "flower" ? "is-friendship" : item.icon === "rings" ? "is-married" : ""));
  model.branches.forEach((branch, index) => {
    const y = 176 + index * 110;
    const start = x(branch.from) + trackClearance(branch.from);
    const end = x(branch.to) - 30;
    const straight = (end - start) / 4;
    const curveStart = start + straight;
    const curveEnd = end - straight;
    const bend = (curveStart + curveEnd) / 2;
    const branchClass = branch.icon === "broken" ? "is-divorced" : "is-fwb";
    svgElement("path", { d: `M${start} 56H${curveStart}C${bend} 56 ${bend} ${y} ${curveEnd} ${y}H${end}`, class: `era-timeline-branch ${branchClass}` }, svg);
    drawNode({ ...branch, reached: true }, x(branch.to), y, `is-branch ${branchClass}`);
  });
  if (model.early) svgElement("path", { d: `M${width - 47} 56h24`, class: "era-timeline-track is-continuation" }, svg);
  return host;
}
