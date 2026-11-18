import { ChefHat, Pencil, Plus } from 'lucide-react';
import { findDuplicates } from '../lib/duplicates';
import { formatQty, plural } from '../lib/format';
import { addParsed, deleteRecipe } from '../state/actions';
import { useStore } from '../state/store';
import { EmptyState, PageHeader } from '../components/ui';

export function Meals() {
  const { data, apply, openModal, toast } = useStore();
  const recipes = [...data.recipes].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Meals"
        subtitle="Save a meal's ingredients once, then add them to the list in one tap"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'recipe' })}>
            <Plus size={17} aria-hidden="true" /> New meal
          </button>
        }
      />
      {recipes.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={ChefHat}
            title="No meals saved"
            body="Add the meals you cook often with their ingredients. When you plan one, a single tap puts everything you need on the shopping list."
            action={<button type="button" className="btn btn-primary" onClick={() => openModal({ type: 'recipe' })}>New meal</button>}
          />
        </div>
      ) : (
        <ul className="cards">
          {recipes.map((r) => {
            const missing = r.ingredients.filter((i) => findDuplicates(i.name, data.items).length === 0);
            return (
              <li key={r.id} className="card detail-card">
                <div className="detail-head">
                  <div className="row-body">
                    <span className="row-title">{r.name}</span>
                    <span className="row-meta">
                      {plural(r.ingredients.length, 'ingredient')}
                      {missing.length < r.ingredients.length ? `, ${r.ingredients.length - missing.length} already on your list` : ''}
                    </span>
                  </div>
                </div>
                <ul className="ingredients">
                  {r.ingredients.map((i, n) => (
                    <li key={n} className={missing.includes(i) ? '' : 'is-listed'}>
                      <span>{i.name}</span>
                      <span className="muted">{formatQty(i.quantity, i.unit)}</span>
                    </li>
                  ))}
                </ul>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={missing.length === 0}
                    onClick={() => {
                      apply((d) => addParsed(d, r.ingredients, new Date()));
                      toast(`Added ${plural(missing.length, 'ingredient')} for ${r.name}`);
                    }}
                  >
                    <Plus size={15} aria-hidden="true" />
                    {missing.length === 0 ? 'All on your list' : `Add ${plural(missing.length, 'ingredient')} to list`}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => openModal({ type: 'recipe', recipe: r })}>
                    <Pencil size={15} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-quiet danger-text"
                    onClick={() =>
                      openModal({
                        type: 'confirm',
                        title: `Delete ${r.name}?`,
                        body: 'This removes the saved meal. Items already on your shopping list are kept.',
                        confirmLabel: 'Delete meal',
                        danger: true,
                        onConfirm: () => { apply((d) => deleteRecipe(d, r.id)); toast(`Deleted ${r.name}`); },
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
