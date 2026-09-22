---
# `.` is the addon's own folder: Slidev resolves local addons from the
# parent of the deck. In your deck, write `addons: [busybar]` instead.
addons:
  - .
title: slidev-addon-busybar
busy:
  screen: welcome
---

# slidev-addon-busybar

A BUSY Bar that follows your slides. Turn its wheel to move on.

---
busy:
  screen: acme
---

# A custom logo

Declared in `busybar.config.ts`.

---
layout: section
busy:
  chapter: Getting started
---

# Getting started

---

# Install

The bar shows the chapter and, on its last row, how far you are in it.

---

# Configure

`.env.local` holds the bar's address and access code.

<v-click>

The wheel steps through clicks too, like this one.

</v-click>

---
busy:
  activity: Quiz
  timer: 90s
---

# Quiz

Press Start/Stop on the bar (or `b`) to start the timer, again to pause.
Hold it (or press `+`) for one more minute; hold Back (or `Shift` + `x`) to
cancel.

---
busy:
  activity: Lab
  timer: [1m Reading, 2m Coding, 1m Sharing]
---

# Lab

Each phase waits for Start/Stop; hold Back to cancel. Clicking the wheel
skips to the next phase.

---
busy:
  screen: break
  timer: 15m
---

# Break

Press Start/Stop on the bar (or `b`): the bar counts down and calls
everyone back.

---
layout: section
busy:
  chapter: Référencer du code
---

# Référencer du code

Accents are drawn with the bar's `global` font; long titles scroll.

---
busy:
  screen: questions
---

# Questions?
