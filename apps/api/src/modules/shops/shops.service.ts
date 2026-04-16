import { prisma } from '../../config/database.js';

export const shopsService = {
  async list() {
    const shops = await prisma.shop.findMany({
      orderBy: { name: 'asc' },
    });
    return shops;
  },

  async getById(id: string) {
    const shop = await prisma.shop.findUnique({
      where: { id },
      include: {
        userShops: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
      },
    });
    return shop;
  },

  async update(id: string, data: {
    name?: string;
    gstNumber?: string;
    panNumber?: string;
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
    logoUrl?: string | null;
    isActive?: boolean;
  }) {
    // Verify shop exists
    const existing = await prisma.shop.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updated = await prisma.shop.update({
      where: { id },
      data,
    });

    return updated;
  },
};
