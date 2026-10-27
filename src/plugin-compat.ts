export const SHARP_METHODS: ReadonlySet<string> = new Set(["LAUNCH_BROWSER", "FIXHTML", "TRANSLATEDATE"]);

/** Lexical inventory only; argument syntax and types are checked at execution. */
export function supportedSharpCall(source: string): boolean {
  const name = /^([A-Z_][A-Z0-9_]*)\s*\(/i.exec(source.trim())?.[1];
  return name !== undefined && SHARP_METHODS.has(name.toUpperCase());
}

/** Blue Resort history repairs, not a general HTML sanitizer. Empty means no change. */
export function fixHistoryHtml(source: string): string {
  let repaired = source;
  if (source.includes("<font color='#FFCCE7'["))
    repaired = source.replaceAll("<font color='#FFCCE7'[", "<font color='#FFCCE7'>[");
  else if (source.includes("500>"))
    repaired = source.replaceAll("500>", "500</font>");
  else
    repaired = source.replace(/([^< ])\/font>/g, "$1</font>");
  return repaired === source ? "" : repaired;
}

export function translateHistoryDate(source: string): string {
  const match = /((\d+)年目 ([\p{L}\p{Mn}\p{Nd}\p{Pc}]+) (\d{1,2})日：)/u.exec(source);
  if (!match) return "";
  const seasons: Record<string, string> = { 春の月: "Spring", 夏の月: "Summer", 秋の月: "Autumn", 冬の月: "Winter" };
  const day = Number(match[4]);
  const suffix = day === 0 ? "" : day % 100 >= 11 && day % 100 <= 13 ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  return source.replaceAll(match[1]!, `Year ${match[2]}, ${seasons[match[3]!] ?? match[3]} ${day}${suffix}: `);
}
