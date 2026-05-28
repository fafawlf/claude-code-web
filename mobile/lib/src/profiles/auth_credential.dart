sealed class AuthCredential {
  const AuthCredential();

  Map<String, dynamic> toJson();

  static AuthCredential fromJson(Map<String, dynamic> json) {
    final kind = json['kind'];
    switch (kind) {
      case 'password':
        return PasswordCredential(password: json['password'] as String);
      case 'privateKey':
        return PrivateKeyCredential(
          privateKeyPem: json['privateKeyPem'] as String,
          passphrase: json['passphrase'] as String?,
        );
      default:
        throw FormatException('Unknown AuthCredential kind: $kind');
    }
  }
}

class PasswordCredential extends AuthCredential {
  const PasswordCredential({required this.password});

  final String password;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': 'password',
        'password': password,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PasswordCredential &&
          runtimeType == other.runtimeType &&
          password == other.password;

  @override
  int get hashCode => Object.hash(runtimeType, password);
}

class PrivateKeyCredential extends AuthCredential {
  const PrivateKeyCredential({
    required this.privateKeyPem,
    this.passphrase,
  });

  final String privateKeyPem;
  final String? passphrase;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': 'privateKey',
        'privateKeyPem': privateKeyPem,
        if (passphrase != null) 'passphrase': passphrase,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PrivateKeyCredential &&
          runtimeType == other.runtimeType &&
          privateKeyPem == other.privateKeyPem &&
          passphrase == other.passphrase;

  @override
  int get hashCode => Object.hash(runtimeType, privateKeyPem, passphrase);
}
