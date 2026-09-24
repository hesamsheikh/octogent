import { type TerminalCompletionSoundId, isTerminalCompletionSoundId } from "@octogent/core";

export { type TerminalCompletionSoundId, isTerminalCompletionSoundId };

export const DEFAULT_TERMINAL_COMPLETION_SOUND: TerminalCompletionSoundId = "pop";

export const TERMINAL_COMPLETION_SOUND_OPTIONS: Array<{
  id: TerminalCompletionSoundId;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    id: "soft-chime",
    labelKey: "web.sound.softChime",
    descriptionKey: "web.sound.softChimeDesc",
  },
  {
    id: "retro-beep",
    labelKey: "web.sound.retroBeep",
    descriptionKey: "web.sound.retroBeepDesc",
  },
  {
    id: "double-beep",
    labelKey: "web.sound.doubleBeep",
    descriptionKey: "web.sound.doubleBeepDesc",
  },
  {
    id: "bell",
    labelKey: "web.sound.bell",
    descriptionKey: "web.sound.bellDesc",
  },
  {
    id: "pop",
    labelKey: "web.sound.pop",
    descriptionKey: "web.sound.popDesc",
  },
  {
    id: "silent",
    labelKey: "web.sound.silent",
    descriptionKey: "web.sound.silentDesc",
  },
];

type WaveformType = "sine" | "square";

type ToneStep = {
  durationMs: number;
  frequencyHz: number;
  gain: number;
  waveform: WaveformType;
};

const SAMPLE_RATE = 8_000;

const SOUND_PATTERNS: Record<TerminalCompletionSoundId, ToneStep[]> = {
  "soft-chime": [
    { durationMs: 120, frequencyHz: 660, gain: 0.28, waveform: "sine" },
    { durationMs: 95, frequencyHz: 880, gain: 0.24, waveform: "sine" },
  ],
  "retro-beep": [{ durationMs: 130, frequencyHz: 740, gain: 0.24, waveform: "square" }],
  "double-beep": [
    { durationMs: 70, frequencyHz: 760, gain: 0.24, waveform: "square" },
    { durationMs: 45, frequencyHz: 0, gain: 0, waveform: "sine" },
    { durationMs: 70, frequencyHz: 920, gain: 0.24, waveform: "square" },
  ],
  bell: [
    { durationMs: 115, frequencyHz: 988, gain: 0.24, waveform: "sine" },
    { durationMs: 150, frequencyHz: 1_320, gain: 0.12, waveform: "sine" },
  ],
  pop: [{ durationMs: 58, frequencyHz: 520, gain: 0.24, waveform: "sine" }],
  silent: [],
};

const writeWavHeader = (buffer: DataView, payloadByteLength: number) => {
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      buffer.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  buffer.setUint32(4, 36 + payloadByteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  buffer.setUint32(16, 16, true);
  buffer.setUint16(20, 1, true);
  buffer.setUint16(22, 1, true);
  buffer.setUint32(24, SAMPLE_RATE, true);
  buffer.setUint32(28, SAMPLE_RATE * 2, true);
  buffer.setUint16(32, 2, true);
  buffer.setUint16(34, 16, true);
  writeAscii(36, "data");
  buffer.setUint32(40, payloadByteLength, true);
};

const encodeBase64 = (bytes: Uint8Array): string | null => {
  if (typeof btoa !== "function") {
    return null;
  }

  let binary = "";
  const chunkSize = 8_192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const buildStepSamples = (step: ToneStep): Int16Array => {
  const sampleCount = Math.max(1, Math.round((SAMPLE_RATE * step.durationMs) / 1_000));
  const attackSamples = Math.max(1, Math.round(sampleCount * 0.08));
  const releaseSamples = Math.max(1, Math.round(sampleCount * 0.2));
  const samples = new Int16Array(sampleCount);

  if (step.frequencyHz <= 0 || step.gain <= 0) {
    return samples;
  }

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const time = sampleIndex / SAMPLE_RATE;
    const phase = 2 * Math.PI * step.frequencyHz * time;
    const waveformValue =
      step.waveform === "square" ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase);

    const attackLevel = Math.min(1, sampleIndex / attackSamples);
    const releaseLevel = Math.min(1, (sampleCount - sampleIndex) / releaseSamples);
    const envelope = Math.min(attackLevel, releaseLevel);
    const amplitude = waveformValue * step.gain * envelope;
    samples[sampleIndex] = Math.round(amplitude * 32_767);
  }

  return samples;
};

export const buildTerminalCompletionSoundDataUrl = (
  soundId: TerminalCompletionSoundId,
): string | null => {
  const pattern = SOUND_PATTERNS[soundId];
  if (pattern.length === 0) {
    return null;
  }

  const sampleParts = pattern.map((step) => buildStepSamples(step));
  const totalSampleCount = sampleParts.reduce((count, part) => count + part.length, 0);
  const payloadByteLength = totalSampleCount * 2;
  const wavBytes = new Uint8Array(44 + payloadByteLength);
  const wavView = new DataView(wavBytes.buffer);
  writeWavHeader(wavView, payloadByteLength);

  let writeOffset = 44;
  for (const part of sampleParts) {
    for (let sampleIndex = 0; sampleIndex < part.length; sampleIndex += 1) {
      wavView.setInt16(writeOffset, part[sampleIndex] ?? 0, true);
      writeOffset += 2;
    }
  }

  const base64 = encodeBase64(wavBytes);
  if (!base64) {
    return null;
  }
  return `data:audio/wav;base64,${base64}`;
};
