typedef Json = Map<String, Object?>;

class ApiException implements Exception {
  const ApiException(
    this.message, {
    this.statusCode,
    this.details,
    this.network = false,
  });
  final String message;
  final int? statusCode;

  /// The server's `details` object, e.g. `{code: 'stale'}` on a 409.
  final Json? details;

  /// The server could not be reached (or did not answer in time); the request
  /// may or may not have been carried out.
  final bool network;
  String? get code => details?['code'] as String?;
  @override
  String toString() => message;
}

Json object(Object? value) {
  if (value is! Map<String, dynamic>) {
    throw const ApiException('The server returned an invalid object.');
  }
  return Map<String, Object?>.from(value);
}

String requiredText(Json json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw ApiException('The server returned an invalid $key.');
  }
  return value;
}

class Credentials {
  const Credentials({
    required this.apiUrl,
    required this.tenantSlug,
    required this.accessToken,
    required this.refreshToken,
    required this.shopId,
  });
  factory Credentials.fromJson(Json json) => Credentials(
    apiUrl: requiredText(json, 'apiUrl'),
    tenantSlug: requiredText(json, 'tenantSlug'),
    accessToken: requiredText(json, 'accessToken'),
    refreshToken: requiredText(json, 'refreshToken'),
    shopId: requiredText(json, 'shopId'),
  );
  final String apiUrl;
  final String tenantSlug;
  final String accessToken;
  final String refreshToken;
  final String shopId;
  Credentials withTokens(Json json) => Credentials(
    apiUrl: apiUrl,
    tenantSlug: tenantSlug,
    accessToken: requiredText(json, 'accessToken'),
    refreshToken: requiredText(json, 'refreshToken'),
    shopId: shopId,
  );
  Credentials withShop(String id, String token) => Credentials(
    apiUrl: apiUrl,
    tenantSlug: tenantSlug,
    accessToken: token,
    refreshToken: refreshToken,
    shopId: id,
  );
  Json toJson() => {
    'apiUrl': apiUrl,
    'tenantSlug': tenantSlug,
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'shopId': shopId,
  };
}

class Shop {
  Shop.fromJson(Json json)
    : id = requiredText(json, 'id'),
      name = requiredText(json, 'name'),
      code = requiredText(json, 'code');
  final String id;
  final String name;
  final String code;
  Json toJson() => {'id': id, 'name': name, 'code': code};
}

class Identity {
  Identity.fromJson(Json json) {
    final user = object(json['user']);
    final tenant = object(json['tenant']);
    userId = requiredText(user, 'id');
    fullName = requiredText(user, 'fullName');
    role = user['role'] is String ? user['role'] as String : '';
    tenantId = requiredText(tenant, 'id');
    tenantSlug = requiredText(tenant, 'slug');
    tenantName = requiredText(tenant, 'name');
    final rawPermissions = json['permissions'];
    final rawShops = json['shops'];
    final rawFlags = object(object(json['features'])['flags']);
    if (rawPermissions is! List ||
        rawPermissions.any((p) => p is! String) ||
        rawShops is! List ||
        rawFlags.values.any((flag) => flag is! bool)) {
      throw const ApiException('The server returned invalid access settings.');
    }
    permissions = Set.unmodifiable(rawPermissions.cast<String>());
    flags = Map.unmodifiable(rawFlags.cast<String, bool>());
    shops = List.unmodifiable(rawShops.map((s) => Shop.fromJson(object(s))));
    if (shops.isEmpty) throw const ApiException('No shops are assigned.');
  }
  late final String userId;
  late final String fullName;

  /// The user's role key (`owner`, `admin`, …). Used only to choose which
  /// modules the phone lists; permissions still decide what is allowed.
  late final String role;
  bool get isOwner => role == 'owner';
  late final String tenantId;
  late final String tenantSlug;
  late final String tenantName;
  late final Set<String> permissions;
  late final Map<String, bool> flags;
  late final List<Shop> shops;

  /// The access last confirmed by the server, saved so the app can start
  /// offline and show cached data. Server checks still decide every request.
  Json toJson() => {
    'user': {'id': userId, 'fullName': fullName, 'role': role},
    'tenant': {'id': tenantId, 'slug': tenantSlug, 'name': tenantName},
    'permissions': permissions.toList(),
    'features': {'flags': flags},
    'shops': shops.map((s) => s.toJson()).toList(),
  };

  bool can(String permission, {String? feature}) =>
      permissions.contains(permission) &&
      (feature == null || flags[feature] == true);
}
