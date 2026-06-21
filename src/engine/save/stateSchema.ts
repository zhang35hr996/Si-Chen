/**
 * Runtime validation for LOADED GameState (skeleton-plan §9). A save that
 * fails this schema is corrupt — quarantined, never silently loaded.
 */
import { z } from "zod";
import { calendarInvariantViolation, type CalendarState } from "../calendar/time";
import {
  characterStandingSchema,
  characterSchema,
  idSchema,
  memoryKindSchema,
} from "../content/schemas";
import type { GameState } from "../state/types";

const percent = z.number().int().min(0).max(100);

export const gameTimeSchema = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().min(0),
});

const calendarStateSchema = gameTimeSchema
  .extend({
    ap: z.number().int().min(0),
    apMax: z.number().int().min(1),
    eraName: z.string().default(""),
  })
  .refine((cal) => calendarInvariantViolation(cal as CalendarState) === null, {
    message: "impossible calendar state",
  });

const memoryEntrySchema = z.strictObject({
  id: z.string().min(1),
  kind: memoryKindSchema,
  summary: z.string().min(1).max(240),
  salience: percent,
  createdAt: gameTimeSchema,
  tags: z.array(z.string()).max(5),
  participants: z.array(z.string()).min(1),
  locationId: idSchema.optional(),
  source: z.enum(["authored", "scene_outcome"]),
  originSceneId: idSchema.optional(),
  protected: z.boolean(),
});

const officialSchema = z.strictObject({
  id: idSchema,
  surname: z.string().min(1),
  givenName: z.string().min(1),
  postId: idSchema,
  loyalty: percent,
});

const flagValueSchema = z.union([z.boolean(), z.number(), z.string()]);

export const gameStateSchema = z.strictObject({
  calendar: calendarStateSchema,
  playerLocation: z.string(),
  resources: z.strictObject({
    sovereign: z.strictObject({
      health: percent,
      diligence: percent,
      prestige: percent,
      martial: percent,
      statecraft: percent,
      cruelty: percent,
      fatigue: percent,
      regimeSecurity: percent,
    }),
    nation: z.strictObject({
      military: percent,
      treasury: z.number().int().min(0),
      publicSupport: percent,
      productivity: percent,
      governance: percent,
      consortClanPower: percent,
      ministerLoyalty: percent,
      corruption: percent,
      clanDiscontent: percent,
      rumor: percent,
    }),
    bloodline: z.strictObject({
      menstrualStatus: z.enum(["normal", "irregular", "absent"]),
      lastRiteAt: gameTimeSchema.optional(),
      pregnancy: z.strictObject({
        status: z.enum(["none", "pending", "carrying"]),
        conceivedAt: gameTimeSchema.optional(),
        candidateIds: z.array(idSchema),
      }),
      gestations: z.array(
        z.strictObject({
          carrier: z.union([z.literal("sovereign"), idSchema]),
          conceivedAt: gameTimeSchema,
          fatherId: idSchema.optional(),
          transferredAtMonth: z.number().int().min(1).optional(),
        }),
      ),
      heirs: z.array(
        z.strictObject({
          id: idSchema,
          sex: z.enum(["daughter", "son"]),
          fatherId: z.union([idSchema, z.null()]),
          bearer: z.union([z.literal("sovereign"), idSchema]),
          birthAt: gameTimeSchema,
          favor: percent,
          legitimate: z.boolean(),
          petName: z.string().max(2),
          givenName: z.string().max(2).optional(),
          education: z.strictObject({
            scholarship: percent,
            martial: percent,
            virtue: percent,
          }),
          adoptiveFatherId: idSchema.optional(),
          health: percent,
          talent: percent,
          diligence: percent,
          ambition: percent,
          closeness: percent,
          support: percent,
          faction: z.enum([
            "none",
            "empress",
            "adoptive",
            "maternal",
            "scholars",
            "generals",
            "clan",
            "wavering",
            "foreign",
          ]),
        }),
      ),
    }),
    storehouse: z.strictObject({
      items: z.record(idSchema, z.number().int().min(0)),
    }),
  }),
  flags: z.record(z.string(), flagValueSchema),
  standing: z.record(idSchema, characterStandingSchema),
  generatedConsorts: z.record(idSchema, characterSchema),
  officials: z.record(z.string(), officialSchema),
  memories: z.record(
    idSchema,
    z.strictObject({ entries: z.array(memoryEntrySchema), nextSeq: z.number().int().min(1) }),
  ),
  bedchamber: z.record(
    idSchema,
    z.strictObject({
      encounters: z.array(
        z.strictObject({ at: gameTimeSchema, mode: z.enum(["passion", "pleasure", "companionship"]) }),
      ),
    }),
  ),
  taihou: z.strictObject({ ill: z.boolean() }),
  eventLog: z.array(z.strictObject({ eventId: idSchema, firedAt: gameTimeSchema })),
  sceneHistory: z.array(idSchema),
  rngSeed: z.number(),
}) satisfies z.ZodType<GameState>;

/** Envelope checked BEFORE the state payload (checksum gates the inside). */
export const saveEnvelopeSchema = z.strictObject({
  formatVersion: z.number().int().min(1),
  engineVersion: z.string(),
  contentVersion: z.string(),
  contentHash: z.string(),
  createdAt: z.string(),
  slot: z.string(),
  checksum: z.string(),
  state: z.unknown(),
});
export type SaveEnvelope = z.infer<typeof saveEnvelopeSchema>;
