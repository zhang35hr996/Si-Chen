/**
 * AssetRegistry (skeleton-plan §3, DESIGN §6.3). resolve() NEVER throws and
 * always returns something drawable:
 *
 *   portrait.X.worried missing → portrait.X.neutral → built-in silhouette
 *   bg.X missing               → built-in gradient
 *   ui./map. missing           → built-in tile
 *
 * Every fallback hop logs AssetError once per key (diagnostics, never spam);
 * `isFallback` lets the debug panel badge degraded art.
 */
import { assetError } from "../infra/errors";
import type { RingBufferLogger } from "../infra/logger";
import { portraitKey, type AssetKind, type AssetManifest } from "./manifest";

export interface ResolvedAsset {
  /** The key that was asked for (not the key that answered). */
  key: string;
  url: string;
  kind: AssetKind;
  isFallback: boolean;
  /** True when the answering entry (or builtin) is placeholder art. */
  isPlaceholder: boolean;
}

export interface AssetRegistryOptions {
  /** URL prefix for manifest paths. Default "/assets/" (Vite public dir). */
  baseUrl?: string;
  logger?: RingBufferLogger;
}

const svgDataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Baked into the bundle — these cannot be missing (DESIGN §6.3). */
export const BUILTIN_FALLBACK_URLS: Record<AssetKind, string> = {
  portrait: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">' +
      '<rect width="300" height="400" fill="#1c1611"/>' +
      '<circle cx="150" cy="150" r="62" fill="#3a2f24"/>' +
      '<path d="M150 220 C 90 220 55 270 50 400 L 250 400 C 245 270 210 220 150 220 Z" fill="#3a2f24"/>' +
      "</svg>",
  ),
  background: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">' +
      '<defs><radialGradient id="g" cx="0.5" cy="0.35"><stop offset="0" stop-color="#2a201a"/><stop offset="1" stop-color="#14100e"/></radialGradient></defs>' +
      '<rect width="1280" height="720" fill="url(#g)"/>' +
      "</svg>",
  ),
  ui: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#241c15" stroke="#5c4d3a" stroke-width="2"/>' +
      "</svg>",
  ),
  map: svgDataUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">' +
      '<rect width="1200" height="800" fill="#181210"/>' +
      "</svg>",
  ),
};

export class AssetRegistry {
  private readonly manifest: AssetManifest;
  private readonly baseUrl: string;
  private readonly logger: RingBufferLogger | undefined;
  private readonly warned = new Set<string>();

  constructor(manifest: AssetManifest, options: AssetRegistryOptions = {}) {
    this.manifest = manifest;
    this.baseUrl = options.baseUrl ?? "/assets/";
    this.logger = options.logger;
  }

  /** Never throws; always returns a drawable url. */
  resolve(key: string, expectedKind: AssetKind): ResolvedAsset {
    for (const candidate of this.fallbackChain(key, expectedKind)) {
      const entry = this.manifest.entries[candidate];
      if (!entry) continue;
      if (entry.kind !== expectedKind) {
        this.warnOnce(
          `kind:${candidate}:${expectedKind}`,
          "ASSET_KIND_MISMATCH",
          `asset "${candidate}" is kind "${entry.kind}", expected "${expectedKind}"`,
          { key: candidate, expected: expectedKind, actual: entry.kind },
        );
        continue; // a wrong-kind entry counts as missing for this request
      }
      const isFallback = candidate !== key;
      if (isFallback) {
        this.warnOnce(
          `miss:${key}:${expectedKind}`,
          "ASSET_MISSING",
          `asset "${key}" missing; using "${candidate}"`,
          { key, fallback: candidate },
        );
      }
      return {
        key,
        url: this.baseUrl + entry.path,
        kind: expectedKind,
        isFallback,
        isPlaceholder: entry.placeholder,
      };
    }

    this.warnOnce(
      `miss:${key}:${expectedKind}`,
      "ASSET_MISSING",
      `asset "${key}" missing; using built-in ${expectedKind} fallback`,
      { key, fallback: "builtin" },
    );
    return {
      key,
      url: BUILTIN_FALLBACK_URLS[expectedKind],
      kind: expectedKind,
      isFallback: true,
      isPlaceholder: true,
    };
  }

  portrait(portraitSet: string, expression: string): ResolvedAsset {
    return this.resolve(portraitKey(portraitSet, expression), "portrait");
  }

  background(backgroundKey: string): ResolvedAsset {
    return this.resolve(backgroundKey, "background");
  }

  /**
   * Resolve a time-of-day variant: prefer `<baseKey>.<variant>` (e.g.
   * bg.yuhuayuan.twilight / map.palace.night), else the plain base key. Both
   * the variant and the base are authored art, so neither is `isFallback`;
   * only the built-in art is. The requested `key` is always the base key so a
   * variant render never badges as degraded.
   */
  resolveVariant(baseKey: string, variant: string, kind: AssetKind): ResolvedAsset {
    for (const candidate of [`${baseKey}.${variant}`, baseKey]) {
      const entry = this.manifest.entries[candidate];
      if (!entry) continue;
      if (entry.kind !== kind) {
        this.warnOnce(
          `kind:${candidate}:${kind}`,
          "ASSET_KIND_MISMATCH",
          `asset "${candidate}" is kind "${entry.kind}", expected "${kind}"`,
          { key: candidate, expected: kind, actual: entry.kind },
        );
        continue;
      }
      return {
        key: baseKey,
        url: this.baseUrl + entry.path,
        kind,
        isFallback: false,
        isPlaceholder: entry.placeholder,
      };
    }
    this.warnOnce(
      `miss:${baseKey}:${kind}`,
      "ASSET_MISSING",
      `asset "${baseKey}" (variant "${variant}") missing; using built-in ${kind} fallback`,
      { key: baseKey, variant, fallback: "builtin" },
    );
    return {
      key: baseKey,
      url: BUILTIN_FALLBACK_URLS[kind],
      kind,
      isFallback: true,
      isPlaceholder: true,
    };
  }

  private fallbackChain(key: string, kind: AssetKind): string[] {
    if (kind === "portrait") {
      const parts = key.split(".");
      if (parts.length === 3 && parts[0] === "portrait" && parts[2] !== "neutral") {
        return [key, portraitKey(parts[1]!, "neutral")];
      }
    }
    return [key];
  }

  private warnOnce(
    dedupeKey: string,
    code: string,
    message: string,
    context: Record<string, unknown>,
  ): void {
    if (this.warned.has(dedupeKey)) return;
    this.warned.add(dedupeKey);
    this.logger?.logGameError(assetError(code, message, { severity: "warn", context }));
  }
}
