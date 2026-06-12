/**
 * INTERIM (PR 7 only — deleted from the UI path when PR 8's SceneRunner +
 * dialogue UI land): flattens a simple scene (lines → one choice → per-choice
 * effect node → closing lines) into "pick an outcome, apply effects".
 *
 * Supports exactly the slice's scene shape; branch nodes and nested choices
 * are out of scope and return an error rather than guessing.
 */
import type { SceneContent, EventEffect } from "../content/schemas";
import { MAX_NODE_STEPS } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";

export interface FlatLine {
  speakerId: string;
  text: string;
  expression?: string;
}

export interface FlatOption {
  id: string;
  text: string;
  tone?: string;
  effects: EventEffect[];
  closing: FlatLine[];
}

export interface FlatScene {
  intro: FlatLine[];
  options: FlatOption[];
}

export function flattenScene(scene: SceneContent): Result<FlatScene, GameError> {
  const nodes = new Map(scene.nodes.map((n) => [n.id, n]));
  const unsupported = (what: string) =>
    err(stateError("SCENE_UNSUPPORTED", `flattenScene: ${what} in scene "${scene.id}"`));

  // intro: walk lines from the start until the choice node
  const intro: FlatLine[] = [];
  let cursor = nodes.get(scene.startNodeId);
  let steps = 0;
  while (cursor && cursor.type === "line") {
    if (++steps > MAX_NODE_STEPS) return unsupported("intro loop");
    intro.push({
      speakerId: cursor.speaker,
      text: cursor.text,
      ...(cursor.expression !== undefined ? { expression: cursor.expression } : {}),
    });
    cursor = cursor.next ? nodes.get(cursor.next) : undefined;
  }
  if (!cursor || cursor.type !== "choice") return unsupported("no choice node after intro");

  // options: choice → (effects?) → closing lines → terminal
  const options: FlatOption[] = [];
  for (const choice of cursor.choices) {
    const effects: EventEffect[] = [];
    const closing: FlatLine[] = [];
    let node = nodes.get(choice.next);
    steps = 0;
    while (node) {
      if (++steps > MAX_NODE_STEPS) return unsupported("option loop");
      if (node.type === "effect") {
        effects.push(...node.effects);
        node = node.next ? nodes.get(node.next) : undefined;
      } else if (node.type === "line") {
        closing.push({
          speakerId: node.speaker,
          text: node.text,
          ...(node.expression !== undefined ? { expression: node.expression } : {}),
        });
        node = node.next ? nodes.get(node.next) : undefined;
      } else {
        return unsupported(`${node.type} node inside an option path`);
      }
    }
    options.push({
      id: choice.id,
      text: choice.text,
      ...(choice.tone !== undefined ? { tone: choice.tone } : {}),
      effects,
      closing,
    });
  }
  return ok({ intro, options });
}
