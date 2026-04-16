import type { PrismaClient, FinanceCompany } from '@prisma/client';

export async function seedFinanceCompanies(prisma: PrismaClient): Promise<FinanceCompany[]> {
  const data = [
    { name: 'Bajaj Finance', code: 'BAJAJ', contactPhone: '1800209999', contactEmail: 'support@bajajfinance.in' },
    { name: 'HDB Financial Services', code: 'HDB', contactPhone: '1800266333', contactEmail: 'support@hdbfs.com' },
    { name: 'Home Credit', code: 'HOMECREDIT', contactPhone: '1800102445', contactEmail: 'support@homecredit.co.in' },
  ];

  const companies: FinanceCompany[] = [];
  for (const d of data) {
    const company = await prisma.financeCompany.upsert({
      where: { code: d.code },
      update: {},
      create: d,
    });
    companies.push(company);
  }
  return companies;
}
