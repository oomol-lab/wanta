export interface VoiceTranscriptionTokenRef {
  current: number
}

export function startVoiceTranscription(ref: VoiceTranscriptionTokenRef): number {
  ref.current += 1
  return ref.current
}

export function invalidateVoiceTranscription(ref: VoiceTranscriptionTokenRef): void {
  ref.current += 1
}

export function isCurrentVoiceTranscription(ref: VoiceTranscriptionTokenRef, token: number): boolean {
  return ref.current === token
}
