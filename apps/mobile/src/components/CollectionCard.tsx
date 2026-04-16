import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { formatINR, formatDateIN } from '@retailerp/shared-utils';
import type { CollectionItem } from '../hooks/useCollections';

interface CollectionCardProps {
  item: CollectionItem;
  onViewSale: (scheduleId: string) => void;
  onCollectPayment: (installmentId: string) => void;
}

function getStatusColor(status: string): string {
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
      return '#64748B';
    case 'rescheduled':
      return '#8B5CF6';
    default:
      return '#64748B';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'partially_paid':
      return 'Partial';
    case 'overdue':
      return 'Overdue';
    case 'due_today':
      return 'Due Today';
    case 'upcoming':
      return 'Upcoming';
    case 'rescheduled':
      return 'Rescheduled';
    default:
      return status;
  }
}

function handleCallCustomer(phone: string) {
  const cleanPhone = phone.replace(/\s|-/g, '');
  const telUrl = Platform.OS === 'android'
    ? `tel:${cleanPhone}`
    : `telprompt:${cleanPhone}`;
  Linking.openURL(telUrl).catch(() => {});
}

export default function CollectionCard({
  item,
  onViewSale,
  onCollectPayment,
}: CollectionCardProps) {
  const { schedule } = item;
  const { sale } = schedule;
  const customer = sale.customer;
  const product = sale.product;
  const statusColor = getStatusColor(item.status);
  const isPaid = item.status === 'paid';

  const address = [customer.addressLine1, customer.addressLine2, customer.city, customer.pincode]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[styles.card, isPaid && styles.cardPaid]}>
      {/* Status badge */}
      <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
        <Text style={styles.statusText}>{getStatusLabel(item.status)}</Text>
      </View>

      {/* Customer name and phone */}
      <View style={styles.headerRow}>
        <Text style={styles.customerName} numberOfLines={1}>
          {customer.name}
        </Text>
        <TouchableOpacity onPress={() => handleCallCustomer(customer.phone)}>
          <Text style={styles.phoneLink}>{customer.phone}</Text>
        </TouchableOpacity>
      </View>

      {/* Product info */}
      <Text style={styles.productText} numberOfLines={1}>
        {product.brand} {product.modelNumber}
        {product.category?.name ? ` - ${product.category.name}` : ''}
      </Text>

      {/* EMI info */}
      <View style={styles.emiRow}>
        <Text style={styles.emiLabel}>
          EMI {item.installmentNumber} of {schedule.numInstallments}
        </Text>
        <Text style={styles.amount}>{formatINR(item.remainingAmount)}</Text>
      </View>

      {/* Due date */}
      <Text style={styles.dateText}>Due: {formatDateIN(item.dueDate)}</Text>

      {/* Address */}
      {address ? (
        <Text style={styles.addressText} numberOfLines={2}>
          {address}
        </Text>
      ) : null}

      {/* Rescheduled note */}
      {item.rescheduledFrom ? (
        <View style={styles.rescheduledNote}>
          <Text style={styles.rescheduledText}>
            Rescheduled from EMI #{item.rescheduledFrom.installmentNumber} (
            {formatDateIN(item.rescheduledFrom.dueDate)})
          </Text>
        </View>
      ) : null}

      {/* Action buttons */}
      {!isPaid && (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={() => onViewSale(item.scheduleId)}
          >
            <Text style={styles.btnSecondaryText}>Sale Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => onCollectPayment(item.id)}
          >
            <Text style={styles.btnPrimaryText}>Collect Payment</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPaid: {
    opacity: 0.6,
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingRight: 80,
  },
  customerName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  phoneLink: {
    fontSize: 13,
    color: '#1E40AF',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  productText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 10,
  },
  emiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  emiLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  amount: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  dateText: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 6,
  },
  addressText: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 8,
  },
  rescheduledNote: {
    backgroundColor: '#F5F3FF',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  rescheduledText: {
    fontSize: 11,
    color: '#7C3AED',
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  btnSecondary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#1E40AF',
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: '#1E40AF',
    fontSize: 14,
    fontWeight: '600',
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1E40AF',
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
