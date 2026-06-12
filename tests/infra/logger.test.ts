import { describe, expect, it } from "vitest";
import { contentError } from "../../src/engine/infra/errors";
import { createLogger, type LogEntry, type LoggerSink } from "../../src/engine/infra/logger";

const fixedClock = () => 1_700_000_000_000;

describe("RingBufferLogger", () => {
  it("records entries oldest→newest with level, message, and data", () => {
    const log = createLogger({ now: fixedClock });
    log.debug("d", { a: 1 });
    log.info("i");
    log.warn("w");
    log.error("e");

    const entries = log.entries();
    expect(entries.map((x) => x.level)).toEqual(["debug", "info", "warn", "error"]);
    expect(entries.map((x) => x.message)).toEqual(["d", "i", "w", "e"]);
    expect(entries[0]?.data).toEqual({ a: 1 });
    expect("data" in entries[1]!).toBe(false);
    expect(entries[0]?.timestamp).toBe(1_700_000_000_000);
  });

  it("evicts oldest entries past capacity while seq stays monotonic", () => {
    const log = createLogger({ capacity: 500, now: fixedClock });
    for (let i = 1; i <= 600; i++) log.info(`msg ${i}`);

    const entries = log.entries();
    expect(entries).toHaveLength(500);
    expect(entries[0]?.seq).toBe(101);
    expect(entries[0]?.message).toBe("msg 101");
    expect(entries[499]?.seq).toBe(600);
    expect(entries[499]?.message).toBe("msg 600");
  });

  it("delivers every entry to sinks and survives a throwing sink", () => {
    const seen: LogEntry[] = [];
    const goodSink: LoggerSink = { write: (e) => seen.push(e) };
    const badSink: LoggerSink = {
      write: () => {
        throw new Error("sink broken");
      },
    };
    const log = createLogger({ sinks: [badSink, goodSink], now: fixedClock });

    expect(() => log.info("hello")).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe("hello");
    expect(log.entries()).toHaveLength(1);
  });

  it("logGameError maps severity to level and embeds the stable tag", () => {
    const log = createLogger({ now: fixedClock });
    log.logGameError(contentError("MISSING_REF", "scene not found", { severity: "fatal" }));
    log.logGameError(contentError("SCHEMA", "odd but tolerable", { severity: "warn" }));

    const [fatal, warn] = log.entries();
    expect(fatal?.level).toBe("error");
    expect(fatal?.message).toContain("ContentError:MISSING_REF");
    expect(warn?.level).toBe("warn");
    expect(fatal?.data).toMatchObject({ category: "content", code: "MISSING_REF" });
  });

  it("exportJson round-trips the buffer and clear empties it", () => {
    const log = createLogger({ now: fixedClock });
    log.info("one", { k: "v" });
    log.warn("two");

    const parsed = JSON.parse(log.exportJson()) as LogEntry[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ seq: 1, level: "info", message: "one", data: { k: "v" } });

    log.clear();
    expect(log.entries()).toHaveLength(0);
    log.info("after clear");
    expect(log.entries()[0]?.seq).toBe(3); // seq is monotonic across clear()
  });
});
