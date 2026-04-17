import type { PrismaClient, SaleRecord, Shop, Product, Customer, User, FinanceCompany } from '@prisma/client';
import { generateSaleNumber } from '../../src/utils/id-generator';

export async function seedSales(
  prisma: PrismaClient,
  shops: Shop[],
  products: Product[],
  customers: Customer[],
  users: User[],
  financeCompanies: FinanceCompany[],
): Promise<SaleRecord[]> {
  if (customers.length === 0 || products.length === 0) {
    return [];
  }

  const sales: SaleRecord[] = [];

  const shopByCode = (code: string) => shops.find((s) => s.code === code)!;
  const customerByName = (name: string) => customers.find((c) => c.name === name)!;
  const financeByCode = (code: string) => financeCompanies.find((fc) => fc.code === code)!;

  // Helper to get first admin user for a shop
  async function getFirstAdmin(shopId: string) {
    const userShop = await prisma.userShop.findFirst({
      where: { shopId, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    return userShop?.user;
  }

  // Find products by brand + model containing a substring + shop
  // Uses a consumed set to avoid picking the same product twice
  const consumedProductIds = new Set<string>();

  const findProduct = (shopCode: string, brand: string, modelSubstr: string) => {
    const shop = shopByCode(shopCode);
    return products.find(
      (p) =>
        p.shopId === shop.id &&
        p.brand === brand &&
        p.modelNumber.includes(modelSubstr) &&
        p.status === 'in_stock' &&
        !consumedProductIds.has(p.id),
    );
  };

  // Find any in_stock product for a shop (fallback)
  const findAnyProduct = (shopCode: string) => {
    const shop = shopByCode(shopCode);
    return products.find(
      (p) => p.shopId === shop.id && p.status === 'in_stock' && !consumedProductIds.has(p.id),
    );
  };

  const ve = shopByCode('VE');
  const ne = shopByCode('NE');
  const vha = shopByCode('VHA');
  const nhe = shopByCode('NHE');

  const veAdmin = await getFirstAdmin(ve.id);
  const neAdmin = await getFirstAdmin(ne.id);
  const vhaAdmin = await getFirstAdmin(vha.id);
  const nheAdmin = await getFirstAdmin(nhe.id);

  // Track last sale numbers per shop prefix for sequential generation
  const saleDate = new Date('2026-04-10');

  // =========================================================================
  // ORIGINAL 5 SALES (keep as-is)
  // =========================================================================
  const saleDefs = [
    // 1. Full Payment (VE): Rajesh buys Samsung 55" QLED TV, full cash
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'Samsung', 'QA55Q60B'),
      customer: customerByName('Rajesh Kumar'),
      ledgerNumber: 'VE001',
      saleType: 'full_payment' as const,
      sellingPrice: 79990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 0, // Full payment, no down payment concept
      paymentMode: 'cash' as const,
      saleDate,
      createdBy: veAdmin?.id,
    },
    // 2. Partial with Promise (NE): Priya buys Samsung Galaxy S24, 50% down, promise 15 days
    {
      shopCode: 'NE',
      shopId: ne.id,
      product: findProduct('NE', 'Samsung', 'Galaxy S24'),
      customer: customerByName('Priya Sharma'),
      ledgerNumber: 'NE001',
      saleType: 'partial_with_promise' as const,
      sellingPrice: 74999,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 44249, // ~50% of totalAmount
      paymentMode: 'cash' as const,
      promiseDate: '2026-04-25',
      saleDate,
      createdBy: neAdmin?.id,
    },
    // 3. Self Finance (VHA): Amit buys Godrej Queen Bed, 20% down UPI, 2% interest, 12 months, file charge 500
    {
      shopCode: 'VHA',
      shopId: vha.id,
      product: findProduct('VHA', 'Godrej', 'Viva Queen'),
      customer: customerByName('Amit Verma'),
      ledgerNumber: 'VA001',
      saleType: 'self_finance' as const,
      sellingPrice: 32990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 7786, // ~20% of totalAmount (32990 + 18% GST = 38928, 20% = ~7786)
      paymentMode: 'upi' as const,
      interestRate: 2,
      fileCharge: 500,
      numInstallments: 12,
      guarantorName: 'Suresh Guarantor2',
      saleDate,
      createdBy: vhaAdmin?.id,
    },
    // 4. Company Finance (NHE): Sunita buys Blue Star Window AC via Bajaj Finance, 10% down cash
    {
      shopCode: 'NHE',
      shopId: nhe.id,
      product: findProduct('NHE', 'Blue Star', 'WFA312LN'),
      customer: customerByName('Sunita Devi'),
      ledgerNumber: 'NH001',
      saleType: 'company_finance' as const,
      sellingPrice: 26990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 3185, // ~10% of totalAmount (26990 + 18% GST = 31848, 10% = ~3185)
      paymentMode: 'cash' as const,
      financeCompanyCode: 'BAJAJ',
      saleDate,
      createdBy: nheAdmin?.id,
    },
    // 5. Self Finance (VE): Mohit buys LG 43" LED TV, 30% down cash, 1.5% interest, 6 months
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'LG', '43LM5760'),
      customer: customerByName('Mohit Singh'),
      ledgerNumber: 'VE002',
      saleType: 'self_finance' as const,
      sellingPrice: 32990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 11678, // ~30% of totalAmount (32990 + 18% GST = 38928, 30% = ~11678)
      paymentMode: 'cash' as const,
      interestRate: 1.5,
      fileCharge: 0,
      numInstallments: 6,
      guarantorName: 'Ravi Guarantor1',
      saleDate,
      createdBy: veAdmin?.id,
    },
  ];

  // Mark consumed products from original defs
  for (const def of saleDefs) {
    if (def.product) consumedProductIds.add(def.product.id);
  }

  // =========================================================================
  // HISTORICAL SALES (5 new sales with realistic dates)
  // =========================================================================
  const historicalSaleDefs = [
    // H1: Dec 2025 — Self Finance, 9 months, nearly complete (VE)
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'Sony', 'KD-50X74K') ?? findAnyProduct('VE'),
      customer: customerByName('Rajesh Kumar'),
      ledgerNumber: 'VE010',
      saleType: 'self_finance' as const,
      sellingPrice: 45000,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 10000,
      paymentMode: 'cash' as const,
      interestRate: 2,
      fileCharge: 500,
      numInstallments: 9,
      guarantorName: 'Ravi Guarantor1',
      saleDate: new Date('2025-12-15'),
      createdBy: veAdmin?.id,
    },
    // H2: Jan 2026 — Self Finance, 12 months, early stage (NE)
    {
      shopCode: 'NE',
      shopId: ne.id,
      product: findProduct('NE', 'LG', 'RS-Q19') ?? findProduct('NE', 'Sony', 'KD-50X74K') ?? findAnyProduct('NE'),
      customer: customerByName('Priya Sharma'),
      ledgerNumber: 'NE010',
      saleType: 'self_finance' as const,
      sellingPrice: 70000,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 15000,
      paymentMode: 'cash' as const,
      interestRate: 1.5,
      fileCharge: 0,
      numInstallments: 12,
      guarantorName: 'Suresh Guarantor2',
      saleDate: new Date('2026-01-10'),
      createdBy: neAdmin?.id,
    },
    // H3: Feb 2026 — Self Finance, 6 months (NHE)
    {
      shopCode: 'NHE',
      shopId: nhe.id,
      product: findProduct('NHE', 'Samsung', 'WW70T') ?? findProduct('NHE', 'LG', 'T80SPSF') ?? findAnyProduct('NHE'),
      customer: customerByName('Sunita Devi'),
      ledgerNumber: 'NH010',
      saleType: 'self_finance' as const,
      sellingPrice: 30000,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 5000,
      paymentMode: 'cash' as const,
      interestRate: 2.5,
      fileCharge: 300,
      numInstallments: 6,
      guarantorName: 'Ravi Guarantor1',
      saleDate: new Date('2026-02-20'),
      createdBy: nheAdmin?.id,
    },
    // H4: Mar 2026 — Company Finance, Bajaj Finance (VHA)
    {
      shopCode: 'VHA',
      shopId: vha.id,
      product: findProduct('VHA', 'LG', 'RS-Q19') ?? findProduct('VHA', 'Samsung', 'AR18CY') ?? findAnyProduct('VHA'),
      customer: customerByName('Amit Verma'),
      ledgerNumber: 'VA010',
      saleType: 'company_finance' as const,
      sellingPrice: 42000,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 8000,
      paymentMode: 'cash' as const,
      financeCompanyCode: 'BAJAJ',
      saleDate: new Date('2026-03-05'),
      createdBy: vhaAdmin?.id,
    },
    // H5: Nov 2025 — Full Payment, old sale (VE)
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'Samsung', 'UA32T') ?? findProduct('VE', 'TCL', '43S5400') ?? findAnyProduct('VE'),
      customer: customerByName('Mohit Singh'),
      ledgerNumber: 'VE011',
      saleType: 'full_payment' as const,
      sellingPrice: 17000,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 0,
      paymentMode: 'cash' as const,
      saleDate: new Date('2025-11-20'),
      createdBy: veAdmin?.id,
    },
  ];

  // Mark consumed products from historical defs
  for (const def of historicalSaleDefs) {
    if (def.product) consumedProductIds.add(def.product.id);
  }

  // Combine all sale definitions
  const allSaleDefs = [...saleDefs, ...historicalSaleDefs];

  for (const def of allSaleDefs) {
    // Check if sale already exists by ledgerNumber + shopId (idempotent)
    const existing = await prisma.saleRecord.findFirst({
      where: { ledgerNumber: def.ledgerNumber, shopId: def.shopId },
    });
    if (existing) {
      sales.push(existing);
      continue;
    }

    if (!def.product) {
      console.warn(`  Product not found for sale ${def.ledgerNumber}, skipping`);
      continue;
    }

    if (!def.customer) {
      console.warn(`  Customer not found for sale ${def.ledgerNumber}, skipping`);
      continue;
    }

    const saleDateForThisSale = def.saleDate;

    // Generate sale number
    const lastSale = await prisma.saleRecord.findFirst({
      where: { saleNumber: { startsWith: `SALE-${def.shopCode}-` } },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    });
    const saleNumber = generateSaleNumber(def.shopCode, saleDateForThisSale, lastSale?.saleNumber ?? undefined);

    // Calculate financials
    const sellingPrice = def.sellingPrice;
    const discountAmount = def.discountAmount ?? 0;
    const gstRate = def.gstRate ?? 0;
    const netAmount = sellingPrice - discountAmount;
    const gstAmount = Math.round(netAmount * gstRate / 100);
    const totalAmount = netAmount + gstAmount;
    const downPayment = def.downPayment ?? 0;
    const fileCharge = 'fileCharge' in def ? (def.fileCharge ?? 0) : 0;
    const interestRate = 'interestRate' in def ? (def.interestRate ?? 0) : 0;
    const numInstallments = 'numInstallments' in def ? (def.numInstallments ?? 0) : 0;

    // Calculate EMI for self_finance (just for amounts; we control due dates ourselves)
    let emiAmounts: { principal: number; totalInterest: number; fileCharge: number; totalPayable: number; emiAmount: number } | null = null;

    if (def.saleType === 'self_finance') {
      const principal = totalAmount - downPayment;
      const totalInterest = principal * (interestRate / 100) * numInstallments;
      const totalPayable = principal + totalInterest + fileCharge;
      const emiAmount = Math.ceil(totalPayable / numInstallments);
      emiAmounts = { principal, totalInterest, fileCharge, totalPayable, emiAmount };
    }

    // Pending amount for partial_with_promise
    let pendingAmount = 0;
    if (def.saleType === 'partial_with_promise') {
      pendingAmount = totalAmount - downPayment;
    }

    // Company finance specifics
    const financeCompany = 'financeCompanyCode' in def
      ? financeByCode(def.financeCompanyCode as string)
      : null;
    const financedAmount = def.saleType === 'company_finance' ? totalAmount - downPayment : null;
    const expectedPaymentDate = def.saleType === 'company_finance'
      ? new Date(saleDateForThisSale.getTime() + 86400000) // next day
      : null;

    // For company finance historical sale H4 — mark as 'received'
    const isH4CompanyFinance = def.ledgerNumber === 'VA010' && def.saleType === 'company_finance';
    const financePaymentStatus = def.saleType === 'company_finance'
      ? (isH4CompanyFinance ? 'received' as any : 'pending' as any)
      : null;
    const financePaymentReceivedDate = isH4CompanyFinance
      ? new Date('2026-03-12') // received a week after sale
      : null;
    const financeReferenceNumber = isH4CompanyFinance
      ? 'BAJAJ-VHA-202603-001'
      : null;

    // Guarantor
    const guarantor = 'guarantorName' in def
      ? customerByName(def.guarantorName as string)
      : null;

    // For full_payment, downPayment should match totalAmount conceptually (they pay it all)
    const effectiveDownPayment = def.saleType === 'full_payment' ? totalAmount : downPayment;

    // Create everything in a transaction
    const saleRecord = await prisma.$transaction(async (tx) => {
      // Create SaleRecord
      const sale = await tx.saleRecord.create({
        data: {
          saleNumber,
          ledgerNumber: def.ledgerNumber,
          shopId: def.shopId,
          productId: def.product!.id,
          customerId: def.customer!.id,
          saleDate: saleDateForThisSale,
          saleType: def.saleType as any,
          mrp: Number(def.product!.mrp),
          sellingPrice,
          discountAmount,
          netAmount,
          gstRate,
          gstAmount,
          totalAmount,
          downPayment: effectiveDownPayment,
          paymentMode: def.paymentMode as any,
          // Partial with promise
          promiseDate: def.saleType === 'partial_with_promise' && 'promiseDate' in def
            ? new Date(def.promiseDate as string)
            : null,
          pendingAmount,
          // Self finance
          interestRate: def.saleType === 'self_finance' ? interestRate : null,
          fileCharge: def.saleType === 'self_finance' ? fileCharge : 0,
          totalFinancedAmount: emiAmounts?.totalPayable ?? null,
          numInstallments: def.saleType === 'self_finance' ? numInstallments : null,
          emiAmount: emiAmounts?.emiAmount ?? null,
          guarantorId: guarantor?.id ?? null,
          // Company finance
          financeCompanyId: financeCompany?.id ?? null,
          financedAmount,
          expectedPaymentDate,
          financePaymentStatus,
          financePaymentReceivedDate,
          financeReferenceNumber,
          // Metadata
          createdBy: def.createdBy!,
        },
      });

      // Create SaleRecordSanitized — ALWAYS
      await tx.saleRecordSanitized.create({
        data: {
          id: sale.id,
          saleNumber,
          ledgerNumber: def.ledgerNumber,
          shopId: def.shopId,
          productId: def.product!.id,
          customerId: def.customer!.id,
          saleDate: saleDateForThisSale,
          saleType: 'full_payment',
          sellingPrice,
          totalAmount,
          paymentMode: 'cash',
          createdBy: def.createdBy!,
        },
      });

      // Update Product status to 'sold'
      await tx.product.update({
        where: { id: def.product!.id },
        data: { status: 'sold' },
      });

      // Create ProductAuditTrail entry
      await tx.productAuditTrail.create({
        data: {
          productId: def.product!.id,
          eventType: 'sold',
          toShopId: def.shopId,
          referenceId: sale.id,
          referenceType: 'sale',
          performedBy: def.createdBy ?? null,
          notes: `Sold to ${def.customer!.name}, Sale: ${saleNumber} (seed data)`,
        },
      });

      // If self_finance: Create InstallmentSchedule + Installment records
      // Use sale date as the base for due date calculation (not today)
      if (def.saleType === 'self_finance' && emiAmounts) {
        const startDate = new Date(saleDateForThisSale);
        startDate.setMonth(startDate.getMonth() + 1);

        const schedule = await tx.installmentSchedule.create({
          data: {
            saleId: sale.id,
            totalPrincipal: emiAmounts.principal,
            totalInterest: emiAmounts.totalInterest,
            fileCharge: emiAmounts.fileCharge,
            totalPayable: emiAmounts.totalPayable,
            numInstallments,
            emiAmount: emiAmounts.emiAmount,
            startDate,
            status: 'active',
          },
        });

        for (let i = 1; i <= numInstallments; i++) {
          const dueDate = new Date(saleDateForThisSale);
          dueDate.setMonth(dueDate.getMonth() + i);
          const isLast = i === numInstallments;
          const amount = isLast
            ? emiAmounts.totalPayable - emiAmounts.emiAmount * (numInstallments - 1)
            : emiAmounts.emiAmount;

          await tx.installment.create({
            data: {
              scheduleId: schedule.id,
              installmentNumber: i,
              dueDate,
              amountDue: amount,
              amountPaid: 0,
              remainingAmount: amount,
              status: 'upcoming',
              isRescheduled: false,
            },
          });
        }
      }

      return sale;
    });

    sales.push(saleRecord);
  }

  return sales;
}
