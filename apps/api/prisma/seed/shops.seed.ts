import type { PrismaClient, Shop } from '@prisma/client';

export async function seedShops(prisma: PrismaClient): Promise<Shop[]> {
  const shopsData = [
    {
      name: 'Vinod Electronics',
      code: 'VE',
      gstNumber: '09AABCV1234A1Z5',
      panNumber: 'AABCV1234A',
      addressLine1: 'Main Market, Shop No. 12',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      phone: '9876543201',
      email: 'vinod.electronics@retailerp.com',
      bankName: 'State Bank of India',
      bankAccountNumber: '1234567890',
      bankIfsc: 'SBIN0001234',
      bankBranch: 'Main Branch, Lucknow',
    },
    {
      name: 'Naveen Electronics',
      code: 'NE',
      gstNumber: '09AABCN5678B1Z3',
      panNumber: 'AABCN5678B',
      addressLine1: 'Civil Lines, Shop No. 45',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      phone: '9876543202',
      email: 'naveen.electronics@retailerp.com',
      bankName: 'Punjab National Bank',
      bankAccountNumber: '2345678901',
      bankIfsc: 'PUNB0002345',
      bankBranch: 'Civil Lines Branch, Lucknow',
    },
    {
      name: 'Vinod Home Appliances',
      code: 'VHA',
      gstNumber: '09AABCV9012C1Z1',
      panNumber: 'AABCV9012C',
      addressLine1: 'Hazratganj, Shop No. 78',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      phone: '9876543203',
      email: 'vinod.home@retailerp.com',
      bankName: 'HDFC Bank',
      bankAccountNumber: '3456789012',
      bankIfsc: 'HDFC0003456',
      bankBranch: 'Hazratganj Branch, Lucknow',
    },
    {
      name: 'New Harshita Electronics',
      code: 'NHE',
      gstNumber: '09AABCN3456D1Z9',
      panNumber: 'AABCN3456D',
      addressLine1: 'Aminabad, Shop No. 23',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226018',
      phone: '9876543204',
      email: 'harshita.electronics@retailerp.com',
      bankName: 'ICICI Bank',
      bankAccountNumber: '4567890123',
      bankIfsc: 'ICIC0004567',
      bankBranch: 'Aminabad Branch, Lucknow',
    },
  ];

  const shops: Shop[] = [];
  for (const data of shopsData) {
    const shop = await prisma.shop.upsert({
      where: { code: data.code },
      update: {},
      create: data,
    });
    shops.push(shop);
  }

  return shops;
}
