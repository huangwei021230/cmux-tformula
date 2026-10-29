import { TerminalCellHoldback } from "./terminal-output.js";

export interface TerminalFramePart {
  data: string;
  inFrame: boolean;
  /** Release this frame only after cached formula placements have been drawn. */
  end?: string;
}

/** Input has already passed TerminalControlGate, so CSI sequences are complete. */
export class TerminalFrameBoundaries {
  readonly #tracker = new TerminalCellHoldback();

  push(data: string): TerminalFramePart[] {
    const state = this.#tracker.trackFrameTransitions(data);
    const parts: TerminalFramePart[] = [];
    let start = 0;
    let inFrame = state.before;
    for (const transition of state.transitions) {
      if (transition.enabled) { inFrame = true; continue; }
      const boundary = Math.max(data.lastIndexOf("\x1b[", transition.end - 1),
        data.lastIndexOf("\u009b", transition.end - 1));
      parts.push({ data: data.slice(start, boundary), inFrame,
        end: data.slice(boundary, transition.end) });
      start = transition.end;
      inFrame = false;
    }
    if (start < data.length) parts.push({ data: data.slice(start), inFrame: inFrame || state.after });
    return parts;
  }
}
