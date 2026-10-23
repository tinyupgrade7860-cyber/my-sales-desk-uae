import { useEffect, useState } from 'preact/hooks';
import type { DataSet, Settings } from './types';
import { emptyDataSet } from './types';
import { loadAll, DEFAULT_SETTINGS } from './db';
import { calcCustomers, type CustomerCalc, type InvoiceCalc, type Index } from './calc';
import { todayISO } from './util';

export interface State {
  ready: boolean;
  data: DataSet;
  settings: Settings;
  invoices: Map<string, InvoiceCalc>;
  customers: Map<string, CustomerCalc>;
  ix: Index | null;
  today: string;
  version: number;
}

const empty: DataSet = emptyDataSet();
let state: State = { ready: false, data: empty, settings: DEFAULT_SETTINGS, invoices: new Map(), customers: new Map(), ix: null, today: todayISO(), version: 0 };
const subs = new Set<(s: State) => void>();

export async function refresh() {
  const { data, settings } = await loadAll();
  const today = todayISO();
  const { ix, invoices, customers } = calcCustomers(data, today);
  state = { ready: true, data, settings, ix, invoices, customers, today, version: state.version + 1 };
  (globalThis as any).__msdVersion = state.version; // used by automated tests to detect completed saves
  subs.forEach(f => f(state));
}
export const getState = () => state;

export function useStore(): State {
  const [s, set] = useState(state);
  useEffect(() => { subs.add(set); if (s !== state) set(state); return () => { subs.delete(set); }; }, []);
  return s;
}

export const custName = (s: State, id?: string) => (id && s.data.customers.find(c => c.id === id)?.name) || '—';
export const invNo = (s: State, id?: string) => (id && s.data.invoices.find(c => c.id === id)?.invoiceNo) || '';
