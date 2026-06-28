/**
 * Browser/Vite content source: bundles content/**.json via import.meta.glob
 * and feeds the same loadContent() the node CLI uses — one loader, two
 * frontends (tools/validate-content.ts is the disk one).
 */
import type { GameError } from "../infra/errors";
import type { Result } from "../infra/result";
import { loadContent, type ContentDB, type RawFile } from "./loader";

const modules = import.meta.glob<unknown>("../../../content/**/*.json", {
  eager: true,
  import: "default",
});

function toRawFile(path: string, data: unknown): RawFile {
  const index = path.indexOf("content/");
  return { source: index >= 0 ? path.slice(index) : path, data };
}

export function loadGameContent(): Result<ContentDB, GameError[]> {
  const characters: RawFile[] = [];
  const locations: RawFile[] = [];
  const events: RawFile[] = [];
  const scenes: RawFile[] = [];
  const eventTemplates: RawFile[] = [];
  let world: RawFile = { source: "content/world.json", data: null };
  let lexicon: RawFile = { source: "content/lexicon.json", data: null };
  let items: RawFile | undefined;

  for (const [path, data] of Object.entries(modules)) {
    const file = toRawFile(path, data);
    if (path.endsWith("/world.json")) world = file;
    else if (path.endsWith("/lexicon.json")) lexicon = file;
    else if (path.endsWith("/items.json")) items = file;
    else if (path.includes("/characters/")) characters.push(file);
    else if (path.includes("/locations/")) locations.push(file);
    else if (path.includes("/event-templates/")) eventTemplates.push(file);
    else if (path.includes("/events/")) events.push(file);
    else if (path.includes("/scenes/")) scenes.push(file);
    // unknown subdirs are ignored here; tools/validate-content covers hygiene
  }

  characters.sort(bySource);
  locations.sort(bySource);
  events.sort(bySource);
  scenes.sort(bySource);
  eventTemplates.sort(bySource);

  return loadContent({ world, lexicon, characters, locations, events, scenes, items, eventTemplates });
}

const bySource = (a: RawFile, b: RawFile): number => a.source.localeCompare(b.source);
