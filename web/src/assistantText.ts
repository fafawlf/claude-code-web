const MODEL_SWITCH_STDOUT = /<local-command-stdout>\s*Set model to [\s\S]*?<\/local-command-stdout>\s*/g;
const OPEN_MODEL_SWITCH_STDOUT = /<local-command-stdout>\s*Set model to [\s\S]*$/;

export function cleanAssistantText(text: string): string {
  return text.replace(MODEL_SWITCH_STDOUT, '').trim();
}

export function cleanStreamingAssistantText(text: string): string {
  return cleanAssistantText(text).replace(OPEN_MODEL_SWITCH_STDOUT, '').trimEnd();
}
