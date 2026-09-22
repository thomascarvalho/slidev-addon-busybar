# slidev-addon-busybar

Turn a [BUSY Bar](https://busy.app) facing the room into a companion for your
[Slidev](https://sli.dev) talks and trainings: it follows your slides on its
own.

- **Current chapter** and how far you are in it, in a colour per chapter
- **Workshop timers** you start from your presentation remote: green, then
  orange, then red, then a blinking "Time's up", a sound and the status LED
- **Driven from the bar**: its wheel changes slides, its Start/Stop button
  runs the timer
- **Special screens**: break (with the resume time), questions, welcome, your
  own logos
- **Your own sounds**: every moment can ring a stock sound, one of your WAV
  files, or nothing
- Accented text, long titles scrolling, English and French built in

![Chapter and progress](docs/screens/chapter.png)
![A workshop timer](docs/screens/timer-short-label.png)
![Break until 10:45](docs/screens/break.png)

> [!IMPORTANT]
> Unofficial community project, not affiliated with or endorsed by Flipper
> Devices. "BUSY Bar" is their trademark.

## Your talk never depends on the bar

The addon only runs with `slidev` (the dev server). `slidev build` and
`slidev export` never talk to the bar. Unplugged, asleep or slow, the bar
never holds your slides back: every call has a 1.5 s timeout, the slides
never wait for it, and the console says so once, then retries every 5 seconds:

```
[busybar] BUSY Bar unreachable (fetch failed). The talk goes on without it; retrying every 5 s.
[busybar] BUSY Bar reachable again.
```

Nothing is sent anywhere but to the bar: no BUSY cloud.

## Install

```bash
npm install slidev-addon-busybar
```

```yaml
---
# slides.md headmatter
addons:
  - busybar
---
```

### Connect the bar

1. **Set the switch on the bar to APPS.** In the other positions the bar
   refuses to draw anything from outside (a 409 error in the console).
2. **Connect it**, either:
   - over **USB**: nothing to configure, it answers on `10.0.4.20`;
   - over **Wi-Fi**: you need its IP address (shown in the BUSY app) and its
     HTTP access code (the bar's "HTTP Access" setting, in key mode). A token
     from the BUSY cloud will not work here.
3. **Create `.env.local`** next to your deck (start from
   [`.env.example`](.env.example)) and **git-ignore it**. It stays on your
   machine and is never sent to the browser. The addon reads it from the folder
   you run `slidev` in and from the deck's folder; shell variables win:

   ```bash
   BUSYBAR_ADDR=192.168.1.42    # default: 10.0.4.20 (USB)
   BUSYBAR_PASSWORD=123456      # HTTP access code, needed over Wi-Fi
   ```

   | Variable | Purpose |
   |---|---|
   | `BUSYBAR_ADDR` | address of the bar; `10.0.4.20` by default |
   | `BUSYBAR_PASSWORD` | HTTP access code of the bar |
   | `BUSYBAR_ENABLED` | `false` turns the addon off |
   | `BUSYBAR_DEBUG` | `true` logs every call to the bar |

4. Run `slidev`: the console shows `[busybar] relay to …`.

## Annotate your slides

Everything goes in a `busy` block of the frontmatter.

**A chapter** is declared on its first slide only, and lasts until the next
chapter or special screen. The bar shows its title (scrolling if too long)
and, on its last row, where the slide sits in the chapter. Outside any chapter
(section slides…), it shows the slide's title.

```yaml
---
busy:
  chapter: Hooks
---
```

![Accented chapter title](docs/screens/chapter-accents.png)

**A timed activity** shows its name and length **without starting**: you start
it (see [shortcuts](#shortcuts)). Durations: `90s`, `15m`, `1h30m`.

```yaml
---
busy:
  activity: Workshop 1
  timer: 15m
---
```

![Activity ready to start](docs/screens/activity.png)

Once started, the timer lives on its own: it keeps running when you change
slides, backwards included, and stays on the bar until it ends or you cancel
it. It turns orange under 20 % of the time and red under a minute, the last
row drains from green to red, and an hourglass precedes the name when there is
room. At zero the bar plays a sound, blinks "Time's up" in red and so does its
status LED. Changing slide or pressing `b` dismisses it.

![Orange, under 20 %](docs/screens/timer-orange.png)
![Paused](docs/screens/timer-paused.png)
![Time's up](docs/screens/time-up.png)

**A workshop in phases** lists them, each a duration and an optional name:

```yaml
---
busy:
  activity: Hooks workshop
  timer: [5m Reading, 10m Coding, 5m Sharing]
---
```

A phase without a name is called after `labels.phase` and its number ("Phase
2"). The bar shows the current phase and its time; the last row has a segment
per phase. When a phase ends, a sound plays and the bar calmly shows what
comes next ("Next Coding 10:00") until you start it; after 30 s the status
LED reminds you. `+` gives the phase that just ended one more minute;
`timer:skip` (on a bar button, see [From the bar](#from-the-bar)) ends a
phase early. Changing slide never stops a workshop: only its final "Time's
up" is dismissed.

**A special screen**: `break`, `questions` or `welcome`, each with its icon and
colour, or the name of one of your [logos](#logos). `until` adds the resume
time, `text` replaces the title; any other name is shown as is.

**A break** is a screen with a `timer`: the bar shows its name and length, and
counts down once you start it, like an activity. Its icon precedes the name
when there is room for both; the screen itself always shows it. The last
minute turns orange with a discreet sound; at zero, "Break's over!" blinks in
the break's colour with the end sound. The countdown stays on the bar when you move on to
the next slide. If a workshop is still in progress, the bar keeps showing it:
let it end and dismiss it, or cancel it (Back held), to start the break.

```yaml
---
busy:
  screen: break
  timer: 15m
---
```

Without `timer`, the screen only shows the resume time:

```yaml
---
busy:
  screen: break
  until: "10:45"
---
```

![Questions](docs/screens/questions.png)
![Welcome](docs/screens/welcome.png)

A timer in progress — running, paused, between two phases or just over — is
shown in front of every screen and chapter until it ends and is dismissed, or
is cancelled: what the bar shows is what Start/Stop acts on. The slide's
screen comes back afterwards.

### Shortcuts

| Key | Effect |
|---|---|
| `b` or `.` | start the slide's activity, pause, resume; start the next workshop phase; dismiss "Time's up" |
| `+` or `=` | one more minute (a finished timer too) |
| `Shift` + `x` | cancel the timer |

`b` and `.` are what the "blank screen" button of presentation remotes sends:
one button runs the whole timer. Shortcuts work in whichever window has the
focus, audience or presenter.

### From the bar

With the switch on APPS, the bar itself drives the deck. By default:

| On the bar | Effect |
|---|---|
| Wheel | next or previous click or slide, one per notch |
| Start/Stop | start the slide's activity, pause, resume; start the next workshop phase; dismiss "Time's up" |
| Start/Stop, held | one more minute |
| Back, held | cancel the timer |
| Wheel click, held | set a timer: the wheel picks the minutes, Start/Stop starts it |

**An ad-hoc timer**, for an exercise that was not planned: hold the wheel's
click, turn the wheel to pick the minutes (it starts from the last duration
you set), press Start/Stop. The wheel sets the timer even with `wheel: false`.
Hold Back, hold the click again or wait 15 s to leave without starting. The
setting and any timer in progress stay in front of the slides. From the
keyboard, `b` starts the setting and `Shift` + `x` closes it while it is
open.

Turning the switch away from APPS hands the screen back to the bar; the
console says so, and the addon redraws as soon as it is back on APPS. With the
presenter window open, the bar drives it and the audience window follows.
This needs Node 22 or later.

Each control can do something else, or nothing, with `controls` in
[`busybar.config.ts`](#configure); `controls: false` stops listening to the
bar:

```ts
export default defineConfig({
  controls: {
    wheel: 'clicks',         // 'clicks', 'slides' (skips the clicks) or false
    start: 'timer:toggle',   // Start/Stop
    startHold: 'timer:add',  // Start/Stop, held
    back: false,
    backHold: 'timer:cancel',
    ok: false,              // the wheel's click
    okHold: 'timer:set',    // the wheel's click, held
    switch: true,           // say when the switch leaves APPS, redraw on return
  },
})
```

| Action | Effect |
|---|---|
| `next`, `prev` | next or previous click or slide |
| `nextSlide`, `prevSlide` | next or previous slide, skipping the clicks |
| `first`, `last` | first or last slide |
| `goto:<n>` | slide `n`, say the day's programme |
| `overview` | open or close the slides overview |
| `dark` | toggle dark mode |
| `timer:toggle`, `timer:add`, `timer:skip`, `timer:cancel` | as `b`, `+`, ending the current phase, and `Shift` + `x` |
| `timer:set` | set a timer with the wheel (1 to 120 minutes), Start/Stop starts it |
| `false` | nothing |

A button with no action when held just does its press action, whenever it is
released.

## Configure

Everything has a default. To change it, add `busybar.config.ts` next to
`slides.md`; it is reloaded when you save it.

```ts
import { defineConfig } from 'slidev-addon-busybar'

export default defineConfig({
  locale: 'fr', // 'en' (default) or 'fr'
  labels: { timeUp: 'Terminé !', breakOver: 'Au travail !', upNext: 'Ensuite' },
  controls: { ok: 'overview' }, // the bar's controls, see "From the bar"
  chapterColors: ['#D3A5AA', '#7BBADD', '#B25043'],
  screens: {
    break: { title: 'Déjeuner' },
    demo: { title: 'Démo live', color: '#7DDB8B', icon: 'dt_work' },
  },
})
```

Colours read best saturated: dark or greyish tones look dull on LEDs.

### Logos

A logo is a function returning `DisplayDraw` elements for the 72×16 screen,
shown by `busy.screen: <name>`. The package exports small helpers:

```ts
import { defineConfig, label, pixels, rect, SCREEN, textWidth } from 'slidev-addon-busybar'

export default defineConfig({
  logos: {
    acme: () => [
      pixels('heart', ['.##.##.', '#######', '.#####.', '..###..', '...#...'], { '#': '#FF5A7A' }, 8, 5),
      label('word', 'acme', 'bold', '#FFFFFF', 20, 3),
    ],
  },
})
```

- `pixels(id, grid, palette, x, y)`: pixel art, one character per pixel, `.`
  transparent, up to 32 colours
- `rect(id, x, y, width, height, color)`: a filled rectangle
- `label(id, text, font, color, x, y)`: text in one of the bar's fonts (`tiny`,
  `small`, `normal`, `condensed`, `bold`, `large`, `extra_large`, `global`)
- `textWidth(text, font)` and `SCREEN` to lay things out

[`example/busybar.config.ts`](example/busybar.config.ts) has a complete one.

### Sounds

Every moment has its sound: a stock sound of the bar, a WAV file of your
deck, or `false` for silence.

```ts
export default defineConfig({
  sounds: {
    timeUp: 'calendar_reminder_ends',  // an activity runs out
    breakOver: './sounds/gong.wav',    // a break runs out
    breakWarning: 'volume_change',     // a break has a minute left
    phaseEnd: 'calendar_event_starts', // a workshop phase runs out
    start: false,                      // a timer or phase starts
  },
})
```

| Moment | Default |
|---|---|
| `timeUp` | `calendar_reminder_ends` |
| `breakOver` | `calendar_reminder_ends` |
| `breakWarning` | `volume_change` |
| `phaseEnd` | `calendar_reminder_ends` |
| `start` | none |

The stock sounds are `calendar_event_starts`, `calendar_reminder_ends` and
`volume_change`. A WAV file (any rate, mono or stereo, 8 to 32-bit or float)
is converted and uploaded to the bar when `slidev` starts and whenever it
changes; sounds are cut at 10 s. Other formats (MP3…) must be converted
first, for instance with `ffmpeg -i gong.mp3 gong.wav`. If a file cannot be
played, the console says why once and the moment's default sound rings
instead.

Replaces `BUSYBAR_SOUND` and `BUSYBAR_WARN_SOUND`, removed in 0.3.0.

A slide can give its timer its own end sound, or silence it:

```yaml
---
busy:
  activity: Hooks workshop
  timer: [5m Reading, 10m Coding, 5m Sharing]
  sound: ./sounds/gong.wav
---
```

`busy.sound` is a WAV file inside the deck's folder, a stock name, or
`false`. A slide's file is uploaded as soon as that slide is shown, long
before its timer can end. An invalid value (a path outside the deck, a
format other than WAV, an unknown stock name) keeps the deck's sound, with a
console warning.

### Firmware icons

`screens.<name>.icon` takes the name of an image stored on the bar, such as
`dt_coffee`, `dt_tea`, `dt_dialog`, `dt_book`, `dt_work`, `dt_home`,
`dt_sparkls_1`, `dt_heart_red`, `dt_emoji_happy`. The full list of your bar:
`GET /api/storage/list?path=/ext/apps_assets/shared/images`.

## Troubleshooting

- **409 in the console**: the switch on the bar is not on APPS.
- **403**: `BUSYBAR_PASSWORD` missing or wrong.
- **Shortcuts do nothing** while the bar follows the slides: the browser
  cached a version of the shortcuts from before the addon was installed. Clear
  the site data of `localhost:3030` once (DevTools → Application → Storage →
  Clear site data).
- **The wheel does nothing**: the switch must be on APPS, a window of the deck
  must be open, and Node must be 22 or later. `BUSYBAR_DEBUG=true` logs every
  input the bar sends.
- **See what goes to the bar**: `BUSYBAR_DEBUG=true slidev`.

## What we learnt about the bar

Tested on firmware 1.2.4 (API 27.5.0). None of it is in the official docs:

- Only the `global` font has accented letters; the others show boxes. Its
  capitals are drawn without their accent.
- The native `countdown` element uses a fixed 5-pixel font, unreadable from
  the back of a room: the addon draws the time itself, once per second.
- A `DisplayDraw` adds to the application's elements instead of replacing
  them. An element drawn again under the same `id` is updated, not replaced:
  some fields survive, such as a rectangle's gradient when redrawn solid. The
  relay clears an element first when its type or fill changes.
- A rectangle without an explicit `z_index` placed after a text element is
  drawn over rectangles with a higher `z_index`.
- Firmware images and animations are addressed as
  `shared/images/<name>.image` and `shared/animations/<name>.anim`.
- The firmware 1.2.4 ships three sounds: `calendar_event_starts`,
  `calendar_reminder_ends` and `volume_change`, addressed as
  `shared/<name>.snd`. The same path with a `wav` extension is accepted (a
  200 OK) but plays nothing.
- `led_notification_color` on a draw blinks the status LED; the next draw
  without it stops it.
- Buttons, wheel and switch come on the WebSocket `/api/status/ws`
  (`?x-api-token=` over Wi-Fi, then send `{"enable":true}`), as protobuf
  `StateUpdate.input` (field 11). Start/Stop is `Button 2`, Back `Button 1`;
  press and release come separately. A wheel notch is one `sint32` delta of
  ±1. The switch is rotary: moving it reports every position it passes.
  Screen frames come on the same socket, about ten a second.
- That stream sometimes goes silent after a minute or so without closing:
  the addon reconnects after 5 s of silence. busy-lib's `LocalStateStream`
  needs a browser Web Worker, so the addon reads the socket itself.
- The firmware plays every sound file as raw PCM, signed 16-bit
  little-endian, mono, 44 100 Hz, and ignores headers: a 22 050 Hz WAV plays
  twice as fast. The addon converts WAV files and uploads them to its assets
  (`AssetsUpload`), then plays them with `AudioPlay({ path })`.

## How it works

`global-bottom.vue` works out, in the browser, the chapter and progress of the
current slide and posts them to the dev server (`POST /__busy/slide`). A Vite
plugin (`src/plugin.ts`) receives them, ignores duplicates (audience and
presenter windows send the same slide) and hands them to the relay, which
draws on the bar with [`@busy-app/busy-lib`](https://github.com/busy-app/busylib-ts):
one call in flight at a time, only what changed.

The plugin also listens to the bar's state stream (`src/stream.ts`,
`src/input.ts`) and plays the action set for each control
(`src/controls.ts`): timer actions in the relay, Slidev actions over Vite's HMR
socket to one window, where `setup/shortcuts.ts` calls Slidev's navigation.

## Develop

```bash
npm install
npm test          # renderer, relay and timer, no bar needed (Node ≥ 23.6)
npm run dev       # builds, then opens example/slides.md
npm run preview -- /tmp/screens   # draws every state on a real bar and saves screenshots
```

`npm run dev` and `npm run preview` read the bar's address and code from
`.env.local` at the root of the repository: `cp .env.example .env.local`, then
fill it in.

### Release

Rename `## Unreleased` to `## <version> — <date>`, commit, then:

```bash
npm version minor          # or patch / major: bumps, commits and tags
git push --follow-tags
```

The `Release` workflow checks that the tag matches `package.json` and that
the changelog has its section, runs the tests, publishes to npm with a
provenance attestation (trusted publishing: no npm token) and creates the
GitHub release from the changelog section.

## Roadmap

- [x] Drive the deck from the bar's wheel and buttons, configurable
- [x] Breaks that count down and call people back
- [x] Workshop timers in phases (read, code, share)
- [x] Configurable sounds, with your own WAV files
- [x] Release workflow: tag, test, publish with provenance
- [x] Ad-hoc timer set with the wheel, no slide needed
- [ ] The day's programme: ahead/behind, "Next: Lunch at 12:30", end-of-day
  report
- [ ] Participant roulette spun with the wheel
- [ ] Audience phone page: "done" / "need help" counts in workshops, reactions
- [ ] Bar reacts to Slidev clicks (`busy.clicks`)
- [ ] Animated chapter transitions
- [ ] Countdown before the start, finale on the last slide
- [ ] Presenter dashboard on the back screen (clock, next chapter, timer)
- [ ] Configurable keyboard shortcuts, more locales
- [ ] Logos from a PNG
- [ ] Verify USB on hardware
- [ ] Integration tests against the emulator

## License

[MIT](LICENSE)
