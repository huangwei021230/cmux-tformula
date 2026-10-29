import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputCoalescer } from "../src/output-coalescer.js";

afterEach(() => vi.useRealTimers());
describe("unframed SSH output coalescing", () => {
  it("can hold an empty frame end until an unframed tail arrives", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const c = new OutputCoalescer(emit, 8);
    c.push("", true); vi.advanceTimersByTime(3);
    expect(c.pending).toBe(true);
    c.push("remaining TeX"); vi.advanceTimersByTime(8);
    expect(emit).toHaveBeenCalledExactlyOnceWith("remaining TeX");
    c.push("", true); vi.advanceTimersByTime(8);
    expect(emit).toHaveBeenLastCalledWith("");
  });
  it("joins a redraw split inside a formula before releasing it", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const c = new OutputCoalescer(emit, 8);
    c.push("\\[\\fr"); vi.advanceTimersByTime(3);
    c.push("ac{1}{2}"); vi.advanceTimersByTime(3);
    c.push("\\]"); vi.advanceTimersByTime(7);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledExactlyOnceWith("\\[\\frac{1}{2}\\]");
    expect(c.pending).toBe(false);
  });
  it("bounds continuous streams by time and size and flushes exit tails exactly once", () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const c = new OutputCoalescer(emit, 8, 24, 32);
    for (let i = 0; i < 6; i++) { c.push("abc"); vi.advanceTimersByTime(4); }
    expect(emit).toHaveBeenCalledExactlyOnceWith("abc".repeat(6));
    c.push("x".repeat(32));
    expect(emit).toHaveBeenLastCalledWith("x".repeat(32));
    c.push("exit tail"); c.flush(); c.flush(); vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenLastCalledWith("exit tail");
  });
});
