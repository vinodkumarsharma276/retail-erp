import type { PrismaClient, Customer, Shop, User } from '@prisma/client';
import { generateCustomerCode } from '../../src/utils/id-generator';

export async function seedCustomers(
  prisma: PrismaClient,
  shops: Shop[],
  users: User[],
): Promise<Customer[]> {
  const customers: Customer[] = [];

  const shopByCode = (code: string) => shops.find((s) => s.code === code)!;

  // Helper to get first admin user for a shop
  async function getFirstAdmin(shopId: string) {
    const userShop = await prisma.userShop.findFirst({
      where: { shopId, isPrimary: true, user: { role: 'admin' } },
      include: { user: true },
    });
    return userShop?.user;
  }

  const ve = shopByCode('VE');
  const ne = shopByCode('NE');
  const vha = shopByCode('VHA');
  const nhe = shopByCode('NHE');

  const veAdmin = await getFirstAdmin(ve.id);
  const neAdmin = await getFirstAdmin(ne.id);
  const vhaAdmin = await getFirstAdmin(vha.id);
  const nheAdmin = await getFirstAdmin(nhe.id);

  // Get last customer code for auto-generation
  let lastCode: string | undefined;
  const lastCustomer = await prisma.customer.findFirst({
    orderBy: { customerCode: 'desc' },
    select: { customerCode: true },
  });
  lastCode = lastCustomer?.customerCode ?? undefined;

  const customerDefs = [
    // --- Guarantors first (they are also customers, with isGuarantor = true) ---
    {
      name: 'Ravi Guarantor1',
      phone: '9876543215',
      aadhaarNumber: '234567890123',
      addressLine1: 'Sector 5, Aliganj',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226024',
      isGuarantor: true,
      shopId: ve.id,
      createdBy: veAdmin?.id ?? null,
    },
    {
      name: 'Suresh Guarantor2',
      phone: '9876543216',
      aadhaarNumber: '345678901234',
      addressLine1: 'Block B, Indira Nagar',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226016',
      isGuarantor: true,
      shopId: ne.id,
      createdBy: neAdmin?.id ?? null,
    },

    // --- Regular customers ---
    {
      name: 'Rajesh Kumar',
      phone: '9876543210',
      aadhaarNumber: '123456789012',
      addressLine1: '42 MG Road, Hazratganj',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      isGuarantor: false,
      shopId: ve.id,
      createdBy: veAdmin?.id ?? null,
    },
    {
      name: 'Priya Sharma',
      phone: '9876543211',
      aadhaarNumber: '234567890124',
      addressLine1: '15 Civil Lines',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226001',
      isGuarantor: false,
      shopId: ne.id,
      createdBy: neAdmin?.id ?? null,
    },
    {
      name: 'Amit Verma',
      phone: '9876543212',
      aadhaarNumber: '345678901235',
      addressLine1: '78 Gomti Nagar',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226010',
      isGuarantor: false,
      shopId: vha.id,
      createdBy: vhaAdmin?.id ?? null,
    },
    {
      name: 'Sunita Devi',
      phone: '9876543213',
      aadhaarNumber: '456789012346',
      addressLine1: '23 Aminabad',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226018',
      isGuarantor: false,
      shopId: nhe.id,
      createdBy: nheAdmin?.id ?? null,
    },
    {
      name: 'Mohit Singh',
      phone: '9876543214',
      aadhaarNumber: '567890123457',
      addressLine1: '56 Alambagh',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      pincode: '226005',
      isGuarantor: false,
      shopId: ve.id,
      createdBy: veAdmin?.id ?? null,
    },
  ];

  for (const def of customerDefs) {
    // Check if customer already exists by phone + shopId
    let customer = await prisma.customer.findFirst({
      where: { phone: def.phone, shopId: def.shopId },
    });

    if (!customer) {
      const customerCode = generateCustomerCode(lastCode);
      lastCode = customerCode;

      customer = await prisma.customer.create({
        data: {
          customerCode,
          name: def.name,
          phone: def.phone,
          aadhaarNumber: def.aadhaarNumber ?? null,
          addressLine1: def.addressLine1 ?? null,
          city: def.city ?? null,
          state: def.state ?? null,
          pincode: def.pincode ?? null,
          isGuarantor: def.isGuarantor,
          dynamicAttributes: {},
          shopId: def.shopId,
          createdBy: def.createdBy,
        },
      });
    }

    customers.push(customer);
  }

  // Now set guarantorId for Rajesh (guaranteed by Ravi) and Priya (guaranteed by Suresh)
  const ravi = customers.find((c) => c.name === 'Ravi Guarantor1')!;
  const suresh = customers.find((c) => c.name === 'Suresh Guarantor2')!;
  const rajesh = customers.find((c) => c.name === 'Rajesh Kumar')!;
  const priya = customers.find((c) => c.name === 'Priya Sharma')!;

  if (rajesh && ravi && !rajesh.guarantorId) {
    await prisma.customer.update({
      where: { id: rajesh.id },
      data: { guarantorId: ravi.id },
    });
    rajesh.guarantorId = ravi.id;
  }

  if (priya && suresh && !priya.guarantorId) {
    await prisma.customer.update({
      where: { id: priya.id },
      data: { guarantorId: suresh.id },
    });
    priya.guarantorId = suresh.id;
  }

  return customers;
}
