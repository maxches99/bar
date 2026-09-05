import { el, markdown, norm } from './dom.js';
import { state, byId, edit, create, remove, options } from './store.js';
import { LEVELS, RATINGS, FULLNESS, BY_FULLNESS, inStock, ratingRank } from './const.js';

export const openSheet = (node) => {
  const sheet = document.getElementById('sheet');
  const body = document.getElementById('sheet-body');
  body.replaceChildren(el('div', { class: 'sheet-grab' }), node);
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.style.overflow = 'hidden';
};
export const closeSheet = () => {
  document.getElementById('sheet').hidden = true;
  document.body.style.overflow = '';
};

const matches = (rec, q, ...extra) =>
  !q || [rec.name, ...extra].some((v) => norm(Array.isArray(v) ? v.join(' ') : v).includes(q));

/** Чего не хватает для коктейля. known:false — ингредиенты вообще не проставлены. */
export function stock(cocktail) {
  const bottles = (cocktail.ingredients || []).map((id) => byId('bottles', id)).filter(Boolean);
  if (!bottles.length) return { known: false, missing: [], have: [] };
  const missing = bottles.filter((b) => !inStock(b));
  return { known: true, missing, have: bottles.filter(inStock), total: bottles.length };
}

// ── Бар ───────────────────────────────────────────────────────────────────

function levelBar(rec) {
  const current = rec.level ? FULLNESS[rec.level] : null;
  const bar = el('div', { class: 'level' });
  for (let i = 0; i <= 5; i++) {
    const on = current !== null && (i === 0 ? current === 0 : current >= i);
    bar.append(el('button', {
      type: 'button',
      'data-on': on ? '1' : '0',
      'data-empty': i === 0 ? '1' : '0',
      title: BY_FULLNESS[i],
      'aria-label': BY_FULLNESS[i],
      onclick: (e) => {
        e.stopPropagation();
        edit('bottles', rec, { level: BY_FULLNESS[i] });
        const fresh = levelBlock(rec);
        e.target.closest('.level-block').replaceWith(fresh);
      },
    }, i === 0 ? '✕' : ''));
  }
  return bar;
}

function levelBlock(rec) {
  return el('div', { class: 'level-block' },
    levelBar(rec),
    el('div', { class: 'level-label' },
      el('span', {}, rec.level || 'остаток не отмечен'),
      rec.category ? el('span', {}, rec.category) : null),
  );
}

export function barView({ q, filter }) {
  let items = state.bottles.filter((b) => !b.archived && matches(b, q, b.category, b.notes, b.mixIdeas));

  if (filter === 'stock') items = items.filter(inStock);
  else if (filter === 'low') items = items.filter((b) => ['Меньше трети', 'Около половины'].includes(b.level));
  else if (filter === 'out') items = items.filter((b) => b.level === 'Закончилась');
  else if (filter?.startsWith('cat:')) items = items.filter((b) => b.category === filter.slice(4));

  if (!items.length) return el('p', { class: 'empty' }, 'Ничего не нашлось');

  const groups = new Map();
  for (const b of items) {
    const key = b.category || 'Без категории';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const order = options('bottles', 'category').map((o) => o.name);
  const sorted = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

  const out = el('div');
  for (const [category, list] of sorted) {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    out.append(
      el('h2', { class: 'group-title' }, category,
        el('span', { class: 'n' }, `${list.filter(inStock).length}/${list.length}`)),
      ...list.map((rec) => el('div', { class: 'card' },
        el('div', { class: 'card-head', onclick: () => openSheet(bottleSheet(rec)) },
          el('div', { class: 'card-name' }, rec.name || 'Без названия'),
          rec.notes ? el('div', { class: 'card-meta' }, '›') : null),
        levelBlock(rec))),
    );
  }
  return out;
}

export function barFilters() {
  const cats = options('bottles', 'category').map((o) => o.name);
  return [
    ['all', 'Всё', state.bottles.filter((b) => !b.archived).length],
    ['stock', 'Есть дома', state.bottles.filter((b) => !b.archived && inStock(b)).length],
    ['low', 'На исходе', state.bottles.filter((b) => ['Меньше трети', 'Около половины'].includes(b.level)).length],
    ['out', 'Кончилось', state.bottles.filter((b) => b.level === 'Закончилась').length],
    ...cats.map((c) => [`cat:${c}`, c, state.bottles.filter((b) => !b.archived && b.category === c).length]),
  ].filter(([, , n]) => n > 0);
}

function bottleSheet(rec) {
  const uses = state.cocktails.filter((c) => (c.ingredients || []).includes(rec.id));
  return el('div', {},
    el('h2', {}, rec.name || 'Без названия'),
    el('p', { class: 'card-sub' }, rec.category || '—'),
    el('section', {}, el('h3', {}, 'Остаток'), levelBlock(rec)),
    editableFields('bottles', rec, [
      ['name', 'Название', 'text'],
      ['category', 'Категория', 'select'],
      ['notes', 'Характеристики', 'textarea'],
      ['mixIdeas', 'Идеи для миксов', 'textarea'],
    ]),
    uses.length ? el('section', {},
      el('h3', {}, `В коктейлях (${uses.length})`),
      el('div', { class: 'tags' }, uses.map((c) =>
        el('span', { class: 'tag', onclick: () => openSheet(cocktailSheet(c)) }, c.name)))) : null,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: closeSheet }, 'Закрыть'),
      el('button', { class: 'btn danger', onclick: () => { remove('bottles', rec); closeSheet(); rerender(); } }, 'Удалить')),
  );
}

