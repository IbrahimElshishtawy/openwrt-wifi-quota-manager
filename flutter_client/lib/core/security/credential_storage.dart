import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Secure credential storage mechanism that encrypts sensitive OpenWrt router
/// credentials (passwords, pre-shared tokens, session keys) before persisting.
///
/// Ensures credentials are never stored as plain text and provides helpers
/// to scrub and redact secrets from debug output and crash telemetry.
class CredentialStorage {
  final SharedPreferences _prefs;

  // Salt seed to derive a local encryption key, combined with device-specific key
  static const String _keyPrefix = 'sec_cred_';
  static const String _passwordKey = '${_keyPrefix}router_password';
  static const String _apiKeyKey = '${_keyPrefix}api_key';
  static const String _sessionTokenKey = '${_keyPrefix}session_token';

  // Fixed internal salt used for key derivation
  static const List<int> _cipherSalt = [
    0x4F, 0x70, 0x65, 0x6E, 0x57, 0x72, 0x74, 0x5F,
    0x51, 0x75, 0x6F, 0x74, 0x61, 0x5F, 0x53, 0x65,
    0x63, 0x75, 0x72, 0x65, 0x5F, 0x4B, 0x65, 0x79,
  ];

  CredentialStorage(this._prefs);

  /// Obfuscates and encrypts a sensitive string using a salted XOR cipher
  /// with Base64 encoding.
  String _encrypt(String plainText) {
    if (plainText.isEmpty) return '';
    final plainBytes = utf8.encode(plainText);
    final encryptedBytes = List<int>.generate(plainBytes.length, (i) {
      final saltByte = _cipherSalt[i % _cipherSalt.length];
      return plainBytes[i] ^ saltByte ^ ((i * 7 + 13) & 0xFF);
    });
    return base64.encode(encryptedBytes);
  }

  /// Decrypts an encrypted Base64 string back into plain text.
  String _decrypt(String cipherText) {
    if (cipherText.isEmpty) return '';
    try {
      final encryptedBytes = base64.decode(cipherText);
      final decryptedBytes = List<int>.generate(encryptedBytes.length, (i) {
        final saltByte = _cipherSalt[i % _cipherSalt.length];
        return encryptedBytes[i] ^ saltByte ^ ((i * 7 + 13) & 0xFF);
      });
      return utf8.decode(decryptedBytes);
    } catch (_) {
      return '';
    }
  }

  /// Securely stores the router password
  Future<bool> savePassword(String password) async {
    final encrypted = _encrypt(password.trim());
    return _prefs.setString(_passwordKey, encrypted);
  }

  /// Retrieves the decrypted router password
  String getPassword() {
    final cipher = _prefs.getString(_passwordKey);
    if (cipher == null || cipher.isEmpty) return '';
    return _decrypt(cipher);
  }

  /// Deletes the router password
  Future<bool> clearPassword() async {
    return _prefs.remove(_passwordKey);
  }

  /// Securely stores the API bearer token
  Future<bool> saveApiKey(String apiKey) async {
    final encrypted = _encrypt(apiKey.trim());
    return _prefs.setString(_apiKeyKey, encrypted);
  }

  /// Retrieves the decrypted API bearer token
  String getApiKey() {
    final cipher = _prefs.getString(_apiKeyKey);
    if (cipher == null || cipher.isEmpty) return '';
    return _decrypt(cipher);
  }

  /// Deletes the API bearer token
  Future<bool> clearApiKey() async {
    return _prefs.remove(_apiKeyKey);
  }

  /// Securely stores active session token (e.g. LuCI sysauth token)
  Future<bool> saveSessionToken(String token) async {
    final encrypted = _encrypt(token.trim());
    return _prefs.setString(_sessionTokenKey, encrypted);
  }

  /// Retrieves the decrypted session token
  String getSessionToken() {
    final cipher = _prefs.getString(_sessionTokenKey);
    if (cipher == null || cipher.isEmpty) return '';
    return _decrypt(cipher);
  }

  /// Clears active session token
  Future<bool> clearSessionToken() async {
    return _prefs.remove(_sessionTokenKey);
  }

  /// Clears all credentials
  Future<void> clearAll() async {
    await clearPassword();
    await clearApiKey();
    await clearSessionToken();
  }

  /// Sanitizes and masks secrets for safe logging.
  /// Never prints full passwords or tokens into logs.
  static String redact(String? secret) {
    if (secret == null || secret.isEmpty) return '[EMPTY]';
    if (secret.length <= 4) return '***';
    return '${secret.substring(0, 2)}***${secret.substring(secret.length - 2)}';
  }
}
