import { useCallback, useEffect, useRef, useState } from 'react';
import { syncGist } from './gistSync.js';
import { HISTORY_PREFIX, backupLegacyHistory, clearLocalRecords, readHistoryView, writeLocalOperations } from './historyStorage.js';

function getHistoryView() {
  try {
    return { ...readHistoryView(), error: '' };
  } catch (error) {
    return { entries: [], pendingCount: 0, error: `端末の履歴を読み込めませんでした。${error.message}` };
  }
}

export default function useHistory(token) {
  const [view, setView] = useState(getHistoryView);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [syncStatus, setSyncStatus] = useState({ busy: false, error: '', checked: false });
  const [revision, setRevision] = useState(0);
  const queue = useRef(Promise.resolve());

  const sync = useCallback((upload = true) => {
    if (!token) return;
    queue.current = queue.current.then(async () => {
      setSyncStatus({ busy: true, error: '', checked: false });
      try {
        await syncGist(token, { upload });
        setSyncStatus({ busy: false, error: '', checked: true });
      } catch (error) {
        setSyncStatus({ busy: false, error: error.message, checked: true });
      } finally {
        setView(getHistoryView());
      }
    });
    return queue.current;
  }, [token]);

  useEffect(() => {
    const refresh = event => {
      if (event.key === null || event.key === 'pomodoroHistory' || event.key.startsWith(HISTORY_PREFIX)) {
        setView(getHistoryView());
      }
    };
    const updateNetwork = () => setIsOnline(navigator.onLine);
    window.addEventListener('storage', refresh);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (!token || !isOnline) return;
    const timer = setTimeout(() => sync(), 400);
    return () => clearTimeout(timer);
  }, [token, isOnline, revision, sync]);

  function persist(change) {
    try {
      backupLegacyHistory();
      readHistoryView();
      change();
      setView(getHistoryView());
      setRevision(current => current + 1);
      return '';
    } catch (error) {
      return `端末に変更を保存できませんでした。${error.message}`;
    }
  }

  const saveChanges = operations => persist(() => writeLocalOperations(operations));
  const clearLocalHistory = ids => persist(() => clearLocalRecords(ids));

  let status = 'この端末に保存';
  if (token) {
    if (!isOnline) status = view.pendingCount ? 'オフライン · 未同期' : 'オフライン';
    else if (syncStatus.busy) status = '同期中…';
    else if (syncStatus.error) status = `同期エラー · ${syncStatus.error}`;
    else if (view.pendingCount || !syncStatus.checked) status = '未同期';
    else status = '同期済み';
  }

  return { ...view, sync, status, isSyncing: syncStatus.busy, saveChanges, clearLocalHistory };
}
