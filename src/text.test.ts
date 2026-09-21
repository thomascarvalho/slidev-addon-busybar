import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toDeviceText } from './text.ts'

test('keeps accents and French punctuation', () => {
  assert.equal(toDeviceText('Référencer du code'), 'Référencer du code')
  assert.equal(toDeviceText('Cœur — « déjà » l’été…'), 'Cœur — « déjà » l’été…')
})

test('recomposes accents typed as combining characters', () => {
  assert.equal(toDeviceText('Référencer'), 'Référencer')
})

test('drops what the bar cannot draw and collapses spaces', () => {
  assert.equal(toDeviceText('  Hooks 🚀 avancés  '), 'Hooks avancés')
})
