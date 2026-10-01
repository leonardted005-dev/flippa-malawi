/// Build-time configuration. The API base URL is injected with
/// `--dart-define=API_BASE_URL=...`; the default targets a local API.
class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000',
  );

  static const String apiPrefix = '/api/v1';
}
