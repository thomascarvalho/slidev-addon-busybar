import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSettings } from './settings.ts'

test('defaults: USB address, no password, enabled, no debug', () => {
  assert.deepEqual(readSettings({}), { addr: '10.0.4.20', password: undefined, enabled: true, debug: false, warnings: [] })
})

test('reads the address, the password and the flags, in any spelling', () => {
  const s = readSettings({ BUSYBAR_ADDR: '192.168.1.42', BUSYBAR_PASSWORD: '123456', BUSYBAR_ENABLED: 'off', BUSYBAR_DEBUG: 'Yes' })
  assert.equal(s.addr, '192.168.1.42')
  assert.equal(s.password, '123456')
  assert.equal(s.enabled, false)
  assert.equal(s.debug, true)
  assert.equal(readSettings({ BUSYBAR_ENABLED: '0' }).enabled, false)
  assert.equal(readSettings({ BUSYBAR_ENABLED: 'maybe' }).enabled, true, 'anything but a no is a yes')
  assert.equal(readSettings({ BUSYBAR_DEBUG: '1' }).debug, true)
  assert.equal(readSettings({ BUSYBAR_ADDR: '', BUSYBAR_PASSWORD: '' }).addr, '10.0.4.20', 'empty is unset')
})

test('the sound variables of 0.2 are reported, once each', () => {
  const s = readSettings({ BUSYBAR_SOUND: 'x', BUSYBAR_WARN_SOUND: 'y' })
  assert.equal(s.warnings.length, 2)
  assert.match(s.warnings[0], /BUSYBAR_SOUND is no longer used/)
  assert.match(s.warnings[1], /BUSYBAR_WARN_SOUND is no longer used/)
})