// ── Коктейли ──────────────────────────────────────────────────────────────

export function cocktailsView({ q, filter }) {
  let items = state.cocktails.filter((c) => !c.archived &&
    matches(c, q, c.bases, c.profile, c.collection, c.proportions, c.status));

  if (filter === 'ready') items = items.filter((c) => { const s = stock(c); return s.known && !s.missing.length; });
  else if (filter === 'almost') items = items.filter((c) => { const s = stock(c); return s.known && s.missing.length === 1; });
  else if (filter === 'top') items = items.filter((c) => ratingRank(c.ratingHome) >= 3 || ratingRank(c.ratingBar) >= 3);
  else if (filter === 'want') items = items.filter((c) => c.status === 'Хочу попробовать');
  else if (filter?.startsWith('base:')) items = items.filter((c) => (c.bases || []).includes(filter.slice(5)));
  else if (filter?.startsWith('set:')) items = items.filter((c) => c.collection === filter.slice(4));

  items.sort((a, b) => {
    const sa = stock(a), sb = stock(b);
    const ma = sa.known ? sa.missing.length : 99, mb = sb.known ? sb.missing.length : 99;
    if (ma !== mb) return ma - mb;
    return Math.max(ratingRank(b.ratingHome), ratingRank(b.ratingBar)) -
           Math.max(ratingRank(a.ratingHome), ratingRank(a.ratingBar));
  });

  if (!items.length) return el('p', { class: 'empty' }, 'Ничего не нашлось');

  return el('div', {}, items.map((c) => {
    const s = stock(c);
    const badge = !s.known ? '' : s.missing.length === 0 ? '✓ есть всё'
      : s.missing.length === 1 ? `нет: ${s.missing[0].name}`
      : `не хватает ${s.missing.length}`;
    const rating = c.ratingHome || c.ratingBar;
    return el('div', { class: 'card row-link', onclick: () => openSheet(cocktailSheet(c)) },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-name' }, c.name || 'Без названия'),
        rating ? el('span', { class: 'card-meta' }, rating) : null),
      c.proportions ? el('div', { class: 'card-sub' }, c.proportions) : null,
      badge ? el('div', { class: 'card-meta', style: `margin-top:6px;color:${s.missing.length ? 'var(--warn)' : 'var(--ok)'}` }, badge) : null);
  }));
}

export function cocktailFilters() {
  const ready = state.cocktails.filter((c) => { const s = stock(c); return s.known && !s.missing.length; }).length;
  const almost = state.cocktails.filter((c) => { const s = stock(c); return s.known && s.missing.length === 1; }).length;
  const bases = options('cocktails', 'bases').map((o) => o.name);
  const sets = options('cocktails', 'collection').map((o) => o.name);
  return [
    ['all', 'Все', state.cocktails.filter((c) => !c.archived).length],
    ['ready', 'Могу собрать', ready],
    ['almost', 'Не хватает одного', almost],
    ['top', 'Любимые', state.cocktails.filter((c) => ratingRank(c.ratingHome) >= 3 || ratingRank(c.ratingBar) >= 3).length],
    ['want', 'Хочу попробовать', state.cocktails.filter((c) => c.status === 'Хочу попробовать').length],
    ...bases.map((b) => [`base:${b}`, b, state.cocktails.filter((c) => (c.bases || []).includes(b)).length]),
    ...sets.map((s) => [`set:${s}`, s, state.cocktails.filter((c) => c.collection === s).length]),
  ].filter(([, , n]) => n > 0);
}

