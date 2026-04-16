export enum UserRole {
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
  OTHERS = 'others',
  EMPLOYEE = 'employee',
}

export enum ProductStatus {
  IN_STOCK = 'in_stock',
  SOLD = 'sold',
  TRANSFERRED = 'transferred',
  RETURNED = 'returned',
  DAMAGED = 'damaged',
}

export enum SaleType {
  FULL_PAYMENT = 'full_payment',
  PARTIAL_WITH_PROMISE = 'partial_with_promise',
  SELF_FINANCE = 'self_finance',
  COMPANY_FINANCE = 'company_finance',
}

export enum PaymentMode {
  CASH = 'cash',
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
  UPI = 'upi',
  BANK_TRANSFER = 'bank_transfer',
  CHEQUE = 'cheque',
}

export enum InstallmentStatus {
  UPCOMING = 'upcoming',
  DUE_TODAY = 'due_today',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  OVERDUE = 'overdue',
  RESCHEDULED = 'rescheduled',
}

export enum TransferStatus {
  INITIATED = 'initiated',
  IN_TRANSIT = 'in_transit',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

export enum ExpenseCategory {
  RENT = 'rent',
  ELECTRICITY = 'electricity',
  SALARY = 'salary',
  TRANSPORT = 'transport',
  MAINTENANCE = 'maintenance',
  MARKETING = 'marketing',
  PURCHASE = 'purchase',
  MISC = 'misc',
}

export enum FinancePaymentStatus {
  PENDING = 'pending',
  RECEIVED = 'received',
  OVERDUE = 'overdue',
  PARTIAL = 'partial',
}

export enum FormFieldType {
  TEXT = 'text',
  NUMBER = 'number',
  SELECT = 'select',
  MULTI_SELECT = 'multi_select',
  DATE = 'date',
  TEL = 'tel',
  EMAIL = 'email',
  TEXTAREA = 'textarea',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  FILE = 'file',
  HIDDEN = 'hidden',
}

export enum BankTxnType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum ReconciliationStatus {
  UNMATCHED = 'unmatched',
  MATCHED = 'matched',
  MANUAL_MATCH = 'manual_match',
  DISPUTED = 'disputed',
}
