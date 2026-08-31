/**
 * A book hierarchy: desk → region → book → position.
 *
 * Deterministic, so CSRM and SSRM show the same tree and any difference
 * between them is the grid rather than the data.
 */

export interface TreeRow {
  positionId: string;
  name: string;
  desk: string;
  region: string;
  book: string;
  instrumentType: string;
  notionalAmount: number;
  marketValue: number;
  pnl: number;
  /** The row's place in the hierarchy, root first. Fed to `getDataPath`. */
  path: string[];
}

const DESKS = ['FX', 'Rates', 'Credit'];
const REGIONS = ['EMEA', 'AMER', 'APAC'];
const INSTRUMENTS = ['Bond', 'Swap', 'Future', 'Option'];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the tree. Every desk / region / book node is a REAL row as well as a
 * parent — the case column grouping cannot express, and the one most likely to
 * break, so the demo leads with it rather than hiding it.
 */
export function makeTreeRows(): TreeRow[] {
  const rnd = mulberry32(1234);
  const rows: TreeRow[] = [];
  let n = 0;

  const push = (path: string[], name: string): void => {
    const notional = Math.round(rnd() * 4_000_000) + 250_000;
    const pnl = Math.round((rnd() - 0.5) * 300_000);
    const [desk = '', region = '', book = ''] = path;
    rows.push({
      positionId: `POS-${String(n++).padStart(5, '0')}`,
      name,
      desk,
      region,
      book,
      instrumentType: INSTRUMENTS[Math.floor(rnd() * INSTRUMENTS.length)]!,
      notionalAmount: notional,
      marketValue: notional + pnl,
      pnl,
      path,
    });
  };

  for (const desk of DESKS) {
    push([desk], `${desk} desk`);                       // a row AND a parent
    for (const region of REGIONS) {
      push([desk, region], `${desk} ${region}`);        // likewise
      for (let b = 1; b <= 2; b++) {
        const book = `Book ${b}`;
        push([desk, region, book], book);               // likewise
        for (let p = 1; p <= 4; p++) {
          push([desk, region, book, `Position ${p}`], `Position ${p}`);
        }
      }
    }
  }
  return rows;
}

/** Column definitions shared by both row models. */
export const TREE_COLUMNS = [
  { colId: 'name', field: 'name', headerName: 'Name', width: 180, filter: true },
  { colId: 'instrumentType', field: 'instrumentType', headerName: 'Instrument', width: 130, filter: true },
  { colId: 'notionalAmount', field: 'notionalAmount', headerName: 'Notional', width: 150, cellDataType: 'number', aggFunc: 'sum', enableValue: true },
  { colId: 'marketValue', field: 'marketValue', headerName: 'Mkt Value', width: 150, cellDataType: 'number', aggFunc: 'sum', enableValue: true },
  { colId: 'pnl', field: 'pnl', headerName: 'P&L', width: 130, cellDataType: 'number', aggFunc: 'sum', enableValue: true },
] as const;
