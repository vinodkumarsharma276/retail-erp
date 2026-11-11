import 'dart:convert';
import '../../core/session_models.dart';

/// One register entry as kept on the device. Fields the server withheld
/// (phones without `customers.view_phone`) are null, never an empty value.
class RegisterEntry {
  RegisterEntry({
    required this.id,
    required this.shopId,
    required this.accountNumber,
    required this.prefix,
    required this.seriesNo,
    required this.customerId,
    required this.customerName,
    required this.mobile,
    required this.address,
    required this.area,
    required this.coCustomerId,
    required this.coName,
    required this.coMobile,
    required this.purchaseDate,
    required this.categoryId,
    required this.product,
    required this.brand,
    required this.model,
    required this.issues,
    required this.rawValues,
    required this.source,
    required this.customerCode,
    required this.coCustomerCode,
    required this.createdAt,
    required this.updatedAt,
    this.customerItemCount = 0,
  });

  factory RegisterEntry.fromApi(Json json) => RegisterEntry(
    id: requiredText(json, 'id'),
    shopId: requiredText(json, 'shopId'),
    accountNumber: (json['accountNumber'] as String?) ?? '',
    prefix: (json['prefix'] as String?) ?? '',
    seriesNo: (json['seriesNo'] as num?)?.toInt(),
    customerId: json['customerId'] as String?,
    customerName: (json['customerName'] as String?) ?? '',
    mobile: json['mobile'] as String?,
    address: json['address'] as String?,
    area: json['area'] as String?,
    coCustomerId: json['coCustomerId'] as String?,
    coName: json['coName'] as String?,
    coMobile: json['coMobile'] as String?,
    purchaseDate: json['purchaseDate'] as String?,
    categoryId: json['categoryId'] as String?,
    product: json['product'] as String?,
    brand: json['brand'] as String?,
    model: json['model'] as String?,
    issues: ((json['issues'] as List?) ?? const []).cast<String>(),
    rawValues: json['rawValues'] is Map
        ? Map<String, Object?>.from(json['rawValues'] as Map)
        : null,
    source: (json['source'] as String?) ?? 'app',
    customerCode: json['customerCode'] as String?,
    coCustomerCode: json['coCustomerCode'] as String?,
    createdAt: (json['createdAt'] as String?) ?? '',
    updatedAt: (json['updatedAt'] as String?) ?? '',
  );

  factory RegisterEntry.fromRow(Map<String, Object?> row) => RegisterEntry(
    id: row['id'] as String,
    shopId: row['shop_id'] as String,
    accountNumber: row['account_number'] as String,
    prefix: row['prefix'] as String,
    seriesNo: row['series_no'] as int?,
    customerId: row['customer_id'] as String?,
    customerName: row['customer_name'] as String,
    mobile: row['mobile'] as String?,
    address: row['address'] as String?,
    area: row['area'] as String?,
    coCustomerId: row['co_customer_id'] as String?,
    coName: row['co_name'] as String?,
    coMobile: row['co_mobile'] as String?,
    purchaseDate: row['purchase_date'] as String?,
    categoryId: row['category_id'] as String?,
    product: row['product'] as String?,
    brand: row['brand'] as String?,
    model: row['model'] as String?,
    issues: (jsonDecode(row['issues'] as String) as List).cast<String>(),
    rawValues: row['raw_values'] == null
        ? null
        : Map<String, Object?>.from(
            jsonDecode(row['raw_values'] as String) as Map,
          ),
    source: row['source'] as String,
    customerCode: row['customer_code'] as String?,
    coCustomerCode: row['co_customer_code'] as String?,
    createdAt: row['created_at'] as String,
    updatedAt: row['updated_at'] as String,
    customerItemCount: (row['item_count'] as int?) ?? 0,
  );

  final String id;
  final String shopId;
  final String accountNumber;
  final String prefix;
  final int? seriesNo;
  final String? customerId;
  final String customerName;
  final String? mobile;
  final String? address;
  final String? area;
  final String? coCustomerId;
  final String? coName;
  final String? coMobile;

  /// `yyyy-mm-dd`, a date without a time zone.
  final String? purchaseDate;
  final String? categoryId;
  final String? product;
  final String? brand;
  final String? model;
  final List<String> issues;
  final Json? rawValues;
  final String source;
  final String? customerCode;
  final String? coCustomerCode;
  final String createdAt;
  final String updatedAt;
  final int customerItemCount;

  /// Text searched by the free-text box, matching the web's per-field
  /// substring search. Fields are separated so a match can't span two.
  String get searchText => [
    customerName,
    coName,
    area,
    product,
    brand,
    model,
    customerCode,
  ].map((v) => (v ?? '').toLowerCase()).join('\u0001');

