import { describe, it, expect } from 'vitest';
import { makeBackup, validateBackup, toCSV, checksum } from '../../src/backup';
import { generateDemo } from '../../src/seed';

const full = () => ({ ...generateDemo('2026-10-23'), auditLog: [], settings: [] });

describe('backup validation', () => {
  it('accepts a freshly made backup', () => {
    const b = makeBackup(full());
    const v = validateBackup(JSON.parse(JSON.stringify(b)));
    expect(v.errors).toEqual([]); expect(v.ok).toBe(true);
    expect(v.counts.customers).toBe(8);
  });
  it('rejects wrong app, tampered data, broken references, bad dates', () => {
    expect(validateBackup({ app: 'x', schemaVersion: 1, data: {} }).ok).toBe(false);
    const b: any = JSON.parse(JSON.stringify(makeBackup(full())));
    b.data.invoices[0].grossAmount = 1;
    expect(validateBackup(b).errors.join(' ')).toMatch(/Checksum mismatch/);
    const c: any = JSON.parse(JSON.stringify(makeBackup(full())));
    c.data.allocations[0].invoiceId = 'nope'; c.checksum = checksum(JSON.stringify(c.data));
    expect(validateBackup(c).errors.join(' ')).toMatch(/missing invoices/);
    const d: any = JSON.parse(JSON.stringify(makeBackup(full())));
    d.data.invoices[0].invoiceDate = '2026-13-45'; d.checksum = checksum(JSON.stringify(d.data));
    expect(validateBackup(d).errors.join(' ')).toMatch(/must be a date/);
    const e: any = JSON.parse(JSON.stringify(makeBackup(full())));
    e.data.customers.push({ ...e.data.customers[0] }); e.checksum = checksum(JSON.stringify(e.data));
    expect(validateBackup(e).errors.join(' ')).toMatch(/duplicate id/);
  });
});

describe('csv', () => {
  it('escapes quotes, commas, newlines and formula injection', () => {
    const s = toCSV([{ a: 'x,"y"', b: '=SUM(A1)', c: 12.5, d: 'line1\nline2' }]);
    expect(s).toBe('\uFEFFa,b,c,d\r\n"x,""y""",\'=SUM(A1),12.5,"line1\nline2"\r\n');
  });
});
