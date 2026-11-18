export type Unit = 'units' | 'kg' | 'g' | 'L' | 'ml' | 'packs' | 'bottles';
export const UNITS: Unit[] = ['units', 'kg', 'g', 'L', 'ml', 'packs', 'bottles'];

export type Priority = 'low' | 'normal' | 'high';
export const PRIORITIES: Priority[] = ['low', 'normal', 'high'];

export type ItemStatus = 'active' | 'purchased' | 'deferred';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  custom: boolean;
}

export interface Deferral {
  /** ISO timestamp of when the item was deferred. */
  deferredAt: string;
  /** Day (YYYY-MM-DD) the item returns to the list, or null for indefinitely. */
  until: string | null;
  reason?: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  /** Estimated price for the whole line (not per unit). */
  estimatedPrice?: number;
  /** Price actually paid, if the user entered it. */
  actualPrice?: number;
  categoryId: string;
  notes?: string;
  priority: Priority;
  status: ItemStatus;
  createdAt: string;
  purchasedAt?: string;
  /** Purchase-history record created when this item was purchased (used by undo). */
  historyId?: string;
  deferral?: Deferral;
  deferCount: number;
  recurringId?: string;
  /** The schedule's due date before this purchase advanced it (used by undo). */
  recurringPrevDue?: string;
  /** Set when the item came back from a deferral automatically. */
  returnedAt?: string;
  sample?: boolean;
}

export type FrequencyKind =
  | 'daily'
  | '3days'
  | 'weekly'
  | 'fortnightly'
  | 'monthly'
  | '2months'
  | '3months'
  | 'custom';

export interface Frequency {
  kind: FrequencyKind;
  /** Only used when kind is 'custom'. */
  customDays?: number;
}

export interface RecurringPurchase {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  estimatedPrice?: number;
  categoryId: string;
  notes?: string;
  frequency: Frequency;
  /** Day (YYYY-MM-DD) of the next expected purchase. */
  nextDue: string;
  reminderDate?: string;
  paused: boolean;
  createdAt: string;
  lastPurchasedAt?: string;
  skippedCount: number;
  completedCount: number;
  sample?: boolean;
}

export interface PurchaseRecord {
  id: string;
  name: string;
  /** Normalised name used to group purchases of the same product. */
  key: string;
  quantity: number;
  unit: Unit;
  price?: number;
  categoryId: string;
  purchasedAt: string;
  recurring: boolean;
  recurringId?: string;
  sample?: boolean;
}

export interface DeferralEvent {
  id: string;
  itemId: string;
  name: string;
  key: string;
  categoryId?: string;
  at: string;
  until: string | null;
  sample?: boolean;
}

export interface ReplenishPref {
  /** Day of the latest purchase when the user dismissed the recommendation. */
  dismissedAtPurchase?: string;
  /** User-adjusted interval in days, overriding the learned average. */
  customIntervalDays?: number;
}

export interface Notice {
  id: string;
  kind: 'deferred-return' | 'recurring-added';
  message: string;
  at: string;
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type SortKey = 'category' | 'name' | 'added' | 'priority';
export type Theme = 'light' | 'dark' | 'system';

export interface NotificationPrefs {
  recurringDue: boolean;
  deferredReturn: boolean;
  replenishment: boolean;
  budget: boolean;
}

export interface Settings {
  currency: string;
  dateFormat: DateFormat;
  time24: boolean;
  theme: Theme;
  /** Budget for the current shopping list, or null when not set. */
  budget: number | null;
  defaultCategoryId: string;
  listSort: SortKey;
  groupByCategory: boolean;
  autoAddRecurring: boolean;
  notifications: NotificationPrefs;
}

export interface AppData {
  version: number;
  items: ShoppingItem[];
  recurring: RecurringPurchase[];
  history: PurchaseRecord[];
  deferrals: DeferralEvent[];
  categories: Category[];
  settings: Settings;
  replenishPrefs: Record<string, ReplenishPref>;
  notices: Notice[];
  onboarded: boolean;
}

export type ViewId =
  | 'dashboard'
  | 'list'
  | 'deferred'
  | 'recurring'
  | 'suggestions'
  | 'history'
  | 'analytics'
  | 'settings'
  | 'shop';
