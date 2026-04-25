final RegExp _modelSwitchStdout = RegExp(
  r'<local-command-stdout>\s*Set model to [\s\S]*?</local-command-stdout>\s*',
);
final RegExp _openModelSwitchStdout = RegExp(
  r'<local-command-stdout>\s*Set model to [\s\S]*$',
);

/// Strip closed `<local-command-stdout>Set model to ...</local-command-stdout>`
/// blocks and trim trailing whitespace. Mirrors `web/src/assistantText.ts`.
String cleanAssistantText(String text) {
  return text.replaceAll(_modelSwitchStdout, '').trimRight();
}

/// Like [cleanAssistantText], but also strips an open-ended
/// `<local-command-stdout>Set model to ...` block that hasn't closed yet
/// (used when rendering the streaming ghost bubble).
String cleanStreamingAssistantText(String text) {
  return cleanAssistantText(text).replaceAll(_openModelSwitchStdout, '').trimRight();
}
