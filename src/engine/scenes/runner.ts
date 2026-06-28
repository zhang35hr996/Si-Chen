/**
 * SceneRunner + SceneSession (skeleton-plan §6, lifecycle locked):
 *
 *   start    — engine-side affordability gate (行动点不足 blocks, no rollover);
 *              session opens in memory, AP reserved NOT spent
 *   advance  — walks line/choice/branch/effect nodes; effect nodes ACCUMULATE
 *              into pendingEffects; GameState is never touched mid-scene;
 *              every line renders through the DialogueProvider seam
 *   end      — returns the pending batch; the CALLER commits it through
 *              store.resolveEvent (the PR 7 transaction) — no second path
 *   abandon  — discards everything: no AP, no effects, `once` unconsumed
 *
 * Branch/choice conditions evaluate against the PRE-scene state snapshot:
 * pending effects are invisible until commit, by design.
 */
import type { ContentDB } from "../content/loader";
import { MAX_NODE_STEPS } from "../content/loader";
import type { EventEffect, SceneContent, SceneNode } from "../content/schemas";
import { assembleDialogueRequest, produceDialogueTurn } from "../dialogue/orchestrator";
import { toDialogueTurnOptions, type DialogueRuntimeDeps } from "../dialogue/runtimeDeps";
import type { DialogueLine } from "../dialogue/types";
import { evaluateCondition, hasEventFired } from "../events/conditions";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameState } from "../state/types";

export interface SceneSession {
  eventId: string;
  sceneId: string;
  reservedApCost: number;
  pendingEffects: EventEffect[];
  cursorNodeId: string | null; // null = walked past the terminal node
  steps: number;
}

export interface DialogueFrame {
  line: DialogueLine;
  /** "choice": pick one of line.choices; "continue": advance() with no input. */
  awaiting: "choice" | "continue";
}

export type RunnerStep =
  | { kind: "frame"; frame: DialogueFrame }
  | { kind: "end"; eventId: string; effects: EventEffect[] };

type ChoiceNode = Extract<SceneNode, { type: "choice" }>;

export class SceneRunner {
  private session: SceneSession | null = null;
  private scene: SceneContent | null = null;
  private preState: GameState | null = null; // conditions read committed state only
  private nodes = new Map<string, SceneNode>();
  private awaiting: "choice" | "continue" | null = null;
  private choiceNode: ChoiceNode | null = null;
  private lastLine: DialogueLine | null = null;

  constructor(
    private readonly db: ContentDB,
    private readonly dialogueRuntime: DialogueRuntimeDeps,
  ) {}

  getSession(): SceneSession | null {
    return this.session;
  }

  async start(state: GameState, eventId: string): Promise<Result<RunnerStep, GameError>> {
    const event = this.db.events[eventId];
    if (!event) return err(stateError("BAD_EVENT_REF", `event "${eventId}" does not exist`));
    if (event.once && hasEventFired(state, eventId)) {
      return err(stateError("EVENT_ALREADY_FIRED", `once-event "${eventId}" already fired`));
    }
    if (event.apCost > state.calendar.ap) {
      // 行动点不足 — entry blocked, time does NOT advance.
      return err(
        stateError("AP_INSUFFICIENT", `event "${eventId}" needs ${event.apCost} AP, ${state.calendar.ap} remaining`),
      );
    }
    const scene = this.db.scenes[event.sceneId];
    if (!scene) return err(stateError("BAD_SCENE_REF", `scene "${event.sceneId}" does not exist`));

    this.session = {
      eventId,
      sceneId: scene.id,
      reservedApCost: event.apCost,
      pendingEffects: [],
      cursorNodeId: scene.startNodeId,
      steps: 0,
    };
    this.scene = scene;
    this.preState = state;
    this.nodes = new Map(scene.nodes.map((n) => [n.id, n]));
    this.awaiting = null;
    this.choiceNode = null;
    this.lastLine = null;
    return this.run();
  }

  async advance(choiceId?: string): Promise<Result<RunnerStep, GameError>> {
    if (!this.session) return err(stateError("NO_SESSION", "no scene in progress"));
    if (this.awaiting === "choice") {
      const choice = this.choiceNode?.choices.find(
        (c) => c.id === choiceId && this.choiceVisible(c.condition),
      );
      if (!choice) {
        return err(stateError("BAD_CHOICE", `choice "${choiceId ?? "(none)"}" is not available`));
      }
      this.session.cursorNodeId = choice.next;
      this.choiceNode = null;
    }
    this.awaiting = null;
    return this.run();
  }

  /** Discard the session — nothing was ever applied, so nothing to undo. */
  abandon(): void {
    this.session = null;
    this.scene = null;
    this.preState = null;
    this.nodes = new Map();
    this.awaiting = null;
    this.choiceNode = null;
    this.lastLine = null;
  }

