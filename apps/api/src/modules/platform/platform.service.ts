import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../../config/database.js';
import { invalidateTenantCache } from '../../middleware/tenant-resolver.js';
import { invalidateFeatureCache } from '../../middleware/feature-gate.js';
import { ALL_FEATURE_KEYS, FeatureKey } from '@retailerp/shared-types';

const SALT_ROUNDS = 10;

// ─── Platform admin authentication ──────────────────────────────────────────

export const platformAuthService = {
  async validateCredentials(username: string, password: string) {
    const admin = await prisma.platformUser.findUnique({ where: { username } });
    if (!admin || !admin.isActive) return null;
    const ok = await bcrypt.compare(password, admin.passwordHash);
    return ok ? admin : null;
  },

  async storeRefreshToken(platformUserId: string, tokenHash: string, deviceInfo?: string | null) {
    await prisma.platformRefreshToken.create({
      data: {
        platformUserId,
        tokenHash,
        deviceInfo: deviceInfo ?? null,
        // 7-day expiry — same window as tenant user refresh tokens.
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  },

  async revokeRefreshToken(tokenHash: string) {
    await prisma.platformRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async findValidRefreshToken(tokenHash: string) {
    return prisma.platformRefreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { platformUser: true },
    });
  },

  async updateLastLogin(platformUserId: string) {
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: { lastLoginAt: new Date() },
    });
  },
};

// ─── Tenants ────────────────────────────────────────────────────────────────

interface CreateTenantInput {
  slug: string;
  name: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  gstNumber?: string | null;
  planCode: string;
  trialEndsAt?: string | null;
  owner: {
    username: string;
    password: string;
    fullName: string;
    email?: string | null;
    phone: string;
  };
  initialShop?: {
    code: string;
    name: string;
    gstNumber: string;
    panNumber: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
  };
}

