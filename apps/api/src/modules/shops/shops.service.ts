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

  /**
   * Lean shop record exposed to non-admin users — only the fields the
   * frontend invoice/PDF actually needs (no bank details, no user list).
   * The Admin-only `getById` retains everything for the Roles & Users UI.
   */
  async getPublicById(id: string) {
    return prisma.shop.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        gstNumber: true,
        panNumber: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        pincode: true,
        phone: true,
        email: true,
        logoUrl: true,
        isActive: true,
      },
    });
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
