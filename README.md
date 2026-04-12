# PHYSIQ ENGINE

**[Launch App →](https://heetdalsania.github.io/physiq/)**

A comprehensive nutrition and fitness optimizer — personalized to your body, your goals, and your routine.

## Features

### Account System
- **Email-based profiles** — sign in with email, data saved and loaded automatically
- **One-time onboarding** — 3-step wizard captures build, goal, and activity on first sign-in
- **Multi-user support** — switch accounts on the same device
- **Daily auto-reset** — meal log resets each morning, profile persists

### ◉ Dashboard
- Calorie ring with real-time macro split (protein / carbs / fats)
- Water tracker with add/subtract, dynamic targets
- Key nutrients with progress bars and micronutrient tracking
- Smart suggestions based on intake gaps and today's workout
- Meal log with timestamps and one-tap removal

### ▣ Eats (Unified Food Logging)
- **AI Search** — type any food in natural language ("banana", "grilled chicken breast", "protein shake") and get instant nutrition data from the USDA FoodData Central database (380,000+ foods). One-tap to log. 100% free, no limits.
- **Manual** — custom entry for any meal with full macro and nutrient fields
- **Scan** — camera-based food scanning placeholder (coming soon)
- **Menu** — 6 fast food restaurant menus (McDonald's, Chipotle, Chick-fil-A, Taco Bell, Subway, Wendy's) with search, category filters, and one-tap logging
- **Remaining budget bar** — always visible across all modes

### ♦ Health
- **Goals** — Build Muscle, Lean Bulk, Maintain, Debloat + Cut, Cut Fat
- **Activity Level** — Sedentary through Extreme with step ranges
- **Muscle Groups** — 8 groups with recovery windows, nutrient focus pairing

### ⚙ Profile & Projections
- 12-week weight projection chart with weekly labels
- Daily macro targets bar chart
- Calorie & protein history (last 7 days with day/date labels)
- Editable BMR override
- Computed stats: BMR, TDEE, target calories, lean mass, protein, water
- Collapsible build editor
- Light / Dark mode

## AI Food Search

The AI Search feature uses the **USDA FoodData Central API** — a free, government-backed database maintained by the U.S. Department of Agriculture with 380,000+ foods. It supports natural language queries and returns complete nutrition data including calories, protein, carbs, fats, fiber, sugar, sodium, and potassium.

- **100% free** — no API costs, no usage limits for normal use
- **No AI model costs** — uses USDA's search endpoint, not an LLM
- **Scales infinitely** — each user's browser makes its own API calls
- **Public domain data** — CC0 licensed, no restrictions

## Quick Start

**Live:** [https://heetdalsania.github.io/physiq/](https://heetdalsania.github.io/physiq/)

**Phone:** Safari/Chrome → Share → Add to Home Screen

**Local:** Clone the repo and serve via any HTTP server (e.g. `python3 -m http.server`). Works offline (except AI search).

## Tech Stack

Modular multi-file architecture · React 18 + Babel (CDN) · USDA FoodData Central API · localStorage per-user · Pure SVG charts · CSS custom properties theming · Mobile-first

## Project Structure

```
physiq/
├── index.html                 # Entry point — loads scripts in dependency order
├── css/
│   └── styles.css             # All styles (theme variables, components, layouts)
├── js/
│   ├── data/
│   │   ├── constants.js       # Muscle groups, goals, activity levels, nutrient info
│   │   └── fastFoodMenu.js    # 6 restaurant menus with full nutrition data
│   ├── utils/
│   │   ├── storage.js         # localStorage helpers (per-user, daily reset)
│   │   └── calculations.js    # BMR, TDEE, macro targets, smart suggestions
│   ├── components/
│   │   ├── ProgressRing.js    # SVG calorie ring
│   │   ├── NutrientCard.js    # Nutrient progress cards (full + compact)
│   │   ├── Charts.js          # Bar charts, projection chart, history chart
│   │   └── PortionModal.js    # Portion size selector modal
│   ├── screens/
│   │   ├── LoginScreen.js     # Email login
│   │   ├── OnboardScreen.js   # 3-step onboarding wizard
│   │   ├── DashboardTab.js    # Main dashboard (ring, water, nutrients, meals)
│   │   ├── EatsTab.js         # Food logging (search, manual, scan, menu)
│   │   ├── HealthTab.js       # Goals, activity, muscle groups
│   │   └── ProfileTab.js      # Projections, stats, settings
│   └── App.js                 # Root component — state management + routing
└── README.md
```

## License

Personal use. USDA nutrition data is public domain (CC0 1.0).
