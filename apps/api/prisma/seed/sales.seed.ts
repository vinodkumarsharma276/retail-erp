import type { PrismaClient, SaleRecord, Shop, Product, Customer, FinanceCompany } from '@prisma/client';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Bulk sales seed — 100 sales per shop (400 total).
//
// Sale type distribution (random per sale):
//   40% full_payment
//   15% partial_with_promise
//   30% self_finance         (requires guarantor + EMI schedule)
//   15% company_finance      (requires finance company)
//
// Integrity rules enforced:
//   - shopId matches product.shopId and customer.shopId
//   - Only picks products with status = 'in_stock'; flips to 'sold' after
//   - Customer is picked from the SAME shop as the product
//   - Repeat customers: sample with replacement (same customer may appear
//     across multiple sales — 20% chance to pick a "recent" customer again)
//   - self_finance: guarantor picked from customers with isGuarantor=true
//     in the same shop; if none, guarantor = any other non-self customer
//   - Creates SaleRecord + SaleRecordSanitized in same transaction
//   - For self_finance: creates InstallmentSchedule + Installment rows
// ---------------------------------------------------------------------------

const SALES_PER_SHOP = 100;

const INTEREST_RATES = [1, 1.5, 2, 2.5, 3];
const INSTALLMENT_MONTHS = [6, 9, 12, 18, 24];
const GST_SLABS = [5, 12, 18, 28];

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(rand(seed) * arr.length) % arr.length];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export async function seedSales(
  prisma: PrismaClient,
  shops: Shop[],
  products: Product[],
  customers: Customer[],
  _users: unknown,
  financeCompanies: FinanceCompany[],
): Promise<SaleRecord[]> {
  if (products.length === 0 || customers.length === 0) return [];

  const existingSales = await prisma.saleRecord.count();
  if (existingSales >= 400) return prisma.saleRecord.findMany();

  // Map shopId → admin user (createdBy)
  const shopAdminMap: Record<string, string> = {};
  for (const shop of shops) {
    const us = await prisma.userShop.findFirst({
      where: { shopId: shop.id, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    if (us) shopAdminMap[shop.id] = us.user.id;
  }

  // Index products by shop (in_stock only)
  const stockByShop = new Map<string, Product[]>();
  for (const p of products) {
    if (p.status !== 'in_stock') continue;
    if (!stockByShop.has(p.shopId)) stockByShop.set(p.shopId, []);
    stockByShop.get(p.shopId)!.push(p);
  }

  // Index customers by shop
  const custByShop = new Map<string, Customer[]>();
  const guarantorByShop = new Map<string, Customer[]>();
  for (const c of customers) {
    if (!custByShop.has(c.shopId)) custByShop.set(c.shopId, []);
    custByShop.get(c.shopId)!.push(c);
    if (c.isGuarantor) {
      if (!guarantorByShop.has(c.shopId)) guarantorByShop.set(c.shopId, []);
      guarantorByShop.get(c.shopId)!.push(c);
    }
  }

  // Per-shop, per-date sale sequence counter (for saleNumber)
  const saleSeqMap = new Map<string, number>();
  // Per-shop ledger counter
  const ledgerSeqMap = new Map<string, number>();

  const soldProductIds = new Set<string>();
  const createdSales: SaleRecord[] = [];

  // Remember "recent customers" per shop for repeat-purchase behavior
  const recentCustomers = new Map<string, Customer[]>();

  let seedBase = 7000;

  for (const shop of shops) {
    const createdBy = shopAdminMap[shop.id];
    if (!createdBy) continue;

    const shopStock = (stockByShop.get(shop.id) ?? []).slice();
    const shopCust = custByShop.get(shop.id) ?? [];
    const shopGuar = guarantorByShop.get(shop.id) ?? [];
    if (shopStock.length === 0 || shopCust.length === 0) continue;

    // Shuffle shopStock deterministically so sales pick across many products
    shopStock.sort((a, b) => a.id.localeCompare(b.id));

    const recents: Customer[] = [];
    recentCustomers.set(shop.id, recents);

    for (let i = 0; i < SALES_PER_SHOP; i++) {
      const seed = seedBase++;

      const product = shopStock[i % shopStock.length];
      if (soldProductIds.has(product.id)) continue;

      // Customer — 20% repeat, 80% fresh
      let customer: Customer;
      if (rand(seed) < 0.2 && recents.length > 0) {
        customer = recents[Math.floor(rand(seed + 1) * recents.length)];
      } else {
        customer = shopCust[Math.floor(rand(seed + 2) * shopCust.length)];
      }
      // Don't use a customer who IS only a guarantor as the buyer (allow it, but prefer non-guarantor)
      if (customer.isGuarantor && rand(seed + 3) < 0.7) {
        const nonGuar = shopCust.filter((c) => !c.isGuarantor);
        if (nonGuar.length > 0) {
          customer = nonGuar[Math.floor(rand(seed + 4) * nonGuar.length)];
        }
      }

      // Sale type distribution
      const typeRoll = rand(seed + 5);
      let saleType: 'full_payment' | 'partial_with_promise' | 'self_finance' | 'company_finance';
      if (typeRoll < 0.40) saleType = 'full_payment';
      else if (typeRoll < 0.55) saleType = 'partial_with_promise';
      else if (typeRoll < 0.85) saleType = 'self_finance';
      else saleType = 'company_finance';

      // Sale date — spread across last 365 days
      const daysBack = Math.floor(rand(seed + 6) * 365);
      const saleDate = daysAgo(daysBack);

      // Price fields (GST-inclusive selling price)
      const mrp = Number(product.mrp);
      const sellingPrice = Number(product.sellingPrice);
      const discountAmount = Math.round(rand(seed + 7) * sellingPrice * 0.05); // 0-5% discount
      const netAmount = sellingPrice - discountAmount;
      const gstRate = GST_SLABS[Math.floor(rand(seed + 8) * GST_SLABS.length)];
      const gstAmount = Math.round(netAmount * gstRate / (100 + gstRate));

      // Purchase price snapshots (for ITC profit calc)
      const purchasePrice = Number(product.purchasePrice);
      const purchaseGstAmount = Math.round(purchasePrice * gstRate / (100 + gstRate));

      // Sale number (per-shop, per-date)
      const dateKey = saleDate.toISOString().split('T')[0];
      const seqKey = `${shop.code}-${dateKey}`;
      const seq = (saleSeqMap.get(seqKey) ?? 0) + 1;
      saleSeqMap.set(seqKey, seq);
      const saleNumber = `SALE-${shop.code}-${dateKey.replace(/-/g, '')}-${pad(seq, 3)}`;

      // Ledger number
      const ledgerSeq = (ledgerSeqMap.get(shop.code) ?? 0) + 1;
      ledgerSeqMap.set(shop.code, ledgerSeq);
      const ledgerNumber = `${shop.code}${pad(ledgerSeq, 4)}`;

      // Payment mode
      const payModes = ['cash', 'upi', 'credit_card', 'debit_card', 'bank_transfer'] as const;
      const paymentMode = pick(payModes, seed + 9);

      // Build per-type fields
      const saleData: any = {
        id: randomUUID(),
        tenantId: shop.tenantId,
        saleNumber,
        ledgerNumber,
        shopId: shop.id,
        productId: product.id,
        customerId: customer.id,
        saleDate,
        saleType,
        mrp,
        sellingPrice,
        discountAmount,
        netAmount,
        gstRate,
        gstAmount,
        purchasePrice,
        purchaseGstAmount,
        totalAmount: netAmount,
        paymentMode,
        createdBy,
      };

      let installmentSchedule: any = null;

      if (saleType === 'full_payment') {
        saleData.downPayment = netAmount;
      } else if (saleType === 'partial_with_promise') {
        const paid = Math.round(netAmount * (0.3 + rand(seed + 10) * 0.4));
        saleData.downPayment = paid;
        saleData.pendingAmount = netAmount - paid;
        saleData.promiseDate = addMonths(saleDate, 1);
      } else if (saleType === 'self_finance') {
        // Need a guarantor
        let guarantor = shopGuar[Math.floor(rand(seed + 11) * Math.max(shopGuar.length, 1))];
        if (!guarantor || guarantor.id === customer.id) {
          const candidates = shopCust.filter((c) => c.id !== customer.id);
          guarantor = candidates[Math.floor(rand(seed + 12) * candidates.length)];
        }
        if (!guarantor) {
          // fallback: skip to full_payment
          saleData.saleType = 'full_payment';
          saleData.downPayment = netAmount;
        } else {
          const downPaymentPct = 0.2 + rand(seed + 13) * 0.3; // 20-50%
          const downPayment = Math.round(netAmount * downPaymentPct);
          const principal = netAmount - downPayment;
          const interestRate = INTEREST_RATES[Math.floor(rand(seed + 14) * INTEREST_RATES.length)];
          const numInstallments = INSTALLMENT_MONTHS[Math.floor(rand(seed + 15) * INSTALLMENT_MONTHS.length)];
          const fileCharge = Math.round(500 + rand(seed + 16) * 1500);
          const totalInterest = Math.round(principal * (interestRate / 100) * numInstallments);
          const totalPayable = principal + totalInterest + fileCharge;
          const emiAmount = Math.round(totalPayable / numInstallments);

          saleData.downPayment = downPayment;
          saleData.interestRate = interestRate;
          if (rand(seed + 20) < 0.3) {
            const penalRates = [1, 1.5, 2];
            saleData.penalRate = penalRates[Math.floor(rand(seed + 21) * penalRates.length)];
          }
          saleData.fileCharge = fileCharge;
          saleData.totalFinancedAmount = totalPayable;
          saleData.numInstallments = numInstallments;
          saleData.emiAmount = emiAmount;
          saleData.guarantorId = guarantor.id;

          installmentSchedule = {
            principal,
            totalInterest,
            fileCharge,
            totalPayable,
            numInstallments,
            emiAmount,
            startDate: addMonths(saleDate, 1),
          };
        }
      } else if (saleType === 'company_finance') {
        const fc = financeCompanies[Math.floor(rand(seed + 17) * Math.max(financeCompanies.length, 1))];
        if (!fc) {
          saleData.saleType = 'full_payment';
          saleData.downPayment = netAmount;
        } else {
          const downPayment = Math.round(netAmount * (0.1 + rand(seed + 18) * 0.2)); // 10-30%
          const financedAmount = netAmount - downPayment;
          saleData.downPayment = downPayment;
          saleData.financeCompanyId = fc.id;
          saleData.financedAmount = financedAmount;
          saleData.expectedPaymentDate = addMonths(saleDate, 1);
          // 70% of company-finance are already received
          const received = rand(seed + 19) < 0.7;
          saleData.financePaymentStatus = received ? 'received' : 'pending';
          if (received) {
            saleData.financePaymentReceivedDate = addMonths(saleDate, 1);
            saleData.financeReferenceNumber = `FIN-${pad(seed, 6)}`;
          }
        }
      }

      // Create sale + sanitized + schedule atomically
      await prisma.$transaction(async (tx) => {
        await tx.saleRecord.create({ data: saleData });
        await tx.saleRecordSanitized.create({
          data: {
            id: saleData.id,
            tenantId: shop.tenantId,
            saleNumber,
            ledgerNumber,
            shopId: shop.id,
            productId: product.id,
            customerId: customer.id,
            saleDate,
            sellingPrice,
            totalAmount: netAmount,
            createdBy,
          },
        });
        if (installmentSchedule) {
          const schedule = await tx.installmentSchedule.create({
            data: {
              tenantId: shop.tenantId,
              saleId: saleData.id,
              totalPrincipal: installmentSchedule.principal,
              totalInterest: installmentSchedule.totalInterest,
              fileCharge: installmentSchedule.fileCharge,
              totalPayable: installmentSchedule.totalPayable,
              numInstallments: installmentSchedule.numInstallments,
              emiAmount: installmentSchedule.emiAmount,
              startDate: installmentSchedule.startDate,
              status: 'active',
            },
          });
          // Create Installment rows (upcoming by default)
          const today = daysAgo(0);
          for (let n = 1; n <= installmentSchedule.numInstallments; n++) {
            const dueDate = addMonths(installmentSchedule.startDate, n - 1);
            let status: 'upcoming' | 'overdue' | 'due_today' = 'upcoming';
            if (dueDate.getTime() < today.getTime()) status = 'overdue';
            else if (dueDate.getTime() === today.getTime()) status = 'due_today';
            await tx.installment.create({
              data: {
                tenantId: shop.tenantId,
                scheduleId: schedule.id,
                installmentNumber: n,
                dueDate,
                amountDue: installmentSchedule.emiAmount,
                remainingAmount: installmentSchedule.emiAmount,
                status,
              },
            });
          }
        }
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'sold' },
        });
      });

      soldProductIds.add(product.id);

      // Remember this customer for repeat behavior
      if (recents.length < 50) recents.push(customer);
      else recents[Math.floor(rand(seed + 20) * recents.length)] = customer;

      createdSales.push(saleData as SaleRecord);
    }
  }

  console.log(`  Bulk sales created: ${createdSales.length}`);
  return createdSales;
}
