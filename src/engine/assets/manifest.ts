/**
 * Asset manifest (DESIGN §6.3): logical keys are the ONLY thing code/content
 * reference; file paths live solely here. Keys follow the naming convention:
 *   portrait.<portraitSet>.<expression> · bg.<locationId> · ui.<name> · map.<name>
 */
import { z } from "zod";

export const assetKindSchema = z.enum(["portrait", "background", "ui", "map"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "asset keys are dot-separated lowercase segments");

export const assetEntrySchema = z.strictObject({
  path: z.string().min(1), // relative to the asset base url / public assets dir
  kind: assetKindSchema,
  placeholder: z.boolean(), // true until real art lands — drives the placeholder report
});
export type AssetEntry = z.infer<typeof assetEntrySchema>;

export const assetManifestSchema = z.strictObject({
  version: z.number().int().min(1),
  entries: z.record(assetKeySchema, assetEntrySchema),
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;

export function portraitKey(portraitSet: string, expression: string): string {
  return `portrait.${portraitSet}.${expression}`;
}

export function backgroundKeyOf(locationId: string): string {
  return `bg.${locationId}`;
}
