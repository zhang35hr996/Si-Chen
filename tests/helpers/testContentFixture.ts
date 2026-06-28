/**
 * Extends the real ContentDB with test-only event/scene fixtures.
 * Never import from production content/; fixtures live in tests/fixtures/.
 */
import { loadRealContent } from "./contentFixture";
import type { ContentDB } from "../../src/engine/content/loader";
import evFixtureSceneRunner from "../fixtures/ev_fixture_scene_runner.json";
import scFixtureSceneRunner from "../fixtures/sc_fixture_scene_runner.json";
import type { GameEventContent, SceneContent } from "../../src/engine/content/schemas";

let cached: ContentDB | undefined;

export function loadTestContent(): ContentDB {
  if (cached) return cached;
  const real = loadRealContent();
  cached = {
    ...real,
    events: {
      ...real.events,
      ev_fixture_scene_runner: evFixtureSceneRunner as unknown as GameEventContent,
    },
    scenes: {
      ...real.scenes,
      sc_fixture_scene_runner: scFixtureSceneRunner as unknown as SceneContent,
    },
  };
  return cached;
}
