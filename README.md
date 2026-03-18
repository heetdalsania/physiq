# PHYSIQ ENGINE

A comprehensive nutrition & fitness optimizer for building muscle, cutting fat, debloating, and maintaining healthy nutrient levels — all personalized to your body and goals.

## Features

- **Smart Calorie & Macro Calculator** — BMR/TDEE based on Mifflin-St Jeor, adjusted for your goal (build, lean bulk, maintain, cut, debloat)
- **Full Nutrient Tracking** — Protein, carbs, fats, sodium, potassium, sugar, fiber, creatine, calcium, magnesium, iron, zinc, Vitamin D, B12, Omega-3
- **Muscle Group Pairing** — Select today's workout muscles and get nutrient recommendations tailored to recovery (push day creatine, pull day ZMA, leg day glycogen)
- **Debloat Mode** — Sodium/potassium ratio optimization, water intake targets, anti-inflammatory food suggestions
- **Smart Suggestions** — Real-time actionable advice based on your intake gaps and workout
- **Water Tracker** — Dynamic target based on weight, exercise, and daily steps
- **Customizable Profile** — Age, weight, height, body fat %, sex, activity level, average steps, gym frequency
- **Auto-Save** — All data persists in your browser via localStorage, resets daily for fresh tracking

## Quick Start

### Option A: Use it right now (local file)
1. Download `index.html`
2. Open it in any browser
3. Done — works offline, no server needed

### Option B: Host free on GitHub Pages
1. Go to [github.com/new](https://github.com/new) and create a new repository (e.g., `physiq-engine`)
2. Make sure it's **Public**
3. Upload `index.html` to the repository
4. Go to **Settings → Pages**
5. Under "Source," select **Deploy from a branch**
6. Choose **main** branch and **/ (root)** folder
7. Click **Save**
8. Wait ~60 seconds, then visit `https://YOUR-USERNAME.github.io/physiq-engine/`

### Option C: Add to your phone's home screen (PWA-like)
After hosting on GitHub Pages:
- **iPhone**: Open the URL in Safari → tap Share → "Add to Home Screen"
- **Android**: Open in Chrome → tap menu → "Add to Home Screen"

It will launch full-screen like a native app.

## Tech Stack

- Pure HTML/CSS/JS — single file, zero build step
- React 18 (CDN) + Babel standalone
- localStorage for data persistence
- Mobile-first responsive design

## Customization

Edit the constants at the top of the `<script>` block in `index.html`:
- `MUSCLE_GROUPS` — add/remove muscle groups and their key nutrients
- `GOALS` — adjust calorie surplus/deficit and protein multipliers
- `ACTIVITY_LEVELS` — modify step ranges and activity multipliers
- `DEFAULT_PROFILE` — change starting profile values

## License

Personal use. Built with PHYSIQ ENGINE.
