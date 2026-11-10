class ApiConfig {
  ApiConfig(String value, {required bool allowHttp}) {
    final parsed = Uri.tryParse(value.trim());
    if (parsed == null ||
        !parsed.hasAuthority ||
        parsed.host.isEmpty ||
        parsed.userInfo.isNotEmpty ||
        parsed.hasQuery ||
        parsed.hasFragment ||
        !['http', 'https'].contains(parsed.scheme)) {
      throw const FormatException('Set API_BASE_URL to your ERP server URL.');
    }
    if (!allowHttp && parsed.scheme != 'https') {
      throw const FormatException('Release builds require an HTTPS API URL.');
    }
    final serverPath = parsed.path.replaceAll(RegExp(r'/+$'), '');
    baseUrl = parsed.replace(
      path: serverPath.endsWith('/api/v1')
          ? '$serverPath/'
          : '$serverPath/api/v1/',
    );
  }

  late final Uri baseUrl;
}
