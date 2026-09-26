import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig, toBarColor } from './config.ts'

test('English by default, French on request', () => {
  assert.equal(resolveConfig().labels.timeUp, 'Time\'s up')
  assert.equal(resolveConfig().labels.breakOver, 'Break\'s over!')
  assert.equal(resolveConfig().labels.upNext, 'Next')
  assert.equal(resolveConfig().screens.break.title, 'Break')
  const fr = resolveConfig({ locale: 'fr' })
  assert.equal(fr.labels.timeUp, 'Temps écoulé')
  assert.equal(fr.labels.breakOver, 'On reprend !')
  assert.equal(fr.labels.upNext, 'Suivant')
  assert.equal(fr.screens.questions.title, 'Questions ?')
})

test('labels and screens can be overridden, new screens added', () => {
  const config = resolveConfig({
    labels: { timeUp: 'Stop!' },
    screens: { break: { title: 'Lunch' }, demo: { title: 'Live demo', color: '#0f0', icon: 'dt_work' } },
  })
  assert.equal(config.labels.timeUp, 'Stop!')
  assert.equal(config.screens.break.title, 'Lunch')
  assert.equal(config.screens.break.icon, 'dt_coffee', 'the rest of the default is kept')
  assert.deepEqual(config.screens.demo, { title: 'Live demo', color: '#00FF00FF', icon: 'dt_work' })
})

test('colours are normalised to the bar format', () => {
  assert.equal(toBarColor('#b25043'), '#B25043FF')
  assert.equal(toBarColor('#B2504380'), '#B2504380')
  assert.equal(toBarColor('#f00'), '#FF0000FF')
  assert.throws(() => toBarColor('red'), /invalid colour/)
  assert.deepEqual(resolveConfig({ chapterColors: ['#123456'] }).chapterColors, ['#123456FF'])
})

test('an unknown locale is an error', () => {
  assert.throws(() => resolveConfig({ locale: 'de' as never }), /unknown locale/)
})

test('sounds: defaults, overrides, silence, and errors naming the key', () => {
  const defaults = resolveConfig().sounds
  assert.deepEqual(defaults.timeUp, { stock: 'calendar_reminder_ends' })
  assert.deepEqual(defaults.breakWarning, { stock: 'volume_change' })
  assert.equal(defaults.start, null)
  const custom = resolveConfig({ sounds: { breakOver: './gong.wav', timeUp: false } }).sounds
  assert.deepEqual(custom.breakOver, { file: './gong.wav' })
  assert.equal(custom.timeUp, null)
  assert.deepEqual(custom.phaseEnd, { stock: 'calendar_reminder_ends' }, 'the rest keeps its default')
  assert.throws(() => resolveConfig({ sounds: { timeUp: 'gong.mp3' } }), /sounds\.timeUp/)
  assert.throws(() => resolveConfig({ sounds: { ending: 'volume_change' } as never }), /sounds\.ending/)
})

test('the back display\'s labels, in both languages', () => {
  const en = resolveConfig().labels
  assert.deepEqual([en.late, en.early, en.chapter, en.next, en.end], ['late', 'early', 'Chapter', 'Next', 'End'])
  const fr = resolveConfig({ locale: 'fr' }).labels
  assert.deepEqual([fr.late, fr.early, fr.chapter, fr.next, fr.end], ['retard', 'avance', 'Chapitre', 'Suite', 'Fin'])
})

test('the grace before a step counts as entered: 10 s by default, a duration otherwise', () => {
  assert.equal(resolveConfig().schedule.graceMs, 10_000)
  assert.equal(resolveConfig({ schedule: { grace: '30s' } }).schedule.graceMs, 30_000)
  assert.throws(() => resolveConfig({ schedule: { grace: 'soon' } }), /schedule\.grace/)
})
