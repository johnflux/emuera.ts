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
  host.className = "era-relationship-timeline";
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
  for (let index = 0; index < model.progress.length; index++) {
    const start = x(index) + 35, end = x(index + 1) - 35;
    const scorched = model.nodes[index + 1].scorched;
    svgElement("path", { d: `M${start} 56H${end}`, class: `era-timeline-track${scorched ? " is-scorched" : ""}` }, svg);
    if (scorched)
      svgElement("image", { href: "/relationship-assets/scorched-path.svg", x: start - 5, y: 16, width: end - start + 10, height: 55, preserveAspectRatio: "none", class: "era-timeline-scorch" }, svg);
    else if (model.progress[index] > 0)
      svgElement("path", { d: `M${start} 56H${start + (end - start) * model.progress[index]}`, class: "era-timeline-fill" }, svg);
  }
  const drawNode = (item, cx, cy, extra = "") => {
    const group = svgElement("g", { class: `era-timeline-node${item.reached ? " is-reached" : ""}${item.boost ? " is-boosted" : ""}${item.scorched ? " is-scorched" : ""} ${extra}`, transform: `translate(${cx} ${cy})` }, svg);
    for (let ring = 0; ring < (item.boost || 0); ring++)
      svgElement("circle", { r: 36 + ring * 4, class: "era-timeline-boost" }, group);
    svgElement("path", { d: scallopedBadge, class: "era-timeline-badge" }, group);
    if (item.icon === "spark") {
      svgElement("path", { d: "M-3 13C-31-3-15-23-3-10C6-23 23-3-3 13ZM9 17C-13 4-1-12 9-2C18-12 31 4 9 17Z", class: "era-timeline-glyph era-timeline-paired-hearts" }, group);
    } else {
      svgElement("image", { href: `/relationship-assets/icon-${badges[item.icon]}.svg`, x: -40, y: -40, width: 80, height: 80, class: "era-timeline-glyph" }, group);
    }
    if (item.icon === "love" || item.icon === "spark") {
      svgElement("path", { d: "M-39-22C-47-27-42-34-39-29C-35-34-31-27-39-22ZM39-27C31-32 36-39 39-34C43-39 47-32 39-27Z", class: "era-timeline-hearts" }, group);
      svgElement("path", { d: "M-43-15l-5-2M-40-10l-5 1M40-19l5-3M42-13l5 1", class: "era-timeline-rays" }, group);
    }
    const text = svgElement("text", { y: 62, "text-anchor": "middle" }, group);
    text.textContent = item.label;
  };
  model.nodes.forEach((item, index) => drawNode(item, x(index), 56, item.icon === "love" ? "is-in-love" : ""));
  model.branches.forEach((branch, index) => {
    const y = 176 + index * 110;
    const start = x(branch.from) + 35;
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
