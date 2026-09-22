import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BAR_RATE, decodeWav } from './wav.ts'

/* Builds a WAV file: `samples` are interleaved raw values for the given
   encoding (ints for PCM, floats for IEEE float). */
function wav({ encoding = 1, channels = 1, rate = BAR_RATE, bits = 16, samples = [] as number[], extensible = false, extra = [] as Uint8Array[] }) {
  const width = bits / 8
  const data = new Uint8Array(samples.length * width)
  const dv = new DataView(data.buffer)
  samples.forEach((s, i) => {
    const at = i * width
    if (encoding === 3)
      bits === 32 ? dv.setFloat32(at, s, true) : dv.setFloat64(at, s, true)
    else if (bits === 8)
      dv.setUint8(at, s)
    else if (bits === 16)
      dv.setInt16(at, s, true)
    else if (bits === 24) {
      dv.setUint8(at, s & 0xFF)
      dv.setUint8(at + 1, (s >> 8) & 0xFF)
      dv.setInt8(at + 2, s >> 16)
    }
    else
      dv.setInt32(at, s, true)
  })
  const fmtSize = extensible ? 40 : 16
  const fmt = new Uint8Array(8 + fmtSize)
  const f = new DataView(fmt.buffer)
  fmt.set([0x66, 0x6D, 0x74, 0x20])
  f.setUint32(4, fmtSize, true)
  f.setUint16(8, extensible ? 0xFFFE : encoding, true)
  f.setUint16(10, channels, true)
  f.setUint32(12, rate, true)
  f.setUint32(16, rate * channels * width, true)
  f.setUint16(20, channels * width, true)
  f.setUint16(22, bits, true)
  if (extensible) {
    f.setUint16(24, 22, true)
    f.setUint16(32, encoding, true)
  }
  const head = new Uint8Array(8)
  head.set([0x64, 0x61, 0x74, 0x61])
  new DataView(head.buffer).setUint32(4, data.length, true)
  const body = [...extra, fmt, head, data]
  const size = 4 + body.reduce((n, b) => n + b.length, 0)
  const riff = new Uint8Array(12)
  riff.set([0x52, 0x49, 0x46, 0x46])
  new DataView(riff.buffer).setUint32(4, size, true)
  riff.set([0x57, 0x41, 0x56, 0x45], 8)
  const out = new Uint8Array(12 + size - 4)
  let at = 0
  for (const part of [riff, ...body]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

test('16-bit mono at 44.1 kHz passes through unchanged', () => {
  const { pcm, truncated } = decodeWav(wav({ samples: [0, 1000, -1000, 32767, -32768] }))
  assert.deepEqual([...pcm], [0, 1000, -1000, 32767, -32768])
  assert.equal(truncated, false)
})

test('stereo is averaged to mono', () => {
  const { pcm } = decodeWav(wav({ channels: 2, samples: [1000, 3000, -2000, 0] }))
  assert.deepEqual([...pcm], [2000, -1000])
})

test('22.05 kHz is resampled to 44.1 kHz: twice the samples', () => {
  const { pcm } = decodeWav(wav({ rate: 22_050, samples: [0, 1000, 2000, 3000] }))
  assert.equal(pcm.length, 8)
  assert.equal(pcm[0], 0)
  assert.equal(pcm[1], 500, 'halfway between two samples')
  assert.equal(pcm[2], 1000)
})

test('8-bit, 24-bit, 32-bit and float samples are scaled to 16 bits', () => {
  assert.deepEqual([...decodeWav(wav({ bits: 8, samples: [128, 192, 64] })).pcm], [0, 16384, -16384])
  assert.deepEqual([...decodeWav(wav({ bits: 24, samples: [0, 4194304, -4194304] })).pcm], [0, 16384, -16384])
  assert.deepEqual([...decodeWav(wav({ bits: 32, samples: [0, 1073741824] })).pcm], [0, 16384])
  assert.deepEqual([...decodeWav(wav({ encoding: 3, bits: 32, samples: [0, 0.5, -0.5] })).pcm], [0, 16384, -16384])
  assert.deepEqual([...decodeWav(wav({ encoding: 3, bits: 64, samples: [0.25] })).pcm], [8192])
})

test('extensible format and extra chunks are understood', () => {
  const list = new Uint8Array([0x4C, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0])
  assert.deepEqual([...decodeWav(wav({ extensible: true, samples: [1234], extra: [list] })).pcm], [1234])
})

test('what cannot be played says why', () => {
  assert.throws(() => decodeWav(new TextEncoder().encode('ID3 not a wav at all')), /not a WAV file/)
  assert.throws(() => decodeWav(wav({ encoding: 2, bits: 4, samples: [] })), /unsupported encoding: ADPCM/)
})

test('a sound longer than 10 s is cut at 10 s', () => {
  const { pcm, truncated } = decodeWav(wav({ rate: 8000, samples: Array.from({ length: 8000 * 12 }, () => 0) }))
  assert.equal(pcm.length, BAR_RATE * 10)
  assert.equal(truncated, true)
})

test('the mono mix is capped near the truncation boundary, not before it', () => {
  /* 500 000 frames at 40 kHz (12.5 s) truncate to 10 s at the bar's 44.1 kHz.
     A single loud frame just past the 10 s mark (source frame 400 000) must
     still be mixed in and reach the last output sample through resampling:
     capping the mix too early would silently drop it. */
  const rate = 40_000
  const samples = Array.from({ length: 500_000 }, () => 0)
  samples[400_000] = 32_767
  const { pcm, truncated } = decodeWav(wav({ rate, samples }))
  assert.equal(pcm.length, BAR_RATE * 10)
  assert.equal(truncated, true)
  assert.notEqual(pcm[pcm.length - 1], 0, 'the loud frame near the boundary was mixed in')
})

test('a truncated fmt chunk throws a readable error', () => {
  const valid = wav({ samples: [1] })
  const truncated = valid.subarray(0, 12 + 8 + 4)
  assert.throws(() => decodeWav(truncated), /not a WAV file/)
})

test('a WAV whose data size exceeds the file still decodes what is present', () => {
  const valid = wav({ samples: [100, 200, 300] })
  const dv = new DataView(valid.buffer)
  /* Find the data chunk and inflate its size field. */
  let dataAt = -1
  for (let at = 12; at + 8 <= valid.length; at += 8 + dv.getUint32(at + 4, true) + (dv.getUint32(at + 4, true) % 2)) {
    if (String.fromCharCode(...valid.subarray(at, at + 4)) === 'data') {
      dataAt = at
      break
    }
  }
  assert.notEqual(dataAt, -1, 'data chunk found')
  /* Set size to much larger than file. */
  dv.setUint32(dataAt + 4, 100000, true)
  const { pcm } = decodeWav(valid)
  assert.deepEqual([...pcm], [100, 200, 300])
})