  private choiceVisible(condition: ChoiceNode["choices"][number]["condition"]): boolean {
    if (!condition) return true;
    return evaluateCondition(condition, { db: this.db, state: this.preState! });
  }

  private fail(error: GameError): Result<RunnerStep, GameError> {
    this.abandon(); // runtime backstop: session discarded, no AP/effects (plan §10 #7)
    return err(error);
  }

  private async run(): Promise<Result<RunnerStep, GameError>> {
    const session = this.session!;
    for (;;) {
      if (session.cursorNodeId === null) {
        const result: RunnerStep = {
          kind: "end",
          eventId: session.eventId,
          effects: session.pendingEffects,
        };
        this.abandon(); // hand the batch to the caller; the session itself is done
        return ok(result);
      }
      if (++session.steps > MAX_NODE_STEPS) {
        return this.fail(
          stateError("SCENE_LOOP", `scene "${session.sceneId}" exceeded ${MAX_NODE_STEPS} node steps`),
        );
      }
      const node = this.nodes.get(session.cursorNodeId);
      if (!node) {
        return this.fail(
          stateError("SCENE_CURSOR", `scene "${session.sceneId}" cursor at unknown node "${session.cursorNodeId}"`),
        );
      }

      switch (node.type) {
        case "effect":
          session.pendingEffects.push(...node.effects); // accumulate; state untouched
          session.cursorNodeId = node.next ?? null;
          continue;

        case "branch":
          session.cursorNodeId = evaluateCondition(node.condition, {
            db: this.db,
            state: this.preState!,
          })
            ? node.ifTrue
            : node.ifFalse;
          continue;

        case "narration": {
          // 旁白节点：直接产生 frame，不经过 DialogueProvider / speaker 校验。
          const narrationLine: DialogueLine = {
            speakerId: "narrator",
            speakerName: "",
            text: node.text,
            expression: "neutral",
            choices: [],
            meta: { generated: false, degraded: false },
          };
          const narrationNext = node.next ? this.nodes.get(node.next) : undefined;
          if (narrationNext?.type === "choice") {
            const attached = this.attachChoices(narrationLine, narrationNext);
            if (!attached.ok) return this.fail(attached.error);
            this.lastLine = attached.value;
            return ok({ kind: "frame", frame: { line: attached.value, awaiting: "choice" } });
          }
          session.cursorNodeId = node.next ?? null;
          this.awaiting = "continue";
          this.lastLine = narrationLine;
          return ok({ kind: "frame", frame: { line: narrationLine, awaiting: "continue" } });
        }

        case "line": {
          const request = assembleDialogueRequest(
            this.db,
            this.preState!,
            node.speaker,
            this.scene!.locationId,
            { scripted: { text: node.text, ...(node.expression !== undefined ? { expression: node.expression } : {}) } },
          );
          if (!request.ok) return this.fail(request.error);
          const produced = await produceDialogueTurn(this.db, this.dialogueRuntime.provider, request.value, this.preState!, toDialogueTurnOptions(this.dialogueRuntime));
          if (!produced.ok) return this.fail(produced.error);

          let line = produced.value.line;
          const nextNode = node.next ? this.nodes.get(node.next) : undefined;
          if (nextNode?.type === "choice") {
            const attached = this.attachChoices(line, nextNode);
            if (!attached.ok) return this.fail(attached.error);
            this.lastLine = attached.value;
            return ok({ kind: "frame", frame: { line: attached.value, awaiting: "choice" } });
          }
          session.cursorNodeId = node.next ?? null;
          this.awaiting = "continue";
          this.lastLine = line;
          return ok({ kind: "frame", frame: { line, awaiting: "continue" } });
        }

        case "choice": {
          // Entered directly (branch/effect → choice): re-present the last line.
          if (!this.lastLine) {
            return this.fail(
              stateError("SCENE_UNSUPPORTED", `scene "${session.sceneId}" opens with a bare choice node`),
            );
          }
          const attached = this.attachChoices(this.lastLine, node);
          if (!attached.ok) return this.fail(attached.error);
          this.lastLine = attached.value;
          return ok({ kind: "frame", frame: { line: attached.value, awaiting: "choice" } });
        }
      }
    }
  }

  private attachChoices(line: DialogueLine, node: ChoiceNode): Result<DialogueLine, GameError> {
    const visible = node.choices.filter((c) => this.choiceVisible(c.condition));
    if (visible.length === 0) {
      return err(
        stateError("SCENE_UNSUPPORTED", `choice node "${node.id}" has no visible choices`),
      );
    }
    this.choiceNode = node;
    this.awaiting = "choice";
    return ok({
      ...line,
      choices: visible.map((c) => ({
        id: c.id,
        text: c.text,
        ...(c.tone !== undefined ? { tone: c.tone } : {}),
      })),
    });
  }
}
