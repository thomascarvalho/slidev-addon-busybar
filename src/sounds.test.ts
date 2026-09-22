import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deckFile, invalidSoundMessage, parseSound, stockPlayer } from './sounds.ts'

test('a sound is a stock name, a WAV file or false', () => {
  assert.deepEqual(parseSound('volume_change'), { stock: 'volume_change' })
  assert.deepEqual(parseSound(' ./sounds/Gong.WAV '), { file: './sounds/Gong.WAV' })
  assert.equal(parseSound(false), null)
  assert.equal(parseSound('gong.mp3'), undefined)
  assert.equal(parseSound('shared/volume_change.snd'), undefined)
  assert.equal(parseSound(true), undefined)
  assert.equal(parseSound(''), undefined)
})

test('only WAV files inside the deck folder are read', () => {
  assert.equal(deckFile('/deck', './sounds/gong.wav'), '/deck/sounds/gong.wav')
  assert.equal(deckFile('/deck', 'gong.wav'), '/deck/gong.wav')
  assert.equal(deckFile('/deck', '../secret.wav'), null)
  assert.equal(deckFile('/deck', '/etc/gong.wav'), null)
  assert.equal(deckFile('/deck', 'sounds/gong.mp3'), null)
  assert.equal(deckFile('/deck', '..x.wav'), '/deck/..x.wav', 'a filename that merely starts with dots is not "..%s"')
})

test('an invalid busy.sound says so, and hints at converting a known audio format', () => {
  assert.equal(invalidSoundMessage('a/b'), 'busy.sound "a/b": not a stock sound name or a .wav file; the deck\'s sound plays instead.')
  assert.equal(invalidSoundMessage('./sounds/gong.mp3'), 'busy.sound "./sounds/gong.mp3": not a stock sound name or a .wav file; the deck\'s sound plays instead. Convert it (ffmpeg -i ./sounds/gong.mp3 ./sounds/gong.wav).')
  assert.equal(invalidSoundMessage('gong.ogg'), 'busy.sound "gong.ogg": not a stock sound name or a .wav file; the deck\'s sound plays instead. Convert it (ffmpeg -i gong.ogg gong.wav).')
})

test('the stock player plays stock sounds and falls back for files', () => {
  assert.deepEqual(stockPlayer.resolve({ stock: 'volume_change' }, null), { application_name: 'slidev', stock_path: 'shared/volume_change.snd' })
  assert.deepEqual(stockPlayer.resolve({ file: 'gong.wav' }, { stock: 'calendar_reminder_ends' }), { application_name: 'slidev', stock_path: 'shared/calendar_reminder_ends.snd' })
  assert.equal(stockPlayer.resolve(null, { stock: 'volume_change' }), null, 'silence is silence')
})
