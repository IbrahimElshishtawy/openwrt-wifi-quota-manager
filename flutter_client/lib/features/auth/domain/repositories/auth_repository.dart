abstract class AuthRepository {
  Future<String?> getToken();
  Future<void> saveToken(String token);
  Future<void> logout();
  Future<bool> validateToken(String token);
}
