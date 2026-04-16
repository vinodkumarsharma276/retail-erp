import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';

export const authService = {
  async listShops() {
    return prisma.shop.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  },

  async validateCredentials(username: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { userShops: { include: { shop: true } } },
    });

    if (!user || !user.isActive) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    return user;
  },

  async verifyUserShopAccess(userId: string, shopId: string) {
    const assignment = await prisma.userShop.findFirst({
      where: { userId, shopId },
    });
    return !!assignment;
  },

  async updateLastLogin(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  },

  async storeRefreshToken(userId: string, tokenHash: string, deviceInfo?: string) {
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        deviceInfo,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  },

  async revokeRefreshToken(tokenHash: string) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async findValidRefreshToken(tokenHash: string) {
    return prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
  },
};
