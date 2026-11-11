import 'package:flutter_test/flutter_test.dart';
import 'package:retailerp_mobile/core/session_models.dart';
import 'package:retailerp_mobile/features/customer_search/customer_search_page.dart';
import 'package:retailerp_mobile/features/feature_catalog.dart';
import 'fixtures.dart';

void main() {
  const permissions = [
    'nav.sales',
    'nav.installments',
    'nav.customer_search',
    'customer_search.list',
    'nav.expenses',
  ];
  const flags = {
    'mobile_app': true,
    'sales': true,
    'installments': true,
    'customer_search': true,
    'expenses': true,
  };
  List<String> modules(String? role, {Map<String, bool> flags = flags}) =>
      mobileModulesFor(
        Identity.fromJson(
          identityData(permissions: permissions, role: role, flags: flags),
        ),
      ).map((f) => f.id).toList();

  test('non-owners see only Installments and Customer Searching', () {
    for (final role in ['admin', 'accountant', 'others', 'employee', null]) {
      expect(modules(role), [
        'installment',
        'customer-searching',
      ], reason: '$role');
    }
  });

  test('the owner sees every module they are allowed', () {
    expect(modules('owner'), [
      'sales',
      'installment',
      'customer-searching',
      'expenses',
    ]);
  });

  test('permissions and plan still apply on top', () {
    expect(modules('admin', flags: {...flags, 'installments': false}), [
      'customer-searching',
    ]);
    expect(modules('owner', flags: {...flags, 'mobile_app': false}), isEmpty);
  });

  test('counts use Indian digit grouping', () {
    expect(formatCount(7), '7');
    expect(formatCount(20976), '20,976');
    expect(formatCount(123456), '1,23,456');
    expect(formatCount(12345678), '1,23,45,678');
  });
}
