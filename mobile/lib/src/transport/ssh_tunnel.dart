import 'dart:async';
import 'dart:typed_data';

import 'package:dartssh2/dartssh2.dart';

import '../profiles/auth_credential.dart';
import '../profiles/connection_profile.dart';
import '../profiles/host_key_store.dart';
import 'ssh_socket_adapter.dart';

typedef ConfirmUnknownHost = Future<bool> Function(
  String keyType,
  Uint8List fingerprint,
);

/// Decision-only host-key verifier. Takes a [ConfirmUnknownHost] callback for
/// the UI; on mismatch or corrupt stored key it refuses without consulting the
/// callback.
class HostKeyVerifier {
  HostKeyVerifier({
    required this.profileId,
    required this.hostKeyStore,
    required this.confirmUnknown,
  });

  final String profileId;
  final HostKeyStore hostKeyStore;
  final ConfirmUnknownHost confirmUnknown;

  Future<bool> verify(String keyType, Uint8List fingerprint) async {
    final decision = await hostKeyStore.checkFingerprint(
      profileId: profileId,
      keyType: keyType,
      fingerprint: fingerprint,
    );
    return switch (decision) {
      HostKeyMatch() => true,
      HostKeyFirstTime() => _handleFirstTime(keyType, fingerprint),
      HostKeyMismatch() => false,
      HostKeyCorrupt() => false,
    };
  }

  Future<bool> _handleFirstTime(
    String keyType,
    Uint8List fingerprint,
  ) async {
    final approved = await confirmUnknown(keyType, fingerprint);
    if (approved) {
      await hostKeyStore.pinFingerprint(
        profileId: profileId,
        keyType: keyType,
        fingerprint: fingerprint,
      );
    }
    return approved;
  }
}

/// Wraps a dartssh2 [SSHClient] with a simplified lifecycle.
///
/// Lifecycle:
///   final tunnel = await SshTunnel.open(profile: profile, verifier: verifier);
///   final duplex = await tunnel.forward(host: '127.0.0.1', port: serverPort);
///   // pump bytes...
///   await tunnel.close();
class SshTunnel {
  SshTunnel._(this._client);

  final SSHClient _client;

  static Future<SshTunnel> open({
    required ConnectionProfile profile,
    required HostKeyVerifier verifier,
  }) async {
    final socket = await SSHSocket.connect(profile.host, profile.sshPort);
    SSHClient? client;
    try {
      client = SSHClient(
        socket,
        username: profile.username,
        onVerifyHostKey: verifier.verify,
        identities: switch (profile.credential) {
          PasswordCredential() => null,
          PrivateKeyCredential(
            privateKeyPem: final pem,
            passphrase: final pass,
          ) =>
            SSHKeyPair.fromPem(pem, pass),
        },
        onPasswordRequest: switch (profile.credential) {
          PasswordCredential(password: final pw) => () => pw,
          PrivateKeyCredential() => null,
        },
      );
      await client.authenticated;
      return SshTunnel._(client);
    } on Object {
      if (client != null) {
        client.close();
      } else {
        await socket.close();
      }
      rethrow;
    }
  }

  /// Opens a TCP forward through the SSH tunnel to [host]:[port].
  /// Returns a [ByteDuplex] connected to the remote endpoint.
  Future<ByteDuplex> forward({required String host, required int port}) async {
    final channel = await _client.forwardLocal(host, port);
    return ByteDuplex(channel.stream, channel.sink);
  }

  /// Closes the SSH client and waits for the transport to finish.
  Future<void> close() async {
    _client.close();
    await _client.done;
  }
}

class SshExecResult {
  const SshExecResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
  });

  final int exitCode;
  final Uint8List stdout;
  final Uint8List stderr;
}

class SshExecException implements Exception {
  SshExecException({
    required this.command,
    required this.exitCode,
    required this.stderr,
  });

  final String command;
  final int exitCode;
  final String stderr;

  @override
  String toString() =>
      'SshExecException: `$command` exited $exitCode: $stderr';
}

/// Pure parse step, extracted so it can be unit-tested without real SSH.
String parseTokenFromExec(
  SshExecResult result, {
  required String command,
}) {
  if (result.exitCode != 0) {
    throw SshExecException(
      command: command,
      exitCode: result.exitCode,
      stderr: String.fromCharCodes(result.stderr),
    );
  }
  final raw = String.fromCharCodes(result.stdout).trim();
  if (raw.isEmpty) {
    throw const FormatException('Token command returned empty stdout');
  }
  if (raw.contains('\n')) {
    throw FormatException(
      'Token must be a single line; got: ${raw.length} chars with newline',
    );
  }
  return raw;
}

extension SshTunnelExec on SshTunnel {
  Future<String> fetchToken({
    String command = 'cat ~/.claudecode-web/token',
  }) async {
    final r = await _client.runWithResult(command);
    return parseTokenFromExec(
      SshExecResult(
        exitCode: r.exitCode ?? -1,
        stdout: r.stdout,
        stderr: r.stderr,
      ),
      command: command,
    );
  }
}
