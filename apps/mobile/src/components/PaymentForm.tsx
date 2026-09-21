import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { PaymentMode, type PaymentPreview } from '@retailerp/shared-types';
import { formatINR } from '@retailerp/shared-utils';
import apiClient from '../lib/api-client';

/** Today in the device's timezone (toISOString would give the UTC date). */
function localTodayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type Scenario = 'full_payment' | 'reschedule' | 'partial_reschedule';

interface PaymentFormProps {
  installmentId: string;
  amountDue: number;
  remainingAmount: number;
  installmentNumber: number;
  totalInstallments: number;
  customerName: string;
  isSubmitting: boolean;
  onSubmit: (data: {
    installmentId: string;
    scenario?: Scenario;
    amount?: number;
    amountPaid?: number;
    paymentMode?: PaymentMode;
    paymentDate?: string;
    newDate?: string;
    notes?: string;
    applyPenalty?: boolean;
    applyEarlyPaymentDeduction?: boolean;
  }) => void;
}

const PAYMENT_MODES: { label: string; value: PaymentMode }[] = [
  { label: 'Cash', value: PaymentMode.CASH },
  { label: 'UPI', value: PaymentMode.UPI },
  { label: 'Credit Card', value: PaymentMode.CREDIT_CARD },
  { label: 'Debit Card', value: PaymentMode.DEBIT_CARD },
];

const SCENARIO_TABS: { label: string; value: Scenario }[] = [
  { label: 'Full Payment', value: 'full_payment' },
  { label: 'Partial', value: 'partial_reschedule' },
];

