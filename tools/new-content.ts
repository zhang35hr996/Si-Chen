/**
 * Content scaffolder (docs/content-authoring): writes a minimal **valid** JSON
 * stub for one content type, refusing to overwrite. Current schema only — no
 * future fields (generate / secrets / schedule / secretRevealed). Deterministic.
 *
 *   npm run new:character wenya_shijun
 *   npm run new:location  lenggong_side
 *   npm run new:event     ev_lenggong_first_visit
 *   npm run new:scene     sc_lenggong_first_visit
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type ContentKind = "character" | "location" | "event" | "scene";

const ID_RE = /^[a-z][a-z0-9_]*$/;

/** Strip a leading ev_/sc_/arc_x__ev_ prefix to get a semantic base. */
function baseOf(id: string): string {
  return id.replace(/^(arc_[a-z0-9_]+__)?(ev_|sc_)/, "");
}

export interface Scaffold {
  dir: string;
  filename: string;
  data: unknown;
}

export function buildScaffold(kind: ContentKind, id: string): Scaffold {
  switch (kind) {
    case "character":
      return {
        dir: "content/characters",
        filename: `${id}.json`,
        data: {
          id,
          kind: "consort",
          profile: {
            name: "TODO 姓名",
            age: 20,
            role: "TODO 一句话身份",
            appearance: "TODO 外貌一两句。",
            personalityTraits: ["TODO 性格"],
            reactionTraits: [],
            coreFacts: ["TODO 关键事实"],
            goals: ["TODO 目标"],
            speechStyle: "TODO 说话风格。",
          },
          defaultLocation: "yushufang",
          portraitSet: id,
          expressions: ["neutral"],
          voice: { register: "formal", quirks: [], tabooTopics: [] },
          initialStanding: { rank: "chenghui", favor: 20, peakFavor: 20 },
          initialMemories: [],
          secrets: [],
        },
      };
    case "location":
      return {
        dir: "content/locations",
        filename: `${id}.json`,
        data: {
          id,
          name: "TODO 名称",
          description: "TODO 场景描写。",
          backgroundKey: `bg.${id}`,
          ambience: ["TODO 环境细节"],
          position: { x: 0.5, y: 0.5 },
          zone: "palace",
          entry: "travel",
          connections: ["yushufang"],
          travelCost: { ap: 1 },
        },
      };
    case "event":
      return {
        dir: "content/events",
        filename: `${id}.json`,
        data: {
          id,
          title: "TODO 事件标题",
          sceneId: `sc_${baseOf(id)}`,
          checkpoint: "location_enter",
          condition: { all: [{ atLocation: "yushufang" }, { not: { eventFired: id } }] },
          priority: 1,
          once: true,
          apCost: 1,
        },
      };
    case "scene":
      return {
        dir: "content/scenes",
        filename: `${id}.json`,
        data: {
          id,
          locationId: "yushufang",
          participants: ["example_character"],
          startNodeId: "n_open",
          nodes: [
            { type: "line", id: "n_open", speaker: "example_character", text: "TODO 开场白。", next: "n_effect" },
            { type: "effect", id: "n_effect", effects: [{ type: "favor", char: "example_character", delta: 1 }] },
          ],
        },
      };
  }
}

const KINDS: ContentKind[] = ["character", "location", "event", "scene"];

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function main(): void {
  const [kind, id] = process.argv.slice(2);
  if (!kind || !KINDS.includes(kind as ContentKind)) {
    fail(`usage: tsx tools/new-content.ts <${KINDS.join("|")}> <id>`);
  }
  if (!id) fail("an id is required");
  if (!ID_RE.test(id)) fail(`id "${id}" must be lowercase snake_case (^[a-z][a-z0-9_]*$)`);
  if (kind === "event" && !id.startsWith("ev_")) fail('event ids must start with "ev_"');
  if (kind === "scene" && !id.startsWith("sc_")) fail('scene ids must start with "sc_"');

  const { dir, filename, data } = buildScaffold(kind as ContentKind, id);
  const fullDir = join(process.cwd(), dir);
  const fullPath = join(fullDir, filename);
  if (existsSync(fullPath)) fail(`${dir}/${filename} already exists — refusing to overwrite`);

  mkdirSync(fullDir, { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`✓ wrote ${dir}/${filename}`);
  console.log("  next: fill the TODO fields, fix cross-references, then `npm run validate-content`.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
