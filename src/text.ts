/* The bar's `global` font draws accented Latin letters and typographic
   punctuation (œ, « », ’, …); the other fonts are ASCII only. So we only drop
   what no font can draw, emoji first, rather than let the bar show boxes.
   Capitals are drawn without their accent. */

/* Latin-1, Latin Extended-A, general punctuation (dashes, quotes, …), €. */
// eslint-disable-next-line regexp/no-obscure-range -- Unicode blocks, by design
const DRAWABLE = /[\x20-\x7E\xA0-ſ‐-‧‰-⁞€]/u

export function toDeviceText(text: string): string {
  return [...text.normalize('NFC')]
    .filter(c => DRAWABLE.test(c))
    .join('')
    .replace(/[\xA0\u202F\u2007]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
