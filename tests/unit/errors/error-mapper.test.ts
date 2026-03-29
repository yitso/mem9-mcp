import { describe, it, expect } from "vitest";
import { mapHttpError, isRetryable, MnemoError } from "../../../src/errors/error-mapper.js";

describe("mapHttpError", () => {
  it("maps 400 to InvalidParams", () => {
    const err = mapHttpError(400, "bad field");
    expect(err).toBeInstanceOf(MnemoError);
    expect(err.mcpCode).toBe("InvalidParams");
    expect(err.message).toContain("bad field");
    expect(err.httpStatus).toBe(400);
  });

  it("maps 401 to InvalidRequest with auth message", () => {
    const err = mapHttpError(401, "");
    expect(err.mcpCode).toBe("InvalidRequest");
    expect(err.message).toContain("MEM9_API_KEY");
  });

  it("maps 404 to InvalidParams", () => {
    const err = mapHttpError(404, "");
    expect(err.mcpCode).toBe("InvalidParams");
    expect(err.message).toContain("not found");
  });

  it("maps 409 to InvalidRequest with conflict message", () => {
    const err = mapHttpError(409, "");
    expect(err.mcpCode).toBe("InvalidRequest");
    expect(err.message).toContain("conflict");
  });

  it("maps 429 to InvalidRequest", () => {
    const err = mapHttpError(429, "");
    expect(err.mcpCode).toBe("InvalidRequest");
    expect(err.message).toContain("Rate limited");
  });

  it("maps 500 to InternalError", () => {
    const err = mapHttpError(500, "");
    expect(err.mcpCode).toBe("InternalError");
  });

  it("maps 502/503/504 to InternalError", () => {
    for (const status of [502, 503, 504]) {
      const err = mapHttpError(status, "");
      expect(err.mcpCode).toBe("InternalError");
      expect(err.httpStatus).toBe(status);
    }
  });

  it("maps 0 (network error) to InternalError with connectivity message", () => {
    const err = mapHttpError(0, "ECONNREFUSED");
    expect(err.mcpCode).toBe("InternalError");
    expect(err.message).toContain("Cannot reach");
    expect(err.message).toContain("ECONNREFUSED");
  });
});

describe("isRetryable", () => {
  it("retries 429, 502, 503, 504", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(502)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(504)).toBe(true);
  });

  it("does not retry 400, 401, 404, 500", () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(500)).toBe(false);
  });
});
