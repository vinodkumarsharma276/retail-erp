import { prisma } from '../../../config/database.js';

type ParsedDistributor = {
  companyName: string | null;
  gstNumber: string | null;
};

export type DistributorMatch = {
  id: string | null;
  companyName: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  gstNumber?: string | null;
  matchedBy: 'gst' | 'name' | null;
  confidence: number;
};

function normalizeGst(value: string | null | undefined) {
  return value?.replace(/[^a-z0-9]/gi, '').toUpperCase() || null;
}

function normalizeName(value: string | null | undefined) {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ') || '';
}

export async function matchDistributor(parsed: ParsedDistributor): Promise<DistributorMatch> {
  const gstNumber = normalizeGst(parsed.gstNumber);
  if (gstNumber) {
    const gstMatch = await prisma.distributor.findFirst({
      where: { gstNumber: { equals: gstNumber, mode: 'insensitive' } },
      select: { id: true, companyName: true, contactPerson: true, phone: true, gstNumber: true },
    });
    if (gstMatch) {
      return { ...gstMatch, matchedBy: 'gst', confidence: 0.99 };
    }
  }

  const normalized = normalizeName(parsed.companyName);
  if (normalized.length >= 4) {
    const candidates = await prisma.distributor.findMany({
      where: { companyName: { contains: parsed.companyName ?? '', mode: 'insensitive' } },
      select: { id: true, companyName: true, contactPerson: true, phone: true, gstNumber: true },
      take: 5,
    });
    const exact = candidates.find((candidate) => normalizeName(candidate.companyName) === normalized);
    const candidate = exact ?? candidates[0];
    if (candidate) {
      return { ...candidate, matchedBy: 'name', confidence: exact ? 0.9 : 0.7 };
    }
  }

  return { id: null, companyName: null, matchedBy: null, confidence: 0 };
}