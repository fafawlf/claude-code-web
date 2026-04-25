import 'auth_credential.dart';

class ConnectionProfile {
  const ConnectionProfile({
    required this.id,
    required this.label,
    required this.host,
    required this.username,
    required this.credential,
    required this.serverPort,
    required this.serverStartCommand,
    this.sshPort = 22,
  });

  final String id;
  final String label;
  final String host;
  final int sshPort;
  final String username;
  final AuthCredential credential;
  final int serverPort;
  final String serverStartCommand;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'label': label,
        'host': host,
        'sshPort': sshPort,
        'username': username,
        'credential': credential.toJson(),
        'serverPort': serverPort,
        'serverStartCommand': serverStartCommand,
      };

  static ConnectionProfile fromJson(Map<String, dynamic> json) =>
      ConnectionProfile(
        id: json['id'] as String,
        label: json['label'] as String,
        host: json['host'] as String,
        sshPort: (json['sshPort'] as num).toInt(),
        username: json['username'] as String,
        credential: AuthCredential.fromJson(
          Map<String, dynamic>.from(json['credential'] as Map),
        ),
        serverPort: (json['serverPort'] as num).toInt(),
        serverStartCommand: json['serverStartCommand'] as String,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ConnectionProfile &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          label == other.label &&
          host == other.host &&
          sshPort == other.sshPort &&
          username == other.username &&
          credential == other.credential &&
          serverPort == other.serverPort &&
          serverStartCommand == other.serverStartCommand;

  @override
  int get hashCode => Object.hash(
        id,
        label,
        host,
        sshPort,
        username,
        credential,
        serverPort,
        serverStartCommand,
      );
}
