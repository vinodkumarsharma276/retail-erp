import type { PrismaClient, Shop } from '@prisma/client';

export async function seedShops(prisma: PrismaClient, tenantId: string): Promise<Shop[]> {
  const shopsData = [
    {
      name: 'Vinod Electronics',
      code: 'VE',
      gstNumber: '09AABCV1234A1Z5',
      panNumber: 'AABCV1234A',
      addressLine1: 'A-2, Himalaya Vihar, Main Road Mangal Bazar',
      addressLine2: 'Khoda Colony',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      pincode: '201030',
      phone: '01202491643, 9345768374',
      email: 'vinod.electronics@retailerp.com',
      bankName: 'State Bank of India',
      bankAccountNumber: '1234567890',
      bankIfsc: 'SBIN0001234',
      bankBranch: 'Main Branch, Ghaziabad',
    },
    {
      name: 'Naveen Electronics',
      code: 'NE',
      gstNumber: '09AABCN5678B1Z3',
      panNumber: 'AABCN5678B',
      addressLine1: 'B-95, Janta Flats, Abhay Khand 1',
      addressLine2: 'Indrapuram',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      pincode: '201040',
      phone: '98765432123',
      email: 'naveen.electronics@retailerp.com',
      bankName: 'Punjab National Bank',
      bankAccountNumber: '2345678901',
      bankIfsc: 'PUNB0002345',
      bankBranch: 'Indrapuram Branch, Ghaziabad',
    },
    {
      name: 'Vinod Home Appliances',
      code: 'VHA',
      gstNumber: '09AABCV9012C1Z1',
      panNumber: 'AABCV9012C',
      addressLine1: 'Vandana Enclave',
      addressLine2: 'Khoda Colony',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      pincode: '349857',
      phone: '345343443, 7989597700, 3454324567',
      email: 'vinod.home@retailerp.com',
      bankName: 'HDFC Bank',
      bankAccountNumber: '3456789012',
      bankIfsc: 'HDFC0003456',
      bankBranch: 'Khoda Colony Branch, Ghaziabad',
    },
    {
      name: 'New Harshita Electronics',
      code: 'NHE',
      gstNumber: '09AABCN3456D1Z9',
      panNumber: 'AABCN3456D',
      addressLine1: 'G-98, Behrampur',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      pincode: '110098',
      phone: '7447364747, 5768473648',
      email: 'harshita.electronics@retailerp.com',
      bankName: 'ICICI Bank',
      bankAccountNumber: '4567890123',
      bankIfsc: 'ICIC0004567',
      bankBranch: 'Behrampur Branch, Ghaziabad',
    },
  ];

  const shops: Shop[] = [];
  for (const data of shopsData) {
    const shop = await prisma.shop.upsert({
      where: { tenantId_code: { tenantId, code: data.code } },
      update: {},
      create: { ...data, tenantId },
    });
    shops.push(shop);
  }

  return shops;
}
