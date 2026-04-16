import type { PrismaClient, FormDefinition } from '@prisma/client';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

interface FieldSeed {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  placeholder?: string;
  defaultValue?: string;
  isRequired: boolean;
  validationRules?: Record<string, unknown>;
  options?: unknown;
  displayOrder: number;
  sectionName: string;
  isVisible: boolean;
  cssClass?: string;
  dependsOn?: Record<string, unknown>;
}

const customerFields: FieldSeed[] = [
  // Section: Basic Info
  {
    fieldName: 'name',
    fieldLabel: 'Customer Name',
    fieldType: 'text',
    isRequired: true,
    displayOrder: 0,
    sectionName: 'Basic Info',
    isVisible: true,
  },
  {
    fieldName: 'phone',
    fieldLabel: 'Phone',
    fieldType: 'tel',
    placeholder: '10-digit mobile',
    isRequired: true,
    validationRules: { pattern: '^[6-9]\\d{9}$', message: 'Enter a valid 10-digit mobile number' },
    displayOrder: 1,
    sectionName: 'Basic Info',
    isVisible: true,
  },
  {
    fieldName: 'altPhone',
    fieldLabel: 'Alternate Phone',
    fieldType: 'tel',
    isRequired: false,
    displayOrder: 2,
    sectionName: 'Basic Info',
    isVisible: true,
  },
  {
    fieldName: 'aadhaarNumber',
    fieldLabel: 'Aadhaar Number',
    fieldType: 'text',
    placeholder: '12-digit Aadhaar',
    isRequired: false,
    validationRules: { pattern: '^\\d{12}$', message: 'Enter a valid 12-digit Aadhaar number' },
    displayOrder: 3,
    sectionName: 'Basic Info',
    isVisible: true,
  },
  // Section: Address
  {
    fieldName: 'addressLine1',
    fieldLabel: 'Address Line 1',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 4,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'addressLine2',
    fieldLabel: 'Address Line 2',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 5,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'city',
    fieldLabel: 'City',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 6,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'state',
    fieldLabel: 'State',
    fieldType: 'select',
    isRequired: false,
    options: INDIAN_STATES.map((s) => ({ label: s, value: s })),
    displayOrder: 7,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'pincode',
    fieldLabel: 'Pincode',
    fieldType: 'text',
    placeholder: '6-digit',
    isRequired: false,
    validationRules: { pattern: '^\\d{6}$', message: 'Enter a valid 6-digit pincode' },
    displayOrder: 8,
    sectionName: 'Address',
    isVisible: true,
  },
  // Section: Identity
  {
    fieldName: 'photoIdUrl',
    fieldLabel: 'Photo ID',
    fieldType: 'file',
    isRequired: false,
    displayOrder: 9,
    sectionName: 'Identity',
    isVisible: true,
  },
];

