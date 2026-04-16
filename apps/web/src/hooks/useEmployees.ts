import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Employee type (local — not yet in shared-types)
// ---------------------------------------------------------------------------
export interface Employee {
  id: string;
  userId: string;
  shopId: string;
  designation?: string;
  dateOfJoining?: string;
  salary?: number;
  aadhaarNumber?: string;
  address?: string;
  emergencyContact?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Joined user fields
  user?: {
    id: string;
    username: string;
    fullName: string;
    role: string;
    phone: string;
    email?: string;
    isActive: boolean;
  };
  shop?: {
    id: string;
    name: string;
    code: string;
  };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  employees: (filters: EmployeeFilters) => ['employees', filters] as const,
  employeeDetail: (id: string) => ['employees', id] as const,
};

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------
export interface EmployeeFilters {
  page?: number;
  pageSize?: number;
  search?: string;
}

// ---------------------------------------------------------------------------
// List employees (paginated)
// ---------------------------------------------------------------------------
export function useEmployeesQuery(filters: EmployeeFilters) {
  return useQuery({
    queryKey: keys.employees(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.page) params.set('page', String(filters.page));
      if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
      if (filters.search) params.set('search', filters.search);

      const { data } = await apiClient.get<PaginatedResponse<Employee>>(
        `/employees?${params.toString()}`,
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Employee detail
// ---------------------------------------------------------------------------
export function useEmployeeDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.employeeDetail(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<Employee>>(
        `/employees/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create employee
// ---------------------------------------------------------------------------
export function useCreateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<Employee>>(
        '/employees',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update employee
// ---------------------------------------------------------------------------
export function useUpdateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<Employee>>(
        `/employees/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({
        queryKey: keys.employeeDetail(variables.id),
      });
    },
  });
}
