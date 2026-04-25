import 'dart:convert';

import 'client_message.dart';
import 'server_message.dart';

String encodeClientMessage(ClientMessage msg) => jsonEncode(msg.toJson());

ServerMessage decodeServerFrame(String frame) {
  final parsed = jsonDecode(frame);
  if (parsed is! Map<String, dynamic>) {
    throw const FormatException('Top-level frame is not a JSON object');
  }
  return ServerMessage.fromJson(parsed);
}
