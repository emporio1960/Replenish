import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../App';
import { STORAGE_KEY } from '../lib/storage';
import type { AppData } from '../types';

const saved = (): AppData => JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
const dialog = () => screen.getByRole('dialog');

function addItem(name: string) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
  fireEvent.change(within(dialog()).getByLabelText('Item'), { target: { value: name } });
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Add to list' }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  window.scrollTo = () => {};
});
afterEach(cleanup);

describe('Replenish app', () => {
  it('starts empty, validates the form and adds an item that survives a restart', () => {
    const first = render(<App />);
    expect(screen.getByText('Welcome to Replenish')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add to list' }));
    expect(within(dialog()).getByText('Enter a name for this item.')).toBeTruthy();
    fireEvent.change(within(dialog()).getByLabelText(/^Item/), { target: { value: 'Milk' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add to list' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saved().items.map((i) => i.name)).toEqual(['Milk']);

    // "Closing and reopening": a fresh mount reads the same data back.
    first.unmount();
    render(<App />);
    expect(screen.getByText(/of 1 in the basket/)).toBeTruthy();
  });

  it('prompts before adding a duplicate', () => {
    render(<App />);
    addItem('Bananas');
    addItem('banana');
    expect(within(dialog()).getByText('Possible duplicate')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: /Increase Bananas to/ }));
    expect(saved().items).toHaveLength(1);
    expect(saved().items[0].quantity).toBe(2);
  });

  it('marks purchased, undoes, defers and restores from the list', () => {
    render(<App />);
    addItem('Detergent');
    window.location.hash = '/list';
    fireEvent(window, new HashChangeEvent('hashchange'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Detergent as purchased' }));
    expect(saved().items[0].status).toBe('purchased');
    expect(saved().history).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Undo purchase of Detergent' }));
    expect(saved().items[0].status).toBe('active');
    expect(saved().history).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Detergent' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /Defer/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: /In 3 days/ }));
    expect(saved().items[0].status).toBe('deferred');

    window.location.hash = '/deferred';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByText('Detergent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore now/ }));
    expect(saved().items[0].status).toBe('active');
  });

  it('renders every section with demo data, and Shopping Mode ticks items off', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore with demo data' }));
    expect(saved().history.length).toBeGreaterThan(40);

    for (const [hash, heading] of [
      ['list', 'Shopping List'], ['deferred', 'Deferred'], ['recurring', 'Recurring'],
      ['suggestions', 'Suggestions'], ['history', 'Purchase History'], ['analytics', 'Analytics'],
      ['settings', 'Settings'], ['dashboard', 'Dashboard'],
    ]) {
      window.location.hash = `/${hash}`;
      fireEvent(window, new HashChangeEvent('hashchange'));
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
    }

    window.location.hash = '/shop';
    fireEvent(window, new HashChangeEvent('hashchange'));
    const before = saved().items.filter((i) => i.status === 'purchased').length;
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(saved().items.filter((i) => i.status === 'purchased').length).toBe(before + 1);
    fireEvent.change(screen.getByLabelText('Add an item'), { target: { value: 'Lemons' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(saved().items.some((i) => i.name === 'Lemons')).toBe(true);
  });
});
