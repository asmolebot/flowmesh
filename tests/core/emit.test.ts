import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitJson, emitJsonl, emit } from "../../src/core/emit.js";

describe("emit utilities", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it("emitJson writes formatted JSON to stdout", () => {
    emitJson({ foo: "bar" });
    expect(stdoutWrite).toHaveBeenCalledOnce();
    const output = stdoutWrite.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({ foo: "bar" });
  });

  it("emitJsonl writes one line per item", () => {
    emitJsonl([{ a: 1 }, { b: 2 }]);
    expect(stdoutWrite).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stdoutWrite.mock.calls[0][0] as string)).toEqual({ a: 1 });
    expect(JSON.parse(stdoutWrite.mock.calls[1][0] as string)).toEqual({ b: 2 });
  });

  it("emit with jsonl format calls emitJsonl for arrays", () => {
    emit([{ x: 1 }], "jsonl");
    expect(stdoutWrite).toHaveBeenCalledOnce();
    expect(JSON.parse(stdoutWrite.mock.calls[0][0] as string)).toEqual({ x: 1 });
  });

  it("emit with json format calls emitJson", () => {
    emit({ data: true }, "json");
    expect(stdoutWrite).toHaveBeenCalledOnce();
    const output = stdoutWrite.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({ data: true });
  });
});
