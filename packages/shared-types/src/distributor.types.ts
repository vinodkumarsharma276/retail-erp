export interface Distributor {
  id: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  altPhone?: string;
  email?: string;
  gstNumber?: string;
  panNumber?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankBranch?: string;
  paymentTerms?: string;
  creditLimit: number;
  dynamicAttributes: Record<string, unknown>;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DistributorListItem extends Distributor {
  totalProductsPurchased: number;
  totalPaymentPaid: number;
  /** Bills minus payments; below zero when an advance is waiting for the next bill. */
  pendingPayment: number;
  /** Paid in advance and not yet used against a bill. */
  advanceBalance?: number;
}
