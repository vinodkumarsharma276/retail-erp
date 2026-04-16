import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatINR } from '@retailerp/shared-utils';
import {
  useTodayCollectionsQuery,
  useCollectionsForDateQuery,
  type CollectionItem,
} from '../../../src/hooks/useCollections';
import CollectionCard from '../../../src/components/CollectionCard';
import LoadingScreen from '../../../src/components/LoadingScreen';

export default function CollectionsScreen() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showDateInput, setShowDateInput] = useState(false);
  const [dateInput, setDateInput] = useState('');

  // Today's query (default view)
  const todayQuery = useTodayCollectionsQuery();

  // Date-specific query (when user picks a date)
  const dateQuery = useCollectionsForDateQuery(selectedDate);

  const activeQuery = selectedDate ? dateQuery : todayQuery;
  const collections = activeQuery.data?.collections ?? [];

  // Summary calculations
  const summary = useMemo(() => {
    const pending = collections.filter((c) => c.status !== 'paid');
    const totalPending = pending.reduce((sum, c) => sum + c.remainingAmount, 0);
    const paid = collections.filter((c) => c.status === 'paid');
    const totalCollected = paid.reduce((sum, c) => sum + c.amountDue, 0);
    return {
      total: collections.length,
      pendingCount: pending.length,
      totalPending,
      paidCount: paid.length,
      totalCollected,
    };
  }, [collections]);

  const handleViewSale = useCallback(
    (scheduleId: string) => {
      router.push({
        pathname: '/(app)/collections/[id]',
        params: { id: scheduleId },
      });
    },
    [router],
  );

  const handleCollectPayment = useCallback(
    (installmentId: string) => {
      router.push({
        pathname: '/(app)/record-payment/[installmentId]',
        params: { installmentId },
      });
    },
    [router],
  );

  function applyDate() {
    if (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      setSelectedDate(dateInput);
      setShowDateInput(false);
    }
  }

  function clearDate() {
    setSelectedDate(null);
    setDateInput('');
    setShowDateInput(false);
  }

  const renderItem = useCallback(
    ({ item }: { item: CollectionItem }) => (
      <CollectionCard
        item={item}
        onViewSale={handleViewSale}
        onCollectPayment={handleCollectPayment}
      />
    ),
    [handleViewSale, handleCollectPayment],
  );

  const keyExtractor = useCallback((item: CollectionItem) => item.id, []);

  if (activeQuery.isLoading && !activeQuery.data) {
    return <LoadingScreen message="Loading collections..." />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{summary.total}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: '#F59E0B' }]}>
            {summary.pendingCount}
          </Text>
          <Text style={styles.summaryLabel}>Pending</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: '#EF4444' }]}>
            {formatINR(summary.totalPending)}
          </Text>
          <Text style={styles.summaryLabel}>To Collect</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: '#10B981' }]}>
            {summary.paidCount}
          </Text>
          <Text style={styles.summaryLabel}>Collected</Text>
        </View>
      </View>

      {/* Date Picker Row */}
      <View style={styles.dateRow}>
        <Text style={styles.dateLabel}>
          {selectedDate
            ? `Collections for ${selectedDate}`
            : "Today's Collections"}
        </Text>
        <View style={styles.dateActions}>
          {selectedDate ? (
            <TouchableOpacity style={styles.dateBtnSmall} onPress={clearDate}>
              <Text style={styles.dateBtnSmallText}>Today</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.dateBtnSmall}
            onPress={() => setShowDateInput(!showDateInput)}
          >
            <Text style={styles.dateBtnSmallText}>
              {showDateInput ? 'Cancel' : 'Pick Date'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {showDateInput && (
        <View style={styles.dateInputRow}>
          <TextInput
            style={styles.dateInput}
            value={dateInput}
            onChangeText={setDateInput}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#94A3B8"
            keyboardType={Platform.OS === 'ios' ? 'default' : 'default'}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.dateGoBtn} onPress={applyDate}>
            <Text style={styles.dateGoBtnText}>Go</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Collection List */}
      <FlatList
        data={collections}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={activeQuery.isRefetching}
            onRefresh={() => activeQuery.refetch()}
            tintColor="#1E40AF"
            colors={['#1E40AF']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u2714'}</Text>
            <Text style={styles.emptyTitle}>No Collections</Text>
            <Text style={styles.emptySubtitle}>
              {selectedDate
                ? `No installments due on ${selectedDate}.`
                : 'No installments due today. You are all caught up!'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 2,
  },
  summaryNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  dateActions: {
    flexDirection: 'row',
    gap: 8,
  },
  dateBtnSmall: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  dateBtnSmallText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E40AF',
  },
  dateInputRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 8,
  },
  dateInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  dateGoBtn: {
    backgroundColor: '#1E40AF',
    borderRadius: 8,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  dateGoBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 24,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    color: '#10B981',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
});
