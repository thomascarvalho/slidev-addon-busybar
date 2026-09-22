# Changelog

Each `## <version> — <date>` section becomes the notes of that version's
GitHub release.

## Unreleased

### Changed

- A timer in progress (running, paused, between two phases or just over) now
  stays in front of every screen until it ends or is cancelled. On a break
  slide, a workshop still in progress stays on the bar: end or cancel it to
  start the break (0.3.0 started the break and ended the workshop).
- `controls.okHold` now defaults to `timer:set`: if you gave `ok` an action,
  holding the wheel's click now opens the timer setting instead; set
  `okHold: false` to keep the old behaviour.

### New

- Ad-hoc timer: hold the wheel's click (`timer:set`, the new default of
  `controls.okHold`), turn the wheel to pick the minutes, press Start/Stop.

## 0.3.0 — 2026-09-22

The bar becomes a training companion: breaks that call people back,
workshops in phases, and sounds of your own.

### Breaking changes

- `screen: pause` is now `screen: break`, and `screens.pause` is now
  `screens.break` in `busybar.config.ts`.
- The control action `timer` is now `timer:toggle`, also as the default of
  `controls.start`.
- `BUSYBAR_SOUND` and `BUSYBAR_WARN_SOUND` are removed: set `sounds` in
  `busybar.config.ts` instead (`timeUp`, `breakOver` and `phaseEnd` for the
  end sound, `breakWarning` for the warning). The console says so if they are
  still set.
- A screen slide with a `timer` is now a break dressed by that screen; before,
  it was a plain activity hidden behind the screen.

### New

- **Breaks**: `screen: break` with `timer: 15m` counts down with the break's
  icon and colour, stays on the bar on the next slides, turns orange with a
  discreet sound in its last minute and calls people back with "Break's
  over!". Start/Stop on a break slide starts the break, ending a workshop
  still in progress.
- **Workshop phases**: `timer: [5m Reading, 10m Coding, 5m Sharing]` runs one
  phase after the other, with a segment per phase on the last row. Between two
  phases the bar calmly shows what comes next until you start it; the status
  LED reminds you after 30 s. `timer:skip` ends a phase early, one more minute
  reopens the phase that just ended, and changing slide never stops a
  workshop.
- **Configurable sounds**: `sounds` sets each moment (end of an activity, end
  of a break, a break's last minute, end of a phase, start) to a stock sound, a
  WAV file of your deck or `false`; `busy.sound` gives a slide's timer its own
  end sound. WAV files are converted to the bar's format and uploaded ahead of
  need.
- New labels: `breakOver`, `upNext`, `phase`.

### Fixes

- The end sound now plays. Stock sounds must be addressed as `.snd`; 0.2.0
  asked for a `.wav` path, which the bar accepts and silently ignores.

## 0.2.0 — 2026-09-22

- Drive the deck from the bar: the wheel steps through clicks and slides,
  Start/Stop runs the timer, Back held cancels it. Every control is
  configurable with `controls`.
- The console says when the bar's switch leaves APPS, and the screen is
  redrawn as soon as it comes back.

## 0.1.0 — 2026-09-22

- First release: chapter and progress, workshop timers, break, questions and
  welcome screens, logos, English and French.
