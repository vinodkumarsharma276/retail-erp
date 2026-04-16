import { prisma } from '../../config/database.js';
import type { Prisma } from '@prisma/client';

export const employeesService = {
  async list(shopId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    search?: string;
  }) {
    const where: Prisma.EmployeeWhereInput = {
      shopId,
      isActive: true,
    };

    if (filters.search) {
      where.OR = [
        { designation: { contains: filters.search, mode: 'insensitive' } },
        { user: { fullName: { contains: filters.search, mode: 'insensitive' } } },
        { user: { username: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [employees, totalItems] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              phone: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.employee.count({ where }),
    ]);

    return { employees, totalItems };
  },

  async getById(id: string) {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
            phone: true,
            email: true,
            isActive: true,
          },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return employee;
  },

  async create(shopId: string, data: {
    userId: string;
    designation?: string | null;
    dateOfJoining?: string | null;
    salary?: number | null;
    aadhaarNumber?: string | null;
    address?: string | null;
    emergencyContact?: string | null;
  }) {
    // Verify user exists and is not already linked to an employee
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const existingEmployee = await prisma.employee.findUnique({
      where: { userId: data.userId },
    });
    if (existingEmployee) {
      throw new Error('User is already linked to an employee record');
    }

    const employee = await prisma.employee.create({
      data: {
        userId: data.userId,
        shopId,
        designation: data.designation ?? null,
        dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : null,
        salary: data.salary ?? null,
        aadhaarNumber: data.aadhaarNumber ?? null,
        address: data.address ?? null,
        emergencyContact: data.emergencyContact ?? null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });

    return employee;
  },

  async update(id: string, data: {
    designation?: string | null;
    dateOfJoining?: string | null;
    salary?: number | null;
    aadhaarNumber?: string | null;
    address?: string | null;
    emergencyContact?: string | null;
    isActive?: boolean;
  }) {
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const updateData: Record<string, unknown> = {};

    if (data.designation !== undefined) updateData.designation = data.designation;
    if (data.dateOfJoining !== undefined) {
      updateData.dateOfJoining = data.dateOfJoining ? new Date(data.dateOfJoining) : null;
    }
    if (data.salary !== undefined) updateData.salary = data.salary;
    if (data.aadhaarNumber !== undefined) updateData.aadhaarNumber = data.aadhaarNumber;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.emergencyContact !== undefined) updateData.emergencyContact = data.emergencyContact;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });

    return updated;
  },
};
