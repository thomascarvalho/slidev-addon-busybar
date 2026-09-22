import type { SoundBar } from './sound-store.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSoundStore } from './sound-store.ts'

/* A minimal 16-bit mono 44.1 kHz WAV with the given samples. */
function wav(samples: number[]): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  out.set([0x52, 0x49, 0x46, 0x46]); v.setUint32(4, 36 + samples.length * 2, true); out.set([0x57, 0x41, 0x56, 0x45], 8)
  out.set([0x66, 0x6D, 0x74, 0x20], 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  out.set([0x64, 0x61, 0x74, 0x61], 36); v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true))
  return out
}

function fakes(files: Record<string, Uint8Array>) {
  const calls: string[] = []
  const lines: string[] = []
  const state = { failUpload: false, attempts: 0 }
  const bar: SoundBar = {
    async AssetsUpload(params) {
      state.attempts++
      if (state.failUpload)
        throw new Error('fetch failed')
      calls.push(`upload ${params.file} ${(params.data as Buffer).length}`)
      return { result: 'OK' }
    },
    async AssetsDelete() {
      calls.push('delete')
      return { result: 'OK' }
    },
    async StorageListGet() {
      return { list: ['calendar_event_starts', 'calendar_reminder_ends', 'volume_change'].map(name => ({ type: 'file', name: `${name}.snd`, size: 1 })) } as never
    },
  }
  const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) }
  const readFile = async (path: string) => {
    const file = files[path]
    if (!file)
      throw new Error('ENOENT')
    return file
  }
  const store = createSoundStore(bar, log, { root: '/deck', readFile })
  return { store, calls, lines, state }
}

const DEFAULT = { stock: 'calendar_reminder_ends' }

test('a WAV file is converted, uploaded once under its content hash, then played', async () => {
  const { store, calls } = fakes({ '/deck/gong.wav': wav([1, 2, 3]), '/deck/copy.wav': wav([1, 2, 3]) })
  assert.deepEqual(store.resolve({ file: 'gong.wav' }, DEFAULT), { application_name: 'slidev', stock_path: 'shared/calendar_reminder_ends.snd' }, 'not ready yet: the default')
  store.prepare({ file: 'gong.wav' })
  store.prepare({ file: 'copy.wav' })
  store.prepare({ file: './gong.wav' })
  await store.idle()
  assert.equal(calls.length, 1, 'same content, one upload')
  assert.match(calls[0], /^upload sounds\/[0-9a-f]{12}\.snd 6$/)
  const asset = calls[0].split(' ')[1]
  assert.deepEqual(store.resolve({ file: 'gong.wav' }, DEFAULT), { application_name: 'slidev', path: asset })
  assert.deepEqual(store.resolve({ file: 'copy.wav' }, DEFAULT), { application_name: 'slidev', path: asset })
})

test('stock sounds and silence need no upload', () => {
  const { store } = fakes({})
  assert.deepEqual(store.resolve({ stock: 'volume_change' }, DEFAULT), { application_name: 'slidev', stock_path: 'shared/volume_change.snd' })
  assert.equal(store.resolve(null, DEFAULT), null)
})

test('a missing, unreadable or outside file warns once and falls back', async () => {
  const { store, lines, calls } = fakes({ '/deck/gong.mp3.wav': new TextEncoder().encode('ID3 mp3 bytes') })
  for (let i = 0; i < 2; i++) {
    store.prepare({ file: 'missing.wav' })
    store.prepare({ file: 'gong.mp3.wav' })
    store.prepare({ file: '../outside.wav' })
  }
  await store.idle()
  assert.equal(calls.length, 0)
  assert.equal(lines.length, 3, JSON.stringify(lines))
  assert.match(lines[0], /missing\.wav: not found; playing the default sound instead/)
  assert.match(lines[1], /gong\.mp3\.wav: not a WAV file\. Convert it to WAV/)
  assert.match(lines[2], /\.\.\/outside\.wav: only WAV files inside the deck's folder/)
  assert.deepEqual(store.resolve({ file: 'missing.wav' }, DEFAULT), { application_name: 'slidev', stock_path: 'shared/calendar_reminder_ends.snd' })
})

test('the conversion hint points at the file as given, in its own folder', async () => {
  const { store, lines } = fakes({ '/deck/audio/bad.wav': new TextEncoder().encode('ID3 mp3 bytes') })
  store.prepare({ file: 'audio/bad.wav' })
  await store.idle()
  assert.equal(lines.length, 1)
  assert.match(lines[0], /ffmpeg -i audio\/bad\.wav audio\/bad\.converted\.wav/)
})

test('a failed upload is retried the next time the sound is prepared', async () => {
  const { store, calls, state } = fakes({ '/deck/gong.wav': wav([5]) })
  state.failUpload = true
  store.prepare({ file: 'gong.wav' })
  await store.idle()
  state.failUpload = false
  store.prepare({ file: 'gong.wav' })
  await store.idle()
  assert.equal(calls.length, 1)
})

test('resolve queues a retry for a file that is not ready, deduplicated until it settles', async () => {
  const { store, calls, state } = fakes({ '/deck/gong.wav': wav([9]) })
  state.failUpload = true
  assert.deepEqual(store.resolve({ file: 'gong.wav' }, DEFAULT), { application_name: 'slidev', stock_path: 'shared/calendar_reminder_ends.snd' }, 'not ready: the fallback')
  /* Repeated misses before idle() must not pile up jobs. */
  store.resolve({ file: 'gong.wav' }, DEFAULT)
  store.resolve({ file: 'gong.wav' }, DEFAULT)
  await store.idle()
  assert.equal(state.attempts, 1, 'a single upload attempt queued by the misses above')
  assert.equal(calls.length, 0, 'the bar was unreachable: nothing uploaded yet')

  state.failUpload = false
  assert.deepEqual(store.resolve({ file: 'gong.wav' }, DEFAULT), { application_name: 'slidev', stock_path: 'shared/calendar_reminder_ends.snd' }, 'still not ready: queues another retry')
  await store.idle()
  assert.equal(state.attempts, 2, 'the retry ran once uploads worked again')
  assert.equal(calls.length, 1)
  const asset = calls[0].split(' ')[1]
  assert.deepEqual(store.resolve({ file: 'gong.wav' }, DEFAULT), { application_name: 'slidev', path: asset })
})

test('reset deletes the addon\'s previous sounds before anything is uploaded', async () => {
  const { store, calls } = fakes({ '/deck/gong.wav': wav([7]) })
  store.reset()
  store.prepare({ file: 'gong.wav' })
  await store.idle()
  assert.equal(calls[0], 'delete')
  assert.match(calls[1], /^upload/)
})

test('an unknown stock sound name is reported with the bar\'s list', async () => {
  const { store, lines } = fakes({})
  await store.checkStock([['sounds.timeUp', { stock: 'gongg' }], ['sounds.breakWarning', { stock: 'volume_change' }], ['sounds.start', null]])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /sounds\.timeUp: no stock sound "gongg" on the bar \(calendar_event_starts, calendar_reminder_ends, volume_change\)/)
})
