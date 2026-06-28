/**
 * Content validator CLI (skeleton-plan §3): reads content/, runs the loader,
 * prints every collected error, exits nonzero on any problem. Runs in CI.
 *
 *   npm run validate-content
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatErrorTag, type GameError } from "../src/engine/infra/errors";
import { loadContent, type ContentDB, type RawContent, type RawFile } from "../src/engine/content/loader";
import { contentError } from "../src/engine/infra/errors";
import type { EventTemplate } from "../src/engine/content/schemas";

export interface DiskContent {
  raw: RawContent;
  /** JSON parse failures — reported alongside loader errors. */
  parseErrors: GameError[];
}

export function readContentDir(rootDir: string): DiskContent {
  const parseErrors: GameError[] = [];

  const readJson = (path: string): RawFile => {
    const source = relative(rootDir, path) || path;
    try {
      return { source: `content/${source}`, data: JSON.parse(readFileSync(path, "utf8")) as unknown };
    } catch (cause) {
      parseErrors.push(
        contentError("SCHEMA", `content/${source}: not valid JSON (${String(cause)})`, {
          context: { file: `content/${source}` },
          cause,
        }),
      );
      return { source: `content/${source}`, data: null };
    }
  };

  const readDir = (dir: string): RawFile[] => {
    const full = join(rootDir, dir);
    return readdirSync(full)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readJson(join(full, name)));
  };

  const eventTemplatesDir = join(rootDir, "event-templates");
  const eventTemplates = existsSync(eventTemplatesDir) ? readDir("event-templates") : [];

  return {
    raw: {
      world: readJson(join(rootDir, "world.json")),
      lexicon: readJson(join(rootDir, "lexicon.json")),
      characters: readDir("characters"),
      locations: readDir("locations"),
      events: readDir("events"),
      scenes: readDir("scenes"),
      items: readJson(join(rootDir, "items.json")),
      eventTemplates,
    },
    parseErrors,
  };
}

// ── 模板专属交叉验证 ──────────────────────────────────────────────────

