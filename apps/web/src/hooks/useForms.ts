import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';
import type {
  ApiResponse,
  FormDefinition,
  FormField,
} from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
const keys = {
  definitions: ['formDefinitions'] as const,
  definitionByName: (name: string) => ['formDefinitions', 'name', name] as const,
  definitionById: (id: string) => ['formDefinitions', 'id', id] as const,
  fields: (defId: string) => ['formDefinitions', defId, 'fields'] as const,
};

// ---------------------------------------------------------------------------
// List all form definitions
// ---------------------------------------------------------------------------
export function useFormDefinitionsQuery() {
  return useQuery({
    queryKey: keys.definitions,
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<FormDefinition[]>>(
        '/forms/definitions',
      );
      return data.data!;
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Get active form definition by name (for rendering)
// ---------------------------------------------------------------------------
export function useFormDefinitionByNameQuery(formName: string | undefined) {
  return useQuery({
    queryKey: keys.definitionByName(formName ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<FormDefinition>>(
        `/forms/definitions/${formName}`,
      );
      return data.data!;
    },
    enabled: !!formName,
    staleTime: 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Get form definition by ID (for editing in form builder)
// ---------------------------------------------------------------------------
export function useFormDefinitionByIdQuery(id: string | undefined) {
  return useQuery({
    queryKey: keys.definitionById(id ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<FormDefinition>>(
        `/forms/definitions/id/${id}`,
      );
      return data.data!;
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Create form definition
// ---------------------------------------------------------------------------
export function useCreateFormDefinitionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      formName: string;
      description?: string;
    }) => {
      const { data } = await apiClient.post<ApiResponse<FormDefinition>>(
        '/forms/definitions',
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.definitions });
    },
  });
}

// ---------------------------------------------------------------------------
// Update form definition
// ---------------------------------------------------------------------------
export function useUpdateFormDefinitionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: { formName?: string; description?: string; isActive?: boolean };
    }) => {
      const { data } = await apiClient.put<ApiResponse<FormDefinition>>(
        `/forms/definitions/${id}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: keys.definitions });
      queryClient.invalidateQueries({
        queryKey: keys.definitionById(variables.id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Add field to a form definition
// ---------------------------------------------------------------------------
export function useAddFormFieldMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      definitionId,
      payload,
    }: {
      definitionId: string;
      payload: Omit<FormField, 'id' | 'formDefinitionId' | 'createdAt'>;
    }) => {
      const { data } = await apiClient.post<ApiResponse<FormField>>(
        `/forms/definitions/${definitionId}/fields`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formDefinitions'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Update a form field
// ---------------------------------------------------------------------------
export function useUpdateFormFieldMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fieldId,
      payload,
    }: {
      fieldId: string;
      payload: Partial<Omit<FormField, 'id' | 'formDefinitionId' | 'createdAt'>>;
    }) => {
      const { data } = await apiClient.put<ApiResponse<FormField>>(
        `/forms/fields/${fieldId}`,
        payload,
      );
      return data.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formDefinitions'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete a form field
// ---------------------------------------------------------------------------
export function useDeleteFormFieldMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fieldId: string) => {
      await apiClient.delete(`/forms/fields/${fieldId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formDefinitions'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Reorder form fields
// ---------------------------------------------------------------------------
export function useReorderFormFieldsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      definitionId,
      fieldIds,
    }: {
      definitionId: string;
      fieldIds: string[];
    }) => {
      const { data } = await apiClient.put<ApiResponse<void>>(
        `/forms/definitions/${definitionId}/fields/reorder`,
        { fieldIds },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formDefinitions'] });
    },
  });
}
