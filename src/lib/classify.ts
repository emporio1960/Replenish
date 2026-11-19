/**
 * Automatic item categorisation.
 *
 * One central, offline classifier used everywhere an item gets a category:
 * the add form, quick add, pasted lists, meals, barcode scans, recurring
 * purchases and suggestions. It works from a product dictionary plus a few
 * context rules, and from corrections the user has made, which always win.
 *
 * To extend it, add terms to DICTIONARY (any category id from categories.ts)
 * or a rule to MODIFIERS. Terms are matched on whole words after the same
 * normalisation used for duplicate detection, so "Tomatoes" matches "tomato".
 */
import type { AppData } from '../types';
import { OTHER_CATEGORY_ID } from './categories';
import { normalizeName } from './duplicates';
import { parseLine } from './parseList';

const DICTIONARY: Record<string, string> = {
  produce: `apple, banana, orange, mandarin, lemon, lime, grapefruit, pear, peach, nectarine, plum, apricot, cherry,
    grape, strawberry, blueberry, raspberry, blackberry, berries, watermelon, rockmelon, honeydew, melon, pineapple,
    mango, kiwi, kiwifruit, passionfruit, pawpaw, papaya, avocado, avo, fig, pomegranate, lychee, persimmon,
    tomato, cherry tomato, potato, spud, sweet potato, kumara, carrot, onion, brown onion, red onion, spring onion,
    shallot, leek, garlic, ginger, capsicum, chilli, cucumber, zucchini, eggplant, pumpkin, squash, broccoli,
    broccolini, cauliflower, cabbage, wombok, bok choy, pak choy, lettuce, iceberg, cos lettuce, rocket, spinach,
    baby spinach, silverbeet, kale, celery, beetroot, radish, turnip, parsnip, swede, fennel, asparagus, corn,
    sweetcorn, corn cob, pea, snow pea, sugar snap, green bean, bean sprout, mushroom, herb, parsley, coriander,
    basil, mint, dill, thyme, rosemary, chive, lemongrass, salad, salad mix, coleslaw, fruit, vegetable, veg, veggie,
    fresh fruit, stone fruit, citrus`,
  meat: `chicken, chook, chicken breast, chicken thigh, chicken wing, chicken drumstick, chicken mince, chicken tender,
    roast chicken, bbq chicken, turkey, duck, beef, steak, rump, scotch fillet, sirloin, eye fillet, t bone, brisket,
    beef mince, mince, rissole, burger patty, pattie, sausage, snag, chipolata, lamb, lamb chop, lamb cutlet, lamb leg,
    lamb shank, lamb mince, pork, pork chop, pork belly, pork mince, pork rib, rib, ham, bacon, prosciutto, salami,
    pancetta, chorizo, kabana, devon, pastrami, silverside, corned beef, kangaroo, veal, schnitzel, meatball,
    hot dog, frankfurt, fish, salmon, smoked salmon, tuna steak, barramundi, snapper, flathead, whiting, cod, basa,
    trout, prawn, shrimp, calamari, squid, octopus, mussel, oyster, scallop, crab, lobster, seafood, marinara mix,
    meat, deli meat, cold cut`,
  dairy: `milk, full cream milk, skim milk, lite milk, long life milk, uht milk, lactose free milk, flavoured milk,
    cheese, tasty cheese, cheddar, mozzarella, parmesan, feta, fetta, haloumi, halloumi, brie, camembert, ricotta,
    cottage cheese, cream cheese, bocconcini, swiss cheese, cheese slice, grated cheese, shredded cheese,
    butter, margarine, spread, cream, thickened cream, sour cream, double cream, pouring cream, custard,
    yoghurt, yogurt, greek yoghurt, egg, free range egg, dozen egg, buttermilk, ghee, kefir, dip, hummus, tzatziki`,
  bakery: `bread, loaf, sourdough, white bread, wholemeal bread, multigrain bread, rye bread, bread roll, roll, bun,
    burger bun, hot dog bun, hot dog roll, baguette, ciabatta, focaccia, turkish bread, pide, pita, pitta, lebanese bread,
    wrap, tortilla, naan, roti, crumpet, english muffin, muffin, bagel, croissant, danish, scone, fruit loaf,
    raisin toast, brioche, donut, doughnut, cake, cupcake, lamington, finger bun, hot cross bun, pastry, pie,
    sausage roll, garlic bread, breadcrumb, pizza base`,
  pantry: `rice, basmati rice, jasmine rice, brown rice, pasta, spaghetti, penne, fettuccine, macaroni, lasagne sheet,
    noodle, two minute noodle, ramen, couscous, quinoa, flour, plain flour, self raising flour, sugar, caster sugar,
    brown sugar, icing sugar, salt, pepper, spice, cumin, paprika, cinnamon, turmeric, oregano, mixed herb,
    curry powder, curry paste, stock, stock cube, chicken stock, beef stock, vegetable stock, gravy, oil, olive oil,
    vegetable oil, canola oil, coconut oil, sesame oil, vinegar, balsamic, soy sauce, fish sauce, oyster sauce,
    tomato sauce, bbq sauce, barbecue sauce, sweet chilli sauce, hot sauce, worcestershire, mayonnaise, mayo, mustard,
    relish, chutney, pasta sauce, passata, tomato paste, tinned tomato, canned tomato, diced tomato, baked bean,
    tinned bean, chickpea, lentil, kidney bean, tuna, tinned tuna, canned tuna, sardine, tinned salmon, soup,
    coconut milk, coconut cream, cereal, weet bix, weetbix, cornflake, muesli, granola, oat, rolled oat, porridge,
    honey, jam, vegemite, peanut butter, nutella, maple syrup, golden syrup, biscuit, bikkie, bikkies, tim tam, cracker, cruskit,
    rice cracker, rice cake, chip, crisp, corn chip, popcorn, pretzel, nut, almond, cashew, walnut, peanut, pistachio,
    seed, chia, dried fruit, sultana, raisin, date, chocolate, choccy, lolly, lollies, muesli bar, snack bar,
    baking powder, bicarb, bicarb soda, yeast, vanilla, cocoa, choc chip, sprinkles, gelatine, cornflour, taco shell,
    taco kit, tortilla chip, salsa, olive, pickle, gherkin, capers, sundried tomato, tofu, condensed milk,
    evaporated milk, powdered milk, protein powder, long grain rice`,
  frozen: `ice cream, icecream, ice block, icy pole, paddle pop, gelato, sorbet, frozen yoghurt, frozen pea,
    frozen vegetable, frozen veg, frozen berries, frozen fruit, frozen chip, frozen pizza, frozen meal, frozen fish,
    fish finger, chicken nugget, nugget, hash brown, potato gem, frozen pastry, puff pastry, shortcrust pastry,
    frozen dumpling, dumpling, spring roll, dim sim, ice, bag of ice, party pie, frozen pie`,
  beverages: `water, sparkling water, mineral water, soda water, tonic, juice, orange juice, apple juice, oj, cordial,
    soft drink, coke, cola, pepsi, lemonade, fanta, sprite, ginger beer, ginger ale, energy drink, sports drink,
    powerade, gatorade, kombucha, iced tea, coffee, coffee bean, instant coffee, coffee pod, coffee capsule, ground coffee,
    tea, tea bag, green tea, herbal tea, chai, milo, hot chocolate, drinking chocolate, beer, wine, red wine, white wine,
    champagne, prosecco, cider, spirit, vodka, gin, whisky, rum, mixer, coconut water, smoothie, iced coffee,
    oat milk drink`,
  cleaning: `dishwashing liquid, dish liquid, dish soap, detergent, washing up liquid, morning fresh, dishwasher tablet,
    dishwasher powder, dishwashing tablet, finish tablet, rinse aid, laundry detergent, laundry liquid, laundry powder,
    washing powder, washing detergent, washing liquid, fabric softener, softener, stain remover, napisan, bleach,
    disinfectant, dettol, pine o cleen, surface spray, spray n wipe, multipurpose spray, multi purpose cleaner, cleaner,
    floor cleaner, glass cleaner, windex, oven cleaner, bathroom cleaner, shower cleaner, toilet cleaner, domestos,
    harpic, jif, cream cleanser, sponge, scourer, steel wool, dishcloth, chux, cleaning cloth, microfibre cloth,
    scrubbing brush, mop, broom, dustpan, rubber glove, drain cleaner, descaler, air freshener, glen 20, mould remover,
    wool wash, dishwasher cleaner, antibacterial wipe, cleaning wipe`,
  household: `toilet paper, toilet roll, toilet tissue, loo roll, loo paper, paper towel, kitchen towel, tissue, serviette,
    napkin, battery, batteries, light bulb, light globe, bin liner, bin bag, garbage bag, rubbish bag,
    kitchen tidy bag, cling wrap, glad wrap, cling film, alfoil, aluminium foil, foil, baking paper, zip lock bag,
    sandwich bag, freezer bag, snap lock bag, matches, lighter, candle, firelighter, paper plate, plastic cup, straw,
    toothpick, skewer, sticky tape, glue, string, pegs, clothes peg, coat hanger, insect spray, fly spray, mortein,
    mozzie coil, ant bait, mouse trap, vacuum bag, extension cord, wrapping paper, gift wrap, birthday card, envelope`,
  personal: `shampoo, conditioner, body wash, shower gel, soap, hand soap, hand wash, bar soap, toothpaste, toothbrush,
    dental floss, floss, mouthwash, deodorant, antiperspirant, razor, razor blade, shaving cream, shaving foam,
    moisturiser, moisturizer, body lotion, hand cream, face wash, cleanser, face cream, sunscreen, sun cream, lip balm,
    cotton bud, cotton ball, cotton pad, makeup, mascara, nail polish, nail polish remover, hair gel, hair spray,
    hair dye, hair tie, comb, hairbrush, tampon, sanitary pad, panty liner, nappy, nappies, baby wipe,
    wet wipe, nappy cream, baby powder, baby shampoo, hand sanitiser, sanitiser, tissue pack, perfume, aftershave,
    body spray, bath bomb, loofah, shower cap, contact lens solution`,
  pet: `dog food, cat food, pet food, puppy food, kitten food, dog biscuit, cat biscuit, dog treat, cat treat,
    dog bone, dog roll, cat litter, kitty litter, litter, bird seed, fish food, flea treatment, worming tablet,
    dog shampoo, poo bag, dog poo bag, pet treat, chew toy, cat milk, pet milk`,
  health: `panadol, paracetamol, nurofen, ibuprofen, aspirin, pain relief, painkiller, vitamin, vitamin c, vitamin d,
    multivitamin, fish oil, magnesium, probiotic, supplement, bandaid, band aid, bandage, plaster, antiseptic,
    antiseptic cream, betadine, cough syrup, cough medicine, cough lolly, throat lozenge, lozenge, strepsil,
    cold and flu, cold and flu tablet, antihistamine, hayfever tablet, telfast, zyrtec, claratyne, nasal spray,
    eye drop, antacid, gaviscon, laxative, electrolyte, hydralyte, thermometer, first aid, medicine, medication,
    prescription, insect repellent, aerogard, heat pack, face mask`,
};

