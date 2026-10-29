/** Join adjacent SSH/tmux redraw fragments without waiting indefinitely on streams. */
export class OutputCoalescer {
  #parts: string[] = [];
  #size = 0;
  #idle?: NodeJS.Timeout;
  #limit?: NodeJS.Timeout;

  constructor(readonly emit: (data: string) => void,
    readonly idleMs = 16, readonly maxMs = 32, readonly maxChars = 65_536) {}

  get pending(): boolean { return this.#parts.length > 0; }

  push(data: string, holdEmpty = false): void {
    if (!data && !holdEmpty) return;
    if (!this.pending) this.#limit = setTimeout(() => this.flush(), this.maxMs);
    this.#parts.push(data);
    this.#size += data.length;
    if (this.#idle) clearTimeout(this.#idle);
    if (this.#size >= this.maxChars) this.flush();
    else this.#idle = setTimeout(() => this.flush(), this.idleMs);
  }

  flush(): void {
    if (this.#idle) clearTimeout(this.#idle);
    if (this.#limit) clearTimeout(this.#limit);
    this.#idle = this.#limit = undefined;
    if (!this.pending) return;
    const data = this.#parts.join("");
    this.#parts = [];
    this.#size = 0;
    this.emit(data);
  }
}
