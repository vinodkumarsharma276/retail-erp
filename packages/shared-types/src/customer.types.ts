export interface Customer {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  altPhone?: string;
  aadhaarNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  photoIdUrl?: string;
  isGuarantor: boolean;
  guarantorId?: string;
  dynamicAttributes: Record<string, unknown>;
  shopId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Joined relation, populated by list / detail endpoints. Useful in
  // "All Shops" mode to render a Shop column without a second lookup.
  shop?: {
    id: string;
    name: string;
    code: string;
  } | null;
}
