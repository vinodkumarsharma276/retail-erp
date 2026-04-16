import type { PrismaClient, Distributor, ProductCategory } from '@prisma/client';

export async function seedDistributors(
  prisma: PrismaClient,
  categories: ProductCategory[],
): Promise<Distributor[]> {
  const distributors: Distributor[] = [];

  // Helper to find category by slug
  const catBySlug = (slug: string) => categories.find((c) => c.slug === slug);

  // Get the first admin user to use as createdBy
  const firstAdmin = await prisma.user.findFirst({
    where: { role: 'admin' },
  });
  const createdBy = firstAdmin?.id ?? null;

  const distributorDefs = [
    {
      companyName: 'Samsung India Electronics Pvt. Ltd.',
      contactPerson: 'Rajesh Kumar Mehta',
      phone: '9811234567',
      altPhone: '9811234568',
      email: 'distribution@samsung-india.com',
      gstNumber: '07AABCS1429B1ZK',
      panNumber: 'AABCS1429B',
      addressLine1: 'Plot No. 2A, Sector 126, Noida-Greater Noida Expressway',
      addressLine2: 'Samsung Digital City',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201304',
      bankName: 'HDFC Bank',
      bankAccountNumber: '50100087654321',
      bankIfsc: 'HDFC0001234',
      bankBranch: 'Noida Sector 18',
      paymentTerms: 'Net 30',
      creditLimit: 2500000,
      categorySlugs: ['tv', 'mobile', 'ac', 'refrigerator', 'washing-machine'],
    },
    {
      companyName: 'LG Electronics India Pvt. Ltd.',
      contactPerson: 'Sunil Sharma',
      phone: '9822345678',
      altPhone: '9822345679',
      email: 'dealer-support@lg-india.com',
      gstNumber: '27AABCL6789M1ZX',
      panNumber: 'AABCL6789M',
      addressLine1: 'A-Wing, 6th Floor, Marathon Futurex',
      addressLine2: 'N.M. Joshi Marg, Lower Parel',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400013',
      bankName: 'ICICI Bank',
      bankAccountNumber: '012805000123',
      bankIfsc: 'ICIC0000128',
      bankBranch: 'Lower Parel Mumbai',
      paymentTerms: 'Net 45',
      creditLimit: 2000000,
      categorySlugs: ['tv', 'ac', 'refrigerator', 'washing-machine'],
    },
    {
      companyName: 'Xiaomi Technology India Pvt. Ltd.',
      contactPerson: 'Priya Nair',
      phone: '9833456789',
      altPhone: null,
      email: 'partners@xiaomi-india.com',
      gstNumber: '29AABCX5432N1ZW',
      panNumber: 'AABCX5432N',
      addressLine1: '3rd Floor, Embassy Tech Village',
      addressLine2: 'Outer Ring Road, Devarabisanahalli',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560103',
      bankName: 'Kotak Mahindra Bank',
      bankAccountNumber: '7611234567890',
      bankIfsc: 'KKBK0007611',
      bankBranch: 'Whitefield Bangalore',
      paymentTerms: 'COD',
      creditLimit: 1500000,
      categorySlugs: ['mobile', 'tv'],
    },
    {
      companyName: 'Godrej Interio (Godrej & Boyce Mfg. Co. Ltd.)',
      contactPerson: 'Amit Deshmukh',
      phone: '9844567890',
      altPhone: '9844567891',
      email: 'dealer.interio@godrej.com',
      gstNumber: '27AABCG1234P1ZY',
      panNumber: 'AABCG1234P',
      addressLine1: 'Godrej One, 4th Floor, Eastern Express Highway',
      addressLine2: 'Vikhroli (East)',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400079',
      bankName: 'Bank of Baroda',
      bankAccountNumber: '32190100012345',
      bankIfsc: 'BARB0VIKHRO',
      bankBranch: 'Vikhroli East Mumbai',
      paymentTerms: 'Net 60',
      creditLimit: 1800000,
      categorySlugs: ['sofa', 'bed', 'dining-table', 'wardrobe'],
    },
    {
      companyName: 'Whirlpool of India Ltd.',
      contactPerson: 'Kavita Joshi',
      phone: '9855678901',
      altPhone: null,
      email: 'trade.partners@whirlpool.com',
      gstNumber: '27AABCW9876Q1ZV',
      panNumber: 'AABCW9876Q',
      addressLine1: 'Plot No. A-4/1, MIDC Industrial Area',
      addressLine2: 'Ranjangaon, Taluka Shirur',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '412220',
      bankName: 'State Bank of India',
      bankAccountNumber: '37621098765432',
      bankIfsc: 'SBIN0005943',
      bankBranch: 'Ranjangaon MIDC Pune',
      paymentTerms: 'Net 30',
      creditLimit: 1200000,
      categorySlugs: ['washing-machine', 'refrigerator', 'ac'],
    },
  ];

  for (const def of distributorDefs) {
    const { categorySlugs, ...distributorData } = def;

    // Check if distributor already exists by company name + phone
    let distributor = await prisma.distributor.findFirst({
      where: {
        companyName: distributorData.companyName,
        phone: distributorData.phone,
      },
    });

    if (!distributor) {
      distributor = await prisma.distributor.create({
        data: {
          companyName: distributorData.companyName,
          contactPerson: distributorData.contactPerson,
          phone: distributorData.phone,
          altPhone: distributorData.altPhone ?? null,
          email: distributorData.email ?? null,
          gstNumber: distributorData.gstNumber ?? null,
          panNumber: distributorData.panNumber ?? null,
          addressLine1: distributorData.addressLine1,
          addressLine2: distributorData.addressLine2 ?? null,
          city: distributorData.city,
          state: distributorData.state,
          pincode: distributorData.pincode,
          bankName: distributorData.bankName ?? null,
          bankAccountNumber: distributorData.bankAccountNumber ?? null,
          bankIfsc: distributorData.bankIfsc ?? null,
          bankBranch: distributorData.bankBranch ?? null,
          paymentTerms: distributorData.paymentTerms ?? null,
          creditLimit: distributorData.creditLimit,
          createdBy: createdBy,
        },
      });
    }

    // Create category associations (upsert-like — skip if exists)
    for (const slug of categorySlugs) {
      const category = catBySlug(slug);
      if (!category) {
        console.warn(`  Category "${slug}" not found for distributor ${distributorData.companyName}`);
        continue;
      }

      const existing = await prisma.distributorCategory.findUnique({
        where: {
          distributorId_categoryId: {
            distributorId: distributor.id,
            categoryId: category.id,
          },
        },
      });

      if (!existing) {
        await prisma.distributorCategory.create({
          data: {
            distributorId: distributor.id,
            categoryId: category.id,
          },
        });
      }
    }

    distributors.push(distributor);
  }

  return distributors;
}
