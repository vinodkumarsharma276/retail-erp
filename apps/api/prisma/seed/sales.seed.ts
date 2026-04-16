import type { PrismaClient, SaleRecord, Shop, Product, Customer, User, FinanceCompany } from '@prisma/client';
import { generateSaleNumber } from '../../src/utils/id-generator';
import { calculateEMI } from '@retailerp/shared-utils';

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
  const findProduct = (shopCode: string, brand: string, modelSubstr: string) => {
    const shop = shopByCode(shopCode);
    return products.find(
      (p) =>
        p.shopId === shop.id &&
        p.brand === brand &&
        p.modelNumber.includes(modelSubstr) &&
        p.status === 'in_stock',
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

  const saleDefs = [
    // 1. Full Payment (VE): Rajesh buys Samsung 55" QLED TV, full cash
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'Samsung', 'QA55Q60B'),
      customer: customerByName('Rajesh Kumar'),
      ledgerNumber: 'VE-2026-001',
      saleType: 'full_payment' as const,
      sellingPrice: 79990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 0, // Full payment, no down payment concept
      paymentMode: 'cash' as const,
      createdBy: veAdmin?.id,
    },
    // 2. Partial with Promise (NE): Priya buys Samsung Galaxy S24, 50% down, promise 15 days
    {
      shopCode: 'NE',
      shopId: ne.id,
      product: findProduct('NE', 'Samsung', 'Galaxy S24'),
      customer: customerByName('Priya Sharma'),
      ledgerNumber: 'NE-2026-001',
      saleType: 'partial_with_promise' as const,
      sellingPrice: 74999,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 44249, // ~50% of totalAmount
      paymentMode: 'cash' as const,
      promiseDate: '2026-04-25',
      createdBy: neAdmin?.id,
    },
    // 3. Self Finance (VHA): Amit buys Godrej Queen Bed, 20% down UPI, 2% interest, 12 months, file charge 500
    {
      shopCode: 'VHA',
      shopId: vha.id,
      product: findProduct('VHA', 'Godrej', 'Viva Queen'),
      customer: customerByName('Amit Verma'),
      ledgerNumber: 'VHA-2026-001',
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
      createdBy: vhaAdmin?.id,
    },
    // 4. Company Finance (NHE): Sunita buys Blue Star Window AC via Bajaj Finance, 10% down cash
    {
      shopCode: 'NHE',
      shopId: nhe.id,
      product: findProduct('NHE', 'Blue Star', 'WFA312LN'),
      customer: customerByName('Sunita Devi'),
      ledgerNumber: 'NHE-2026-001',
      saleType: 'company_finance' as const,
      sellingPrice: 26990,
      discountAmount: 0,
      gstRate: 18,
      downPayment: 3185, // ~10% of totalAmount (26990 + 18% GST = 31848, 10% = ~3185)
      paymentMode: 'cash' as const,
      financeCompanyCode: 'BAJAJ',
      createdBy: nheAdmin?.id,
    },
    // 5. Self Finance (VE): Mohit buys LG 43" LED TV, 30% down cash, 1.5% interest, 6 months
    {
      shopCode: 'VE',
      shopId: ve.id,
      product: findProduct('VE', 'LG', '43LM5760'),
      customer: customerByName('Mohit Singh'),
      ledgerNumber: 'VE-2026-002',
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
      createdBy: veAdmin?.id,
    },
  ];

  for (const def of saleDefs) {
    if (!def.product) {
      console.warn(`  Product not found for sale ${def.ledgerNumber}, skipping`);
      continue;
    }

    if (!def.customer) {
      console.warn(`  Customer not found for sale ${def.ledgerNumber}, skipping`);
      continue;
    }

    // Check if sale already exists by ledgerNumber + shopId
    const existing = await prisma.saleRecord.findFirst({
      where: { ledgerNumber: def.ledgerNumber, shopId: def.shopId },
    });
    if (existing) {
      sales.push(existing);
      continue;
    }

    // Generate sale number
    const lastSale = await prisma.saleRecord.findFirst({
      where: { saleNumber: { startsWith: `SALE-${def.shopCode}-` } },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    });
    const saleNumber = generateSaleNumber(def.shopCode, saleDate, lastSale?.saleNumber ?? undefined);

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

    // Calculate EMI for self_finance
    let emiResult: ReturnType<typeof calculateEMI> | null = null;
    let totalFinancedAmount: number | null = null;
    let emiAmount: number | null = null;

    if (def.saleType === 'self_finance') {
      emiResult = calculateEMI({
        sellingPrice: totalAmount,
        downPayment,
        interestRate,
        fileCharge,
        numInstallments,
      });
      totalFinancedAmount = emiResult.totalPayable;
      emiAmount = emiResult.emiAmount;
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
      ? new Date(saleDate.getTime() + 86400000) // next day
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
          saleDate,
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
          totalFinancedAmount,
          numInstallments: def.saleType === 'self_finance' ? numInstallments : null,
          emiAmount,
          guarantorId: guarantor?.id ?? null,
          // Company finance
          financeCompanyId: financeCompany?.id ?? null,
          financedAmount,
          expectedPaymentDate,
          financePaymentStatus: def.saleType === 'company_finance' ? 'pending' as any : null,
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
          saleDate,
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
      if (def.saleType === 'self_finance' && emiResult) {
        const schedule = await tx.installmentSchedule.create({
          data: {
            saleId: sale.id,
            totalPrincipal: emiResult.principal,
            totalInterest: emiResult.totalInterest,
            fileCharge: emiResult.fileCharge,
            totalPayable: emiResult.totalPayable,
            numInstallments: emiResult.schedule.length,
            emiAmount: emiResult.emiAmount,
            startDate: new Date(emiResult.schedule[0].dueDate),
            status: 'active',
          },
        });

        for (const inst of emiResult.schedule) {
          await tx.installment.create({
            data: {
              scheduleId: schedule.id,
              installmentNumber: inst.installmentNumber,
              dueDate: new Date(inst.dueDate),
              amountDue: inst.amount,
              amountPaid: 0,
              remainingAmount: inst.amount,
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
