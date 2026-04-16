export interface Shop {
  id: string;
  name: string;
  code: string;
  gstNumber: string;
  panNumber: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankBranch?: string;
  logoUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShopListItem {
  id: string;
  name: string;
  code: string;
}
