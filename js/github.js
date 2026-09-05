// Чтение и запись данных в приватном репозитории через GitHub API.
// Запись — одним коммитом на все изменённые файлы (Git Data API), чтобы не было полусохранённых состояний.
import { REPO } from './config.js';
import { getToken } from './auth.js';

const base = () => `https://api.github.com/repos/${REPO.owner}/${REPO.name}`;

async function gh(path, { method = 'GET', body, accept = 'application/vnd.github+json' } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`GitHub ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return accept.includes('raw') ? res.text() : res.json();
}

export async function readJson(path) {
  const text = await gh(`/contents/${path}?ref=${REPO.branch}&t=${Date.now()}`, {
    accept: 'application/vnd.github.raw',
  });
  return JSON.parse(text);
}

export async function headSha() {
  const ref = await gh(`/git/ref/heads/${REPO.branch}`);
  return ref.object.sha;
}

/** files: { 'data/bottles.json': '<содержимое>' }. Возвращает sha нового коммита. */
export async function commit(files, message) {
  const parent = await headSha();
  const commitInfo = await gh(`/git/commits/${parent}`);

  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await gh('/git/blobs', { method: 'POST', body: { content, encoding: 'utf-8' } });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: commitInfo.tree.sha, tree } });
  const newCommit = await gh('/git/commits', {
    method: 'POST',
    body: { message, tree: newTree.sha, parents: [parent] },
  });
  await gh(`/git/refs/heads/${REPO.branch}`, { method: 'PATCH', body: { sha: newCommit.sha } });
  return newCommit.sha;
}

export async function checkToken() {
  const res = await fetch(`${base()}`, {
    headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/vnd.github+json' },
  });
  return res.ok;
}
