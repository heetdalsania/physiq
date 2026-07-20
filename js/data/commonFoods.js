/* ─── PHYSIQ ENGINE — Common Foods (Day Planner candidate pool) ───────────
 *
 * Curated staples with per-serving macros, used by the Plan-a-Day
 * recommendation engine so suggestions work offline and deterministically.
 * Values are typical USDA-style numbers per listed serving. Same field
 * shape as logged meal items / search results.
 * ───────────────────────────────────────────────────────────────────────── */

export const COMMON_FOODS = [
  // Protein-forward
  { name: "Chicken Breast",          serving: "6 oz",     cal: 280, protein: 52,  carbs: 0,  fats: 6,    fiber: 0,   sugar: 0,  sodium: 130, potassium: 440 },
  { name: "Greek Yogurt (nonfat)",   serving: "1 cup",    cal: 130, protein: 22,  carbs: 9,  fats: 0,    fiber: 0,   sugar: 7,  sodium: 85,  potassium: 240 },
  { name: "Whey Protein Shake",      serving: "1 scoop",  cal: 120, protein: 24,  carbs: 3,  fats: 1.5,  fiber: 0,   sugar: 2,  sodium: 130, potassium: 160 },
  { name: "Eggs",                    serving: "2 large",  cal: 140, protein: 12,  carbs: 1,  fats: 10,   fiber: 0,   sugar: 0,  sodium: 140, potassium: 140 },
  { name: "Salmon Fillet",           serving: "5 oz",     cal: 290, protein: 32,  carbs: 0,  fats: 18,   fiber: 0,   sugar: 0,  sodium: 85,  potassium: 630 },
  { name: "Lean Ground Beef (93/7)", serving: "4 oz",     cal: 170, protein: 24,  carbs: 0,  fats: 8,    fiber: 0,   sugar: 0,  sodium: 75,  potassium: 360 },
  { name: "Canned Tuna",             serving: "1 can",    cal: 100, protein: 22,  carbs: 0,  fats: 1,    fiber: 0,   sugar: 0,  sodium: 320, potassium: 200 },
  { name: "Cottage Cheese (low-fat)",serving: "1 cup",    cal: 180, protein: 24,  carbs: 8,  fats: 5,    fiber: 0,   sugar: 6,  sodium: 700, potassium: 190 },
  { name: "Tofu (firm)",             serving: "6 oz",     cal: 145, protein: 16,  carbs: 4,  fats: 8,    fiber: 1,   sugar: 1,  sodium: 15,  potassium: 300 },
  { name: "Shrimp",                  serving: "5 oz",     cal: 120, protein: 24,  carbs: 1,  fats: 1.5,  fiber: 0,   sugar: 0,  sodium: 300, potassium: 220 },

  // Carb-forward
  { name: "White Rice (cooked)",     serving: "1 cup",    cal: 205, protein: 4,   carbs: 45, fats: 0.5,  fiber: 0.5, sugar: 0,  sodium: 2,   potassium: 55 },
  { name: "Brown Rice (cooked)",     serving: "1 cup",    cal: 215, protein: 5,   carbs: 45, fats: 1.8,  fiber: 3.5, sugar: 0,  sodium: 10,  potassium: 85 },
  { name: "Oats (dry)",              serving: "1 cup",    cal: 300, protein: 10,  carbs: 54, fats: 5,    fiber: 8,   sugar: 1,  sodium: 5,   potassium: 330 },
  { name: "Banana",                  serving: "1 medium", cal: 105, protein: 1,   carbs: 27, fats: 0.4,  fiber: 3,   sugar: 14, sodium: 1,   potassium: 420 },
  { name: "Sweet Potato",            serving: "1 medium", cal: 115, protein: 2,   carbs: 27, fats: 0,    fiber: 4,   sugar: 6,  sodium: 40,  potassium: 540 },
  { name: "Whole Wheat Bread",       serving: "2 slices", cal: 160, protein: 8,   carbs: 28, fats: 2,    fiber: 4,   sugar: 4,  sodium: 290, potassium: 140 },
  { name: "Pasta (cooked)",          serving: "1.5 cups", cal: 330, protein: 12,  carbs: 65, fats: 2,    fiber: 4,   sugar: 2,  sodium: 2,   potassium: 90 },
  { name: "Bagel (plain)",           serving: "1 bagel",  cal: 280, protein: 11,  carbs: 56, fats: 1.5,  fiber: 2,   sugar: 5,  sodium: 430, potassium: 100 },
  { name: "Apple",                   serving: "1 medium", cal: 95,  protein: 0.5, carbs: 25, fats: 0.3,  fiber: 4,   sugar: 19, sodium: 2,   potassium: 195 },
  { name: "Baked Potato",            serving: "1 medium", cal: 160, protein: 4,   carbs: 37, fats: 0.2,  fiber: 4,   sugar: 2,  sodium: 15,  potassium: 925 },

  // Fat-forward
  { name: "Peanut Butter",           serving: "2 tbsp",   cal: 190, protein: 8,   carbs: 7,  fats: 16,   fiber: 2,   sugar: 3,  sodium: 140, potassium: 190 },
  { name: "Almonds",                 serving: "1 oz",     cal: 165, protein: 6,   carbs: 6,  fats: 14,   fiber: 3.5, sugar: 1,  sodium: 0,   potassium: 210 },
  { name: "Avocado",                 serving: "1/2 fruit",cal: 120, protein: 1.5, carbs: 6,  fats: 11,   fiber: 5,   sugar: 0.5,sodium: 5,   potassium: 350 },
  { name: "Olive Oil",               serving: "1 tbsp",   cal: 120, protein: 0,   carbs: 0,  fats: 14,   fiber: 0,   sugar: 0,  sodium: 0,   potassium: 0 },
  { name: "Cheddar Cheese",          serving: "1.5 oz",   cal: 170, protein: 10,  carbs: 1,  fats: 14,   fiber: 0,   sugar: 0,  sodium: 270, potassium: 40 },
  { name: "Whole Milk",              serving: "1 cup",    cal: 150, protein: 8,   carbs: 12, fats: 8,    fiber: 0,   sugar: 12, sodium: 105, potassium: 320 },
  { name: "Dark Chocolate",          serving: "1 oz",     cal: 170, protein: 2,   carbs: 13, fats: 12,   fiber: 3,   sugar: 7,  sodium: 5,   potassium: 200 },
  { name: "Trail Mix",               serving: "1/4 cup",  cal: 170, protein: 5,   carbs: 16, fats: 11,   fiber: 2,   sugar: 8,  sodium: 60,  potassium: 220 }
];
