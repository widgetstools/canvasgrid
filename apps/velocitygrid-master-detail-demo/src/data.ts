/**
 * The master/detail dataset, deliberately shaped like ag-grid's own
 * master-detail example (accounts → call records) so the two can be put side
 * by side and compared behaviour-for-behaviour.
 *
 * Two departures from the reference data, both to exercise the parts of the
 * feature a static example never reaches:
 *   - some accounts have NO call records, so `isRowMaster` has something real
 *     to veto;
 *   - `calls` / `minutes` tick, so `refreshStrategy` has something to refresh.
 */

export interface CallRecord {
  callId: number;
  direction: 'In' | 'Out';
  number: string;
  duration: number;
  switchCode: string;
}

export interface Account {
  id: string;
  name: string;
  account: number;
  country: string;
  calls: number;
  minutes: number;
  callRecords: CallRecord[];
}

const NAMES = [
  'Aoife Byrne', 'Tom Brand', 'Niall Cassidy', 'Mira Devi', 'Lars Ek',
  'Priya Nair', 'Sofia Ruiz', 'Hana Sato', 'Jonas Weber', 'Ada Okafor',
  'Marc Dubois', 'Ken Tanaka', 'Ruth Levy', 'Ivan Petrov', 'Chen Wei',
  'Emma Hall', 'Omar Haddad', 'Lena Fischer', 'Diego Costa', 'Yuki Mori',
];
const COUNTRIES = ['Ireland', 'United Kingdom', 'United States', 'Germany', 'Japan', 'Brazil'];
const SWITCHES = ['SW5', 'SW3', 'SW9', 'SW2', 'SW7'];

/** Deterministic PRNG so a reload shows the same book — a demo that reshuffles
 *  on every refresh is useless for comparing against a reference. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeAccounts(count = 60): Account[] {
  const rnd = mulberry32(20260831);
  const out: Account[] = [];
  let callId = 1;
  for (let i = 0; i < count; i++) {
    // Every seventh account has no call history — `isRowMaster` returns false
    // for these, so they paint with no chevron and never open.
    const recordCount = i % 7 === 0 ? 0 : 2 + Math.floor(rnd() * 12);
    const callRecords: CallRecord[] = [];
    for (let r = 0; r < recordCount; r++) {
      callRecords.push({
        callId: callId++,
        direction: rnd() > 0.5 ? 'In' : 'Out',
        number: `(0${1 + Math.floor(rnd() * 8)}) ${1000 + Math.floor(rnd() * 8999)} ${1000 + Math.floor(rnd() * 8999)}`,
        duration: 20 + Math.floor(rnd() * 900),
        switchCode: SWITCHES[Math.floor(rnd() * SWITCHES.length)]!,
      });
    }
    out.push({
      id: `A${100000 + i}`,
      name: NAMES[i % NAMES.length]!,
      account: 177000 + i * 37,
      country: COUNTRIES[Math.floor(rnd() * COUNTRIES.length)]!,
      calls: callRecords.length,
      minutes: Math.round(callRecords.reduce((s, c) => s + c.duration, 0) / 60),
      callRecords,
    });
  }
  return out;
}

/** Add one call to `account` and return the NEW account object — the store
 *  replaces rows by id, so an update has to be a whole row. */
export function addCall(account: Account, rnd: () => number): Account {
  const record: CallRecord = {
    callId: Math.floor(rnd() * 1_000_000),
    direction: rnd() > 0.5 ? 'In' : 'Out',
    number: `(0${1 + Math.floor(rnd() * 8)}) ${1000 + Math.floor(rnd() * 8999)} ${1000 + Math.floor(rnd() * 8999)}`,
    duration: 20 + Math.floor(rnd() * 900),
    switchCode: SWITCHES[Math.floor(rnd() * SWITCHES.length)]!,
  };
  const callRecords = [record, ...account.callRecords];
  return {
    ...account,
    callRecords,
    calls: callRecords.length,
    minutes: Math.round(callRecords.reduce((s, c) => s + c.duration, 0) / 60),
  };
}

export const MASTER_COLUMNS = [
  // The chevron lives on the column carrying `cellRenderer: 'group'` — the
  // same convention as ag-grid's `agGroupCellRenderer`.
  { colId: 'name', field: 'name', headerName: 'Name', width: 200, cellRenderer: 'group' },
  { colId: 'account', field: 'account', headerName: 'Account', width: 120, cellDataType: 'number' },
  { colId: 'country', field: 'country', headerName: 'Country', width: 150 },
  { colId: 'calls', field: 'calls', headerName: 'Calls', width: 100, cellDataType: 'number', aggFunc: 'sum' },
  { colId: 'minutes', field: 'minutes', headerName: 'Minutes', width: 110, cellDataType: 'number', aggFunc: 'sum' },
] as const;

export const DETAIL_COLUMNS = [
  { colId: 'callId', field: 'callId', headerName: 'Call ID', width: 110, cellDataType: 'number' },
  { colId: 'direction', field: 'direction', headerName: 'Direction', width: 110 },
  { colId: 'number', field: 'number', headerName: 'Number', width: 190 },
  { colId: 'duration', field: 'duration', headerName: 'Duration (s)', width: 130, cellDataType: 'number' },
  { colId: 'switchCode', field: 'switchCode', headerName: 'Switch', width: 110 },
] as const;
