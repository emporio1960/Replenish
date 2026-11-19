/**
 * Shopping lists arriving from outside the app:
 *
 *  - an Apple Shortcut (or any link) opening   <site>#import=<URL-encoded list>
 *  - the share sheet on systems that support the Web Share Target API, which
 *    opens                                    <site>?title=…&text=…&url=…
 *
 * The data sits in the address only. It is never sent anywhere, and nothing is
 * added to the list from it until the user has reviewed and confirmed it.
 */
import type { ImportSource } from '../types';
import { MAX_IMPORT_CHARS } from './importParser';

export interface Incoming {
  text: string;
  source: ImportSource;
}

export const INCOMING_EVENT = 'replenish:incoming';
let pending: Incoming | null = null;

/** Looks for a list in the address, remembers it, and tidies the address. Returns true if one was found. */
export function captureIncoming(): boolean {
  try {
    const { hash, search, pathname } = window.location;
    const fromHash = /^#\/?import=([\s\S]*)$/.exec(hash);
    let found: Incoming | null = null;
    if (fromHash) {
      const text = decodeURIComponent(fromHash[1].replace(/\+/g, '%20'));
      if (text.trim()) found = { text, source: 'shortcut' };
    } else if (search) {
      const q = new URLSearchParams(search);
      const text = [q.get('title'), q.get('text'), q.get('url')].filter((v): v is string => Boolean(v && v.trim())).join('\n');
      if ((q.has('text') || q.has('title') || q.has('url')) && text.trim()) found = { text, source: 'shared' };
    }
    if (!found) return false;
    pending = { ...found, text: found.text.slice(0, MAX_IMPORT_CHARS) };
    window.history.replaceState(null, '', `${pathname}#/transfer`);
    window.dispatchEvent(new Event(INCOMING_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Hands the waiting list to the import screen, once. */
export function takeIncoming(): Incoming | null {
  const next = pending;
  pending = null;
  return next;
}

/** The address a Shortcut should open, with the URL-encoded list added to the end. */
export function importLinkBase(): string {
  return `${window.location.origin}${window.location.pathname}#import=`;
}
