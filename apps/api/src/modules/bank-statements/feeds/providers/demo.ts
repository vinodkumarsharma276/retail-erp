import { createHash } from 'node:crypto';
import type { RawTransaction } from '../../engine/types.js';
import type { FeedProvider } from './types.js';

/**
 * Generated, repeatable test data so the whole feed flow (connect, sync,
 * nightly runs, de-duplication, review) can be tried before a bank's API is live.
 * The same account + date always yields the same transactions and running balance,
 * so overlapping syncs de-duplicate exactly like a real bank feed.
 */
const EPOCH = '2026-01-01';
const OPENING = 500_000;

const CREDIT = [
  ['UPI IN/{ref}/RAHUL SHARMA/9876543210@ybl/Payment', 1500, 18000],
  ['UPI IN/{ref}/PRIYA ENTERPRISES/priya@okaxis/Paid', 2000, 25000],
  ['NEFT CR-PINELABS SETTLEMENT-PINE LABS PVT LTD-SETL{ref}', 15000, 90000],
  ['NFT/BAJAJ FINANCE L/SBIN{ref}/SBI', 8000, 45000],
  ['BY CASH DEPOSIT CDM {ref}', 10000, 60000],
] as const;
const DEBIT = [
  ['NEFT DR-HDFC0000123-SAMSUNG INDIA ELECTRONICS PVT LTD-PO{ref}', 40000, 250000],
  ['RTGS DR-ICIC0000045-LG ELECTRONICS INDIA PVT LTD-PO{ref}', 60000, 300000],
  ['UPI OUT/{ref}/MAHESH PROPERTIES/rent@okhdfc/Rent', 85000, 85000],
  ['NACH DR BAJAJ FINANCE EMI {ref}', 12000, 12000],
  ['ATM CASH WDL {ref} NOIDA SEC 18', 5000, 20000],
] as const;

function rand(seed: string) {
  let h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => {
    if (i + 4 > h.length) {
      h = createHash('sha256').update(h).digest();
      i = 0;
    }
    const v = h.readUInt32BE(i) / 0xffffffff;
    i += 4;
    return v;
  };
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function day(accountId: string, date: string) {
  const r = rand(`${accountId}|${date}`);
  const out: { description: string; amount: number }[] = [];
  const credits = 3 + Math.floor(r() * 6);
  const debits = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0;
  for (let k = 0; k < credits + debits; k++) {
    const [tpl, min, max] = k < credits ? CREDIT[Math.floor(r() * CREDIT.length)] : DEBIT[Math.floor(r() * DEBIT.length)];
    const amt = Math.round((min + r() * (max - min)) / 10) * 10;
    out.push({ description: tpl.replace('{ref}', String(Math.floor(r() * 1e12)).padStart(12, '0')), amount: k < credits ? amt : -amt });
  }
  return out;
}

export const demoProvider: FeedProvider = {
  id: 'demo',
  label: 'Demo feed (test data)',
  banks: 'any',
  ready: true,
  note: 'Generates realistic sample transactions every day so you can try automatic syncing. Do not use for real accounts.',
  credentialFields: [],
  async fetchTransactions(account, _credentials, from, to) {
    const rows: RawTransaction[] = [];
    let balance = OPENING;
    for (let d = EPOCH; d <= to; d = addDays(d, 1)) {
      for (const t of day(account.id, d)) {
        balance = Math.round((balance + t.amount) * 100) / 100;
        if (d >= from) rows.push({ date: d, description: t.description, amount: t.amount, balance, reference: null });
      }
    }
    return rows;
  },
};
