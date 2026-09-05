// Данные в памяти + отложенное сохранение в репозиторий.
// Правка помечает запись localEditedAt — по этой метке ночной синк решает, что везти в Notion.
import { readJson, commit } from './github.js?v=20260905145553';
import { FILES } from './config.js?v=20260905145553';

// Режим предпросмотра: на localhost читаем data/ прямо с диска и ничего не сохраняем.
// ?remote заставляет и локально ходить в GitHub — чтобы проверить вход и запись.
const params = new URLSearchParams(location.search);
export const LOCAL = !params.has('remote') &&
  (params.has('local') || ['localhost', '127.0.0.1'].includes(location.hostname));
const fetchJson = LOCAL
  ? (path) => fetch(`../${path}?t=${Date.now()}`).then((r) => r.json())
  : readJson;

export const state = { bottles: [], cocktails: [], places: [], dishes: [], meta: { options: {} } };

const files = {};            // коллекция → полное содержимое файла
const index = {};            // коллекция → Map(id → запись)
const dirty = new Set();
let timer = null;
let saving = null;
let notify = () => {};

export const setStatusHandler = (fn) => { notify = fn; };
export const byId = (collection, id) => index[collection]?.get(id) || null;
export const isDirty = () => dirty.size > 0 || !!saving;

const COLLECTIONS = ['bottles', 'cocktails', 'places', 'dishes'];

function reindex(collection) {
  index[collection] = new Map(state[collection].map((r) => [r.id, r]));
}

export async function load() {
  const [meta, ...rest] = await Promise.all([
    fetchJson(FILES.meta).catch(() => ({ options: {} })),
    ...COLLECTIONS.map((c) => fetchJson(FILES[c])),
  ]);
  state.meta = meta;
  COLLECTIONS.forEach((c, i) => {
    files[c] = rest[i];
    state[c] = rest[i].items;
    reindex(c);
  });
}

export function edit(collection, rec, patch) {
  Object.assign(rec, patch, { localEditedAt: new Date().toISOString() });
  dirty.add(collection);
  schedule();
}

export function create(collection, fields) {
  const rec = {
    id: `local:${crypto.randomUUID()}`,
    ...fields,
    createdAt: new Date().toISOString(),
    localEditedAt: new Date().toISOString(),
    syncedAt: null,
    notionEditedAt: null,
  };
  state[collection].unshift(rec);
  index[collection].set(rec.id, rec);
  dirty.add(collection);
  schedule();
  return rec;
}

export function remove(collection, rec) {
  // Локальную запись просто выкидываем, приехавшую из Notion — помечаем на архивацию.
  if (String(rec.id).startsWith('local:')) {
    state[collection] = state[collection].filter((r) => r !== rec);
    index[collection].delete(rec.id);
  } else {
    edit(collection, rec, { archived: true });
  }
  dirty.add(collection);
  schedule();
}

function schedule() {
  notify('dirty');
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}

export async function flush() {
  clearTimeout(timer);
  if (saving) return saving;
  if (!dirty.size) return;

  const sending = [...dirty];
  dirty.clear();
  notify('saving');

  saving = (async () => {
    try {
      await writeCollections(sending);
      notify(dirty.size ? 'dirty' : 'saved');
    } catch (err) {
      sending.forEach((c) => dirty.add(c));
      notify('error', err);
      throw err;
    } finally {
      saving = null;
    }
  })();

  try { await saving; } catch { /* состояние уже показано в шапке */ }
}

async function writeCollections(collections, retry = true) {
  const payload = {};
  for (const c of collections) {
    files[c] = { updatedAt: new Date().toISOString(), items: state[c] };
    payload[FILES[c]] = JSON.stringify(files[c], null, 2) + '\n';
  }
  const names = { bottles: 'бар', cocktails: 'коктейли', places: 'места', dishes: 'блюда' };
  const message = `Сайт: ${collections.map((c) => names[c]).join(', ')}`;
  if (LOCAL) { console.info('предпросмотр: сохранение пропущено —', message); return; }
  try {
    await commit(payload, message);
  } catch (err) {
    // Кто-то (синк с Notion) успел записать раньше — подтягиваем свежее и наклеиваем свои правки сверху.
    if (retry && (err.status === 409 || err.status === 422)) {
      await mergeRemote(collections);
      return writeCollections(collections, false);
    }
    throw err;
  }
}

async function mergeRemote(collections) {
  for (const c of collections) {
    const remote = await fetchJson(FILES[c]);
    const mine = new Map(
      state[c].filter((r) => r.localEditedAt).map((r) => [r.id, r]),
    );
    const merged = remote.items.map((r) => mine.get(r.id) || r);
    for (const [id, rec] of mine) {
      if (!merged.some((r) => r.id === id)) merged.push(rec);
    }
    state[c] = merged;
    files[c] = { ...remote, items: merged };
    reindex(c);
  }
}

export const options = (collection, field) => state.meta.options?.[collection]?.[field] || [];

// Сохранить недописанное, если вкладку закрывают.
addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
addEventListener('beforeunload', (e) => { if (isDirty()) { flush(); e.preventDefault(); } });
