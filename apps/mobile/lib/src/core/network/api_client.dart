import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'ApiException(${statusCode ?? '-'}): $message';
}

/// Thin HTTP client over the marketplace API. The mobile app performs NO
/// business logic: it only calls the API and renders the result.
class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  Future<Map<String, dynamic>> healthLive() async {
    final uri = Uri.parse('$_baseUrl${AppConfig.apiPrefix}/health/live');
    final res = await _client.get(uri).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) {
      throw ApiException('Health check failed', statusCode: res.statusCode);
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  void dispose() => _client.close();
}