function cocktailSheet(rec) {
  const s = stock(rec);
  const places = (rec.places || []).map((id) => byId('places', id)).filter(Boolean);
  return el('div', {},
    el('h2', {}, rec.name || 'Без названия'),
    el('p', { class: 'card-sub' }, [rec.collection, rec.method, rec.glass].filter(Boolean).join(' · ') || '—'),

    rec.proportions ? el('section', {}, el('h3', {}, 'Пропорции'), el('div', { class: 'recipe' }, rec.proportions)) : null,

    s.known ? el('section', {},
      el('h3', {}, 'Ингредиенты'),
      el('div', { class: 'tags' }, (rec.ingredients || []).map((id) => {
        const b = byId('bottles', id);
        if (!b) return null;
        return el('span', {
          class: `tag ${inStock(b) ? 'have' : 'miss'}`,
          onclick: () => openSheet(bottleSheet(b)),
        }, b.name);
      }))) : null,

    rec.recipe ? el('section', {}, el('h3', {}, 'Рецепт'), el('div', { class: 'recipe', html: markdown(rec.recipe) })) : null,

    el('section', {}, el('h3', {}, 'Оценки'),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Дома'), el('dd', {}, ratingPicker('cocktails', rec, 'ratingHome')),
        el('dt', {}, 'В баре'), el('dd', {}, ratingPicker('cocktails', rec, 'ratingBar')))),

    places.length ? el('section', {}, el('h3', {}, 'Где пробовал'),
      el('div', { class: 'tags' }, places.map((p) =>
        el('span', { class: 'tag', onclick: () => openSheet(placeSheet(p)) }, p.name)))) : null,

    rec.toBuy ? el('section', {}, el('h3', {}, 'Что докупить'), el('div', { class: 'recipe' }, rec.toBuy)) : null,
    rec.source ? el('section', {}, el('a', { class: 'btn', href: rec.source, target: '_blank', rel: 'noreferrer' }, 'Источник ↗')) : null,

    editableFields('cocktails', rec, [
      ['name', 'Название', 'text'],
      ['status', 'Статус', 'select'],
      ['difficulty', 'Сложность', 'select'],
      ['proportions', 'Пропорции', 'textarea'],
      ['recipe', 'Рецепт', 'textarea'],
      ['toBuy', 'Что докупить', 'textarea'],
    ]),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: closeSheet }, 'Закрыть'),
      el('button', { class: 'btn danger', onclick: () => { remove('cocktails', rec); closeSheet(); rerender(); } }, 'Удалить')),
  );
}

// ── Места и блюда ─────────────────────────────────────────────────────────

export function placesView({ q, filter }) {
  let items = state.places.filter((p) => !p.archived && matches(p, q, p.city, p.format, p.barType, p.cuisine, p.orderThis));
  if (filter === 'bars') items = items.filter((p) => (p.format || []).includes('Бар'));
  else if (filter === 'restaurants') items = items.filter((p) => (p.format || []).includes('Ресторан'));
  else if (filter === 'wishlist') items = items.filter((p) => p.status === 'Хочу сходить');
  else if (filter?.startsWith('city:')) items = items.filter((p) => p.city === filter.slice(5));

  items.sort((a, b) => Math.max(ratingRank(b.ratingBar), ratingRank(b.ratingKitchen)) -
                       Math.max(ratingRank(a.ratingBar), ratingRank(a.ratingKitchen)));
  if (!items.length) return el('p', { class: 'empty' }, 'Ничего не нашлось');

  return el('div', {}, items.map((p) => el('div', { class: 'card row-link', onclick: () => openSheet(placeSheet(p)) },
    el('div', { class: 'card-head' },
      el('div', { class: 'card-name' }, p.name),
      el('span', { class: 'card-meta' }, [p.ratingBar, p.ratingKitchen].filter(Boolean).join(' / '))),
    el('div', { class: 'card-sub' }, [p.city, ...(p.format || [])].filter(Boolean).join(' · ')),
    p.orderThis ? el('div', { class: 'card-meta', style: 'margin-top:6px' }, p.orderThis) : null)));
}

