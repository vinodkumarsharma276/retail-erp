import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';
import { generateCustomerCode } from '../../utils/id-generator.js';

export const customersService = {
  async list(shopId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    search?: string;
  }) {
    const where: Prisma.CustomerWhereInput = {
      shopId,
    };

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { customerCode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [customers, totalItems] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          guarantor: {
            select: { id: true, name: true, phone: true, customerCode: true },
          },
          creator: {
            select: { id: true, username: true, fullName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.customer.count({ where }),
    ]);

    return { customers, totalItems };
  },

  async search(query: string) {
    // Search across ALL shops — for sale form customer lookup (find repeat customers)
    const customers = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { customerCode: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return customers;
  },

  async getById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        guaranteedCustomers: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
        saleRecords: {
          include: {
            product: {
              select: { id: true, brand: true, modelNumber: true, serialNumber: true },
            },
          },
          orderBy: { saleDate: 'desc' },
        },
      },
    });

    return customer;
  },

  async create(shopId: string, data: {
    name: string;
    phone: string;
    altPhone?: string | null;
    aadhaarNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    isGuarantor?: boolean;
    guarantorId?: string | null;
    dynamicAttributes?: Record<string, unknown>;
  }, userId: string) {
    // Validate guarantor exists if provided
    if (data.guarantorId) {
      const guarantor = await prisma.customer.findUnique({
        where: { id: data.guarantorId },
      });
      if (!guarantor) {
        throw new Error('Guarantor not found');
      }
    }

    // Get last customer code to generate next one
    const lastCustomer = await prisma.customer.findFirst({
      orderBy: { customerCode: 'desc' },
      select: { customerCode: true },
    });

    const customerCode = generateCustomerCode(lastCustomer?.customerCode ?? undefined);

    const customer = await prisma.customer.create({
      data: {
        customerCode,
        name: data.name,
        phone: data.phone,
        altPhone: data.altPhone ?? null,
        aadhaarNumber: data.aadhaarNumber ?? null,
        addressLine1: data.addressLine1 ?? null,
        addressLine2: data.addressLine2 ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        isGuarantor: data.isGuarantor ?? false,
        guarantorId: data.guarantorId ?? null,
        dynamicAttributes: (data.dynamicAttributes ?? {}) as any,
        shopId,
        createdBy: userId,
      },
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return customer;
  },

  async update(id: string, data: {
    name?: string;
    phone?: string;
    altPhone?: string | null;
    aadhaarNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    isGuarantor?: boolean;
    guarantorId?: string | null;
    dynamicAttributes?: Record<string, unknown>;
  }) {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    // Validate guarantor exists if provided
    if (data.guarantorId) {
      const guarantor = await prisma.customer.findUnique({
        where: { id: data.guarantorId },
      });
      if (!guarantor) {
        throw new Error('Guarantor not found');
      }
    }

    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.altPhone !== undefined) updateData.altPhone = data.altPhone;
    if (data.aadhaarNumber !== undefined) updateData.aadhaarNumber = data.aadhaarNumber;
    if (data.addressLine1 !== undefined) updateData.addressLine1 = data.addressLine1;
    if (data.addressLine2 !== undefined) updateData.addressLine2 = data.addressLine2;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.pincode !== undefined) updateData.pincode = data.pincode;
    if (data.isGuarantor !== undefined) updateData.isGuarantor = data.isGuarantor;
    if (data.guarantorId !== undefined) updateData.guarantorId = data.guarantorId;
    if (data.dynamicAttributes !== undefined) {
      updateData.dynamicAttributes = data.dynamicAttributes as any;
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: updateData as any,
      include: {
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    return updated;
  },

  async getSales(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      return null;
    }

    const sales = await prisma.saleRecord.findMany({
      where: { customerId },
      include: {
        product: {
          select: {
            id: true,
            brand: true,
            modelNumber: true,
            serialNumber: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
        guarantor: {
          select: { id: true, name: true, phone: true, customerCode: true },
        },
        financeCompany: {
          select: { id: true, name: true, code: true },
        },
        installmentSchedule: {
          select: { id: true, status: true, numInstallments: true, emiAmount: true, totalPayable: true },
        },
      },
      orderBy: { saleDate: 'desc' },
    });

    return sales;
  },
};
