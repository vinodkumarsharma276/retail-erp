import type { PrismaClient, Distributor, ProductCategory } from '@prisma/client';

// ---------------------------------------------------------------------------
// Bulk distributors seed â€” 40 distributors total (10 per shop).
// Distributors are global (no shop_id); each is linked to 2-5 leaf categories.
// ---------------------------------------------------------------------------

const COMPANY_PREFIXES = [
  'Samsung', 'LG', 'Sony', 'Xiaomi', 'OnePlus', 'Vivo', 'Oppo', 'Realme',
  'Whirlpool', 'Godrej', 'Haier', 'Bosch', 'Panasonic', 'TCL', 'Hisense',
  'Blue Star', 'Voltas', 'Carrier', 'Daikin', 'Hitachi', 'Lloyd', 'IFB',
  'Nilkamal', 'Durian', 'Wakefit', 'Urban Ladder', 'Bajaj', 'Philips',
  'Havells', 'Usha', 'Crompton', 'Kent', 'Aquaguard', 'Pureit',
  'Preethi', 'Butterfly', 'Morphy Richards', 'Maharaja', 'Nokia', 'Lava',
];

const SUFFIXES = [
  'India Electronics Pvt. Ltd.',
  'Distributors Pvt. Ltd.',
  'India Pvt. Ltd.',
  'Sales & Distribution Ltd.',
  'Trading Corporation',
  'Agencies Pvt. Ltd.',
  'Enterprises Pvt. Ltd.',
  'Marketing Pvt. Ltd.',
];

const CONTACT_NAMES = [
  'Rajesh Kumar', 'Amit Sharma', 'Sunil Mehta', 'Vikram Singh', 'Rohit Gupta',
  'Deepak Verma', 'Anil Kapoor', 'Sanjay Patel', 'Manoj Reddy', 'Praveen Joshi',
  'Arun Nair', 'Kishore Das', 'Naveen Rao', 'Tarun Bansal', 'Harish Yadav',
];

const CITIES = [
  { city: 'Mumbai', state: 'Maharashtra', pincode: '400001', gstPrefix: '27' },
  { city: 'Delhi', state: 'Delhi', pincode: '110001', gstPrefix: '07' },
  { city: 'Bangalore', state: 'Karnataka', pincode: '560001', gstPrefix: '29' },
  { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', gstPrefix: '33' },
  { city: 'Kolkata', state: 'West Bengal', pincode: '700001', gstPrefix: '19' },
  { city: 'Hyderabad', state: 'Telangana', pincode: '500001', gstPrefix: '36' },
  { city: 'Pune', state: 'Maharashtra', pincode: '411001', gstPrefix: '27' },
  { city: 'Noida', state: 'Uttar Pradesh', pincode: '201301', gstPrefix: '09' },
  { city: 'Gurgaon', state: 'Haryana', pincode: '122001', gstPrefix: '06' },
  { city: 'Ahmedabad', state: 'Gujarat', pincode: '380001', gstPrefix: '24' },
];

const BANKS = [
  { bankName: 'HDFC Bank', bankIfsc: 'HDFC0001234', bankBranch: 'Main Branch' },
  { bankName: 'ICICI Bank', bankIfsc: 'ICIC0001234', bankBranch: 'Central Branch' },
  { bankName: 'State Bank of India', bankIfsc: 'SBIN0001234', bankBranch: 'Corporate Branch' },
  { bankName: 'Axis Bank', bankIfsc: 'UTIB0001234', bankBranch: 'Head Office Branch' },
  { bankName: 'Kotak Mahindra Bank', bankIfsc: 'KKBK0001234', bankBranch: 'Business Branch' },
];

function pick<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export async function seedDistributors(
  prisma: PrismaClient,
  categories: ProductCategory[],
): Promise<Distributor[]> {
  const leafCategories = categories.filter((c) => c.isLeaf);

  const existingCount = await prisma.distributor.count();
  if (existingCount >= 40) {
    return prisma.distributor.findMany();
  }

  const firstAdmin = await prisma.user.findFirst({ where: { role: 'admin' } });
  const createdBy = firstAdmin?.id ?? null;

  const distributors: Distributor[] = [];

  for (let i = 0; i < 40; i++) {
    const companyPrefix = pick(COMPANY_PREFIXES, i);
    const suffix = pick(SUFFIXES, i);
    const contact = pick(CONTACT_NAMES, i);
    const city = pick(CITIES, i);
    const bank = pick(BANKS, i);

    const companyName = `${companyPrefix} ${suffix} (${pad(i + 1, 2)})`;
    const panLetters = (companyPrefix.replace(/\s+/g, '').toUpperCase().slice(0, 3) + 'AAA').slice(0, 3);
    const panNumber = `AA${panLetters}${pad(1000 + i, 4)}A`;
    const gstNumber = `${city.gstPrefix}${panNumber}1Z${i % 10}`;

    const phone = `98${pad((10000000 + i * 137) % 100000000, 8)}`;
    const altPhone = `98${pad((20000000 + i * 241) % 100000000, 8)}`;

    const distributor = await prisma.distributor.create({
      data: {
        companyName,
        contactPerson: contact,
        phone,
        altPhone,
        email: `${companyPrefix.toLowerCase().replace(/\s+/g, '')}-${i + 1}@distributor.com`,
        gstNumber,
        panNumber,
        addressLine1: `Plot ${100 + i}, Industrial Area`,
        addressLine2: `${city.city} Zone ${(i % 5) + 1}`,
        city: city.city,
        state: city.state,
        pincode: city.pincode,
        bankName: bank.bankName,
        bankAccountNumber: pad((50000000000 + i * 17) % 1000000000000, 12),
        bankIfsc: bank.bankIfsc,
        bankBranch: bank.bankBranch,
        paymentTerms: pick(['Net 30', 'Net 45', 'Net 15', 'Net 60'], i),
        creditLimit: [500000, 1000000, 1500000, 2000000, 2500000][i % 5],
        createdBy,
      },
    });
    distributors.push(distributor);

    const numCats = 2 + (i % 4);
    const linkedCatIds = new Set<string>();
    for (let k = 0; k < numCats; k++) {
      const cat = leafCategories[(i * 7 + k * 13) % leafCategories.length];
      if (linkedCatIds.has(cat.id)) continue;
      linkedCatIds.add(cat.id);
      await prisma.distributorCategory.create({
        data: { distributorId: distributor.id, categoryId: cat.id },
      });
    }
  }

  return distributors;
}