export const tenantsService = {
  async list(filter?: { status?: string; q?: string }) {
    return prisma.tenant.findMany({
      where: {
        ...(filter?.status ? { status: filter.status as any } : {}),
        ...(filter?.q
          ? {
              OR: [
                { name: { contains: filter.q, mode: 'insensitive' as const } },
                { slug: { contains: filter.q, mode: 'insensitive' as const } },
                { contactEmail: { contains: filter.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: {
        plan: { select: { id: true, code: true, name: true } },
        _count: { select: { shops: true, users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(id: string) {
    return prisma.tenant.findUnique({
      where: { id },
      include: {
        plan: true,
        features: true,
        _count: { select: { shops: true, users: true, customers: true, saleRecords: true } },
      },
    });
  },

  /**
   * Onboard a new tenant atomically. Creates Tenant + initial Owner user
   * (with `tenantId`) + optional first shop + UserShop link. Bootstraps
   * a single empty `userShops` row so the owner can immediately log in.
   *
   * Returns the created tenant + the seeded owner user (without password
   * hash). The temporary password is returned in the response so the
   * platform admin can hand it to the customer through a side channel —
   * we never store or email it.
   */
  async create(input: CreateTenantInput, platformUserId: string) {
    const plan = await prisma.plan.findUnique({
      where: { code: input.planCode },
      select: { id: true, code: true, name: true },
    });
    if (!plan) {
      throw new Error(`Plan '${input.planCode}' not found`);
    }

    // Pre-flight slug uniqueness so we get a clean 400 (not an opaque P2002).
    const existing = await prisma.tenant.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`Tenant slug '${input.slug}' is already taken`);
    }

    const passwordHash = await bcrypt.hash(input.owner.password, SALT_ROUNDS);

    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: input.slug,
          name: input.name,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          gstNumber: input.gstNumber ?? null,
          planId: plan.id,
          trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          status: input.trialEndsAt ? 'trial' : 'active',
        },
      });

      // Optional first shop.
      let firstShop = null;
      if (input.initialShop) {
        firstShop = await tx.shop.create({
          data: {
            tenantId: tenant.id,
            code: input.initialShop.code,
            name: input.initialShop.name,
            gstNumber: input.initialShop.gstNumber,
            panNumber: input.initialShop.panNumber,
            addressLine1: input.initialShop.addressLine1,
            city: input.initialShop.city,
            state: input.initialShop.state,
            pincode: input.initialShop.pincode,
            phone: input.initialShop.phone,
          },
        });
      }

      // Initial Owner user. Role enum is `owner` (lowercase) — see schema.
      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          username: input.owner.username,
          passwordHash,
          fullName: input.owner.fullName,
          email: input.owner.email ?? null,
          phone: input.owner.phone,
          role: 'owner',
        },
      });

      if (firstShop) {
        await tx.userShop.create({
          data: {
            tenantId: tenant.id,
            userId: owner.id,
            shopId: firstShop.id,
            isPrimary: true,
          },
        });
      }

      // Audit log
      await tx.platformAuditLog.create({
        data: {
          platformUserId,
          tenantId: tenant.id,
          action: 'tenant.create',
          entityType: 'tenant',
          entityId: tenant.id,
          newValues: {
            slug: tenant.slug,
            name: tenant.name,
            planCode: plan.code,
            ownerUsername: owner.username,
            initialShopCode: input.initialShop?.code ?? null,
          },
        },
      });

      return {
        tenant,
        owner: {
          id: owner.id,
          username: owner.username,
          fullName: owner.fullName,
          role: owner.role,
        },
        initialShop: firstShop
          ? { id: firstShop.id, code: firstShop.code, name: firstShop.name }
          : null,
      };
    });
  },

  async update(
    id: string,
    input: {
      name?: string;
      contactEmail?: string | null;
      contactPhone?: string | null;
      gstNumber?: string | null;
      status?: 'active' | 'trial' | 'suspended' | 'cancelled';
      planCode?: string;
      trialEndsAt?: string | null;
      customDomain?: string | null;
    },
    platformUserId: string,
  ) {
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw new Error('Tenant not found');

    let planId: string | undefined;
    if (input.planCode) {
      const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
      if (!plan) throw new Error(`Plan '${input.planCode}' not found`);
      planId = plan.id;
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        gstNumber: input.gstNumber,
        status: input.status,
        planId,
        trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : input.trialEndsAt,
        customDomain: input.customDomain,
      },
    });

    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        tenantId: id,
        action: 'tenant.update',
        entityType: 'tenant',
        entityId: id,
        oldValues: existing as any,
        newValues: input as any,
      },
    });

    // Tenant cache + feature cache may now be stale (plan change, etc.).
    invalidateTenantCache(existing.slug);
    if (updated.slug !== existing.slug) invalidateTenantCache(updated.slug);
    invalidateFeatureCache(id);

    return updated;
  },

  // ── Feature overrides ────────────────────────────────────────────────────
  async listFeatures(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planId: true },
    });
    if (!tenant) throw new Error('Tenant not found');

    const [planFeatures, overrides] = await Promise.all([
      prisma.planFeature.findMany({ where: { planId: tenant.planId } }),
      prisma.tenantFeature.findMany({ where: { tenantId } }),
    ]);

    // Merge into a per-key effective view.
    const map = new Map<
      string,
      {
        featureKey: string;
        enabled: boolean;
        valueJson: unknown;
        source: 'plan' | 'override';
        note: string | null;
      }
    >();
    for (const k of ALL_FEATURE_KEYS) {
      // Default disabled if neither plan nor override defines it.
      map.set(k, { featureKey: k, enabled: false, valueJson: null, source: 'plan', note: null });
    }
    for (const pf of planFeatures) {
      map.set(pf.featureKey, {
        featureKey: pf.featureKey,
        enabled: pf.enabled,
        valueJson: pf.valueJson,
        source: 'plan',
        note: null,
      });
    }
    for (const tf of overrides) {
      map.set(tf.featureKey, {
        featureKey: tf.featureKey,
        enabled: tf.enabled,
        valueJson: tf.valueJson,
        source: 'override',
        note: tf.note ?? null,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.featureKey.localeCompare(b.featureKey));
  },

  async upsertFeature(
    tenantId: string,
    input: { featureKey: string; enabled: boolean; valueJson?: unknown; note?: string | null },
    platformUserId: string,
  ) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant not found');

    const upserted = await prisma.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey: input.featureKey } },
      update: {
        enabled: input.enabled,
        valueJson: (input.valueJson ?? null) as any,
        note: input.note ?? null,
      },
      create: {
        tenantId,
        featureKey: input.featureKey,
        enabled: input.enabled,
        valueJson: (input.valueJson ?? null) as any,
        note: input.note ?? null,
      },
    });

    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        tenantId,
        action: 'tenant.feature.upsert',
        entityType: 'tenant_feature',
        entityId: upserted.id,
        newValues: input as any,
      },
    });

    invalidateFeatureCache(tenantId);
    return upserted;
  },

  async deleteFeatureOverride(tenantId: string, featureKey: string, platformUserId: string) {
    await prisma.tenantFeature
      .delete({ where: { tenantId_featureKey: { tenantId, featureKey } } })
      .catch(() => {});

    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        tenantId,
        action: 'tenant.feature.delete',
        entityType: 'tenant_feature',
        entityId: featureKey,
      },
    });

    invalidateFeatureCache(tenantId);
  },

  /** Generate a one-time temporary password for the tenant owner. */
  async resetOwnerPassword(tenantId: string, platformUserId: string) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant not found');

    const owner = await prisma.user.findFirst({
      where: { tenantId, role: 'owner', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) throw new Error('Tenant has no active owner user');

    const tempPassword = crypto.randomBytes(12).toString('base64url').slice(0, 16);
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: owner.id },
      data: { passwordHash: hash },
    });
    await prisma.refreshToken.updateMany({
      where: { userId: owner.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        tenantId,
        action: 'tenant.owner_password_reset',
        entityType: 'user',
        entityId: owner.id,
      },
    });

    return { username: owner.username, temporaryPassword: tempPassword };
  },
};

