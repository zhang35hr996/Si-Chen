/**
 * Tests for the knowledge:inspect CLI argument parser.
 *
 * Covers the three documented example commands and error paths.
 */
import { describe, expect, it } from "vitest";
import { parseInspectArgs } from "../../tools/knowledge-inspect";

const DEFAULT_DB = "/default/.knowledge.db";

describe("parseInspectArgs — basic query parsing", () => {
  it("single positional arg becomes the query", () => {
    const r = parseInspectArgs(["承养"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("承养");
    expect(r!.limit).toBe(10);
    expect(r!.visibility).toBe("public");
    expect(r!.db).toBe(DEFAULT_DB);
  });

  it("multi-word query is joined with a space", () => {
    const r = parseInspectArgs(["禁足", "请安"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("禁足 请安");
  });

  it("quoted string with spaces parses as one positional", () => {
    // Shell would split quotes before passing args; simulate pre-split
    const r = parseInspectArgs(["禁足 请安"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("禁足 请安");
  });
});

describe("parseInspectArgs — documented example commands", () => {
  it('"承养" — minimal query, all defaults', () => {
    const r = parseInspectArgs(["承养"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("承养");
    expect(r!.limit).toBe(10);
    expect(r!.visibility).toBe("public");
  });

  it('"禁足 请安" --limit 5', () => {
    const r = parseInspectArgs(["禁足", "请安", "--limit", "5"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("禁足 请安");
    expect(r!.limit).toBe(5);
  });

  it('"宣政殿" --visibility imperial --db custom.db', () => {
    const r = parseInspectArgs(
      ["宣政殿", "--db", "./custom.db", "--visibility", "imperial"],
      DEFAULT_DB,
    );
    expect(r).not.toBeNull();
    expect(r!.query).toBe("宣政殿");
    expect(r!.visibility).toBe("imperial");
    expect(r!.db).toBe("./custom.db");
  });
});

describe("parseInspectArgs — flag positions", () => {
  it("flags can appear before the query", () => {
    const r = parseInspectArgs(["--limit", "3", "宣政殿"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("宣政殿");
    expect(r!.limit).toBe(3);
  });

  it("flags can appear between query words", () => {
    const r = parseInspectArgs(["禁足", "--visibility", "restricted", "请安"], DEFAULT_DB);
    expect(r).not.toBeNull();
    expect(r!.query).toBe("禁足 请安");
    expect(r!.visibility).toBe("restricted");
  });
});

describe("parseInspectArgs — error paths", () => {
  it("returns null when query is empty", () => {
    expect(parseInspectArgs([], DEFAULT_DB)).toBeNull();
    expect(parseInspectArgs(["--limit", "5"], DEFAULT_DB)).toBeNull();
  });

  it("returns null for invalid --limit value", () => {
    expect(parseInspectArgs(["query", "--limit", "abc"], DEFAULT_DB)).toBeNull();
    expect(parseInspectArgs(["query", "--limit", "0"], DEFAULT_DB)).toBeNull();
    expect(parseInspectArgs(["query", "--limit", "-1"], DEFAULT_DB)).toBeNull();
  });

  it("returns null for invalid --visibility value", () => {
    expect(parseInspectArgs(["query", "--visibility", "secret"], DEFAULT_DB)).toBeNull();
  });

  it("returns null when flag is missing its value", () => {
    expect(parseInspectArgs(["query", "--limit"], DEFAULT_DB)).toBeNull();
    expect(parseInspectArgs(["query", "--visibility"], DEFAULT_DB)).toBeNull();
    expect(parseInspectArgs(["query", "--db"], DEFAULT_DB)).toBeNull();
  });

  it("returns null for unknown flag", () => {
    expect(parseInspectArgs(["query", "--unknown", "val"], DEFAULT_DB)).toBeNull();
  });
});
