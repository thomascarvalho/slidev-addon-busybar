import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfig, toBarColor } from './config.ts'

test('English by default, French on request', () => {
  assert.equal(resolveConfig().labels.timeUp, 'Time\'s up')
  assert.equal(resolveConfig().screens.pause.title, 'Break')
  const fr = resolveConfig({ locale: 'fr' })
  assert.equal(fr.labels.timeUp, 'Temps écoulé')
  assert.equal(fr.screens.questions.title, 'Questions ?')
})

test('labels and screens can be overridden, new screens added', () => {
  const config = resolveConfig({
    labels: { timeUp: 'Stop!' },
    screens: { pause: { title: 'Lunch' }, demo: { title: 'Live demo', color: '#0f0', icon: 'dt_work' } },
  })
  assert.equal(config.labels.timeUp, 'Stop!')
  assert.equal(config.screens.pause.title, 'Lunch')
  assert.equal(config.screens.pause.icon, 'dt_coffee', 'the rest of the default is kept')
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