// ─── Plans ──────────────────────────────────────────────────────────────────

export const plansService = {
  async list() {
    return prisma.plan.findMany({
      include: { features: true, _count: { select: { tenants: true } } },
      orderBy: { priceMonthly: 'asc' },
    });
  },

  async getByCode(code: string) {
    return prisma.plan.findUnique({
      where: { code },
      include: { features: true, _count: { select: { tenants: true } } },
    });
  },

  async create(
    input: {
      code: string;
      name: string;
      description?: string | null;
      priceMonthly: number;
      priceYearly: number;
      isPublic: boolean;
      isActive: boolean;
    },
    platformUserId: string,
  ) {
    const plan = await prisma.plan.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        priceMonthly: input.priceMonthly,
        priceYearly: input.priceYearly,
        isPublic: input.isPublic,
        isActive: input.isActive,
      },
    });

    // Seed all known feature keys as disabled — admin must opt-in features
    // per plan via setFeature.
    await prisma.planFeature.createMany({
      data: ALL_FEATURE_KEYS.map((k) => ({
        planId: plan.id,
        featureKey: k,
        enabled: false,
        valueJson: null,
      })),
    });

    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        action: 'plan.create',
        entityType: 'plan',
        entityId: plan.id,
        newValues: input as any,
      },
    });
    return plan;
  },

  async update(
    id: string,
    input: Partial<{
      name: string;
      description: string | null;
      priceMonthly: number;
      priceYearly: number;
      isPublic: boolean;
      isActive: boolean;
    }>,
    platformUserId: string,
  ) {
    const updated = await prisma.plan.update({
      where: { id },
      data: input,
    });
    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        action: 'plan.update',
        entityType: 'plan',
        entityId: id,
        newValues: input as any,
      },
    });
    // Tenants on this plan may have changed effective features.
    invalidateFeatureCache();
    return updated;
  },

  async setFeature(
    planId: string,
    input: { featureKey: string; enabled: boolean; valueJson?: unknown },
    platformUserId: string,
  ) {
    const upserted = await prisma.planFeature.upsert({
      where: { planId_featureKey: { planId, featureKey: input.featureKey } },
      update: { enabled: input.enabled, valueJson: (input.valueJson ?? null) as any },
      create: {
        planId,
        featureKey: input.featureKey,
        enabled: input.enabled,
        valueJson: (input.valueJson ?? null) as any,
      },
    });
    await prisma.platformAuditLog.create({
      data: {
        platformUserId,
        action: 'plan.feature.set',
        entityType: 'plan_feature',
        entityId: upserted.id,
        newValues: input as any,
      },
    });
    invalidateFeatureCache();
    return upserted;
  },
};

// Re-export for type discoverability in tests / docs.
export { FeatureKey };
