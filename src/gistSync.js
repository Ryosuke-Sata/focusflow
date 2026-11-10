import { legacyOperations, mergeOperations, newId, readOperations } from './history.js';
import {
  backupLegacyHistory, readConnection, readLocalOperations, readRemoteOperations,
  rememberConnection, rememberRemoteOperations
} from './historyStorage.js';

const API = 'https://api.github.com/gists';
const DESCRIPTION = 'FocusFlow Data';
const LEGACY_FILE = 'focusflow_history.json';
const DEVICE_FILE = /^focusflow_v2_[a-f\d-]+\.json$/;

async function github(url, token, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(body && { 'Content-Type': 'application/json' })
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout?.(20000)
  });
  if (!response.ok) throw new Error(`GitHub Gist に接続できませんでした (HTTP ${response.status})。`);
  return response.json();
}

async function findGists(token, gistId) {
  const matches = [];
  for (let page = 1; ; page++) {
    const gists = await github(`${API}?per_page=100&page=${page}`, token);
    for (const gist of gists) {
      if (gist.public) continue;
      if (gistId ? gist.id === gistId : gist.description === DESCRIPTION &&
          Object.keys(gist.files).some(name => name === LEGACY_FILE || DEVICE_FILE.test(name))) {
        matches.push(gist);
      }
    }
    if (gists.length < 100 || (gistId && matches.length)) return matches;
  }
}

async function findGist(token, connection, upload) {
  let matches = await findGists(token, connection?.gistId);
  if (connection && !matches.length) {
    throw new Error('連携済みの Gist にアクセスできません。GitHub アカウントと PAT を確認してください。');
  }
  if (!matches.length && upload) {
    await github(API, token, 'POST', {
      description: DESCRIPTION,
      public: false,
      files: { [LEGACY_FILE]: { content: '[]' } }
    });
    matches = await findGists(token);
    if (!matches.length) throw new Error('作成した Gist を取得できませんでした。再試行してください。');
  }
  if (matches.length > 1) {
    throw new Error('FocusFlow Data が複数あります。同期先を1つに絞るため、Gist の説明を確認してください。');
  }
  return matches[0];
}

async function readFile(file) {
  if (!file.truncated) return JSON.parse(file.content);

  const url = new URL(file.raw_url);
  if (url.origin !== 'https://gist.githubusercontent.com') {
    throw new Error('Gist のデータ取得先が無効です。');
  }
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout?.(20000) });
  if (!response.ok) throw new Error('Gist のファイル全体を取得できませんでした。');
  return response.json();
}

async function readGist(token, gistId) {
  const gist = await github(`${API}/${gistId}`, token);
  if (gist.public) throw new Error('FocusFlow の同期には公開設定を Secret にした Gist を使ってください。');
  if (gist.truncated) throw new Error('Gist のファイル一覧をすべて取得できませんでした。');

  const files = Object.entries(gist.files)
    .filter(([name]) => name === LEGACY_FILE || DEVICE_FILE.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const contents = await Promise.all(files.map(async ([name, file]) => {
    const data = await readFile(file);
    if (name === LEGACY_FILE) return [name, legacyOperations(data)];
    if (data.version !== 2) throw new Error('未対応の Gist データ形式です。');
    return [name, readOperations(data.operations)];
  }));
  const groups = new Map(contents);
  const legacy = groups.get(LEGACY_FILE) ?? [];
  groups.delete(LEGACY_FILE);
  const uploaded = mergeOperations(...groups.values());
  return { groups, uploaded, operations: mergeOperations(uploaded, legacy) };
}

export async function syncGist(token, { upload = true } = {}) {
  if (!navigator.onLine) throw new Error('オフラインです。再接続後に同期します。');
  if (!navigator.locks) throw new Error('同期には Web Locks に対応したブラウザと HTTPS 接続が必要です。');

  // Serialize writers sharing a browser profile. Each profile only writes its own file.
  return navigator.locks.request('focusflow-gist-sync', async () => {
    backupLegacyHistory();
    let connection = readConnection();
    const gist = await findGist(token, connection, upload);
    if (!gist) return;
    const remote = await readGist(token, gist.id);

    if (!connection) {
      connection = { gistId: gist.id, deviceId: newId() };
      rememberConnection(connection);
    }
    rememberRemoteOperations(remote.operations);
    if (!upload) return;

    // Copy legacy rows into the versioned files without modifying the original Gist file.
    const remoteIds = new Set(remote.uploaded.map(operation => operation.id));
    const missing = mergeOperations(readLocalOperations(), readRemoteOperations())
      .filter(operation => !remoteIds.has(operation.id));
    if (!missing.length) return;

    const filename = `focusflow_v2_${connection.deviceId}.json`;
    const operations = mergeOperations(remote.groups.get(filename) ?? [], missing);
    await github(`${API}/${gist.id}`, token, 'PATCH', {
      files: { [filename]: { content: JSON.stringify({ version: 2, operations }, null, 2) } }
    });

    const confirmed = await readGist(token, gist.id);
    const confirmedIds = new Set(confirmed.uploaded.map(operation => operation.id));
    if ([...remote.uploaded, ...missing].some(operation => !confirmedIds.has(operation.id))) {
      throw new Error('すべての変更を Gist で確認できませんでした。同期を再試行してください。');
    }
    rememberRemoteOperations(confirmed.operations);
  });
}
