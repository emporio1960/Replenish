import type { Category, Store } from '../types';

export const OTHER_CATEGORY_ID = 'other';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'produce', name: 'Fruit and vegetables', icon: 'apple', color: '#3f8f4f', custom: false },
  { id: 'meat', name: 'Meat and seafood', icon: 'fish', color: '#c2504a', custom: false },
  { id: 'dairy', name: 'Dairy and eggs', icon: 'milk', color: '#3d7fb8', custom: false },
  { id: 'bakery', name: 'Bakery', icon: 'croissant', color: '#b9772a', custom: false },
  { id: 'pantry', name: 'Pantry', icon: 'wheat', color: '#8a6d3b', custom: false },
  { id: 'frozen', name: 'Frozen foods', icon: 'snowflake', color: '#3a9aa8', custom: false },
  { id: 'beverages', name: 'Beverages', icon: 'cup', color: '#7a5ab5', custom: false },
  { id: 'cleaning', name: 'Household cleaning', icon: 'spray', color: '#2f8f83', custom: false },
  { id: 'household', name: 'Household essentials', icon: 'box', color: '#5f6f9a', custom: false },
  { id: 'personal', name: 'Personal care', icon: 'bath', color: '#b3558f', custom: false },
  { id: 'pet', name: 'Pet supplies', icon: 'paw', color: '#a8643c', custom: false },
  { id: 'health', name: 'Health and pharmacy', icon: 'pill', color: '#cf4f6b', custom: false },
  { id: OTHER_CATEGORY_ID, name: 'Other', icon: 'basket', color: '#6f7480', custom: false },
];

export const CUSTOM_COLORS = ['#5b6fc7', '#c0653a', '#4d9a6a', '#a14fa8', '#2f8fa0', '#b8873a'];

export function categoryById(categories: Category[], id: string): Category {
  return (
    categories.find((c) => c.id === id) ??
    categories.find((c) => c.id === OTHER_CATEGORY_ID) ??
    DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]
  );
}

/** Categories in the order a store's aisles are walked; unlisted ones follow in default order. */
export function storeCategoryOrder(store: Store | undefined, categories: Category[]): Category[] {
  if (!store) return categories;
  const listed = store.aisleOrder
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => c !== undefined);
  return [...listed, ...categories.filter((c) => !store.aisleOrder.includes(c.id))];
}
