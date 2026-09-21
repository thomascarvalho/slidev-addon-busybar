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

A BUSY Bar that follows your slides.

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

---
busy:
  activity: Quiz
  timer: 90s
---

# Quiz

Press `b` to start the timer, again to pause, `+` for one more minute.

---
busy:
  screen: pause
  until: "10:45"
---

# Break

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
