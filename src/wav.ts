/* WAV files → the bar's only sound format. Firmware 1.2.4 plays every file
   as raw PCM, signed 16-bit little-endian, mono, 44 100 Hz, and ignores
   headers: a 22 050 Hz WAV plays twice as fast. So the dev server converts
   the deck's WAV files before uploading them. Pure, no dependency. */

/** The bar's sample rate. */
export const BAR_RATE = 44_100
/** Longer sounds are cut: 10 s is 882 000 bytes on the bar. */
export const MAX_SECONDS = 10

const PCM = 1
const FLOAT = 3
const EXTENSIBLE = 0xFFFE
const NAMES: Record<number, string> = { 2: 'ADPCM', 6: 'A-law', 7: 'µ-law', 17: 'IMA ADPCM', 85: 'MP3' }

/** Converts a RIFF/WAVE file (PCM 8/16/24/32-bit or IEEE float 32/64-bit,
    any rate and channel count) to mono 44.1 kHz signed 16-bit samples.
    Throws an `Error` saying what is wrong. */
export function decodeWav(bytes: Uint8Array): { pcm: Int16Array, truncated: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE')
    throw new Error('not a WAV file')

  let format: { encoding: number, channels: number, rate: number, bits: number } | null = null
  let data: Uint8Array | null = null
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      let encoding = view.getUint16(body, true)
      /* WAVE_FORMAT_EXTENSIBLE: the real encoding is the first two bytes of
         the sub-format GUID. */
      if (encoding === EXTENSIBLE && size >= 40 && body + 26 <= bytes.length)
        encoding = view.getUint16(body + 24, true)
      format = { encoding, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) }
    }
    else if (id === 'data') {
      data = bytes.subarray(body, Math.min(body + size, bytes.length))
    }
    /* Chunks are padded to an even size. */
    at = body + size + (size % 2)
  }
  if (!format || !data)
    throw new Error('not a WAV file (no fmt or data chunk)')

  const { encoding, channels, rate, bits } = format
  const supported = (encoding === PCM && [8, 16, 24, 32].includes(bits)) || (encoding === FLOAT && (bits === 32 || bits === 64))
  if (!supported)
    throw new Error(`unsupported encoding: ${NAMES[encoding] ?? `${encoding}, ${bits}-bit`}`)
  if (!channels || !rate)
    throw new Error('not a WAV file (no channels or sample rate)')

  const width = bits / 8
  const d = new DataView(data.buffer, data.byteOffset, data.byteLength)
  /* One sample, scaled to [-1, 1). */
  const sample = (at: number): number => {
    if (encoding === FLOAT)
      return bits === 32 ? d.getFloat32(at, true) : d.getFloat64(at, true)
    switch (bits) {
      case 8: return (d.getUint8(at) - 128) / 128
      case 16: return d.getInt16(at, true) / 32768
      case 24: return (d.getUint8(at) | (d.getUint8(at + 1) << 8) | (d.getInt8(at + 2) << 16)) / 8388608
      default: return d.getInt32(at, true) / 2147483648
    }
  }

  const frames = Math.floor(data.length / (width * channels))
  const mixFrames = Math.min(frames, Math.ceil(MAX_SECONDS * rate) + 2)
  const mono = new Float32Array(mixFrames)
  for (let f = 0; f < mixFrames; f++) {
    let sum = 0
    for (let c = 0; c < channels; c++)
      sum += sample((f * channels + c) * width)
    mono[f] = sum / channels
  }

  /* Linear resampling: plenty for one-second chimes. */
  const total = Math.floor(frames * BAR_RATE / rate)
  const length = Math.min(total, BAR_RATE * MAX_SECONDS)
  const pcm = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const position = i * rate / BAR_RATE
    const j = Math.floor(position)
    const a = mono[j] ?? 0
    const b = mono[j + 1] ?? a
    const value = a + (b - a) * (position - j)
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32768)))
  }
  return { pcm, truncated: total > length }
}