const distributorFields: FieldSeed[] = [
  // Section: Company Info
  {
    fieldName: 'companyName',
    fieldLabel: 'Company Name',
    fieldType: 'text',
    isRequired: true,
    displayOrder: 0,
    sectionName: 'Company Info',
    isVisible: true,
  },
  {
    fieldName: 'contactPerson',
    fieldLabel: 'Contact Person',
    fieldType: 'text',
    isRequired: true,
    displayOrder: 1,
    sectionName: 'Company Info',
    isVisible: true,
  },
  {
    fieldName: 'phone',
    fieldLabel: 'Phone',
    fieldType: 'tel',
    isRequired: true,
    validationRules: { pattern: '^[6-9]\\d{9}$', message: 'Enter a valid 10-digit mobile number' },
    displayOrder: 2,
    sectionName: 'Company Info',
    isVisible: true,
  },
  {
    fieldName: 'altPhone',
    fieldLabel: 'Alternate Phone',
    fieldType: 'tel',
    isRequired: false,
    displayOrder: 3,
    sectionName: 'Company Info',
    isVisible: true,
  },
  {
    fieldName: 'email',
    fieldLabel: 'Email',
    fieldType: 'email',
    isRequired: false,
    displayOrder: 4,
    sectionName: 'Company Info',
    isVisible: true,
  },
  // Section: Tax & Legal
  {
    fieldName: 'gstNumber',
    fieldLabel: 'GST Number',
    fieldType: 'text',
    placeholder: '15-char GSTIN',
    isRequired: false,
    validationRules: { pattern: '^\\d{2}[A-Z]{5}\\d{4}[A-Z]{1}[A-Z\\d]{1}[Z]{1}[A-Z\\d]{1}$', message: 'Enter a valid 15-character GSTIN' },
    displayOrder: 5,
    sectionName: 'Tax & Legal',
    isVisible: true,
  },
  {
    fieldName: 'panNumber',
    fieldLabel: 'PAN Number',
    fieldType: 'text',
    placeholder: '10-char PAN',
    isRequired: false,
    validationRules: { pattern: '^[A-Z]{5}\\d{4}[A-Z]{1}$', message: 'Enter a valid 10-character PAN' },
    displayOrder: 6,
    sectionName: 'Tax & Legal',
    isVisible: true,
  },
  // Section: Address
  {
    fieldName: 'addressLine1',
    fieldLabel: 'Address Line 1',
    fieldType: 'text',
    isRequired: true,
    displayOrder: 7,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'addressLine2',
    fieldLabel: 'Address Line 2',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 8,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'city',
    fieldLabel: 'City',
    fieldType: 'text',
    isRequired: true,
    displayOrder: 9,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'state',
    fieldLabel: 'State',
    fieldType: 'select',
    isRequired: false,
    options: INDIAN_STATES.map((s) => ({ label: s, value: s })),
    displayOrder: 10,
    sectionName: 'Address',
    isVisible: true,
  },
  {
    fieldName: 'pincode',
    fieldLabel: 'Pincode',
    fieldType: 'text',
    placeholder: '6-digit',
    isRequired: true,
    validationRules: { pattern: '^\\d{6}$', message: 'Enter a valid 6-digit pincode' },
    displayOrder: 11,
    sectionName: 'Address',
    isVisible: true,
  },
  // Section: Bank Details
  {
    fieldName: 'bankName',
    fieldLabel: 'Bank Name',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 12,
    sectionName: 'Bank Details',
    isVisible: true,
  },
  {
    fieldName: 'bankAccountNumber',
    fieldLabel: 'Bank Account Number',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 13,
    sectionName: 'Bank Details',
    isVisible: true,
  },
  {
    fieldName: 'bankIfsc',
    fieldLabel: 'IFSC Code',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 14,
    sectionName: 'Bank Details',
    isVisible: true,
  },
  {
    fieldName: 'bankBranch',
    fieldLabel: 'Bank Branch',
    fieldType: 'text',
    isRequired: false,
    displayOrder: 15,
    sectionName: 'Bank Details',
    isVisible: true,
  },
  // Section: Terms
  {
    fieldName: 'paymentTerms',
    fieldLabel: 'Payment Terms',
    fieldType: 'text',
    placeholder: 'e.g. Net 30',
    isRequired: false,
    displayOrder: 16,
    sectionName: 'Terms',
    isVisible: true,
  },
  {
    fieldName: 'creditLimit',
    fieldLabel: 'Credit Limit',
    fieldType: 'number',
    isRequired: false,
    displayOrder: 17,
    sectionName: 'Terms',
    isVisible: true,
  },
];

