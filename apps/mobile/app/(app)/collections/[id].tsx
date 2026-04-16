import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { formatINR, formatDateIN, formatPhone } from '@retailerp/shared-utils';
import { useScheduleDetailQuery } from '../../../src/hooks/useCollections';
import LoadingScreen from '../../../src/components/LoadingScreen';

function handleCall(phone: string) {
  const clean = phone.replace(/\s|-/g, '');
  const url = Platform.OS === 'android' ? `tel:${clean}` : `telprompt:${clean}`;
  Linking.openURL(url).catch(() => {});
}

function getInstallmentStatusColor(status: string): string {
  switch (status) {
    case 'paid':
      return '#10B981';
    case 'partially_paid':
      return '#F59E0B';
    case 'overdue':
      return '#EF4444';
    case 'due_today':
      return '#1E40AF';
    case 'upcoming':
      return '#CBD5E1';
    case 'rescheduled':
      return '#8B5CF6';
    default:
      return '#CBD5E1';
  }
}

function getInstallmentStatusLabel(status: string): string {
  switch (status) {
    case 'paid': return 'Paid';
    case 'partially_paid': return 'Partial';
    case 'overdue': return 'Overdue';
    case 'due_today': return 'Due Today';
    case 'upcoming': return 'Upcoming';
    case 'rescheduled': return 'Rescheduled';
    default: return status;
  }
}