/** Describing words that settle the category on their own, checked after multi-word products. */
const MODIFIERS: { words: string[]; categoryId: string }[] = [
  { words: ['frozen'], categoryId: 'frozen' },
  { words: ['dog', 'cat', 'puppy', 'kitten', 'pet'], categoryId: 'pet' },
  { words: ['tinned', 'canned', 'dried', 'instant'], categoryId: 'pantry' },
];

interface Term {
  words: string[];
  categoryId: string;
}

const TERMS: Term[] = [];
const SINGLE = new Map<string, string>();
for (const [categoryId, list] of Object.entries(DICTIONARY)) {
  for (const raw of list.split(',')) {
    const words = normalizeName(raw).split(' ').filter(Boolean);
    if (!words.length) continue;
    if (words.length === 1) {
      if (!SINGLE.has(words[0])) SINGLE.set(words[0], categoryId);
    } else {
      TERMS.push({ words, categoryId });
    }
  }
}
TERMS.sort((a, b) => b.words.length - a.words.length);
/** Every word the dictionary knows, alone or inside a longer product name: used to fix typos. */
const VOCAB = new Set([...SINGLE.keys(), ...TERMS.flatMap((t) => t.words)]);
const MODIFIER = new Map(MODIFIERS.flatMap((m) => m.words.map((w) => [w, m.categoryId] as const)));

