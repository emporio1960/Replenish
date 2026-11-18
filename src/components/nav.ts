import {
  CalendarClock, ChartColumn, LayoutDashboard, Lightbulb, ListChecks, ReceiptText, Repeat, Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ViewId } from '../types';

export interface NavItem {
  id: ViewId;
  label: string;
  short: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
  { id: 'list', label: 'Shopping List', short: 'List', icon: ListChecks },
  { id: 'deferred', label: 'Deferred', short: 'Deferred', icon: CalendarClock },
  { id: 'recurring', label: 'Recurring', short: 'Recurring', icon: Repeat },
  { id: 'suggestions', label: 'Suggestions', short: 'Suggestions', icon: Lightbulb },
  { id: 'history', label: 'Purchase History', short: 'History', icon: ReceiptText },
  { id: 'analytics', label: 'Analytics', short: 'Analytics', icon: ChartColumn },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings },
];

/** Sections shown directly in the phone tab bar; the rest sit under More. */
export const PRIMARY_NAV = NAV.slice(0, 4);
export const SECONDARY_NAV = NAV.slice(4);
