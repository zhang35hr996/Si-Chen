import { describe, expect, it } from "vitest";
import { err, isErr, isOk, map, mapErr, ok, unwrapOr } from "../../src/engine/infra/result";

describe("Result", () => {
  it("ok() wraps a value and narrows via isOk", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    expect(r.value).toBe(42);
  });

  it("err() wraps an error and narrows via isErr", () => {
    const r = err("boom");
    expect(r.ok).toBe(false);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("unwrapOr returns the value for ok and the fallback for err", () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err("x") as never, 99)).toBe(99);
  });

  it("map transforms ok and passes err through untouched", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    const e = err("nope");
    expect(map(e, (n: number) => n * 10)).toBe(e);
  });

  it("mapErr transforms err and passes ok through untouched", () => {
    const o = ok(2);
    expect(mapErr(o, (s: string) => s.toUpperCase())).toBe(o);
    expect(mapErr(err("nope"), (s) => s.toUpperCase())).toEqual(err("NOPE"));
  });
});
