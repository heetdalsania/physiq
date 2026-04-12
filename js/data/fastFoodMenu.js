/* ─── PHYSIQ ENGINE — Fast Food Menu Database ────────────────────────────── */

window.PhysIQ = window.PhysIQ || {};
window.PhysIQ.Data = window.PhysIQ.Data || {};

(function(Data) {

  // ─── Restaurant List (with aliases for OSM matching) ───────────────────
  Data.FF_RESTAURANTS = [
    { id: "mcdonalds",   name: "McDonald's",    color: "#FFC72C", icon: "🍔", aliases: ["mcdonalds", "mcdonald's", "mc donald", "mcd"] },
    { id: "chipotle",    name: "Chipotle",      color: "#A81612", icon: "🌯", aliases: ["chipotle", "chipotle mexican grill"] },
    { id: "chickfila",   name: "Chick-fil-A",   color: "#E51636", icon: "🐔", aliases: ["chick-fil-a", "chickfila", "chick fil a"] },
    { id: "tacobell",    name: "Taco Bell",     color: "#702082", icon: "🌮", aliases: ["taco bell", "tacobell"] },
    { id: "subway",      name: "Subway",        color: "#008C15", icon: "🥖", aliases: ["subway"] },
    { id: "wendys",      name: "Wendy's",       color: "#E2203D", icon: "🍟", aliases: ["wendy's", "wendys"] },
    { id: "pandaexpress",name: "Panda Express", color: "#D02B2B", icon: "🥡", aliases: ["panda express", "pandaexpress"] },
    { id: "fiveguys",    name: "Five Guys",     color: "#B7191C", icon: "🍔", aliases: ["five guys", "fiveguys", "five guys burgers"] },
    { id: "popeyes",     name: "Popeyes",       color: "#F15A22", icon: "🍗", aliases: ["popeyes", "popeye's", "popeyes louisiana kitchen"] },
    { id: "innout",      name: "In-N-Out",      color: "#FFD700", icon: "🎯", aliases: ["in-n-out", "in n out", "innout", "in-n-out burger"] },
    { id: "panera",      name: "Panera Bread",  color: "#4A7C2E", icon: "🥐", aliases: ["panera", "panera bread"] },
    { id: "starbucks",   name: "Starbucks",     color: "#00704A", icon: "☕", aliases: ["starbucks", "starbucks coffee"] },
    { id: "dunkin",      name: "Dunkin'",       color: "#FF671F", icon: "🍩", aliases: ["dunkin", "dunkin'", "dunkin donuts", "dunkin' donuts"] }
  ];

  // ─── Full Menu Data ────────────────────────────────────────────────────
  Data.FF_MENU = {

    mcdonalds: {
      categories: ["Burgers", "Chicken", "Breakfast", "Sides"],
      items: [
        { name: "Big Mac",                    cat: "Burgers",    cal: 550, protein: 25, carbs: 45, fats: 30, fiber: 3, sugar: 9,  sodium: 1010, potassium: 350 },
        { name: "Quarter Pounder w/ Cheese",  cat: "Burgers",    cal: 520, protein: 30, carbs: 42, fats: 27, fiber: 2, sugar: 10, sodium: 1150, potassium: 370 },
        { name: "McDouble",                   cat: "Burgers",    cal: 400, protein: 22, carbs: 33, fats: 20, fiber: 2, sugar: 7,  sodium: 920,  potassium: 280 },
        { name: "Hamburger",                  cat: "Burgers",    cal: 250, protein: 12, carbs: 31, fats: 9,  fiber: 2, sugar: 6,  sodium: 520,  potassium: 200 },
        { name: "Cheeseburger",               cat: "Burgers",    cal: 300, protein: 15, carbs: 33, fats: 12, fiber: 2, sugar: 7,  sodium: 750,  potassium: 220 },
        { name: "Double Cheeseburger",        cat: "Burgers",    cal: 450, protein: 25, carbs: 34, fats: 24, fiber: 2, sugar: 7,  sodium: 1120, potassium: 310 },
        { name: "10pc McNuggets",             cat: "Chicken",    cal: 410, protein: 25, carbs: 26, fats: 24, fiber: 1, sugar: 0,  sodium: 900,  potassium: 320 },
        { name: "McChicken",                  cat: "Chicken",    cal: 400, protein: 14, carbs: 40, fats: 21, fiber: 2, sugar: 5,  sodium: 760,  potassium: 200 },
        { name: "Spicy McCrispy",             cat: "Chicken",    cal: 530, protein: 27, carbs: 48, fats: 26, fiber: 2, sugar: 7,  sodium: 1180, potassium: 300 },
        { name: "Egg McMuffin",               cat: "Breakfast",  cal: 300, protein: 17, carbs: 30, fats: 12, fiber: 2, sugar: 3,  sodium: 770,  potassium: 200 },
        { name: "Sausage McMuffin w/ Egg",    cat: "Breakfast",  cal: 480, protein: 20, carbs: 30, fats: 31, fiber: 2, sugar: 2,  sodium: 830,  potassium: 220 },
        { name: "Sausage Burrito",            cat: "Breakfast",  cal: 310, protein: 13, carbs: 25, fats: 17, fiber: 1, sugar: 2,  sodium: 800,  potassium: 180 },
        { name: "Medium Fries",               cat: "Sides",      cal: 320, protein: 5,  carbs: 43, fats: 15, fiber: 4, sugar: 0,  sodium: 260,  potassium: 570 },
        { name: "Large Fries",                cat: "Sides",      cal: 480, protein: 7,  carbs: 65, fats: 23, fiber: 6, sugar: 0,  sodium: 400,  potassium: 850 },
        { name: "Hash Brown",                 cat: "Sides",      cal: 140, protein: 1,  carbs: 16, fats: 8,  fiber: 2, sugar: 0,  sodium: 310,  potassium: 190 }
      ]
    },

    chipotle: {
      categories: ["Bowls", "Burritos", "Tacos", "Sides"],
      items: [
        { name: "Chicken Bowl (full)",  cat: "Bowls",    cal: 865,  protein: 47, carbs: 90,  fats: 28, fiber: 10, sugar: 5, sodium: 1680, potassium: 650 },
        { name: "Steak Bowl (full)",    cat: "Bowls",    cal: 900,  protein: 44, carbs: 90,  fats: 32, fiber: 10, sugar: 5, sodium: 1420, potassium: 700 },
        { name: "Barbacoa Bowl (full)", cat: "Bowls",    cal: 870,  protein: 42, carbs: 91,  fats: 30, fiber: 11, sugar: 5, sodium: 1720, potassium: 680 },
        { name: "Chicken Burrito",      cat: "Burritos", cal: 1060, protein: 52, carbs: 120, fats: 37, fiber: 12, sugar: 6, sodium: 2270, potassium: 700 },
        { name: "Steak Burrito",        cat: "Burritos", cal: 1100, protein: 49, carbs: 120, fats: 41, fiber: 12, sugar: 6, sodium: 2010, potassium: 750 },
        { name: "Chicken Tacos (3)",    cat: "Tacos",    cal: 615,  protein: 38, carbs: 42,  fats: 30, fiber: 5,  sugar: 3, sodium: 1050, potassium: 400 },
        { name: "White Rice",           cat: "Sides",    cal: 210,  protein: 4,  carbs: 40,  fats: 4,  fiber: 1,  sugar: 0, sodium: 340,  potassium: 60 },
        { name: "Black Beans",          cat: "Sides",    cal: 130,  protein: 8,  carbs: 22,  fats: 1,  fiber: 7,  sugar: 1, sodium: 260,  potassium: 350 },
        { name: "Guacamole",            cat: "Sides",    cal: 230,  protein: 3,  carbs: 12,  fats: 22, fiber: 7,  sugar: 1, sodium: 375,  potassium: 500 },
        { name: "Chips & Guac",         cat: "Sides",    cal: 780,  protein: 11, carbs: 80,  fats: 49, fiber: 12, sugar: 1, sodium: 795,  potassium: 700 }
      ]
    },

    chickfila: {
      categories: ["Entrees", "Nuggets", "Breakfast", "Sides"],
      items: [
        { name: "Chicken Sandwich",        cat: "Entrees",   cal: 440, protein: 28, carbs: 40, fats: 19, fiber: 1,  sugar: 6,  sodium: 1350, potassium: 300 },
        { name: "Spicy Chicken Sandwich",  cat: "Entrees",   cal: 450, protein: 28, carbs: 42, fats: 19, fiber: 2,  sugar: 6,  sodium: 1620, potassium: 310 },
        { name: "Grilled Chicken Sandwich",cat: "Entrees",   cal: 320, protein: 28, carbs: 36, fats: 6,  fiber: 3,  sugar: 10, sodium: 800,  potassium: 350 },
        { name: "Grilled Cool Wrap",       cat: "Entrees",   cal: 350, protein: 37, carbs: 29, fats: 13, fiber: 15, sugar: 5,  sodium: 1070, potassium: 400 },
        { name: "8ct Grilled Nuggets",     cat: "Nuggets",   cal: 130, protein: 25, carbs: 1,  fats: 3,  fiber: 0,  sugar: 1,  sodium: 440,  potassium: 280 },
        { name: "12ct Nuggets",            cat: "Nuggets",   cal: 380, protein: 40, carbs: 16, fats: 17, fiber: 0,  sugar: 1,  sodium: 1200, potassium: 400 },
        { name: "Egg White Grill",         cat: "Breakfast", cal: 300, protein: 25, carbs: 31, fats: 7,  fiber: 1,  sugar: 4,  sodium: 960,  potassium: 220 },
        { name: "Waffle Fries (Med)",      cat: "Sides",     cal: 420, protein: 5,  carbs: 45, fats: 24, fiber: 5,  sugar: 0,  sodium: 380,  potassium: 520 },
        { name: "Kale Crunch Side",        cat: "Sides",     cal: 120, protein: 3,  carbs: 14, fats: 6,  fiber: 2,  sugar: 9,  sodium: 170,  potassium: 200 }
      ]
    },

    tacobell: {
      categories: ["Tacos", "Burritos", "Specialties", "Sides"],
      items: [
        { name: "Crunchy Taco",          cat: "Tacos",       cal: 170, protein: 8,  carbs: 13, fats: 10, fiber: 2, sugar: 1, sodium: 310,  potassium: 150 },
        { name: "Soft Chicken Taco",     cat: "Tacos",       cal: 170, protein: 12, carbs: 16, fats: 6,  fiber: 1, sugar: 1, sodium: 470,  potassium: 180 },
        { name: "Doritos Locos Taco",    cat: "Tacos",       cal: 170, protein: 8,  carbs: 13, fats: 10, fiber: 2, sugar: 1, sodium: 340,  potassium: 150 },
        { name: "Crunchwrap Supreme",    cat: "Specialties", cal: 540, protein: 16, carbs: 71, fats: 21, fiber: 5, sugar: 6, sodium: 1100, potassium: 300 },
        { name: "Mexican Pizza",         cat: "Specialties", cal: 540, protein: 20, carbs: 47, fats: 30, fiber: 6, sugar: 3, sodium: 1000, potassium: 350 },
        { name: "Chicken Quesadilla",    cat: "Specialties", cal: 500, protein: 27, carbs: 37, fats: 27, fiber: 3, sugar: 3, sodium: 1150, potassium: 280 },
        { name: "Bean Burrito",          cat: "Burritos",    cal: 350, protein: 13, carbs: 54, fats: 9,  fiber: 9, sugar: 3, sodium: 1060, potassium: 400 },
        { name: "Beefy 5-Layer Burrito", cat: "Burritos",    cal: 490, protein: 19, carbs: 63, fats: 18, fiber: 6, sugar: 4, sodium: 1250, potassium: 350 },
        { name: "Cheesy Fiesta Potatoes",cat: "Sides",       cal: 230, protein: 3,  carbs: 27, fats: 12, fiber: 2, sugar: 1, sodium: 590,  potassium: 300 }
      ]
    },

    subway: {
      categories: ["6-inch Subs", "Footlongs", "Sides"],
      items: [
        { name: '6" Turkey Breast',      cat: "6-inch Subs", cal: 270, protein: 18, carbs: 42, fats: 3,  fiber: 4, sugar: 6,  sodium: 710,  potassium: 250 },
        { name: '6" Chicken Teriyaki',   cat: "6-inch Subs", cal: 340, protein: 26, carbs: 46, fats: 5,  fiber: 4, sugar: 12, sodium: 780,  potassium: 300 },
        { name: '6" Italian BMT',        cat: "6-inch Subs", cal: 370, protein: 17, carbs: 43, fats: 14, fiber: 4, sugar: 6,  sodium: 1260, potassium: 250 },
        { name: '6" Steak & Cheese',     cat: "6-inch Subs", cal: 350, protein: 24, carbs: 43, fats: 10, fiber: 4, sugar: 7,  sodium: 870,  potassium: 300 },
        { name: '6" Rotisserie Chicken', cat: "6-inch Subs", cal: 300, protein: 23, carbs: 40, fats: 6,  fiber: 4, sugar: 6,  sodium: 630,  potassium: 280 },
        { name: '12" Turkey Breast',     cat: "Footlongs",   cal: 540, protein: 36, carbs: 84, fats: 6,  fiber: 8, sugar: 12, sodium: 1420, potassium: 500 },
        { name: '12" Chicken Teriyaki',  cat: "Footlongs",   cal: 680, protein: 52, carbs: 92, fats: 10, fiber: 8, sugar: 24, sodium: 1560, potassium: 600 },
        { name: "Chips",                 cat: "Sides",       cal: 230, protein: 2,  carbs: 30, fats: 12, fiber: 2, sugar: 1,  sodium: 350,  potassium: 300 },
        { name: "Cookie",                cat: "Sides",       cal: 210, protein: 2,  carbs: 30, fats: 10, fiber: 1, sugar: 18, sodium: 150,  potassium: 60 }
      ]
    },

    wendys: {
      categories: ["Burgers", "Chicken", "Sides"],
      items: [
        { name: "Dave's Single",    cat: "Burgers", cal: 570, protein: 30, carbs: 39, fats: 34, fiber: 2, sugar: 9, sodium: 1150, potassium: 400 },
        { name: "Dave's Double",    cat: "Burgers", cal: 820, protein: 49, carbs: 40, fats: 51, fiber: 2, sugar: 9, sodium: 1500, potassium: 550 },
        { name: "Jr. Cheeseburger", cat: "Burgers", cal: 290, protein: 16, carbs: 27, fats: 13, fiber: 1, sugar: 6, sodium: 640,  potassium: 200 },
        { name: "Baconator",        cat: "Burgers", cal: 940, protein: 57, carbs: 38, fats: 62, fiber: 1, sugar: 8, sodium: 1720, potassium: 550 },
        { name: "Classic Chicken",  cat: "Chicken", cal: 490, protein: 28, carbs: 46, fats: 22, fiber: 2, sugar: 6, sodium: 1180, potassium: 300 },
        { name: "Spicy Chicken",    cat: "Chicken", cal: 480, protein: 28, carbs: 46, fats: 20, fiber: 2, sugar: 5, sodium: 1190, potassium: 300 },
        { name: "10pc Nuggets",     cat: "Chicken", cal: 430, protein: 24, carbs: 28, fats: 25, fiber: 0, sugar: 0, sodium: 870,  potassium: 250 },
        { name: "Medium Fries",     cat: "Sides",   cal: 350, protein: 4,  carbs: 44, fats: 17, fiber: 4, sugar: 0, sodium: 410,  potassium: 520 },
        { name: "Chili (Lg)",       cat: "Sides",   cal: 330, protein: 23, carbs: 31, fats: 13, fiber: 8, sugar: 8, sodium: 1170, potassium: 600 }
      ]
    },

    pandaexpress: {
      categories: ["Entrees", "Sides", "Appetizers"],
      items: [
        { name: "Orange Chicken",      cat: "Entrees",    cal: 490, protein: 25, carbs: 51, fats: 23, fiber: 0, sugar: 19, sodium: 820,  potassium: 240 },
        { name: "Beijing Beef",        cat: "Entrees",    cal: 470, protein: 14, carbs: 57, fats: 22, fiber: 3, sugar: 25, sodium: 660,  potassium: 300 },
        { name: "Kung Pao Chicken",    cat: "Entrees",    cal: 290, protein: 16, carbs: 16, fats: 19, fiber: 2, sugar: 7,  sodium: 880,  potassium: 330 },
        { name: "Broccoli Beef",       cat: "Entrees",    cal: 150, protein: 9,  carbs: 13, fats: 7,  fiber: 2, sugar: 7,  sodium: 520,  potassium: 290 },
        { name: "Teriyaki Chicken",    cat: "Entrees",    cal: 340, protein: 36, carbs: 14, fats: 14, fiber: 1, sugar: 8,  sodium: 530,  potassium: 400 },
        { name: "String Bean Chicken", cat: "Entrees",    cal: 190, protein: 14, carbs: 13, fats: 9,  fiber: 2, sugar: 5,  sodium: 570,  potassium: 250 },
        { name: "Fried Rice",          cat: "Sides",      cal: 520, protein: 12, carbs: 85, fats: 16, fiber: 1, sugar: 3,  sodium: 850,  potassium: 160 },
        { name: "Chow Mein",           cat: "Sides",      cal: 510, protein: 13, carbs: 80, fats: 22, fiber: 5, sugar: 9,  sodium: 860,  potassium: 200 },
        { name: "White Rice",          cat: "Sides",      cal: 380, protein: 7,  carbs: 86, fats: 0,  fiber: 0, sugar: 0,  sodium: 0,    potassium: 60 },
        { name: "Cream Cheese Rangoon",cat: "Appetizers", cal: 190, protein: 5,  carbs: 24, fats: 8,  fiber: 1, sugar: 1,  sodium: 180,  potassium: 40 },
        { name: "Chicken Egg Roll",    cat: "Appetizers", cal: 200, protein: 8,  carbs: 20, fats: 10, fiber: 2, sugar: 3,  sodium: 390,  potassium: 100 }
      ]
    },

    fiveguys: {
      categories: ["Burgers", "Hot Dogs", "Sides"],
      items: [
        { name: "Hamburger",           cat: "Burgers",  cal: 700, protein: 39, carbs: 39, fats: 43, fiber: 2, sugar: 8,  sodium: 430,  potassium: 450 },
        { name: "Cheeseburger",        cat: "Burgers",  cal: 840, protein: 47, carbs: 40, fats: 55, fiber: 2, sugar: 8,  sodium: 1050, potassium: 500 },
        { name: "Little Hamburger",    cat: "Burgers",  cal: 480, protein: 23, carbs: 39, fats: 26, fiber: 2, sugar: 8,  sodium: 380,  potassium: 300 },
        { name: "Little Cheeseburger", cat: "Burgers",  cal: 550, protein: 27, carbs: 40, fats: 32, fiber: 2, sugar: 8,  sodium: 690,  potassium: 330 },
        { name: "Bacon Burger",        cat: "Burgers",  cal: 780, protein: 43, carbs: 39, fats: 50, fiber: 2, sugar: 8,  sodium: 690,  potassium: 500 },
        { name: "Hot Dog",             cat: "Hot Dogs", cal: 545, protein: 18, carbs: 40, fats: 35, fiber: 2, sugar: 8,  sodium: 1130, potassium: 250 },
        { name: "Cheese Dog",          cat: "Hot Dogs", cal: 615, protein: 22, carbs: 41, fats: 41, fiber: 2, sugar: 8,  sodium: 1440, potassium: 280 },
        { name: "Regular Fries",       cat: "Sides",    cal: 530, protein: 8,  carbs: 64, fats: 23, fiber: 6, sugar: 0,  sodium: 960,  potassium: 900 },
        { name: "Cajun Fries",         cat: "Sides",    cal: 530, protein: 8,  carbs: 64, fats: 23, fiber: 6, sugar: 0,  sodium: 1460, potassium: 900 }
      ]
    },

    popeyes: {
      categories: ["Chicken", "Sandwiches", "Sides"],
      items: [
        { name: "Chicken Sandwich",         cat: "Sandwiches", cal: 700, protein: 28, carbs: 50, fats: 42, fiber: 2, sugar: 8,  sodium: 1443, potassium: 320 },
        { name: "Spicy Chicken Sandwich",   cat: "Sandwiches", cal: 700, protein: 28, carbs: 50, fats: 42, fiber: 2, sugar: 8,  sodium: 1707, potassium: 320 },
        { name: "3pc Tenders (Mild)",       cat: "Chicken",    cal: 340, protein: 21, carbs: 15, fats: 22, fiber: 1, sugar: 0,  sodium: 970,  potassium: 280 },
        { name: "2pc Leg & Thigh (Mild)",   cat: "Chicken",    cal: 410, protein: 28, carbs: 11, fats: 29, fiber: 1, sugar: 0,  sodium: 870,  potassium: 350 },
        { name: "Mashed Potatoes & Gravy",  cat: "Sides",      cal: 110, protein: 2,  carbs: 18, fats: 4,  fiber: 1, sugar: 1,  sodium: 570,  potassium: 200 },
        { name: "Cajun Fries (Reg)",        cat: "Sides",      cal: 260, protein: 4,  carbs: 34, fats: 14, fiber: 3, sugar: 0,  sodium: 750,  potassium: 400 },
        { name: "Red Beans & Rice",         cat: "Sides",      cal: 230, protein: 8,  carbs: 30, fats: 9,  fiber: 7, sugar: 1,  sodium: 680,  potassium: 380 },
        { name: "Biscuit",                  cat: "Sides",      cal: 200, protein: 3,  carbs: 26, fats: 10, fiber: 1, sugar: 2,  sodium: 430,  potassium: 50 }
      ]
    },

    innout: {
      categories: ["Burgers", "Sides", "Drinks"],
      items: [
        { name: "Hamburger",             cat: "Burgers", cal: 390, protein: 16, carbs: 39, fats: 19, fiber: 3, sugar: 10, sodium: 650,  potassium: 300 },
        { name: "Cheeseburger",          cat: "Burgers", cal: 480, protein: 22, carbs: 39, fats: 27, fiber: 3, sugar: 10, sodium: 1000, potassium: 330 },
        { name: "Double-Double",         cat: "Burgers", cal: 670, protein: 37, carbs: 39, fats: 41, fiber: 3, sugar: 10, sodium: 1440, potassium: 450 },
        { name: "Protein Style Burger",  cat: "Burgers", cal: 240, protein: 13, carbs: 11, fats: 17, fiber: 3, sugar: 7,  sodium: 370,  potassium: 250 },
        { name: "3x3",                   cat: "Burgers", cal: 860, protein: 53, carbs: 39, fats: 55, fiber: 3, sugar: 10, sodium: 1880, potassium: 570 },
        { name: "Animal Style Fries",    cat: "Sides",   cal: 750, protein: 19, carbs: 58, fats: 52, fiber: 2, sugar: 7,  sodium: 1210, potassium: 550 },
        { name: "French Fries",          cat: "Sides",   cal: 370, protein: 6,  carbs: 52, fats: 15, fiber: 2, sugar: 0,  sodium: 250,  potassium: 520 },
        { name: "Neapolitan Shake",      cat: "Drinks",  cal: 590, protein: 9,  carbs: 85, fats: 24, fiber: 0, sugar: 72, sodium: 260,  potassium: 400 }
      ]
    },

    panera: {
      categories: ["Sandwiches", "Soups", "Salads", "Bakery"],
      items: [
        { name: "Chipotle Chicken Avocado Melt", cat: "Sandwiches", cal: 830, protein: 42, carbs: 71, fats: 40, fiber: 7,  sugar: 8,  sodium: 1750, potassium: 600 },
        { name: "Bacon Turkey Bravo",            cat: "Sandwiches", cal: 600, protein: 36, carbs: 55, fats: 27, fiber: 2,  sugar: 7,  sodium: 1780, potassium: 400 },
        { name: "Mediterranean Veggie",          cat: "Sandwiches", cal: 520, protein: 17, carbs: 65, fats: 20, fiber: 5,  sugar: 6,  sodium: 1170, potassium: 350 },
        { name: "Broccoli Cheddar Soup (Bowl)",  cat: "Soups",      cal: 370, protein: 14, carbs: 30, fats: 21, fiber: 4,  sugar: 7,  sodium: 1470, potassium: 450 },
        { name: "Creamy Tomato Soup (Bowl)",     cat: "Soups",      cal: 340, protein: 7,  carbs: 33, fats: 21, fiber: 4,  sugar: 18, sodium: 1230, potassium: 600 },
        { name: "Caesar Salad (Full)",           cat: "Salads",     cal: 420, protein: 12, carbs: 23, fats: 32, fiber: 4,  sugar: 3,  sodium: 780,  potassium: 350 },
        { name: "Fuji Apple Chicken Salad",      cat: "Salads",     cal: 580, protein: 32, carbs: 46, fats: 30, fiber: 6,  sugar: 26, sodium: 870,  potassium: 500 },
        { name: "Cinnamon Crunch Bagel",         cat: "Bakery",     cal: 420, protein: 9,  carbs: 76, fats: 9,  fiber: 2,  sugar: 22, sodium: 460,  potassium: 100 },
        { name: "Chocolate Chip Cookie",         cat: "Bakery",     cal: 370, protein: 4,  carbs: 51, fats: 19, fiber: 2,  sugar: 30, sodium: 310,  potassium: 80 }
      ]
    },

    starbucks: {
      categories: ["Drinks", "Breakfast", "Snacks"],
      items: [
        { name: "Caffè Latte (Grande)",       cat: "Drinks",     cal: 190, protein: 13, carbs: 18, fats: 7,  fiber: 0, sugar: 17, sodium: 170, potassium: 350 },
        { name: "Caramel Macchiato (Grande)", cat: "Drinks",     cal: 250, protein: 10, carbs: 35, fats: 7,  fiber: 0, sugar: 33, sodium: 150, potassium: 300 },
        { name: "Mocha Frappuccino (Grande)", cat: "Drinks",     cal: 370, protein: 6,  carbs: 54, fats: 15, fiber: 0, sugar: 51, sodium: 210, potassium: 280 },
        { name: "Cold Brew (Grande)",         cat: "Drinks",     cal: 5,   protein: 0,  carbs: 0,  fats: 0,  fiber: 0, sugar: 0,  sodium: 15,  potassium: 200 },
        { name: "Bacon Egg & Gouda",          cat: "Breakfast",  cal: 370, protein: 19, carbs: 34, fats: 18, fiber: 1, sugar: 3,  sodium: 690, potassium: 200 },
        { name: "Egg White & Roasted Red Pepper", cat: "Breakfast", cal: 280, protein: 18, carbs: 33, fats: 8, fiber: 3, sugar: 3, sodium: 670, potassium: 220 },
        { name: "Impossible Breakfast Sandwich", cat: "Breakfast", cal: 420, protein: 22, carbs: 34, fats: 22, fiber: 3, sugar: 4, sodium: 860, potassium: 250 },
        { name: "Cheese Danish",              cat: "Snacks",     cal: 290, protein: 5,  carbs: 34, fats: 15, fiber: 0, sugar: 16, sodium: 280, potassium: 60 },
        { name: "Cake Pop",                   cat: "Snacks",     cal: 170, protein: 2,  carbs: 22, fats: 8,  fiber: 0, sugar: 17, sodium: 120, potassium: 40 }
      ]
    },

    dunkin: {
      categories: ["Drinks", "Donuts", "Breakfast"],
      items: [
        { name: "Medium Iced Latte",           cat: "Drinks",     cal: 120, protein: 8,  carbs: 12, fats: 4,  fiber: 0, sugar: 11, sodium: 120, potassium: 280 },
        { name: "Medium Hot Coffee w/ Cream",  cat: "Drinks",     cal: 60,  protein: 1,  carbs: 2,  fats: 6,  fiber: 0, sugar: 1,  sodium: 25,  potassium: 170 },
        { name: "Medium Frozen Caramel Latte", cat: "Drinks",     cal: 440, protein: 5,  carbs: 75, fats: 14, fiber: 0, sugar: 68, sodium: 170, potassium: 200 },
        { name: "Glazed Donut",                cat: "Donuts",     cal: 240, protein: 4,  carbs: 31, fats: 11, fiber: 1, sugar: 12, sodium: 340, potassium: 60 },
        { name: "Boston Kreme Donut",          cat: "Donuts",     cal: 280, protein: 4,  carbs: 38, fats: 13, fiber: 1, sugar: 17, sodium: 360, potassium: 70 },
        { name: "Chocolate Frosted Donut",     cat: "Donuts",     cal: 260, protein: 4,  carbs: 33, fats: 13, fiber: 1, sugar: 15, sodium: 350, potassium: 65 },
        { name: "Bacon Egg & Cheese Croissant",cat: "Breakfast",  cal: 540, protein: 22, carbs: 39, fats: 33, fiber: 1, sugar: 6,  sodium: 1010, potassium: 200 },
        { name: "Sausage Egg & Cheese Wake-Up Wrap", cat: "Breakfast", cal: 290, protein: 13, carbs: 14, fats: 20, fiber: 0, sugar: 1, sodium: 680, potassium: 150 },
        { name: "Hash Browns",                 cat: "Breakfast",  cal: 130, protein: 1,  carbs: 15, fats: 8,  fiber: 2, sugar: 0,  sodium: 440,  potassium: 180 }
      ]
    }

  };

})(window.PhysIQ.Data);
