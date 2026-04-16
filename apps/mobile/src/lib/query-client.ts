import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 2, // 2 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes garbage collection
      refetchOnWindowFocus: false, // Not applicable on mobile but set for clarity
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