export default function PaymentForm({
  installmentId,
  amountDue,
  remainingAmount,
  installmentNumber,
  totalInstallments,
  customerName,
  isSubmitting,
  onSubmit,
}: PaymentFormProps) {
  const [scenario, setScenario] = useState<Scenario>('full_payment');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [amount, setAmount] = useState(String(remainingAmount));
  const [partialAmount, setPartialAmount] = useState('');
  const [newDate, setNewDate] = useState('');
  const [notes, setNotes] = useState('');

  // Penalty and early-payment deduction come from the server for today's
  // date, so the collector sees exactly what will be saved. Both start OFF —
  // the collector decides.
  const today = localTodayIso();
  const previewQuery = useQuery({
    queryKey: ['payment-preview', installmentId, today],
    queryFn: async () => {
      const response = await apiClient.get(`/installments/${installmentId}/payment-preview`, {
        params: { paymentDate: today },
      });
      return response.data.data as PaymentPreview;
    },
  });
  const preview = previewQuery.data;
  const [chargePenalty, setChargePenalty] = useState(false);
  const [giveDeduction, setGiveDeduction] = useState(false);

  const penaltyAvailable = !!preview?.penalty.applicable;
  const deductionAvailable = !!preview?.earlyPayment.applicable && scenario === 'full_payment';
  useEffect(() => {
    if (!penaltyAvailable) setChargePenalty(false);
  }, [penaltyAvailable]);
  useEffect(() => {
    if (!deductionAvailable) setGiveDeduction(false);
  }, [deductionAvailable]);

  const baseDue = preview?.remainingAmount ?? remainingAmount;
  const penaltyCharged = chargePenalty && preview ? preview.penalty.amount : 0;
  // The deduction comes off the LAST installment; it only changes today's
  // amount when this EMI is that last one.
  const deductionOnThisEmi =
    giveDeduction && preview && preview.earlyPayment.targetInstallmentNumbers.includes(preview.installmentNumber)
      ? Math.min(preview.earlyPayment.amount, baseDue + penaltyCharged)
      : 0;
  const toCollect = round2(baseDue + penaltyCharged - deductionOnThisEmi);

  // Keep the full-payment amount in step with the ticks until the collector types.
  const [amountTouched, setAmountTouched] = useState(false);
  useEffect(() => {
    if (!amountTouched) setAmount(String(toCollect));
  }, [toCollect, amountTouched]);

  const partialRemaining = useMemo(() => {
    const paid = parseFloat(partialAmount) || 0;
    return Math.max(0, toCollect - paid);
  }, [partialAmount, toCollect]);

  function validateAndSubmit() {
    if (scenario === 'full_payment') {
      const amt = parseFloat(amount);
      if (!amt || amt < toCollect) {
        Alert.alert('Invalid Amount', `Amount must be at least ${formatINR(toCollect)}`);
        return;
      }
      onSubmit({
        installmentId,
        scenario: 'full_payment',
        amount: amt,
        amountPaid: amt,
        paymentMode,
        paymentDate: today,
        notes: notes.trim() || undefined,
        applyPenalty: chargePenalty,
        applyEarlyPaymentDeduction: giveDeduction,
      });
    } else if (scenario === 'partial_reschedule') {
      const amt = parseFloat(partialAmount);
      if (!amt || amt <= 0 || amt >= toCollect) {
        Alert.alert(
          'Invalid Amount',
          `Partial amount must be between ${formatINR(1)} and less than ${formatINR(toCollect)}.`,
        );
        return;
      }
      // Still recorded as a plain payment — the promise date on this tab is
      // not sent yet (a separate, known gap: case D3 in the audit).
      onSubmit({
        installmentId,
        scenario: 'full_payment',
        amount: amt,
        amountPaid: amt,
        paymentMode,
        paymentDate: today,
        notes: notes.trim() || undefined,
        applyPenalty: chargePenalty,
      });
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.customerName}>{customerName}</Text>
        <Text style={styles.emiInfo}>
          EMI {installmentNumber} of {totalInstallments}
        </Text>
        <Text style={styles.amountDue}>{formatINR(remainingAmount)}</Text>
        <Text style={styles.amountLabel}>Amount Due</Text>
      </View>

      {/* Scenario Tabs */}
      <View style={styles.tabRow}>
        {SCENARIO_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.value}
            style={[styles.tab, scenario === tab.value && styles.tabActive]}
            onPress={() => setScenario(tab.value)}
          >
            <Text
              style={[
                styles.tabText,
                scenario === tab.value && styles.tabTextActive,
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Full Payment Form */}
      {scenario === 'full_payment' && (
        <View style={styles.formSection}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={(value) => {
              setAmountTouched(true);
              setAmount(value);
            }}
            keyboardType="numeric"
            placeholder={String(remainingAmount)}
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.label}>Payment Mode</Text>
          <View style={styles.modeRow}>
            {PAYMENT_MODES.map((mode) => (
              <TouchableOpacity
                key={mode.value}
                style={[
                  styles.modeBtn,
                  paymentMode === mode.value && styles.modeBtnActive,
                ]}
                onPress={() => setPaymentMode(mode.value)}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    paymentMode === mode.value && styles.modeBtnTextActive,
                  ]}
                >
                  {mode.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any notes about this payment"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
          />
        </View>
      )}

      {/* Late penalty — computed by the server; the collector only decides */}
      {preview?.penalty.applicable && (
        <View style={styles.noticeWarn}>
          <Text style={styles.noticeTitleWarn}>
            Late penalty: {formatINR(preview.penalty.perDay)}/day × {preview.penalty.days} day
            {preview.penalty.days === 1 ? '' : 's'} = {formatINR(preview.penalty.amount)}
          </Text>
          {preview.penalty.alreadyCharged > 0 && (
            <Text style={styles.noticeText}>
              {formatINR(preview.penalty.alreadyCharged)} already charged earlier.
            </Text>
          )}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setChargePenalty((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: chargePenalty }}
          >
            <View style={[styles.checkbox, chargePenalty && styles.checkboxActive]} />
            <Text style={styles.checkboxText}>Charge {formatINR(preview.penalty.amount)} penalty</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Early-payment deduction — full payment only, off the last installment */}
      {deductionAvailable && preview && (
        <View style={styles.noticeInfo}>
          <Text style={styles.noticeTitleInfo}>Paid {preview.earlyPayment.daysEarly} days early</Text>
          <Text style={styles.noticeText}>
            This EMI includes {formatINR(preview.earlyPayment.amount)} of the interest charged at sale.
          </Text>
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setGiveDeduction((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: giveDeduction }}
          >
            <View style={[styles.checkbox, giveDeduction && styles.checkboxActive]} />
            <Text style={styles.checkboxText}>
              Deduct {formatINR(preview.earlyPayment.amount)} from the last installment
              {preview.earlyPayment.targetInstallmentNumbers.length === 1
                ? ` (EMI #${preview.earlyPayment.targetInstallmentNumbers[0]})`
                : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {(penaltyCharged > 0 || deductionOnThisEmi > 0) && (
        <Text style={styles.toCollect}>To collect: {formatINR(toCollect)}</Text>
      )}

      {/* Reschedule Form */}
      {scenario === 'reschedule' && (
        <View style={styles.formSection}>
          <Text style={styles.label}>New Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={newDate}
            onChangeText={setNewDate}
            placeholder="2026-05-15"
            placeholderTextColor="#94A3B8"
            keyboardType={Platform.OS === 'ios' ? 'default' : 'default'}
          />

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              The full amount of {formatINR(remainingAmount)} will be rescheduled to
              the new date. No payment is collected now.
            </Text>
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Reason for rescheduling"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
          />
        </View>
      )}

      {/* Partial + Reschedule Form */}
      {scenario === 'partial_reschedule' && (
        <View style={styles.formSection}>
          <Text style={styles.label}>Amount Paid Now</Text>
          <TextInput
            style={styles.input}
            value={partialAmount}
            onChangeText={setPartialAmount}
            keyboardType="numeric"
            placeholder="Enter partial amount"
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.label}>Payment Mode</Text>
          <View style={styles.modeRow}>
            {PAYMENT_MODES.map((mode) => (
              <TouchableOpacity
                key={mode.value}
                style={[
                  styles.modeBtn,
                  paymentMode === mode.value && styles.modeBtnActive,
                ]}
                onPress={() => setPaymentMode(mode.value)}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    paymentMode === mode.value && styles.modeBtnTextActive,
                  ]}
                >
                  {mode.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.remainingBox}>
            <Text style={styles.remainingLabel}>Remaining to Reschedule</Text>
            <Text style={styles.remainingAmount}>{formatINR(partialRemaining)}</Text>
          </View>

          <Text style={styles.label}>New Date for Remaining (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={newDate}
            onChangeText={setNewDate}
            placeholder="2026-05-15"
            placeholderTextColor="#94A3B8"
          />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes about partial payment"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
          />
        </View>
      )}

      {/* Confirm Button */}
      <TouchableOpacity
        style={[styles.confirmBtn, isSubmitting && styles.confirmBtnDisabled]}
        onPress={validateAndSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.confirmBtnText}>
            {scenario === 'full_payment'
              ? 'Confirm Payment'
              : scenario === 'reschedule'
                ? 'Confirm Reschedule'
                : 'Confirm Partial Payment'}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
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
  summaryCard: {
    backgroundColor: '#1E40AF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  customerName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  emiInfo: {
    color: '#BFDBFE',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 12,
  },
  amountDue: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  amountLabel: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#1E40AF',
  },
  formSection: {
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 12,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94A3B8',
  },
  checkboxActive: {
    backgroundColor: '#1E40AF',
    borderColor: '#1E40AF',
  },
  checkboxText: {
    flex: 1,
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  noticeWarn: {
    backgroundColor: '#FEF6E7',
    borderColor: '#F3D9A4',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  noticeInfo: {
    backgroundColor: '#EEEDFD',
    borderColor: '#CBC8F7',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  noticeTitleWarn: {
    color: '#92560A',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  noticeTitleInfo: {
    color: '#3F37C9',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  noticeText: {
    color: '#475569',
    fontSize: 13,
    marginBottom: 4,
  },
  toCollect: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  modeBtnActive: {
    borderColor: '#1E40AF',
    backgroundColor: '#EFF6FF',
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  modeBtnTextActive: {
    color: '#1E40AF',
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 14,
    marginTop: 12,
  },
  infoText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 18,
  },
  remainingBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    padding: 14,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  remainingLabel: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '600',
  },
  remainingAmount: {
    fontSize: 18,
    color: '#92400E',
    fontWeight: '800',
  },
  confirmBtn: {
    backgroundColor: '#1E40AF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
