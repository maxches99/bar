import { el, norm } from './dom.js?v=20260905145553';
import { getToken, unlock, lock } from './auth.js?v=20260905145553';
import { diagnoseToken } from './github.js?v=20260905145553';
import { load, flush, setStatusHandler, isDirty, LOCAL } from './store.js?v=20260905145553';
import * as V from './views.js?v=20260905145553';

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
const LABELS = { dirty: 'не сохранено', saving: 'сохраняю…', saved: 'сохранено', error: 'не сохранилось' };

/** Запись идёт через /git/blobs и /git/refs — для них права Contents: Read-only мало. */
function describeSaveError(err) {
  if (err?.status === 403 || err?.status === 404) {
    return 'Правка не сохранилась: у токена нет права на запись. Открой github.com/settings/personal-access-tokens → свой токен → Repository permissions → Contents → Read and write.';
  }
  if (err?.status === 401) return 'Правка не сохранилась: GitHub перестал принимать токен — он отозван или истёк.';
  if (err?.status === 409 || err?.status === 422) return 'Кто-то записал в репозиторий раньше. Нажми «Повторить» — правка наложится на свежую версию.';
  return `Правка не сохранилась: ${err?.message || err}`;
}

function showBanner(text) {
  const banner = $('banner');
  banner.replaceChildren(
    el('div', {}, text),
    el('button', { class: 'btn', onclick: () => { hideBanner(); flush(); } }, 'Повторить'),
  );
  banner.hidden = false;
}
const hideBanner = () => { $('banner').hidden = true; };

setStatusHandler((stateName, err) => {
  const node = $('sync');
  node.dataset.state = stateName;
  node.textContent = LABELS[stateName] || '';
  if (stateName === 'error') { console.error(err); showBanner(describeSaveError(err)); }
  if (stateName === 'saving' || stateName === 'saved') hideBanner();
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
// Данные грузим ДО того, как прятать экран входа: иначе при сбое чтения
// пользователь получает пустую оболочку, а сообщение об ошибке рисуется
// на уже скрытом экране и его никто не видит.
async function start() {
  await load();
  $('lock').hidden = true;
  $('app').hidden = false;
  route();
}

/** /repos/… открывается по праву Metadata, а /contents/… требует Contents — отсюда самая частая беда. */
function describeLoadError(err) {
  if (err.status === 404) {
    return 'Токен видит репозиторий, но не может читать файлы. Открой токен на github.com/settings/personal-access-tokens и поставь Repository permissions → Contents: Read and write.';
  }
  if (err.status === 403) return 'GitHub отклонил чтение (403): либо не выдано право Contents, либо упёрлись в лимит запросов.';
  if (err.status === 401) return 'GitHub перестал принимать токен — он отозван или истёк.';
  return `Данные не читаются: ${err.message || err}`;
}

function showLockError(text) {
  const error = $('lock-error');
  $('lock').hidden = false;
  $('app').hidden = true;
  error.textContent = text;
  error.hidden = false;
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
    showLockError(describeLoadError(err));
  } finally {
    button.disabled = false;
  }
});

if (LOCAL) {
  start().catch((err) => { $('view').textContent = String(err); });
} else if (getToken()) {
  // Не перезагружаем страницу по кругу — показываем, что именно сломалось.
  start().catch((err) => { lock(); showLockError(describeLoadError(err)); $('passphrase').focus(); });
} else {
  $('passphrase').focus();
}