const saleFields: FieldSeed[] = [
  // Section: Sale Info
  {
    fieldName: 'ledgerNumber',
    fieldLabel: 'Ledger Number',
    fieldType: 'text',
    placeholder: 'Office register number',
    isRequired: true,
    displayOrder: 0,
    sectionName: 'Sale Info',
    isVisible: true,
  },
  {
    fieldName: 'saleType',
    fieldLabel: 'Sale Type',
    fieldType: 'select',
    isRequired: true,
    options: [
      { label: 'Full Payment', value: 'full_payment' },
      { label: 'Partial', value: 'partial_with_promise' },
      { label: 'Self Finance', value: 'self_finance' },
      { label: 'Company Finance', value: 'company_finance' },
    ],
    displayOrder: 1,
    sectionName: 'Sale Info',
    isVisible: true,
  },
  // Section: Payment
  {
    fieldName: 'downPayment',
    fieldLabel: 'Down Payment',
    fieldType: 'number',
    isRequired: false,
    displayOrder: 2,
    sectionName: 'Payment',
    isVisible: true,
  },
  {
    fieldName: 'paymentMode',
    fieldLabel: 'Payment Mode',
    fieldType: 'select',
    isRequired: false,
    options: [
      { label: 'Cash', value: 'cash' },
      { label: 'Credit Card', value: 'credit_card' },
      { label: 'Debit Card', value: 'debit_card' },
      { label: 'UPI', value: 'upi' },
    ],
    displayOrder: 3,
    sectionName: 'Payment',
    isVisible: true,
  },
  // Section: Self Finance
  {
    fieldName: 'interestRate',
    fieldLabel: 'Interest Rate',
    fieldType: 'select',
    isRequired: false,
    options: [
      { label: '1%', value: '1' },
      { label: '1.5%', value: '1.5' },
      { label: '2%', value: '2' },
      { label: '2.5%', value: '2.5' },
      { label: '3%', value: '3' },
    ],
    displayOrder: 4,
    sectionName: 'Self Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'self_finance' },
  },
  {
    fieldName: 'fileCharge',
    fieldLabel: 'File Charge',
    fieldType: 'number',
    isRequired: false,
    displayOrder: 5,
    sectionName: 'Self Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'self_finance' },
  },
  {
    fieldName: 'numInstallments',
    fieldLabel: 'Number of Installments',
    fieldType: 'select',
    isRequired: false,
    options: [
      { label: '3', value: '3' },
      { label: '6', value: '6' },
      { label: '9', value: '9' },
      { label: '12', value: '12' },
      { label: '15', value: '15' },
      { label: '18', value: '18' },
      { label: '24', value: '24' },
    ],
    displayOrder: 6,
    sectionName: 'Self Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'self_finance' },
  },
  // Section: Company Finance
  {
    fieldName: 'financeCompanyId',
    fieldLabel: 'Finance Company',
    fieldType: 'select',
    isRequired: false,
    displayOrder: 7,
    sectionName: 'Company Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'company_finance' },
  },
  {
    fieldName: 'financedAmount',
    fieldLabel: 'Financed Amount',
    fieldType: 'number',
    isRequired: false,
    displayOrder: 8,
    sectionName: 'Company Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'company_finance' },
  },
  {
    fieldName: 'expectedPaymentDate',
    fieldLabel: 'Expected Payment Date',
    fieldType: 'date',
    isRequired: false,
    displayOrder: 9,
    sectionName: 'Company Finance',
    isVisible: true,
    dependsOn: { field: 'saleType', value: 'company_finance' },
  },
];

export async function seedFormDefinitions(prisma: PrismaClient): Promise<FormDefinition[]> {
  const formConfigs = [
    { formName: 'customer', description: 'Customer registration and details form', fields: customerFields },
    { formName: 'distributor', description: 'Distributor/supplier registration form', fields: distributorFields },
    { formName: 'sale', description: 'Sale recording form with conditional finance sections', fields: saleFields },
  ];

  const definitions: FormDefinition[] = [];

  for (const config of formConfigs) {
    // Check if definition already exists
    const existing = await prisma.formDefinition.findFirst({
      where: { formName: config.formName, shopId: null },
    });

    if (existing) {
      definitions.push(existing);
      continue;
    }

    const definition = await prisma.formDefinition.create({
      data: {
        formName: config.formName,
        shopId: null,
        version: 1,
        isActive: true,
        description: config.description,
        fields: {
          create: config.fields.map((f) => ({
            fieldName: f.fieldName,
            fieldLabel: f.fieldLabel,
            fieldType: f.fieldType as any,
            placeholder: f.placeholder ?? null,
            defaultValue: f.defaultValue ?? null,
            isRequired: f.isRequired,
            validationRules: f.validationRules ?? undefined,
            options: f.options ?? undefined,
            displayOrder: f.displayOrder,
            sectionName: f.sectionName,
            isVisible: f.isVisible,
            cssClass: f.cssClass ?? null,
            dependsOn: f.dependsOn ?? undefined,
          })),
        },
      },
    });

    definitions.push(definition);
  }

  return definitions;
}
