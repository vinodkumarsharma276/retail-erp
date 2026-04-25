import { useMutation, useQuery } from '@tanstack/react-query';
import { ocrApi } from '../api/ocr-api';

export function useOcrStatusQuery() {
  return useQuery({
    queryKey: ['ocr', 'status'],
    queryFn: ocrApi.status,
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useScanInvoiceMutation() {
  return useMutation({ mutationFn: (file: File) => ocrApi.parseInvoice(file) });
}

export function useScanRegisterMutation() {
  return useMutation({ mutationFn: (file: File) => ocrApi.parseRegisterEntry(file) });
}