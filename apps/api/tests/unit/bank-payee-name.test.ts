import { describe, expect, it } from 'vitest';
import { extractCounterparty } from '../../src/modules/bank-statements/engine/categorize/merchant.js';

/** Payee names from real bank narrations (Federal Bank formats, plus HDFC-style ones). */
describe('Payee name from a bank narration', () => {
  it.each([
    // Federal Bank NEFT: "NFT" is NEFT, the reference and IFSC are codes, the trailing "V" is a cut-off word.
    ['NFT/FBBT262925890053 Laxmi Enterpris ICIC0001917 V / FT', 'Laxmi Enterpris'],
    ['NFT/ARVIND KUMAR /CNRBH00170025682/CANARA / FT', 'Arvind Kumar'],
    // Federal Bank UPI: the name is the UPI id's handle; what follows the id is the payer's remark.
    ['UPI IN/033198381749 /harish15kaira@axl/Paymen/5722 / TFR', 'Harish Kaira'],
    ['UPI IN/005783539083 /akashkumar2457@nyes/Paid/5722 / TFR', 'Akashkumar'],
    // An id wrapped onto the next line is rejoined.
    ['UPI IN/110893095049/sandeep.9489- 13@waicici//5722 / TFR', 'Sandeep'],
    ['UPI IN/102127282468/nitish. gupta11@ybl/Payme/5722 / TFR', 'Nitish Gupta'],
    // A phone-number id has no name; the id itself identifies the payer.
    ['UPI IN/005737875338 /8376937388@nyes/Paid via/5722 / TFR', '8376937388@nyes'],
    ['UPI IN/130976226661 /ak3733176951@okhdfcbank//5722 / TFR', 'ak3733176951@okhdfcbank'],
    // Standing instruction, NACH, IMPS and cheques.
    ['STD INS TO 13400600159567 / JAGDISH CHAND / TFR', 'Jagdish Chand'],
    ['ACHDR/PINE LABS PVT LTD /FDRL0000000003705685/STAN / TFR', 'Pine Labs Pvt Ltd'],
    ['FT IMPS/IFI/629414806071/LBS AIRCON LBS AIRCON/Ac / TFR', 'LBS Aircon'],
    ['NAVRANG MARKETING / CLG', 'Navrang Marketing'],
    ['A K A S AND ASSOCIATES LLP / CLG', 'A K A S And Associates Llp'],
    // Other banks' layouts keep working.
    ['UPI/DR/412345678901/RAMESH KUMAR/SBIN/ramesh@oksbi/Payment', 'Ramesh Kumar'],
    ['NEFT-HDFCR52024031512345-SAMSUNG INDIA ELECTRONICS PVT LTD-INV22', 'Samsung India Electronics Pvt Ltd'],
  ])('%s → %s', (narration, payee) => {
    expect(extractCounterparty(narration)).toBe(payee);
  });

  it('finds no payee in a cash withdrawal or a bare code', () => {
    expect(extractCounterparty('CASH:SELF / CASH')).toBeNull();
    expect(extractCounterparty('UPI IN/005708999869 / TFR')).toBeNull();
  });
});