function validateTemplate(tpl: EventTemplate, db: ContentDB): string[] {
  const errors: string[] = [];
  const loc = `template:${tpl.id}`;

  const roleIds = new Set(tpl.participantRoles.map((r) => r.roleId));
  const choiceIds = new Set(tpl.choices.map((c) => c.id));
  const outcomeChoiceIds = new Set(tpl.outcomes.map((o) => o.choiceId));
  const truthIds = new Set(tpl.hiddenTruthCandidates.map((h) => h.id));

  // 1. 每个 choice 恰好有一个 outcome
  for (const c of tpl.choices) {
    if (!outcomeChoiceIds.has(c.id)) errors.push(`${loc}: choice "${c.id}" 缺少 outcome`);
  }
  // 反向：不允许多余 outcome
  for (const o of tpl.outcomes) {
    if (!choiceIds.has(o.choiceId)) errors.push(`${loc}: outcome.choiceId "${o.choiceId}" 在 choices 中不存在`);
  }

  // 2. choiceId / roleId / hiddenTruthId 不得重复
  if (tpl.choices.length !== choiceIds.size) {
    errors.push(`${loc}: choices 含重复 id`);
  }
  if (tpl.participantRoles.length !== roleIds.size) {
    errors.push(`${loc}: participantRoles 含重复 roleId`);
  }
  if (tpl.hiddenTruthCandidates.length !== truthIds.size) {
    errors.push(`${loc}: hiddenTruthCandidates 含重复 id`);
  }

  // 3. responseLine.role 必须是已声明 role
  for (const o of tpl.outcomes) {
    if (o.responseLine && !roleIds.has(o.responseLine.role)) {
      errors.push(`${loc}: outcome[${o.choiceId}].responseLine.role "${o.responseLine.role}" 不在 participantRoles 中`);
    }
  }

  // 4. effect.role 必须是已声明 role
  for (const o of tpl.outcomes) {
    for (const e of o.effects) {
      if (e.type === "favor" || e.type === "adjust_consort_attr") {
        if (!roleIds.has(e.role)) {
          errors.push(`${loc}: outcome[${o.choiceId}].effects.role "${e.role}" 不在 participantRoles 中`);
        }
      }
    }
  }

  // 5. memory forRole / subjectIds 中非 player 的 role 必须已声明
  for (const o of tpl.outcomes) {
    for (const m of o.memories) {
      if (!roleIds.has(m.forRole)) {
        errors.push(`${loc}: outcome[${o.choiceId}].memories.forRole "${m.forRole}" 不在 participantRoles 中`);
      }
      for (const sid of m.entry.subjectIds) {
        if (sid !== "player" && !roleIds.has(sid)) {
          errors.push(`${loc}: outcome[${o.choiceId}].memories.subjectIds "${sid}" 不是 player 也不在 participantRoles 中`);
        }
      }
    }
  }

  // 6. openingNarration dialogue 的 speakerRole 必须已声明
  if (tpl.openingNarration.mode === "dialogue" && !roleIds.has(tpl.openingNarration.speakerRole)) {
    errors.push(`${loc}: openingNarration.speakerRole "${tpl.openingNarration.speakerRole}" 不在 participantRoles 中`);
  }

  // 7. {roleId} 占位符必须能解析（仅检查 narration/dialogue text 和 responseLine）
  const rolePattern = /\{([a-z][a-z0-9_]*)\}/g;
  const checkText = (text: string, field: string): void => {
    let m: RegExpExecArray | null;
    rolePattern.lastIndex = 0;
    while ((m = rolePattern.exec(text)) !== null) {
      const rid = m[1]!;
      if (!roleIds.has(rid)) {
        errors.push(`${loc}: ${field} 含 {${rid}} 但 roleId 未声明`);
      }
    }
  };
  checkText(tpl.openingNarration.text, "openingNarration.text");
  for (const o of tpl.outcomes) {
    if (o.responseLine) checkText(o.responseLine.text, `outcome[${o.choiceId}].responseLine.text`);
  }

  // 8. exploration presentation 的 hostLocation / subLocation 必须存在
  if (tpl.presentation?.mode === "exploration") {
    const p = tpl.presentation;
    if (!db.locations[p.hostLocationId]) {
      errors.push(`${loc}: presentation.hostLocationId "${p.hostLocationId}" 不存在`);
    }
    const hostLoc = db.locations[p.hostLocationId];
    if (hostLoc) {
      const hasSub = hostLoc.subLocations?.some((s) => s.id === p.subLocationId);
      if (!hasSub) {
        errors.push(`${loc}: presentation.subLocationId "${p.subLocationId}" 不存在于 "${p.hostLocationId}"`);
      }
    }
  }

  // 9. participantConstraints role 引用必须已声明
  for (const constraint of tpl.participantConstraints) {
    if (constraint.type === "rank_higher_than") {
      if (!roleIds.has(constraint.higherRole)) {
        errors.push(`${loc}: participantConstraints.higherRole "${constraint.higherRole}" 未声明`);
      }
      if (!roleIds.has(constraint.lowerRole)) {
        errors.push(`${loc}: participantConstraints.lowerRole "${constraint.lowerRole}" 未声明`);
      }
    }
  }

  // 10. triggerCondition atLocation 引用必须存在
  const cond = tpl.triggerCondition;
  if ("atLocation" in cond && cond.atLocation && !db.locations[cond.atLocation]) {
    errors.push(`${loc}: triggerCondition.atLocation "${cond.atLocation}" 不存在`);
  }

  return errors;
}

function validateAllTemplates(db: ContentDB): string[] {
  const allErrors: string[] = [];
  for (const tpl of Object.values(db.templates)) {
    allErrors.push(...validateTemplate(tpl, db));
  }
  return allErrors;
}

// ── main ──────────────────────────────────────────────────────────────

function main(): void {
  const rootDir = join(process.cwd(), "content");
  const { raw, parseErrors } = readContentDir(rootDir);
  const result = loadContent(raw);

  const errors = [...parseErrors, ...(result.ok ? [] : result.error)];
  if (errors.length > 0) {
    console.error(`✖ content validation failed with ${errors.length} error(s):\n`);
    for (const error of errors) {
      console.error(`  ${formatErrorTag(error)}  ${error.message}`);
    }
    process.exit(1);
  }

  if (!result.ok) {
    console.error("✖ loader returned no ContentDB despite zero errors");
    process.exit(1);
    return;
  }
  const db = result.value;

  // 模板专属交叉验证
  const templateErrors = validateAllTemplates(db);
  if (templateErrors.length > 0) {
    console.error(`✖ event template cross-validation failed with ${templateErrors.length} error(s):\n`);
    for (const e of templateErrors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ content OK (version ${db.contentVersion}): ` +
      `${Object.keys(db.characters).length} characters, ` +
      `${Object.keys(db.locations).length} locations, ` +
      `${Object.keys(db.events).length} events, ` +
      `${Object.keys(db.scenes).length} scenes, ` +
      `${Object.keys(db.ranks).length} ranks, ` +
      `${Object.keys(db.templates).length} event templates`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