export function placeFilters() {
  const cities = options('places', 'city').map((o) => o.name);
  return [
    ['all', 'Все', state.places.filter((p) => !p.archived).length],
    ['bars', 'Бары', state.places.filter((p) => (p.format || []).includes('Бар')).length],
    ['restaurants', 'Рестораны', state.places.filter((p) => (p.format || []).includes('Ресторан')).length],
    ['wishlist', 'Хочу сходить', state.places.filter((p) => p.status === 'Хочу сходить').length],
    ...cities.map((c) => [`city:${c}`, c, state.places.filter((p) => p.city === c).length]),
  ].filter(([, , n]) => n > 0);
}

function placeSheet(rec) {
  const cocktails = (rec.cocktails || []).map((id) => byId('cocktails', id)).filter(Boolean);
  const dishes = (rec.dishes || []).map((id) => byId('dishes', id)).filter(Boolean);
  return el('div', {},
    el('h2', {}, rec.name),
    el('p', { class: 'card-sub' }, [rec.city, ...(rec.format || []), ...(rec.barType || []), ...(rec.cuisine || [])].filter(Boolean).join(' · ')),
    el('section', {}, el('h3', {}, 'Оценки'),
      el('dl', { class: 'kv' },
        el('dt', {}, 'Бар'), el('dd', {}, ratingPicker('places', rec, 'ratingBar')),
        el('dt', {}, 'Кухня'), el('dd', {}, ratingPicker('places', rec, 'ratingKitchen')))),
    rec.orderThis ? el('section', {}, el('h3', {}, 'Что заказывать'), el('div', { class: 'recipe' }, rec.orderThis)) : null,
    rec.address ? el('section', {}, el('h3', {}, 'Адрес'), el('div', { class: 'recipe' }, rec.address)) : null,
    cocktails.length ? el('section', {}, el('h3', {}, 'Коктейли'),
      el('div', { class: 'tags' }, cocktails.map((c) => el('span', { class: 'tag', onclick: () => openSheet(cocktailSheet(c)) }, c.name)))) : null,
    dishes.length ? el('section', {}, el('h3', {}, 'Блюда'),
      el('div', { class: 'tags' }, dishes.map((d) => el('span', { class: 'tag' }, d.name)))) : null,
    rec.link ? el('section', {}, el('a', { class: 'btn', href: rec.link, target: '_blank', rel: 'noreferrer' }, 'Открыть ↗')) : null,
    editableFields('places', rec, [
      ['name', 'Название', 'text'],
      ['city', 'Город', 'select'],
      ['status', 'Статус', 'select'],
      ['address', 'Адрес', 'text'],
      ['orderThis', 'Что заказывать', 'textarea'],
      ['avgBill', 'Средний чек', 'number'],
      ['link', 'Ссылка', 'text'],
    ]),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: closeSheet }, 'Закрыть'),
      el('button', { class: 'btn danger', onclick: () => { remove('places', rec); closeSheet(); rerender(); } }, 'Удалить')),
  );
}

export function dishesView({ q, filter }) {
  let items = state.dishes.filter((d) => !d.archived && matches(d, q, d.description, d.types));
  if (filter === 'repeat') items = items.filter((d) => d.repeatAtHome);
  else if (filter === 'top') items = items.filter((d) => ratingRank(d.rating) >= 3);
  items.sort((a, b) => ratingRank(b.rating) - ratingRank(a.rating));
  if (!items.length) return el('p', { class: 'empty' }, 'Ничего не нашлось');

  return el('div', {}, items.map((d) => {
    const place = (d.places || []).map((id) => byId('places', id)).filter(Boolean)[0];
    return el('div', { class: 'card row-link', onclick: () => openSheet(dishSheet(d)) },
      el('div', { class: 'card-head' },
        el('div', { class: 'card-name' }, d.name),
        d.rating ? el('span', { class: 'card-meta' }, d.rating) : null),
      el('div', { class: 'card-sub' }, [place?.name, ...(d.types || [])].filter(Boolean).join(' · ')));
  }));
}

