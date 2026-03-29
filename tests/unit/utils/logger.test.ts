import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger } from "../../../src/utils/logger.js";

describe("createLogger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  it("writes JSON lines to stderr", () => {
    const logger = createLogger("debug");
    logger.info("hello");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trimEnd());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.ts).toBeDefined();
  });

  it("includes extra data fields", () => {
    const logger = createLogger("debug");
    logger.warn("problem", { code: 42, detail: "oops" });
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trimEnd());
    expect(parsed.code).toBe(42);
    expect(parsed.detail).toBe("oops");
  });

  it("filters messages below the configured level", () => {
    const logger = createLogger("warn");
    logger.debug("too low");
    logger.info("also too low");
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.warn("just right");
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it("allows error level when configured to error", () => {
    const logger = createLogger("error");
    logger.warn("nope");
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.error("yes");
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it("defaults to info level", () => {
    const logger = createLogger();
    logger.debug("hidden");
    expect(stderrSpy).not.toHaveBeenCalled();
    logger.info("visible");
    expect(stderrSpy).toHaveBeenCalledOnce();
  });
});
