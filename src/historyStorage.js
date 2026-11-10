import { legacyOperations, materializeHistory, mergeOperations, newId, readOperations } from './history.js';

export const HISTORY_PREFIX = 'focusflow_history_v2_';
const CLEAR_PREFIX = HISTORY_PREFIX + 'clear_';
const BATCH_PREFIX = HISTORY_PREFIX + 'batch_';
const BACKUP_KEY = HISTORY_PREFIX + 'legacy_backup';
const REMOTE_KEY = HISTORY_PREFIX + 'remote';
const CONNECTION_KEY = HISTORY_PREFIX + 'connection';
const LEGACY_KEY = 'pomodoroHistory';

export function backupLegacyHistory() {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null && localStorage.getItem(BACKUP_KEY) === null) {
    legacyOperations(JSON.parse(legacy));
    localStorage.setItem(BACKUP_KEY, legacy);
  }
}

export function readLocalOperations() {
  const backup = legacyOperations(JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '[]'));
  const legacy = legacyOperations(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]'));
  const keys = Object.keys(localStorage);
  const cleared = new Set(keys.filter(key => key.startsWith(CLEAR_PREFIX))
    .flatMap(key => JSON.parse(localStorage.getItem(key))));
  const batches = keys.filter(key => key.startsWith(BATCH_PREFIX))
    .map(key => readOperations(JSON.parse(localStorage.getItem(key))));
  return mergeOperations(backup, legacy, ...batches).filter(operation => !cleared.has(operation.recordId));
}

export function writeLocalOperations(operations) {
  if (operations.length) {
    localStorage.setItem(BATCH_PREFIX + operations[0].id, JSON.stringify(readOperations(operations)));
  }
}

export function clearLocalRecords(recordIds) {
  localStorage.setItem(CLEAR_PREFIX + newId(), JSON.stringify(recordIds.map(String)));
}

export function readRemoteOperations() {
  return readOperations(JSON.parse(localStorage.getItem(REMOTE_KEY) ?? '[]'));
}

export function rememberRemoteOperations(operations) {
  const cache = mergeOperations(readRemoteOperations(), operations);
  localStorage.setItem(REMOTE_KEY, JSON.stringify(cache));
}

export function readConnection() {
  return JSON.parse(localStorage.getItem(CONNECTION_KEY) ?? 'null');
}

export function rememberConnection(connection) {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export function readHistoryView() {
  const local = readLocalOperations();
  const remote = readRemoteOperations();
  const acknowledged = new Set(remote.map(operation => operation.id));
  return {
    entries: materializeHistory(mergeOperations(local, remote)),
    pendingCount: local.filter(operation => !acknowledged.has(operation.id)).length
  };
}
