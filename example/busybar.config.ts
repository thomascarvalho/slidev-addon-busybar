import { defineConfig, label, pixels, SCREEN, textWidth } from 'slidev-addon-busybar'

/* A heart in pixel art, then a word: `busy.screen: acme`. */
const HEART = [
  '.##...##.',
  '####.####',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
]

export default defineConfig({
  locale: 'en',
  logos: {
    acme() {
      const word = 'acme'
      const x = Math.floor((SCREEN.width - HEART[0].length - 4 - textWidth(word, 'bold')) / 2)
      return [
        pixels('logo-heart', HEART, { '#': '#FF5A7A' }, x, 4),
        label('logo-word', word, 'bold', '#FFFFFF', x + HEART[0].length + 4, 3),
      ]
    },
  },
})
