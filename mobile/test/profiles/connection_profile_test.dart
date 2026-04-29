import 'package:claudecode_mobile/src/profiles/auth_credential.dart';
import 'package:claudecode_mobile/src/profiles/connection_profile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('PasswordCredential', () {
    test('round-trips toJson/fromJson', () {
      const cred = PasswordCredential(password: 'p@ss');
      final json = cred.toJson();
      expect(json['kind'], 'password');
      expect(json['password'], 'p@ss');
      final parsed = AuthCredential.fromJson(json);
      expect(parsed, cred);
    });
  });

  group('PrivateKeyCredential', () {
    test('round-trips with optional passphrase', () {
      const cred = PrivateKeyCredential(
        privateKeyPem: '-----BEGIN OPENSSH PRIVATE KEY-----\nxxx\n',
        passphrase: 'pp',
      );
      final json = cred.toJson();
      expect(json['kind'], 'privateKey');
      expect(json['privateKeyPem'], startsWith('-----BEGIN'));
      expect(json['passphrase'], 'pp');
      final parsed = AuthCredential.fromJson(json);
      expect(parsed, cred);
    });

    test('round-trips without passphrase', () {
      const cred = PrivateKeyCredential(
        privateKeyPem: 'k',
      );
      final parsed = AuthCredential.fromJson(cred.toJson());
      expect(parsed, cred);
    });
  });

  group('AuthCredential.fromJson', () {
    test('throws on unknown kind', () {
      expect(
        () => AuthCredential.fromJson(<String, dynamic>{'kind': 'biometric'}),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('ConnectionProfile', () {
    test('constructor defaults port to 22 when omitted via named', () {
      const profile = ConnectionProfile(
        id: 'id-1',
        label: 'home',
        host: 'example.com',
        username: 'me',
        credential: PasswordCredential(password: 'x'),
        serverPort: 8080,
        serverStartCommand: 'node server.js',
      );
      expect(profile.sshPort, 22);
    });

    test('round-trips toJson/fromJson including nested credential', () {
      const profile = ConnectionProfile(
        id: 'abc',
        label: 'work',
        host: 'h',
        sshPort: 2222,
        username: 'u',
        credential: PrivateKeyCredential(privateKeyPem: 'k'),
        serverPort: 8080,
        serverStartCommand: 'node s.js',
      );
      final json = profile.toJson();
      expect(json['sshPort'], 2222);
      expect((json['credential'] as Map<String, dynamic>)['kind'], 'privateKey');
      final parsed = ConnectionProfile.fromJson(json);
      expect(parsed, profile);
      expect(parsed.hashCode, profile.hashCode);
    });

    test('equality differs when any field differs', () {
      const a = ConnectionProfile(
        id: 'abc',
        label: 'work',
        host: 'h',
        username: 'u',
        credential: PasswordCredential(password: 'x'),
        serverPort: 8080,
        serverStartCommand: 'c',
      );
      const b = ConnectionProfile(
        id: 'abc',
        label: 'work',
        host: 'h',
        username: 'u',
        credential: PasswordCredential(password: 'y'),
        serverPort: 8080,
        serverStartCommand: 'c',
      );
      expect(a, isNot(b));
    });
  });
}
