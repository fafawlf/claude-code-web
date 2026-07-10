const SAFE_TRANSCRIPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Provider resume ids become filesystem lookup keys. Keep them to the token
 * alphabet used by Claude/Codex and reject path syntax before any join or SDK
 * fallback can observe the value. */
export function assertSafeTranscriptId(sessionId: string): void {
  if (!SAFE_TRANSCRIPT_ID.test(sessionId)) {
    throw new Error('Invalid transcript session id');
  }
}
