import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type { ApiResponse } from '@retailerp/shared-types';

export interface FinanceCompany {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export function useFinanceCompaniesQuery() {
  return useQuery({
    queryKey: ['finance-companies'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<FinanceCompany[]>>('/sales/finance-companies');
      return res.data.data!;
    },
    staleTime: 10 * 60 * 1000, // cache for 10 minutes — rarely changes
  });
}
