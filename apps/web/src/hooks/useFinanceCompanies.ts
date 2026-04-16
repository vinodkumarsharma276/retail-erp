/**
 * Finance companies — hardcoded for now.
 * When a finance companies API endpoint is added, this can be converted to a
 * useQuery hook.
 */

export interface FinanceCompany {
  id: string;
  name: string;
  code: string;
}

const FINANCE_COMPANIES: FinanceCompany[] = [
  { id: 'fc_bajaj', name: 'Bajaj Finance', code: 'BAJAJ' },
  { id: 'fc_hdb', name: 'HDB Financial Services', code: 'HDB' },
  { id: 'fc_home_credit', name: 'Home Credit', code: 'HOME_CREDIT' },
];

export function useFinanceCompaniesQuery() {
  // Return a stable reference that matches TanStack Query shape
  return {
    data: FINANCE_COMPANIES,
    isLoading: false,
    isError: false,
  };
}