  Map<String, Object?> toRow() => {
    'id': id,
    'shop_id': shopId,
    'account_number': accountNumber,
    'prefix': prefix,
    'series_no': seriesNo,
    'customer_id': customerId,
    'customer_name': customerName,
    'mobile': mobile,
    'address': address,
    'area': area,
    'co_customer_id': coCustomerId,
    'co_name': coName,
    'co_mobile': coMobile,
    'purchase_date': purchaseDate,
    'category_id': categoryId,
    'product': product,
    'brand': brand,
    'model': model,
    'issues': jsonEncode(issues),
    'raw_values': rawValues == null ? null : jsonEncode(rawValues),
    'source': source,
    'customer_code': customerCode,
    'co_customer_code': coCustomerCode,
    'created_at': createdAt,
    'updated_at': updatedAt,
    'search_text': searchText,
  };
}

class RegisterShop {
  const RegisterShop(this.id, this.name, this.code);
  final String id;
  final String name;
  final String code;
}

class RegisterCategory {
  const RegisterCategory({
    required this.id,
    required this.name,
    required this.parentId,
    required this.path,
    required this.level,
    required this.isLeaf,
    required this.isActive,
    required this.displayOrder,
  });
  final String id;
  final String name;
  final String? parentId;
  final String path;
  final int level;
  final bool isLeaf;
  final bool isActive;
  final int displayOrder;
}

/// Labels for `issues` codes — the same text as REGISTER_ISSUES on the web.
const registerIssueLabels = {
  'duplicate_account': 'Account number used more than once',
  'missing_account': 'No account number',
  'odd_account': 'Account number in an unusual format',
  'missing_name': 'No customer name',
  'missing_mobile': 'No mobile number',
  'invalid_mobile': 'Mobile number not valid',
  'missing_date': 'No purchase date',
  'invalid_date': 'Purchase date not readable',
  'future_date': 'Purchase date is in the future',
  'co_incomplete': 'Co-applicant details incomplete',
  'no_product_type': 'No product type',
  'items_unknown': 'Several items, details unknown',
};

/// The web's `normalizeMobile`: last 10 digits, or '' when fewer.
String normalizeMobile(String value) {
  final digits = value.replaceAll(RegExp(r'\D'), '');
  return digits.length >= 10 ? digits.substring(digits.length - 10) : '';
}

/// The web's `isValidMobile`: an Indian mobile, 10 digits starting 6-9.
bool isValidMobile(String value) =>
    RegExp(r'^[6-9]\d{9}$').hasMatch(normalizeMobile(value));

/// The web's `normalizeAccountNumber`: upper case, no spaces.
String normalizeAccountNumber(String value) =>
    value.toUpperCase().replaceAll(RegExp(r'\s+'), '');

/// Which column the search box looks in ("All" = every searchable column,
/// as on the web).
enum RegisterField {
  all('All'),
  account('Account number'),
  name('Customer name'),
  mobile('Mobile'),
  coApplicant('Co-applicant'),
  area('Area'),
  product('Product');

  const RegisterField(this.label);
  final String label;
}

class RegisterQuery {
  const RegisterQuery({
    this.text = '',
    this.field = RegisterField.all,
    this.prefix,
    this.issue,
    this.shopId,
    this.categoryId,
    this.area,
    this.customerId,
    this.dateFrom,
    this.dateTo,
  });
  final String text;
  final RegisterField field;
  final String? prefix;

  /// `any` or an issue code.
  final String? issue;
  final String? shopId;

  /// A type (and every type below it), or `none`.
  final String? categoryId;
  final String? area;
  final String? customerId;
  final String? dateFrom;
  final String? dateTo;

  bool get hasFilters =>
      prefix != null ||
      issue != null ||
      shopId != null ||
      categoryId != null ||
      (area ?? '').isNotEmpty ||
      customerId != null ||
      dateFrom != null ||
      dateTo != null;

  RegisterQuery copyWith({
    String? text,
    RegisterField? field,
    String? Function()? prefix,
    String? Function()? issue,
    String? Function()? shopId,
    String? Function()? categoryId,
    String? Function()? area,
    String? Function()? dateFrom,
    String? Function()? dateTo,
  }) => RegisterQuery(
    text: text ?? this.text,
    field: field ?? this.field,
    prefix: prefix != null ? prefix() : this.prefix,
    issue: issue != null ? issue() : this.issue,
    shopId: shopId != null ? shopId() : this.shopId,
    categoryId: categoryId != null ? categoryId() : this.categoryId,
    area: area != null ? area() : this.area,
    customerId: customerId,
    dateFrom: dateFrom != null ? dateFrom() : this.dateFrom,
    dateTo: dateTo != null ? dateTo() : this.dateTo,
  );
}

class RegisterPage {
  const RegisterPage(this.entries, this.total);
  final List<RegisterEntry> entries;
  final int total;
}
