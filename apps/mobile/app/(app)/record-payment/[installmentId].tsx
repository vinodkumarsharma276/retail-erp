import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatINR } from '@retailerp/shared-utils';
import {
  useTodayCollectionsQuery,
  useRecordPaymentMutation,
  type CollectionItem,
  type CollectionsResponse,
} from '../../../src/hooks/useCollections';
import PaymentForm from '../../../src/components/PaymentForm';
import LoadingScreen from '../../../src/components/LoadingScreen';

export default function RecordPaymentScreen() {
  const { installmentId } = useLocalSearchParams<{ installmentId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showSuccess, setShowSuccess] = useState(false);

  const todayQuery = useTodayCollectionsQuery();
  const paymentMutation = useRecordPaymentMutation();

  // Search all cached collection queries (today + any date-specific) for this installment
  const installment: CollectionItem | undefined = useMemo(() => {
    // Check today's data first
    const fromToday = todayQuery.data?.collections.find(
      (c) => c.id === installmentId,
    );
    if (fromToday) return fromToday;

    // Search all cached collection queries (date-specific)
    const allQueries = qc.getQueriesData<CollectionsResponse>({
      queryKey: ['collections'],
    });
    for (const [, data] of allQueries) {
      const found = data?.collections?.find((c) => c.id === installmentId);
      if (found) return found;
    }
    return undefined;
  }, [todayQuery.data, installmentId, qc]);

  if (todayQuery.isLoading && !todayQuery.data) {
    return <LoadingScreen message="Loading installment..." />;
  }

  if (!installment) {
    return (
      <>
        <Stack.Screen options={{ title: 'Record Payment' }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Installment Not Found</Text>
          <Text style={styles.errorSubtitle}>
            This installment may have already been paid or is not in your collection list.
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  // Success screen after payment
  if (showSuccess) {
    return (
      <>
        <Stack.Screen options={{ title: 'Payment Recorded' }} />
        <View style={styles.successContainer}>
          <View style={styles.successCircle}>
            <Text style={styles.successCheck}>{'\u2713'}</Text>
          </View>
          <Text style={styles.successTitle}>Payment Recorded!</Text>
          <Text style={styles.successSubtitle}>
            {installment.schedule.sale.customer.name}
          </Text>
          <Text style={styles.successAmount}>
            {formatINR(installment.remainingAmount)}
          </Text>
          <Text style={styles.successEmi}>
            EMI {installment.installmentNumber} of{' '}
            {installment.schedule.numInstallments}
          </Text>

          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => {
              router.replace('/(app)/collections');
            }}
          >
            <Text style={styles.doneBtnText}>Back to Collections</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: `Collect - ${installment.schedule.sale.customer.name}`,
        }}
      />
      <PaymentForm
        installmentId={installment.id}
        amountDue={installment.amountDue}
        remainingAmount={installment.remainingAmount}
        installmentNumber={installment.installmentNumber}
        totalInstallments={installment.schedule.numInstallments}
        customerName={installment.schedule.sale.customer.name}
        isSubmitting={paymentMutation.isPending}
        onSubmit={(data) => {
          paymentMutation.mutate(data, {
            onSuccess: () => {
              setShowSuccess(true);
            },
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  backBtn: {
    backgroundColor: '#1E40AF',
    borderRadius: 10,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 40,
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successCheck: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '800',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#475569',
    fontWeight: '600',
    marginBottom: 4,
  },
  successAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#10B981',
    marginBottom: 4,
  },
  successEmi: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 40,
  },
  doneBtn: {
    backgroundColor: '#1E40AF',
    borderRadius: 12,
    paddingHorizontal: 40,
    paddingVertical: 16,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
