// Match-count bookkeeping: per-rule totals + per-(rule,row) contribution
// map, so incremental updates and row removals adjust totals exactly.
//
// Authoritative reference: spec §1.1 item 4 (live match count).

export class MatchCounter {
  /** ruleId → total matched cells across the dataset. */
  #totals = new Map<string, number>();
  /** rowId → (ruleId → contribution). Zero contributions are not stored. */
  #byRow = new Map<string, Map<string, number>>();

  count(ruleId: string): number {
    return this.#totals.get(ruleId) ?? 0;
  }

  resetAll(): void {
    this.#totals.clear();
    this.#byRow.clear();
  }

  setRowMatches(ruleId: string, rowId: string, n: number): void {
    let rowMap = this.#byRow.get(rowId);
    const prev = rowMap?.get(ruleId) ?? 0;
    if (prev === n) return;
    if (n === 0) {
      rowMap!.delete(ruleId); // prev !== 0 implies rowMap exists
      if (rowMap!.size === 0) this.#byRow.delete(rowId);
    } else {
      if (!rowMap) {
        rowMap = new Map();
        this.#byRow.set(rowId, rowMap);
      }
      rowMap.set(ruleId, n);
    }
    this.#totals.set(ruleId, (this.#totals.get(ruleId) ?? 0) - prev + n);
  }

  dropRow(rowId: string): void {
    const rowMap = this.#byRow.get(rowId);
    if (!rowMap) return;
    for (const [ruleId, n] of rowMap) {
      this.#totals.set(ruleId, (this.#totals.get(ruleId) ?? 0) - n);
    }
    this.#byRow.delete(rowId);
  }
}
