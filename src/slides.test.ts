import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slideInfo } from './slides.ts'

const deck = [
  undefined, // cover, before any chapter
  { chapter: 'Hooks' },
  undefined,
  { activity: 'Workshop 1', timer: ['15m'] },
  { chapter: 'Effects' },
  undefined,
]

test('no chapter before the first declaration', () => {
  const info = slideInfo(deck, 0)
  assert.equal(info.no, 1)
  assert.equal(info.chapter, null)
  assert.equal(info.progress, null)
})

test('the current chapter is the last one declared', () => {
  assert.equal(slideInfo(deck, 1).chapter, 'Hooks')
  assert.equal(slideInfo(deck, 3).chapter, 'Hooks')
  assert.equal(slideInfo(deck, 5).chapter, 'Effects')
})

test('numbers chapters in deck order', () => {
  assert.equal(slideInfo(deck, 1).chapterNo, 1)
  assert.equal(slideInfo(deck, 3).chapterNo, 1)
  assert.equal(slideInfo(deck, 5).chapterNo, 2)
  assert.equal(slideInfo(deck, 0).chapterNo, null)
})

test('slide-specific fields do not leak to the next slides', () => {
  assert.equal(slideInfo(deck, 3).activity, 'Workshop 1')
  assert.deepEqual(slideInfo(deck, 3).timer, ['15m'])
  assert.equal(slideInfo(deck, 4).activity, null)
})

test('a timer can be a list of phases', () => {
  const info = slideInfo([{ activity: 'Lab', timer: ['5m Reading', '10m Coding'] }], 0)
  assert.deepEqual(info.timer, ['5m Reading', '10m Coding'])
  assert.equal(slideInfo([{ timer: [] }], 0).timer, null)
})

test('a special screen closes the current chapter', () => {
  const withBreak = [
    { chapter: 'Hooks' },
    undefined,
    { screen: 'break', until: '10:45' },
    undefined, // section slide after the break
    { chapter: 'Effects' },
  ]
  assert.deepEqual(slideInfo(withBreak, 1).progress, { index: 2, count: 2 })
  assert.equal(slideInfo(withBreak, 2).chapter, null)
  assert.equal(slideInfo(withBreak, 2).screen, 'break')
  assert.equal(slideInfo(withBreak, 3).chapter, null)
  assert.equal(slideInfo(withBreak, 4).chapter, 'Effects')
})

test('a slide can open a chapter and carry a screen', () => {
  const info = slideInfo([{ chapter: 'Intro', screen: 'welcome' }, undefined], 1)
  assert.equal(info.chapter, 'Intro')
  assert.deepEqual(info.progress, { index: 2, count: 2 })
})

test('passes the slide title on', () => {
  assert.equal(slideInfo([undefined], 0, 'Part 1').title, 'Part 1')
  assert.equal(slideInfo([undefined], 0).title, null)
})

test('a slide can give its timer a sound, or silence it', () => {
  assert.equal(slideInfo([{ timer: '5m', sound: './gong.wav' }], 0).sound, './gong.wav')
  assert.equal(slideInfo([{ timer: '5m', sound: false }], 0).sound, false)
  assert.equal(slideInfo([{ timer: '5m' }], 0).sound, null)
})