export function dishFilters() {
  return [
    ['all', 'Все', state.dishes.filter((d) => !d.archived).length],
    ['repeat', 'Повторить дома', state.dishes.filter((d) => d.repeatAtHome).length],
    ['top', 'Топ', state.dishes.filter((d) => ratingRank(d.rating) >= 3).length],
  ].filter(([, , n]) => n > 0);
}

function dishSheet(rec) {
  const places = (rec.places || []).map((id) => byId('places', id)).filter(Boolean);
  return el('div', {},
    el('h2', {}, rec.name),
    el('p', { class: 'card-sub' }, [places[0]?.name, ...(rec.types || [])].filter(Boolean).join(' · ')),
    el('section', {}, el('h3', {}, 'Оценка'), ratingPicker('dishes', rec, 'rating')),
    rec.description ? el('section', {}, el('h3', {}, 'Описание'), el('div', { class: 'recipe' }, rec.description)) : null,
    editableFields('dishes', rec, [
      ['name', 'Название', 'text'],
      ['description', 'Описание', 'textarea'],
      ['price', 'Цена', 'number'],
      ['repeatAtHome', 'Хочу повторить дома', 'checkbox'],
    ]),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: closeSheet }, 'Закрыть'),
      el('button', { class: 'btn danger', onclick: () => { remove('dishes', rec); closeSheet(); rerender(); } }, 'Удалить')),
  );
}

// ── Общие элементы редактирования ─────────────────────────────────────────

function ratingPicker(collection, rec, field) {
  const wrap = el('div', { class: 'tags' });
  const draw = () => {
    wrap.replaceChildren(...['—', ...RATINGS].map((r) => {
      const value = r === '—' ? null : r;
      const active = (rec[field] || null) === value;
      return el('span', {
        class: 'tag', style: active ? 'border-color:var(--accent);color:var(--accent)' : '',
        onclick: () => { edit(collection, rec, { [field]: value }); draw(); },
      }, r);
    }));
  };
  draw();
  return wrap;
}

function editableFields(collection, rec, fields) {
  const section = el('section', {}, el('h3', {}, 'Правка'));
  for (const [field, label, kind] of fields) {
    const opts = options(collection, field);
    let input;
    if (kind === 'select' || opts.length) {
      input = el('select', { onchange: (e) => edit(collection, rec, { [field]: e.target.value || null }) },
        el('option', { value: '' }, '—'),
        ...opts.map((o) => el('option', { value: o.name, selected: rec[field] === o.name }, o.name)));
    } else if (kind === 'textarea') {
      input = el('textarea', { value: rec[field] || '', onchange: (e) => edit(collection, rec, { [field]: e.target.value || null }) });
    } else if (kind === 'checkbox') {
      input = el('input', { type: 'checkbox', checked: !!rec[field], onchange: (e) => edit(collection, rec, { [field]: e.target.checked }) });
    } else {
      input = el('input', {
        type: kind === 'number' ? 'number' : 'text',
        value: rec[field] ?? '',
        onchange: (e) => edit(collection, rec, { [field]: kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null) }),
      });
    }
    section.append(el('div', { class: 'field' }, el('label', {}, label), input));
  }
  return section;
}

// ── Добавление записи ─────────────────────────────────────────────────────

export function addSheet(collection) {
  const labels = { bottles: 'бутылку', cocktails: 'коктейль', places: 'место', dishes: 'блюдо' };
  const name = el('input', { type: 'text', placeholder: 'Название', autofocus: true });
  const extra = collection === 'bottles'
    ? el('select', {}, el('option', { value: '' }, 'Категория'),
        ...options('bottles', 'category').map((o) => el('option', { value: o.name }, o.name)))
    : null;

  return el('div', {},
    el('h2', {}, `Добавить ${labels[collection]}`),
    el('div', { class: 'field', style: 'margin-top:18px' }, el('label', {}, 'Название'), name),
    extra ? el('div', { class: 'field' }, el('label', {}, 'Категория'), extra) : null,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: closeSheet }, 'Отмена'),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          if (!name.value.trim()) return name.focus();
          const fields = { name: name.value.trim() };
          if (collection === 'bottles') { fields.category = extra.value || null; fields.level = 'Запечатана'; }
          create(collection, fields);
          closeSheet();
          rerender();
        },
      }, 'Добавить')),
  );
}

// Перерисовку задаёт app.js — так views не тянет за собой роутер.
export let rerender = () => {};
export const setRerender = (fn) => { rerender = fn; };
