import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Loader2, Save, ArrowLeft, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  useEmployeeDetailQuery,
  useCreateEmployeeMutation,
  useUpdateEmployeeMutation,
} from '../../hooks/useEmployees';
import { apiClient } from '../../lib/api-client';
import type { ApiResponse, User } from '@retailerp/shared-types';

// ---------------------------------------------------------------------------
// Form values
// ---------------------------------------------------------------------------
interface EmployeeFormValues {
  userId: string;
  designation: string;
  dateOfJoining: string;
  salary: number | '';
  aadhaarNumber: string;
  address: string;
  emergencyContact: string;
}

const defaultValues: EmployeeFormValues = {
  userId: '',
  designation: '',
  dateOfJoining: '',
  salary: '',
  aadhaarNumber: '',
  address: '',
  emergencyContact: '',
};

export function EmployeeFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  // Available users for dropdown (users that don't have employee records yet)
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Load existing employee in edit mode
  const { data: existingEmployee, isLoading: isLoadingEmployee } =
    useEmployeeDetailQuery(id);

  // Mutations
  const createMutation = useCreateEmployeeMutation();
  const updateMutation = useUpdateEmployeeMutation();
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeFormValues>({ defaultValues });

  // Fetch available users for the dropdown
  useEffect(() => {
    let cancelled = false;
    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        // Fetch all shop users. The API may filter to users without employee records,
        // or we show all users and let backend handle the check.
        const { data } = await apiClient.get<ApiResponse<User[]>>('/users');
        if (!cancelled && data.data) {
          setAvailableUsers(data.data);
        }
      } catch {
        // Silently fail — user can retry or the dropdown will be empty
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    };
    fetchUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-fill form when editing
  useEffect(() => {
    if (existingEmployee && isEditMode) {
      reset({
        userId: existingEmployee.userId,
        designation: existingEmployee.designation ?? '',
        dateOfJoining: existingEmployee.dateOfJoining
          ? existingEmployee.dateOfJoining.split('T')[0]
          : '',
        salary: existingEmployee.salary ?? '',
        aadhaarNumber: existingEmployee.aadhaarNumber ?? '',
        address: existingEmployee.address ?? '',
        emergencyContact: existingEmployee.emergencyContact ?? '',
      });
    }
  }, [existingEmployee, isEditMode, reset]);

  const onSubmit = (formData: EmployeeFormValues) => {
    const payload: Record<string, unknown> = {
      userId: formData.userId,
      designation: formData.designation.trim() || undefined,
      dateOfJoining: formData.dateOfJoining || undefined,
      salary: formData.salary ? Number(formData.salary) : undefined,
      aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
      address: formData.address.trim() || undefined,
      emergencyContact: formData.emergencyContact.trim() || undefined,
    };

    if (isEditMode && id) {
      updateMutation.mutate(
        { id, payload },
        {
          onSuccess: () => {
            navigate('/employees', { replace: true });
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          navigate('/employees', { replace: true });
        },
      });
    }
  };

  // Error message from mutation
  const mutationError = createMutation.error || updateMutation.error;
  const errorMessage = mutationError
    ? (mutationError as any)?.response?.data?.error ??
      (mutationError as any)?.response?.data?.message ??
      'Something went wrong. Please try again.'
    : null;

  // Loading state for edit mode
  if (isEditMode && isLoadingEmployee) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Page header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          to="/employees"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-semibold">
          {isEditMode ? 'Edit Employee' : 'Add Employee'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Section 1: User Selection */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">User Account</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="userId"
                className="block text-sm font-medium mb-1.5"
              >
                Select User <span className="text-destructive">*</span>
              </label>
              {isEditMode ? (
                <div className="rounded-md border bg-muted px-3 py-2.5 text-sm">
                  {existingEmployee?.user?.fullName ?? 'Unknown'} (
                  {existingEmployee?.user?.username ?? ''})
                </div>
              ) : (
                <select
                  id="userId"
                  {...register('userId', {
                    required: 'Please select a user',
                  })}
                  disabled={loadingUsers}
                  className={cn(
                    'w-full appearance-none rounded-md border bg-background px-3 py-2.5 pr-8 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                    errors.userId && 'border-destructive',
                  )}
                >
                  <option value="">
                    {loadingUsers ? 'Loading users...' : 'Select a user...'}
                  </option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} ({user.username}) - {user.role}
                    </option>
                  ))}
                </select>
              )}
              {errors.userId && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.userId.message}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Employee Details */}
        <section className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-medium mb-4">Employee Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Designation */}
            <div>
              <label
                htmlFor="designation"
                className="block text-sm font-medium mb-1.5"
              >
                Designation
              </label>
              <input
                id="designation"
                type="text"
                {...register('designation')}
                placeholder="e.g. Sales Executive, Store Manager"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Date of Joining */}
            <div>
              <label
                htmlFor="dateOfJoining"
                className="block text-sm font-medium mb-1.5"
              >
                Date of Joining
              </label>
              <input
                id="dateOfJoining"
                type="date"
                {...register('dateOfJoining')}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>

            {/* Salary */}
            <div>
              <label
                htmlFor="salary"
                className="block text-sm font-medium mb-1.5"
              >
                Monthly Salary
              </label>
              <input
                id="salary"
                type="number"
                step="1"
                {...register('salary', {
                  min: { value: 0, message: 'Salary must be positive' },
                })}
                placeholder="0"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.salary && 'border-destructive',
                )}
              />
              {errors.salary && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.salary.message}
                </p>
              )}
            </div>

            {/* Aadhaar Number */}
            <div>
              <label
                htmlFor="aadhaarNumber"
                className="block text-sm font-medium mb-1.5"
              >
                Aadhaar Number
              </label>
              <input
                id="aadhaarNumber"
                type="text"
                {...register('aadhaarNumber', {
                  pattern: {
                    value: /^[0-9]{12}$/,
                    message: 'Enter a valid 12-digit Aadhaar number',
                  },
                })}
                placeholder="e.g. 123456789012"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.aadhaarNumber && 'border-destructive',
                )}
              />
              {errors.aadhaarNumber && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.aadhaarNumber.message}
                </p>
              )}
            </div>

            {/* Emergency Contact */}
            <div>
              <label
                htmlFor="emergencyContact"
                className="block text-sm font-medium mb-1.5"
              >
                Emergency Contact
              </label>
              <input
                id="emergencyContact"
                type="tel"
                {...register('emergencyContact', {
                  pattern: {
                    value: /^[6-9]\d{9}$/,
                    message: 'Enter a valid 10-digit mobile number',
                  },
                })}
                placeholder="e.g. 9876543210"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors.emergencyContact && 'border-destructive',
                )}
              />
              {errors.emergencyContact && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.emergencyContact.message}
                </p>
              )}
            </div>

            {/* Address */}
            <div className="sm:col-span-2">
              <label
                htmlFor="address"
                className="block text-sm font-medium mb-1.5"
              >
                Address
              </label>
              <textarea
                id="address"
                rows={3}
                {...register('address')}
                placeholder="Full residential address"
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2.5 text-sm',
                  'placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                )}
              />
            </div>
          </div>
        </section>

        {/* Error */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {errorMessage}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              'flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                {isEditMode ? 'Update Employee' : 'Save Employee'}
              </>
            )}
          </button>
          <Link
            to="/employees"
            className="rounded-md border px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