/** Edit distance where swapping two neighbouring letters counts as one mistake. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** A dictionary word within a typo or two of the given word (longer words only). */
function nearWord(word: string): string | undefined {
  // Short words are too easy to confuse ("paper" is one letter from "pepper").
  if (word.length < 6) return undefined;
  const max = word.length >= 10 ? 2 : 1;
  let best: string | undefined;
  let bestDistance = max + 1;
  for (const candidate of VOCAB) {
    if (candidate.length < 5 || candidate[0] !== word[0]) continue; // typos rarely change the first letter
    const d = editDistance(word, candidate, max);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** The product words of a typed name, without quantities, units or filler. */
export function productKey(name: string): string {
  const parsed = parseLine(name);
  return normalizeName(parsed ? parsed.name : name);
}

export type ClassifySource = 'learned' | 'history' | 'dictionary' | 'spelling' | 'none';

export interface Classification {
  categoryId: string;
  source: ClassifySource;
}

const NONE: Classification = { categoryId: OTHER_CATEGORY_ID, source: 'none' };

function fromWords(words: string[]): string | undefined {
  // 1. The longest multi-word product wins: "dog food", "hot dog bun", "coconut milk".
  for (const term of TERMS) {
    const n = term.words.length;
    for (let i = 0; i + n <= words.length; i++) {
      if (term.words.every((w, k) => words[i + k] === w)) return term.categoryId;
    }
  }
  // 2. A describing word that decides it: "frozen peas", "cat biscuits", "tinned corn".
  for (const w of words.slice(0, -1)) {
    const hit = MODIFIER.get(w);
    if (hit) return hit;
  }
  // 3. Single words, last first: in English the product is usually the final
  //    word ("chicken stock" is stock, "milk chocolate" is chocolate).
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = SINGLE.get(words[i]);
    if (hit) return hit;
  }
  return undefined;
}

/** Dictionary-only classification of a product name. */
export function classifyName(name: string): Classification {
  const words = productKey(name).split(' ').filter(Boolean);
  if (!words.length) return NONE;
  const exact = fromWords(words);
  if (exact) return { categoryId: exact, source: 'dictionary' };
  // Nothing matched as typed: allow for small spelling mistakes in longer words.
  const corrected = words.map((w) => (VOCAB.has(w) ? w : (nearWord(w) ?? w)));
  if (corrected.some((w, i) => w !== words[i])) {
    const fuzzy = fromWords(corrected);
    if (fuzzy) return { categoryId: fuzzy, source: 'spelling' };
  }
  return NONE;
}

type Known = Pick<AppData, 'categoryRules' | 'categories' | 'history' | 'recurring'>;

/**
 * The category for a new item. In order: a correction the user made for this
 * product, the category they last bought it under, the dictionary, and
 * otherwise Other. It never guesses a category it has no evidence for.
 */
export function categorise(data: Known, name: string): Classification {
  const key = productKey(name);
  if (!key) return NONE;
  const valid = (id: string | undefined): id is string => Boolean(id) && data.categories.some((c) => c.id === id);

  // The user's own rules come first. A rule also covers longer names that
  // contain it ("organic almond milk" follows the rule for "almond milk");
  // when several apply, the most specific (longest) one wins.
  const padded = ` ${key} `;
  let learned: string | undefined;
  let longest = 0;
  for (const [ruleKey, categoryId] of Object.entries(data.categoryRules)) {
    if (ruleKey.length > longest && padded.includes(` ${ruleKey} `) && valid(categoryId)) {
      learned = categoryId;
      longest = ruleKey.length;
    }
  }
  if (learned) return { categoryId: learned, source: 'learned' };

  for (let i = data.history.length - 1; i >= 0; i--) {
    const r = data.history[i];
    if (r.key === key && r.categoryId !== OTHER_CATEGORY_ID && valid(r.categoryId)) {
      return { categoryId: r.categoryId, source: 'history' };
    }
  }
  const schedule = data.recurring.find((r) => normalizeName(r.name) === key);
  if (schedule && schedule.categoryId !== OTHER_CATEGORY_ID) return { categoryId: schedule.categoryId, source: 'history' };

  const guess = classifyName(name);
  return valid(guess.categoryId) ? guess : NONE;
}
