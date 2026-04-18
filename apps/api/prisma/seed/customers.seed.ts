import type { PrismaClient, Customer, Shop, User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Bulk customers seed — 300 customers per shop (1200 total).
//
// Integrity rules enforced:
//   - Customer is shop-scoped (shopId required)
//   - ~10% of customers per shop are flagged `isGuarantor = true`
//   - ~25% of non-guarantor customers are linked to a guarantor via guarantorId
//     (the guarantor must be from the SAME shop for referential consistency)
//   - customerCode is unique globally (CUST-NNNN)
//   - phone is NOT unique — this models "repeat customer" / same person
//     buying at multiple shops (each occurrence is a separate Customer row)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Rajesh', 'Amit', 'Sunil', 'Vikram', 'Rohit', 'Deepak', 'Anil', 'Sanjay',
  'Manoj', 'Praveen', 'Arun', 'Kishore', 'Naveen', 'Tarun', 'Harish', 'Suresh',
  'Rakesh', 'Dinesh', 'Ramesh', 'Mahesh', 'Prakash', 'Vinod', 'Nitin', 'Ashok',
  'Priya', 'Pooja', 'Neha', 'Kavita', 'Sunita', 'Anita', 'Seema', 'Meena',
  'Rekha', 'Geeta', 'Sita', 'Radha', 'Shalini', 'Madhuri', 'Deepika', 'Anjali',
  'Ravi', 'Mohan', 'Sohan', 'Rohan', 'Karan', 'Arjun', 'Vijay', 'Ajay',
  'Sachin', 'Raj', 'Gaurav', 'Pankaj', 'Yogesh', 'Mukesh', 'Naresh', 'Jitendra',
  'Shweta', 'Divya', 'Payal', 'Ritika', 'Sneha', 'Aarti', 'Lakshmi', 'Saraswati',
];

const LAST_NAMES = [
  'Kumar', 'Sharma', 'Verma', 'Singh', 'Gupta', 'Agarwal', 'Mehta', 'Patel',
  'Shah', 'Joshi', 'Pandey', 'Mishra', 'Tiwari', 'Dubey', 'Srivastava', 'Saxena',
  'Yadav', 'Rai', 'Chauhan', 'Tomar', 'Rathore', 'Choudhary', 'Jain', 'Aggarwal',
  'Bansal', 'Goyal', 'Mittal', 'Khanna', 'Kapoor', 'Malhotra', 'Chopra', 'Bhatia',
  'Nair', 'Menon', 'Iyer', 'Reddy', 'Rao', 'Naidu', 'Das', 'Dutta',
];

const AREAS = [
  'Hazratganj', 'Gomti Nagar', 'Aliganj', 'Indira Nagar', 'Alambagh', 'Aminabad',
  'Chowk', 'Mahanagar', 'Jankipuram', 'Vikas Nagar', 'Rajajipuram', 'Nishatganj',
  'Aashiyana', 'Sarojini Nagar', 'Kapoorthala', 'Kaisarbagh', 'Charbagh',
];

function rand(seed: number): number {
  // deterministic pseudo-random in [0, 1)
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(rand(seed) * arr.length) % arr.length];
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export async function seedCustomers(
  prisma: PrismaClient,
  shops: Shop[],
  _users: User[],
): Promise<Customer[]> {
  // Idempotency — if any customers already exist (from previous seed), append; but
  // in most cases clear.ts will have been run first.
  const existing = await prisma.customer.count();
  if (existing >= 1200) {
    return prisma.customer.findMany();
  }

  // Get last customer code for sequential generation
  const lastCustomer = await prisma.customer.findFirst({
    orderBy: { customerCode: 'desc' },
    select: { customerCode: true },
  });
  let nextCustNum = lastCustomer
    ? parseInt(lastCustomer.customerCode.split('-')[1], 10) + 1
    : 1;

  // Resolve a shop's primary admin as createdBy
  const shopAdminMap: Record<string, string | null> = {};
  for (const shop of shops) {
    const us = await prisma.userShop.findFirst({
      where: { shopId: shop.id, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    shopAdminMap[shop.id] = us?.user.id ?? null;
  }

  const allCustomers: Customer[] = [];

  const CUSTOMERS_PER_SHOP = 300;
  const GUARANTOR_RATIO = 0.1; // 10% of customers are guarantors (someone who CAN guarantee others)

  // ---------- Phase 1: create all customers without guarantorId ----------
  for (const shop of shops) {
    const createdBy = shopAdminMap[shop.id];

    for (let i = 0; i < CUSTOMERS_PER_SHOP; i++) {
      const seed = shop.code.charCodeAt(0) * 1000 + i;
      const first = pick(FIRST_NAMES, seed);
      const last = pick(LAST_NAMES, seed + 1);
      const area = pick(AREAS, seed + 2);

      const customerCode = `CUST-${pad(nextCustNum++, 6)}`;
      const phone = `9${pad((8000000000 + seed * 997) % 1000000000, 9)}`;
      const isGuarantor = rand(seed + 3) < GUARANTOR_RATIO;

      const customer = await prisma.customer.create({
        data: {
          customerCode,
          name: `${first} ${last}`,
          phone,
          altPhone: rand(seed + 4) < 0.3 ? `9${pad((7000000000 + seed * 131) % 1000000000, 9)}` : null,
          aadhaarNumber: pad((100000000000 + seed * 31) % 1000000000000, 12),
          addressLine1: `${Math.floor(rand(seed + 5) * 200) + 1}, ${area}`,
          addressLine2: `Near ${pick(['Market', 'Park', 'School', 'Temple', 'Hospital'], seed + 6)}`,
          city: shop.city,
          state: shop.state,
          pincode: shop.pincode,
          isGuarantor,
          shopId: shop.id,
          createdBy,
        },
      });
      allCustomers.push(customer);
    }
  }

  // ---------- Phase 2: link ~25% of non-guarantor customers to a guarantor ----------
  // A guarantor must belong to the SAME shop
  const byShop = new Map<string, Customer[]>();
  for (const c of allCustomers) {
    if (!byShop.has(c.shopId)) byShop.set(c.shopId, []);
    byShop.get(c.shopId)!.push(c);
  }

  for (const [shopId, shopCustomers] of byShop.entries()) {
    const guarantors = shopCustomers.filter((c) => c.isGuarantor);
    if (guarantors.length === 0) continue;

    for (const c of shopCustomers) {
      if (c.isGuarantor) continue;
      const seed = c.customerCode.charCodeAt(c.customerCode.length - 1) * 13 + shopId.charCodeAt(0);
      if (rand(seed) < 0.25) {
        const g = guarantors[Math.floor(rand(seed + 1) * guarantors.length)];
        await prisma.customer.update({
          where: { id: c.id },
          data: { guarantorId: g.id },
        });
      }
    }
  }

  return prisma.customer.findMany();
}
