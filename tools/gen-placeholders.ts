/**
 * Placeholder generator (DESIGN §6.3): every manifest entry marked
 * placeholder:true gets a real SVG file — the game never special-cases
 * placeholders, they're just assets. Swapping in real art = replacing the
 * file + flipping the flag.
 *
 *   npm run gen-placeholders
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetManifestSchema, type AssetKind } from "../src/engine/assets/manifest";

const DIMS: Record<AssetKind, [number, number]> = {
  portrait: [300, 400],
  background: [1280, 720],
  ui: [64, 64],
  map: [1200, 800],
};

/** Stable hue per key group so one character keeps one color family. */
function hueOf(text: string): number {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return hash % 360;
}

export function placeholderSvg(key: string, kind: AssetKind): string {
  const [w, h] = DIMS[kind];
  const group = key.split(".")[1] ?? key;
  const hue = hueOf(group);
  const fill = `hsl(${hue} 22% 18%)`;
  const accent = `hsl(${hue} 35% 45%)`;
  const figure =
    kind === "portrait"
      ? `<circle cx="${w / 2}" cy="${h * 0.36}" r="${w * 0.2}" fill="${accent}" opacity="0.45"/>` +
        `<path d="M${w / 2} ${h * 0.55} C ${w * 0.28} ${h * 0.55} ${w * 0.16} ${h * 0.72} ${w * 0.14} ${h} L ${w * 0.86} ${h} C ${w * 0.84} ${h * 0.72} ${w * 0.72} ${h * 0.55} ${w / 2} ${h * 0.55} Z" fill="${accent}" opacity="0.45"/>`
      : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${fill}"/>` +
    `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="8 6"/>` +
    figure +
    `<text x="${w / 2}" y="${h - 28}" text-anchor="middle" font-family="monospace" font-size="${Math.max(12, w / 25)}" fill="hsl(${hue} 30% 70%)">${key}</text>` +
    `<text x="${w / 2}" y="${h - 10}" text-anchor="middle" font-family="monospace" font-size="${Math.max(10, w / 32)}" fill="hsl(${hue} 20% 50%)">placeholder · ${kind}</text>` +
    "</svg>"
  );
}

function main(): void {
  const manifestPath = join(process.cwd(), "assets", "manifest.json");
  const manifest = assetManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const outRoot = join(process.cwd(), "public", "assets");

  let written = 0;
  for (const [key, entry] of Object.entries(manifest.entries)) {
    if (!entry.placeholder) continue; // never overwrite real art
    const target = join(outRoot, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, placeholderSvg(key, entry.kind));
    written++;
  }
  console.log(`✓ generated ${written} placeholder file(s) under public/assets/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
