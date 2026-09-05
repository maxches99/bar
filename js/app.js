import { el, norm } from './dom.js?v=20260905144423';
import { getToken, unlock, lock } from './auth.js?v=20260905144423';
import { diagnoseToken } from './github.js?v=20260905144423';
import { load, flush, setStatusHandler, isDirty, LOCAL } from './store.js?v=20260905144423';
import * as V from './views.js?v=20260905144423';

const $ = (id) => document.getElementById(id);

const TABS = {
  bar:       { title: 'Бар',      view: V.barView,       filters: V.barFilters,      add: 'bottles' },
  cocktails: { title: 'Коктейли', view: V.cocktailsView, filters: V.cocktailFilters, add: 'cocktails' },
  places:    { title: 'Места',    view: V.placesView,    filters: V.placeFilters,    add: 'places' },
  dishes:    { title: 'Блюда',    view: V.dishesView,    filters: V.dishFilters,     add: 'dishes' },
};

// В баре больше половины позиций — справочник ингредиентов с пометкой «Закончилась»,
// поэтому по умолчанию показываем только то, что реально стоит дома.
const DEFAULT_FILTER = { bar: 'stock' };
const ui = { tab: 'bar', q: '', filter: DEFAULT_FILTER.bar };
const filterMemory = {};

// ── состояние синхронизации в шапке ───────────────────────────────────────
const LABELS = { dirty: 'не сохранено', saving: 'сохраняю…', saved: 'сохранено', error: 'ошибка сохранения' };
setStatusHandler((stateName, err) => {
  const node = $('sync');
  node.dataset.state = stateName;
  node.textContent = LABELS[stateName] || '';
  if (err) console.error(err);
  if (stateName === 'saved') setTimeout(() => { if (!isDirty()) node.textContent = ''; }, 2000);
});

// ── рендер ────────────────────────────────────────────────────────────────
function render() {
  const tab = TABS[ui.tab];
  $('title').textContent = tab.title;
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.tab === ui.tab);
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
  });

  const chips = tab.filters();
  if (!chips.some(([key]) => key === ui.filter)) ui.filter = 'all';

  $('filters').replaceChildren(...chips.map(([key, label, count]) =>
    el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(key === ui.filter),
      onclick: () => { ui.filter = key; filterMemory[ui.tab] = key; render(); },
    }, label, el('span', { class: 'n' }, String(count)))));

  $('view').replaceChildren(tab.view({ q: norm(ui.q), filter: ui.filter }));

  let fab = document.querySelector('.fab');
  if (!fab) {
    fab = el('button', { class: 'fab', title: 'Добавить' }, '+');
    document.body.append(fab);
  }
  fab.onclick = () => V.openSheet(V.addSheet(TABS[ui.tab].add));
}
V.setRerender(render);

// ── роутер и ввод ─────────────────────────────────────────────────────────
function route() {
  const tab = location.hash.replace('#/', '') || 'bar';
  if (!TABS[tab]) return location.replace('#/bar');
  ui.tab = tab;
  ui.filter = filterMemory[tab] || DEFAULT_FILTER[tab] || 'all';
  ui.q = '';
  $('search').value = '';
  render();
}
addEventListener('hashchange', route);

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { ui.q = e.target.value; render(); }, 120);
});

$('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') V.closeSheet(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') V.closeSheet(); });
$('sync').addEventListener('click', () => { if (isDirty()) flush(); });

// ── вход ──────────────────────────────────────────────────────────────────
async function start() {
  $('lock').hidden = true;
  $('app').hidden = false;
  await load();
  route();
}

$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  const error = $('lock-error');
  button.disabled = true;
  error.hidden = true;
  // Три разные беды — три разных сообщения: фраза, токен, загрузка данных.
  try {
    await unlock($('passphrase').value);
  } catch {
    lock();
    error.textContent = 'Неверная фраза.';
    error.hidden = false;
    $('passphrase').select();
    button.disabled = false;
    return;
  }

  const check = await diagnoseToken();
  if (!check.ok) {
    lock();
    error.textContent = check.text;
    error.hidden = false;
    button.disabled = false;
    return;
  }

  try {
    await start();
  } catch (err) {
    lock();
    error.textContent = `Токен подошёл, но данные не читаются: ${err.message || err}`;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

if (LOCAL) {
  start().catch((err) => { $('view').textContent = String(err); });
} else if (getToken()) {
  start().catch(() => { lock(); location.reload(); });
} else {
  $('passphrase').focus();
}
