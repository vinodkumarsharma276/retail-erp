import { ProductStatus } from './enums';

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  parentId?: string;
  level: number;
  path: string;
  displayOrder: number;
  isLeaf: boolean;
  icon?: string;
  hsnCode?: string | null;
  isActive: boolean;
  children?: ProductCategory[];
}

export interface CategoryAttribute {
  id: string;
  categoryId: string;
  attributeName: string;
  attributeLabel: string;
  attributeType: string;
  isRequired: boolean;
  validationRules?: Record<string, unknown>;
  options?: unknown[];
  displayOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  shopId: string;
  categoryId: string;
  brand: string;
  modelNumber: string;
  serialNumber?: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  color?: string;
  weightKg?: number;
  distributorId?: string;
  purchaseId?: string;
  status: ProductStatus;
  dynamicAttributes: Record<string, unknown>;
  warrantyMonths?: number;
  warrantyExpiry?: string;
  barcode?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  purchase?: {
    id: string;
    invoiceDate?: string;
    gstAmount?: number;
    totalAmount?: number;
    discountAmount?: number;
  } | null;
}

export interface ProductAuditTrailEntry {
  id: string;
  productId: string;
  eventType: 'purchased' | 'transferred_out' | 'transferred_in' | 'sold' | 'returned';
  fromShopId?: string;
  toShopId?: string;
  referenceId?: string;
  referenceType?: 'sale' | 'transfer' | 'purchase' | 'return';
  notes?: string;
  performedBy?: string;
  performer?: {
    id: string;
    username: string;
    fullName?: string | null;
  } | null;
  createdAt: string;
}