export default function SaleDetailScreen() {
  // The id param is actually the scheduleId (employees access via schedule detail)
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheduleQuery = useScheduleDetailQuery(id ?? null);

  if (scheduleQuery.isLoading) {
    return <LoadingScreen message="Loading sale details..." />;
  }

  if (scheduleQuery.isError || !scheduleQuery.data) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Failed to load sale details.</Text>
      </View>
    );
  }

  const schedule = scheduleQuery.data as any;
  const sale = schedule.sale;
  const product = sale?.product;
  const customer = sale?.customer;
  const guarantor = sale?.guarantor;
  const installments = schedule.installments ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: `Sale ${sale?.saleNumber ?? ''}`,
          headerStyle: { backgroundColor: '#1E40AF' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Product Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Product</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Brand</Text>
            <Text style={styles.value}>{product?.brand ?? '-'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Model</Text>
            <Text style={styles.value}>{product?.modelNumber ?? '-'}</Text>
          </View>
          {product?.serialNumber ? (
            <View style={styles.row}>
              <Text style={styles.label}>Serial No</Text>
              <Text style={styles.value}>{product.serialNumber}</Text>
            </View>
          ) : null}
          {product?.category?.name ? (
            <View style={styles.row}>
              <Text style={styles.label}>Category</Text>
              <Text style={styles.value}>{product.category.name}</Text>
            </View>
          ) : null}
        </View>

        {/* Customer Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{customer?.name ?? '-'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Phone</Text>
            <TouchableOpacity onPress={() => customer?.phone && handleCall(customer.phone)}>
              <Text style={styles.phoneValue}>
                {customer?.phone ? formatPhone(customer.phone) : '-'}
              </Text>
            </TouchableOpacity>
          </View>
          {customer?.addressLine1 ? (
            <View style={styles.row}>
              <Text style={styles.label}>Address</Text>
              <Text style={styles.value} numberOfLines={2}>
                {[customer.addressLine1, customer.city].filter(Boolean).join(', ')}
              </Text>
            </View>
          ) : null}
          {customer?.aadhaarNumber ? (
            <View style={styles.row}>
              <Text style={styles.label}>Aadhaar</Text>
              <Text style={styles.value}>{customer.aadhaarNumber}</Text>
            </View>
          ) : null}
        </View>

        {/* Guarantor Card */}
        {guarantor ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Guarantor</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{guarantor.name}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Phone</Text>
              <TouchableOpacity onPress={() => handleCall(guarantor.phone)}>
                <Text style={styles.phoneValue}>{formatPhone(guarantor.phone)}</Text>
              </TouchableOpacity>
            </View>
            {guarantor.addressLine1 ? (
              <View style={styles.row}>
                <Text style={styles.label}>Address</Text>
                <Text style={styles.value} numberOfLines={2}>
                  {[guarantor.addressLine1, guarantor.city].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Sale Info Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sale Information</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Sale #</Text>
            <Text style={styles.value}>{sale?.saleNumber ?? '-'}</Text>
          </View>
          {sale?.ledgerNumber ? (
            <View style={styles.row}>
              <Text style={styles.label}>Ledger #</Text>
              <Text style={styles.value}>{sale.ledgerNumber}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>
              {sale?.saleDate ? formatDateIN(sale.saleDate) : '-'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Type</Text>
            <Text style={styles.value}>
              {(sale?.saleType ?? '').replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total Amount</Text>
            <Text style={styles.valueBold}>
              {formatINR(Number(sale?.totalAmount ?? 0))}
            </Text>
          </View>
          {Number(sale?.downPayment) > 0 ? (
            <View style={styles.row}>
              <Text style={styles.label}>Down Payment</Text>
              <Text style={styles.value}>{formatINR(Number(sale.downPayment))}</Text>
            </View>
          ) : null}
          {sale?.interestRate ? (
            <View style={styles.row}>
              <Text style={styles.label}>Interest Rate</Text>
              <Text style={styles.value}>{sale.interestRate}%</Text>
            </View>
          ) : null}
          {Number(sale?.fileCharge) > 0 ? (
            <View style={styles.row}>
              <Text style={styles.label}>File Charge</Text>
              <Text style={styles.value}>{formatINR(Number(sale.fileCharge))}</Text>
            </View>
          ) : null}
        </View>

        {/* Schedule Summary Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Installment Schedule</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Total Payable</Text>
            <Text style={styles.valueBold}>
              {formatINR(Number(schedule.totalPayable))}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>EMI Amount</Text>
            <Text style={styles.value}>{formatINR(Number(schedule.emiAmount))}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Installments</Text>
            <Text style={styles.value}>{schedule.numInstallments}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, {
              color: schedule.status === 'completed' ? '#10B981'
                : schedule.status === 'active' ? '#1E40AF'
                : '#EF4444',
              fontWeight: '700',
            }]}>
              {(schedule.status ?? '').toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Installment Timeline */}
        {installments.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>EMI Timeline</Text>
            {installments
              .filter((inst: any) => !inst.isRescheduled)
              .map((inst: any) => {
                const statusColor = getInstallmentStatusColor(inst.status);
                return (
                  <View key={inst.id} style={styles.timelineItem}>
                    <View style={[styles.timelineDot, { backgroundColor: statusColor }]} />
                    <View style={styles.timelineContent}>
                      <View style={styles.timelineHeader}>
                        <Text style={styles.timelineEmi}>
                          EMI #{inst.installmentNumber}
                        </Text>
                        <Text style={[styles.timelineStatus, { color: statusColor }]}>
                          {getInstallmentStatusLabel(inst.status)}
                        </Text>
                      </View>
                      <Text style={styles.timelineDate}>
                        Due: {formatDateIN(inst.dueDate)}
                      </Text>
                      <View style={styles.timelineAmounts}>
                        <Text style={styles.timelineAmount}>
                          Due: {formatINR(Number(inst.amountDue))}
                        </Text>
                        {Number(inst.amountPaid) > 0 ? (
                          <Text style={styles.timelinePaid}>
                            Paid: {formatINR(Number(inst.amountPaid))}
                          </Text>
                        ) : null}
                      </View>
                      {/* Show payment details if any */}
                      {inst.payments?.length > 0 ? (
                        <View style={styles.paymentsSection}>
                          {inst.payments.map((p: any) => (
                            <Text key={p.id} style={styles.paymentDetail}>
                              {formatINR(Number(p.amount))} via {p.paymentMode}{' '}
                              {p.collector?.fullName ? `by ${p.collector.fullName}` : ''}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  errorText: {
    fontSize: 16,
    color: '#EF4444',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  label: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
    flex: 1.5,
    textAlign: 'right',
  },
  valueBold: {
    fontSize: 15,
    color: '#0F172A',
    fontWeight: '800',
    flex: 1.5,
    textAlign: 'right',
  },
  phoneValue: {
    fontSize: 14,
    color: '#1E40AF',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingLeft: 4,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    marginRight: 12,
  },
  timelineContent: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  timelineEmi: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  timelineStatus: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  timelineDate: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  timelineAmounts: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineAmount: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  timelinePaid: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
  },
  paymentsSection: {
    marginTop: 4,
  },
  paymentDetail: {
    fontSize: 11,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
});
