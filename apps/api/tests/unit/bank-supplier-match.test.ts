import { describe, expect, it } from 'vitest';
import { containedSupplier, matchSuppliersLocally } from '../../src/modules/bank-statements/engine/categorize/suppliers.js';

const suppliers = [
  { id: 'navrang-mkt', name: 'NAVRANG MARKETING' },
  { id: 'navrang-dist', name: 'NAVRANG DISTRIBUTORS' },
  { id: 'navrang-av', name: 'NAVRANG ADIO VIDEO PVT LTD' },
  { id: 'laxmi', name: 'LAXMI ENTERPRISES' },
  { id: 'crimson', name: 'CRIMSONWAVE PRIVATE LIMITED' },
  { id: 'shiv', name: 'SHIV DISTRIBUTORS' },
  { id: 'lg', name: 'LG' },
];
const row = (description: string, counterparty: string | null = null, channel = 'Cheque') => ({ description, counterparty, channel });

describe('Which supplier a bank withdrawal paid', () => {
  it('finds the supplier named in a cheque narration, preferring the most specific name', () => {
    expect(containedSupplier('NAVRANG MARKETING / CLG', suppliers)?.id).toBe('navrang-mkt');
    expect(containedSupplier('SHIV DISTRIBUTORS / CLG', suppliers)?.id).toBe('shiv');
  });

  it('ignores Pvt/Ltd differences and a name cut short inside references', () => {
    expect(containedSupplier('MS CRIMSONWAVE PRIVATE LTD / CLG', suppliers)?.id).toBe('crimson');
    expect(containedSupplier('NFT/FBBT262925890053 Laxmi Enterpris ICIC0001917 V / FT', suppliers)?.id).toBe('laxmi');
  });

  it('suggests nothing when the narration names no supplier, or only a word several share', () => {
    expect(containedSupplier('UPI IN/628276104594 /7503915481@ptaxis/Sent u/5722 / TFR', suppliers)).toBeNull();
    expect(containedSupplier('NAVRANG / CLG', suppliers)).toBeNull();
  });

  it('never reads a two-letter supplier name out of a narration', () => {
    expect(containedSupplier('PAYMENT LG / CLG', suppliers)).toBeNull();
  });

  it('needs every initial of a name, not just its common word', () => {
    const withInitials = [...suppliers, { id: 'am', name: 'A & M Associates' }, { id: 'ls', name: 'L & S MARKETING' }];
    expect(containedSupplier('A K A S AND ASSOCIATES LLP / CLG', withInitials)).toBeNull();
    expect(containedSupplier('STD INS TO 13400600159567 / JAGDISH CHAND Market Rd / TFR', withInitials)).toBeNull();
    expect(containedSupplier('A AND M ASSOCIATES / CLG', withInitials)?.id).toBe('am');
    const { matches } = matchSuppliersLocally([row('A K A S AND ASSOCIATES LLP / CLG', 'A K A S And Associates LLP')], withInitials);
    expect(matches[0]).toBeNull();
  });

  it('skips cash withdrawals and bank charges', () => {
    const { matches } = matchSuppliersLocally([row('NAVRANG MARKETING CASH', null, 'ATM/Cash'), row('NAVRANG MARKETING / CLG')], suppliers);
    expect(matches.map((m) => m?.distributorId ?? null)).toEqual([null, 'navrang-mkt']);
  });

  it('falls back to how alike the payee is, and leaves the uncertain middle for a model', () => {
    const { matches, uncertain } = matchSuppliersLocally(
      [row('NEFT-HDFC000123-SHIV DISTRIBUTOR-PAYMT', 'Shiv Distributor', 'NEFT/IMPS/RTGS'), row('IMPS/ABC TRADERS', 'Laxmi Electricals', 'NEFT/IMPS/RTGS')],
      suppliers,
    );
    expect(matches[0]?.distributorId).toBe('shiv');
    expect(matches[1]).toBeNull();
    expect(uncertain.map((u) => u.pair.existingId)).toEqual(['laxmi']);
  });
});
