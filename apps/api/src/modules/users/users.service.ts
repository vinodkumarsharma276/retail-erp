import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma, tenantStamped } from '../../config/database.js';
import { tenantContext } from '../../config/tenant-context.js';

const SALT_ROUNDS = 10;

export const usersService = {
  async list(options: {
    page: number;
    pageSize: number;
    skip: number;
    take: number;
    shopId?: string;
    role?: string;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (options.role) {
      where.role = options.role;
    }

    if (options.search) {
      where.OR = [
        { username: { contains: options.search, mode: 'insensitive' } },
        { fullName: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    if (options.shopId) {
      where.userShops = {
        some: { shopId: options.shopId },
      };
    }

    const [users, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          phone: true,
          role: true,
          isMobileOnly: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          userShops: {
            include: {
              shop: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: options.skip,
        take: options.take,
      }),
      prisma.user.count({ where }),
    ]);

    return { users, totalItems };
  },

  async getById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isMobileOnly: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        userShops: {
          include: {
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });
    return user;
  },

  async create(data: {
    username: string;
    password: string;
    fullName: string;
    email?: string | null;
    phone: string;
    role: string;
    isMobileOnly?: boolean;
    shopIds: string[];
  }) {
    // Check for duplicate username (unique per tenant; the scoped client adds the tenant)
    const existing = await prisma.user.findFirst({
      where: { username: data.username },
    });
    if (existing) {
      throw new Error('Username already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Nested creates aren't stamped by the scoped client, so set the tenant explicitly.
    const tenantId = tenantContext.currentTenantId();
    if (!tenantId) {
      throw new Error('No tenant in context');
    }

    const user = await prisma.user.create({
      data: {
        tenantId,
        username: data.username,
        passwordHash,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        role: data.role as any,
        isMobileOnly: data.isMobileOnly ?? false,
        userShops: {
          create: data.shopIds.map((shopId, index) => ({
            tenantId,
            shopId,
            isPrimary: index === 0, // First shop is primary
          })),
        },
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isMobileOnly: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        userShops: {
          include: {
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    return user;
  },

  async update(
    id: string,
    data: {
      fullName?: string;
      email?: string | null;
      phone?: string;
      role?: string;
      isMobileOnly?: boolean;
      isActive?: boolean;
    },
  ) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: data as any,
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isMobileOnly: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        userShops: {
          include: {
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    return updated;
  },

  async softDelete(id: string) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
      },
    });

    // Revoke all refresh tokens when user is deactivated
    await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return updated;
  },

  async assignShops(userId: string, shopIds: string[]) {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      return null;
    }

    // Remove all existing shop assignments
    await prisma.userShop.deleteMany({
      where: { userId },
    });

    // Create new shop assignments
    await prisma.userShop.createMany({
      data: tenantStamped<Prisma.UserShopCreateManyInput>(
        shopIds.map((shopId, index) => ({
          userId,
          shopId,
          isPrimary: index === 0,
        })),
      ),
    });

    // Return updated user with shops
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        isMobileOnly: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        userShops: {
          include: {
            shop: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    return user;
  },
};
