import { useState, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import HistoryEditor from './HistoryEditor.jsx';
import { calendarDate, dateInputValue, makeOperation, newId } from './history.js';
import useHistory from './useHistory.js';
import './App.css';

// --- 洗練されたUI用のSVGアイコン ---
const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>
);

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
  </svg>
);

const StopIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h12v12H6z"/>
  </svg>
);

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9"></polyline>
    <polyline points="9 21 3 21 3 15"></polyline>
    <line x1="21" y1="3" x2="14" y2="10"></line>
    <line x1="3" y1="21" x2="10" y2="14"></line>
  </svg>
);

// リロード（取得）アイコン
const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
  </svg>
);

// 上矢印（送信）アイコン
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>
);

const HEAT_LEVELS = [
  { min: 0, label: '0' },
  { min: 1, label: '1–24' },
  { min: 25, label: '25–49' },
  { min: 50, label: '50–99' },
  { min: 100, label: '100+' }
];

function recentTimer(record) {
  if (record.timer_mode === 'Focus 50') return { mode: 'Focus 50', minutes: 50 };
  if (record.timer_mode === 'Custom' && Number.isInteger(record.timer_minutes) &&
      record.timer_minutes >= 1 && record.timer_minutes <= 180) {
    return { mode: 'Custom', minutes: record.timer_minutes };
  }
  return { mode: 'Focus 25', minutes: 25 };
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone);
}

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('focusflow_theme') || 'system');
  const [viewMode, setViewMode] = useState('main'); 
  const [activeTab, setActiveTab] = useState('Timer'); 
  const [slideDirection, setSlideDirection] = useState('slide-none');

  const [currentCalDate, setCurrentCalDate] = useState(new Date());
  const [selectedCalDateStr, setSelectedCalDateStr] = useState(() => calendarDate(new Date()));
  const [editor, setEditor] = useState(null);

  const [timerMode, setTimerMode] = useState('Focus 25');
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('ja-JP'));
  const [customMinutes, setCustomMinutes] = useState(25);

  const [sessionStart, setSessionStart] = useState('');
  const audioCtxRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const getModeDuration = (mode) => {
    if (mode === 'Focus 25') return 25;
    if (mode === 'Focus 50') return 50;
    if (mode === 'Break 5') return 5;
    if (mode === 'Break 15') return 15;
    if (mode === 'Custom') return customMinutes;
    return 25;
  };

  const handleCustomMinutesChange = (value) => {
    const minutes = Math.max(1, Math.min(180, value));
    setCustomMinutes(minutes);
    setTimeLeft(minutes * 60);
  };

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone] = useState(isStandaloneApp);
  const [isMobileOS] = useState(() => isIosDevice() || /android/i.test(navigator.userAgent));
  const [showIosPrompt, setShowIosPrompt] = useState(() => isIosDevice() && !isStandaloneApp());
  const [customAlert, setCustomAlert] = useState(null);
  const [customConfirm, setCustomConfirm] = useState(null);
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('focusflow_pat') ?? '');
  const [patInput, setPatInput] = useState('');
  const {
    entries, sync, status, isSyncing, saveChanges, clearLocalHistory, error: historyError
  } = useHistory(githubToken);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const today = calendarDate(new Date());
  const { stats, days, recentTasks, conflicts } = useMemo(() => {
    const days = new Map();
    const recentTasks = new Map();
    const conflicts = [];
    let totalMins = 0;
    for (const entry of entries) {
      const record = entry.record;
      const day = days.get(record.date) ?? { entries: [], minutes: 0 };
      day.entries.push(entry);
      day.minutes += record.duration_minutes;
      days.set(record.date, day);
      totalMins += record.duration_minutes;
      if (record.task_name.trim() && record.task_name !== '名無しのタスク' && !recentTasks.has(record.task_name)) {
        recentTasks.set(record.task_name, record);
      }
      if (entry.alternatives.length) conflicts.push(entry);
    }

    let weekMins = 0;
    const day = new Date();
    for (let offset = 0; offset < 7; offset++) {
      weekMins += days.get(calendarDate(day))?.minutes ?? 0;
      day.setDate(day.getDate() - 1);
    }
    const todaySummary = days.get(today);
    return {
      days, recentTasks: [...recentTasks.values()].slice(0, 5), conflicts,
      stats: {
        todayMins: todaySummary?.minutes ?? 0, todayCount: todaySummary?.entries.length ?? 0,
        weekMins, totalMins, totalCount: entries.length
      }
    };
  }, [entries, today]);

  const selectedDay = days.get(selectedCalDateStr);
  const selectedEntries = selectedDay?.entries ?? [];

  const getCalendarDays = () => {
    const day = new Date(currentCalDate);
    day.setDate(1);
    const firstDayIndex = day.getDay();
    const month = day.getMonth();
    const days = Array(firstDayIndex).fill(null);
    while (day.getMonth() === month) {
      days.push({ day: day.getDate(), dateStr: calendarDate(day) });
      day.setDate(day.getDate() + 1);
    }
    return days;
  };

  const shiftMonth = (offset) => {
    const month = new Date(currentCalDate);
    month.setDate(1);
    month.setMonth(month.getMonth() + offset);
    if (month.getFullYear() < 1 || month.getFullYear() > 9999) return;
    setCurrentCalDate(month);
    setSelectedCalDateStr(calendarDate(month));
  };

  const handleTouchStart = (e) => {
    // 指が触れた瞬間のX座標とY座標を記録
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    };
  };

  const handleTabClick = (targetTab) => {
    const tabs = ['Timer', 'History', 'Settings'];
    const currentIndex = tabs.indexOf(activeTab);
    const targetIndex = tabs.indexOf(targetTab);
    
    if (currentIndex < targetIndex) setSlideDirection('slide-left');
    else if (currentIndex > targetIndex) setSlideDirection('slide-right');
    else setSlideDirection('slide-none');
    
    setActiveTab(targetTab);
  };

  const handleTouchEnd = (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;

    if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
      const tabs = ['Timer', 'History', 'Settings'];
      const currentIndex = tabs.indexOf(activeTab);

      if (deltaX < 0) {
        // 左スワイプ（指を右から左へ） ➔ 次のタブへ（画面は左へスライド）
        if (currentIndex < tabs.length - 1) {
          setSlideDirection('slide-left'); // ★追加
          setActiveTab(tabs[currentIndex + 1]);
        }
      } else {
        // 右スワイプ（指を左から右へ） ➔ 前のタブへ（画面は右へスライド）
        if (currentIndex > 0) {
          setSlideDirection('slide-right'); // ★追加
          setActiveTab(tabs[currentIndex - 1]);
        }
      }
    }
  };

  useEffect(() => {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = theme === 'dark' || (theme === 'system' && systemTheme.matches);
      const compact = isMobileOS && viewMode !== 'main';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.compact = String(compact);
      document.querySelector('meta[name="theme-color"]').content =
        getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    };

    applyTheme();
    systemTheme.addEventListener('change', applyTheme);
    return () => systemTheme.removeEventListener('change', applyTheme);
  }, [theme, viewMode, isMobileOS]);

  useEffect(() => {
    if (!isStandalone) return;
    // スマホではリサイズ命令は無視されるため，PC版のPWAのみで機能します
    const setOptimalWindowSize = () => {
      if (viewMode === 'main') window.resizeTo(400, 750);
      else if (viewMode === 'mini') window.resizeTo(280, 320); 
      else if (viewMode === 'bar') window.resizeTo(520, 100); 
    };
    setOptimalWindowSize();
  }, [viewMode, isStandalone]);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    }
  };

  useEffect(() => {
    const clockInterval = setInterval(() => setCurrentTime(new Date().toLocaleTimeString('ja-JP')), 1000);
    return () => clearInterval(clockInterval);
  }, []);

  const initAudio = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(console.warn);
  };

  const playAlarm = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    let time = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 1000;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(time); gain.gain.exponentialRampToValueAtTime(0.00001, time + 0.2);
      osc.stop(time + 0.2); time += 0.3;
    }
  };

  const handleTimerFinish = useEffectEvent(() => {
    try {
      playAlarm();
    } catch (error) {
      console.warn('タイマーの音を再生できませんでした。', error);
    }

    const isFocus = timerMode.startsWith('Focus') || timerMode === 'Custom';
    if (window.Notification?.permission === 'granted') {
      const options = { body: isFocus ? 'お疲れ様でした！休憩しましょう。' : '休憩終了！作業に戻りましょう。' };
      try {
        new Notification('FocusFlow', options);
      } catch {
        navigator.serviceWorker?.getRegistration().then(registration =>
          registration?.showNotification('FocusFlow', options)).catch(console.warn);
      }
    }

    const duration = getModeDuration(timerMode);
    if (isFocus) {
      const now = new Date();
      const endTime = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const record = {
        id: newId(), date: calendarDate(now), duration_minutes: duration,
        task_name: taskName.trim() || '名無しのタスク', time_range: `${sessionStart || endTime} - ${endTime}`,
        timer_mode: timerMode, timer_minutes: duration
      };
      const error = saveChanges([makeOperation(record.id, record)]);
      if (error) setCustomAlert(error);
    }

    setIsRunning(false);
    setTimeLeft(duration * 60);
    setSessionStart('');
  });

  useEffect(() => {
    if (!isRunning) return;
    const timer = setTimeout(() => {
      if (timeLeft <= 1) handleTimerFinish();
      else setTimeLeft(timeLeft - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [isRunning, timeLeft]);

  const startSession = () => {
    initAudio();
    setSessionStart(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
    setIsRunning(true);
  };

  const toggleTimer = () => {
    if (!sessionStart) {
      startSession();
      return;
    }
    if (!isRunning) initAudio();
    setIsRunning(!isRunning);
  };

  const resetTimer = (mode = timerMode) => {
    setIsRunning(false);
    setTimeLeft(getModeDuration(mode) * 60);
    setSessionStart('');
  };

  const handleModeChange = (mode) => {
    setTimerMode(mode);
    resetTimer(mode);
  };

  const startRecentTask = (record) => {
    if (sessionStart) return;
    const { mode, minutes } = recentTimer(record);
    setTaskName(record.task_name);
    setTimerMode(mode);
    if (mode === 'Custom') setCustomMinutes(minutes);
    setTimeLeft(minutes * 60);
    startSession();
  };

  const saveRecord = (changes) => {
    const { entry } = editor;
    const record = { id: newId(), ...entry?.record, ...changes };
    const error = saveChanges([makeOperation(record.id, record, entry?.heads)]);
    if (error) return error;
    setSelectedCalDateStr(record.date);
    setCurrentCalDate(new Date(dateInputValue(record.date) + 'T12:00:00'));
    setEditor(null);
    return '';
  };

  const deleteRecord = (entry) => setCustomConfirm({
    message: `「${entry.record.task_name}」の作業履歴を削除しますか？`,
    onConfirm: () => {
      const error = saveChanges([makeOperation(entry.record.id, null, entry.heads)]);
      setCustomConfirm(null);
      if (error) setCustomAlert(error);
    }
  });

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const formatMins = (mins) => {
    if (mins === 0) return '0m';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const exportCSV = () => {
    if (!entries.length) return setCustomAlert('出力する履歴データがありません。');

    setCustomConfirm({
      message: githubToken
        ? '現在表示できる履歴を CSV として出力しますか？'
        : 'CSV を出力しますか？\n出力後に、この端末の履歴がクリアされます。',
      onConfirm: () => {
        const rows = entries.map(({ record }) =>
          [record.id, record.date, record.duration_minutes, record.task_name, record.time_range]
            .map(value => '"' + String(value).replaceAll('"', '""') + '"').join(','));
        const csv = ['ID,Date,Minutes,Task Name,Time Range', ...rows].join('\n');
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `focusflow_export_${today.replaceAll('-', '')}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setCustomConfirm(null);

        const error = githubToken ? '' : clearLocalHistory(entries.map(({ record }) => record.id));
        setCustomAlert(error || (githubToken ? 'CSV を出力しました。' : 'CSV を出力し、履歴をクリアしました。'));
      }
    });
  };

  const handleSavePat = () => {
    const token = patInput.trim();
    if (!token || isSyncing) return;
    setCustomConfirm({
      message: 'このトークンの権限を「gist」のみに制限しましたか？',
      onConfirm: () => {
        localStorage.setItem('focusflow_pat', token);
        setGithubToken(token);
        setPatInput('');
        setCustomConfirm(null);
        if (token === githubToken) sync();
      }
    });
  };

  return (
    <div className={`app-container ${viewMode} ${isMobileOS ? 'is-mobile-os' : ''}`}>
      {editor && (
        <HistoryEditor record={editor.entry?.record} date={selectedCalDateStr}
          onSave={saveRecord} onCancel={() => setEditor(null)} />
      )}
      
      {/* PC / Android 用のインストールプロンプト */}
      {deferredPrompt && !isStandalone && !showIosPrompt && (
        <div className="install-prompt">
          <span>アプリとして端末にインストールしますか？</span>
          <div>
            <button className="btn-install" onClick={handleInstallClick}>はい</button>
            <button className="btn-close" onClick={() => setDeferredPrompt(null)}>✕</button>
          </div>
        </div>
      )}

      {/* iPhone (iOS Safari) 用のインストールガイド */}
      {showIosPrompt && !isStandalone && (
        <div className="install-prompt ios-prompt">
          <p className="ios-instruction">
            アプリとして利用するには，下部の<br />
            <b>[共有ボタン]</b> から <b>[ホーム画面に追加]</b><br />
            をタップしてください．
          </p>
          <button className="btn-close" style={{width: '100%'}} onClick={() => setShowIosPrompt(false)}>閉じる</button>
        </div>
      )}

      {/* カスタムアラート */}
      {customAlert && (
        <div className="custom-alert-overlay">
          <div className="custom-alert-box" role="alertdialog" aria-label="FocusFlow のメッセージ" aria-modal="true">
            <p className="custom-alert-text">{customAlert}</p>
            <button className="btn-alert-ok" onClick={() => setCustomAlert(null)}>OK</button>
          </div>
        </div>
      )}

      {/* カスタム確認ダイアログ */}
      {customConfirm && (
        <div className="custom-alert-overlay">
          <div className="custom-alert-box" role="alertdialog" aria-label="FocusFlow のメッセージ" aria-modal="true">
            <p className="custom-alert-text">{customConfirm.message}</p>
            <div style={{display: 'flex', gap: '10px', justifyContent: 'center'}}>
              <button className="btn-alert-cancel" onClick={() => setCustomConfirm(null)}>キャンセル</button>
              <button className="btn-alert-ok" onClick={customConfirm.onConfirm}>OK</button>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'main' && <div className="title-bar"><span aria-hidden="true" />FocusFlow</div>}

      <div className="main-content" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {viewMode === 'main' && (
          <div className="main-layout-inner">
            <div className="clock">{currentTime}</div>
            
            <div className="tabs">
              <button className={activeTab === 'Timer' ? 'active' : ''} onClick={() => handleTabClick('Timer')}>Timer</button>
              <button className={activeTab === 'History' ? 'active' : ''} onClick={() => handleTabClick('History')}>History</button>
              <button className={activeTab === 'Settings' ? 'active' : ''} onClick={() => handleTabClick('Settings')}>Settings</button>
            </div>

            {/* Timer タブ */}
            {activeTab === 'Timer' && (
              <div className={`tab-content ${slideDirection}`}>
                <div className="task-input-container">
                  <label htmlFor="task-name">作業内容</label>
                  <input id="task-name" type="text" className="task-input" placeholder="例: 英語の勉強" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
                </div>

                <div className="mode-segments">
                  {['Focus 25', 'Focus 50', 'Break 5', 'Break 15', 'Custom'].map(m => (
                    <button key={m} aria-pressed={timerMode === m} className={timerMode === m ? 'active' : ''} onClick={() => handleModeChange(m)}>{m}</button>
                  ))}
                </div>

                {timerMode === 'Custom' && (
                  <div className="custom-timer-adjust">
                    <button className="btn-adjust" disabled={Boolean(sessionStart)} onClick={() => handleCustomMinutesChange(customMinutes - 1)}>-</button>
                    <input 
                      type="number" 
                      className="custom-minutes-input"
                      aria-label="カスタム時間（分）"
                      min="1" 
                      max="180" 
                      disabled={Boolean(sessionStart)}
                      value={customMinutes} 
                      onChange={(e) => handleCustomMinutesChange(parseInt(e.target.value) || 1)} 
                    />
                    <span className="unit-label">分</span>
                    <button className="btn-adjust" disabled={Boolean(sessionStart)} onClick={() => handleCustomMinutesChange(customMinutes + 1)}>+</button>
                  </div>
                )}
                <div className="time-display">{formatTime(timeLeft)}</div>
                <div className="controls">
                  <button className={`btn-start ${isRunning ? 'is-running' : ''}`} onClick={toggleTimer}>{isRunning ? 'PAUSE' : 'START'}</button>
                  <button className="btn-reset" onClick={() => resetTimer()}>RESET</button>
                </div>

                {recentTasks.length > 0 && (
                  <section className="recent-tasks" aria-labelledby="recent-title">
                    <h3 id="recent-title">最近のタスク</h3>
                    <div>
                      {recentTasks.map(record => {
                        const { minutes } = recentTimer(record);
                        return (
                          <button key={record.id} type="button" disabled={Boolean(sessionStart)}
                            onClick={() => startRecentTask(record)} title={record.task_name}>
                            <span>{record.task_name}</span><small>{minutes} 分</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {isStandalone && (
                  <div className="view-controls">
                    <button className="btn-mini" onClick={() => setViewMode('mini')}>mini</button>
                    <button className="btn-bar" onClick={() => setViewMode('bar')}>bar</button>
                  </div>
                )}
                
                <p className={`status-text ${isRunning ? 'is-running' : ''}`}>{isRunning ? 'Concentrating...' : 'Ready'}</p>
              </div>
            )}

            {/* History タブ */}
            {activeTab === 'History' && (
              <div className={`tab-content history ${slideDirection}`}>
                <div className="dashboard-header">
                  <h3>ダッシュボード</h3>
                  {githubToken && (
                    <div className="dashboard-sync">
                      <button className="icon-btn" onClick={() => sync(false)}
                        disabled={isSyncing} aria-label="Gist から取得" title="Gist から取得">
                        <RefreshIcon />
                      </button>
                      <button className="icon-btn" onClick={() => sync()}
                        disabled={isSyncing} aria-label="Gist に同期" title="Gist に同期">
                        <UploadIcon />
                      </button>
                    </div>
                  )}
                </div>
                {githubToken && <p className="sync-status" role="status">{status}</p>}
                {historyError && <p className="form-error" role="alert">{historyError}</p>}

                {conflicts.length > 0 && (
                  <details className="history-conflicts">
                    <summary>同じ履歴が複数の端末で編集されました（{conflicts.length} 件）</summary>
                    {conflicts.map(({ record, heads, alternatives }) => (
                      <div key={record.id} className="conflict-record">
                        {[record, ...alternatives].map((version, index) => (
                          <div key={heads[index]} className="conflict-option">
                            <span>{index === 0 && '表示中 · '}{version.date} · {version.task_name} · {version.time_range} · {formatMins(version.duration_minutes)}</span>
                            <button className="small-button" onClick={() => {
                              const error = saveChanges([makeOperation(record.id, version, heads)]);
                              if (error) setCustomAlert(error);
                            }}>採用</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </details>
                )}

                {/* 統計情報のカード */}
                <div className="stats-container">
                  <div className="stat-card">
                    <span className="stat-label">今日の集中</span>
                    {/* ★ formatMins を適用 */}
                    <span className="stat-value">{formatMins(stats.todayMins)}</span>
                    <span className="stat-sub">{stats.todayCount} 回</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">直近7日間</span>
                    <span className="stat-value">{formatMins(stats.weekMins)}</span>
                    <span className="stat-sub">作業時間</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-label">累計</span>
                    <span className="stat-value">{formatMins(stats.totalMins)}</span>
                    <span className="stat-sub">{stats.totalCount} 回</span>
                  </div>
                </div>

                {/* 集中カレンダーセクション */}
                <div className="calendar-section">
                  <div className="calendar-header">
                    <button onClick={() => shiftMonth(-1)} className="icon-btn cal-nav-btn" aria-label="前月">◀</button>
                    <span className="calendar-title">
                      {currentCalDate.getFullYear()}年 {currentCalDate.getMonth() + 1}月
                    </span>
                    <button onClick={() => shiftMonth(1)} className="icon-btn cal-nav-btn" aria-label="翌月">▶</button>
                  </div>

                  <div className="calendar-grid-weeks">
                    <span className="sunday">日</span>
                    <span>月</span><span>火</span><span>水</span><span>木</span><span>金</span>
                    <span className="saturday">土</span>
                  </div>

                  <div className="calendar-grid-days">
                    {getCalendarDays().map((item, index) => {
                      if (!item) return <div key={`empty-${index}`} className="calendar-day-empty"></div>;
                      const minutes = days.get(item.dateStr)?.minutes ?? 0;
                      const heat = HEAT_LEVELS.findLastIndex(level => minutes >= level.min);
                      const isSelected = item.dateStr === selectedCalDateStr;
                      const isToday = item.dateStr === today;
                      const weekday = index % 7 === 0 ? 'sunday' : index % 7 === 6 ? 'saturday' : '';

                      return (
                        <button type="button" key={item.dateStr}
                          className={`calendar-day-cell heat-${heat} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                          onClick={() => setSelectedCalDateStr(item.dateStr)}
                          aria-pressed={isSelected} aria-current={isToday ? 'date' : undefined}
                          aria-label={`${item.dateStr}、集中 ${minutes} 分`}>
                          <span className={`day-number ${weekday}`}>{item.day}</span>
                          {minutes > 0 && <span className="day-mins-badge">{formatMins(minutes)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="heat-legend" aria-label="日別の集中時間（分）">
                    <span>集中（分）</span>
                    {HEAT_LEVELS.map(({ label }, index) => (
                      <span key={label}><i className={`heat-${index}`} aria-hidden="true" />{label}</span>
                    ))}
                  </div>
                </div>

                <section className="selected-day-details" aria-labelledby="selected-day-heading">
                  <div className="details-header">
                    <h4 id="selected-day-heading">{selectedCalDateStr.split('-').slice(1).join('月')}日</h4>
                    <span className="details-total-mins">合計 {formatMins(selectedDay?.minutes ?? 0)}</span>
                    <button className="small-button add-history" onClick={() => setEditor({})}>＋ 履歴を追加</button>
                  </div>
                  {!selectedEntries.length && <p className="empty-day">この日の作業履歴はありません</p>}
                  {selectedEntries.map(entry => {
                    const { record } = entry;
                    return (
                      <div key={record.id} className="history-item">
                        <div className="history-description">
                          <span className="history-task" title={record.task_name}>{record.task_name}</span>
                          <span className="history-time">{record.time_range} · {formatMins(record.duration_minutes)}</span>
                        </div>
                        <button className="small-button" aria-label={`${record.task_name}を編集`}
                          onClick={() => setEditor({ entry })}>編集</button>
                        <button className="small-button delete-history" aria-label={`${record.task_name}を削除`}
                          onClick={() => deleteRecord(entry)}>削除</button>
                      </div>
                    );
                  })}
                </section>

                <button className="btn-export history-export" onClick={exportCSV}>
                  {githubToken ? 'CSVファイルとして保存' : 'CSV出力（履歴をクリア）'}
                </button>
              </div>
            )}

            {/* Settings タブ */}
            {activeTab === 'Settings' && (
              <div className={`tab-content settings-content ${slideDirection}`}>
                <div className="settings-section theme-settings">
                  <label htmlFor="theme">外観</label>
                  <select id="theme" value={theme} onChange={(event) => {
                    localStorage.setItem('focusflow_theme', event.target.value);
                    setTheme(event.target.value);
                  }}>
                    <option value="system">端末設定に合わせる</option>
                    <option value="light">ライト</option>
                    <option value="dark">ダーク</option>
                  </select>
                </div>
                <div className="settings-section">
                  <h4>GitHub Gist 同期設定</h4>
                  <p className="sync-status" role="status">{status}</p>
                  {githubToken && (
                    <button className="small-button" onClick={() => sync()} disabled={isSyncing}>今すぐ同期</button>
                  )}
                  
                  {githubToken ? (
                    <div className="pat-success-box">
                      <p className="pat-success-text">✓ PATは設定済みです<br/>(セキュリティのため非表示)</p>

                      <details style={{marginTop: '20px'}}>
                        <summary className="summary-btn">PATを上書き再設定する</summary>
                        <div style={{marginTop: '10px'}}>
                          <input type="password" className="pat-input" placeholder="ghp_..." value={patInput} onChange={(e) => setPatInput(e.target.value)} />
                          <button className="btn-save-pat" onClick={handleSavePat} disabled={isSyncing}>上書き保存</button>
                        </div>
                      </details>
                    </div>
                  ) : (
                    <>
                      <div className="settings-desc">
                        <p>複数端末で履歴を同期するには，GitHubのPersonal Access Tokenを入力してください．</p>
                        <ul style={{paddingLeft: '20px', margin: '10px 0'}}>
                          <li>GitHubの <b>[Settings]</b> ➔ <b>[Developer settings]</b> ➔ <b>[Personal access tokens]</b> ➔ <b>[Tokens (classic)]</b> <br /> から作成できます．</li>
                          <li>権限は必ず <b>[gist]</b> のみを選択してください．</li>
                          <li>トークンはブラウザ内にのみ保存されます．</li>
                        </ul>
                      </div>
                      <input 
                        type="password" 
                        className="pat-input" 
                        placeholder="ghp_..." 
                        value={patInput} 
                        onChange={(e) => setPatInput(e.target.value)} 
                      />
                      <button className="btn-save-pat" onClick={handleSavePat}>保存して同期を有効化</button>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>
        )}

        {viewMode === 'mini' && (
          <div className="mini-content">
            <div className="clock-mini">{currentTime}</div>
            
            {/* ↓ 新設：作業中のタスク名を表示する要素（長すぎる場合は自動で省略されます） ↓ */}
            <div className="mini-task" title={taskName || 'No Task'}>
              {taskName || 'No Task'}
            </div>

            <div className="time-display-mini">{formatTime(timeLeft)}</div>
            <div className="mini-controls">
              <button onClick={toggleTimer} className="icon-btn" aria-label={isRunning ? '一時停止' : '開始'}>{isRunning ? <PauseIcon /> : <PlayIcon />}</button>
              <button onClick={() => resetTimer()} className="icon-btn" aria-label="リセット"><StopIcon /></button>
            </div>
            <button className="btn-expand" aria-label="メインに戻る" onClick={() => setViewMode('main')}><ExpandIcon /> 拡大</button>
          </div>
        )}

        {viewMode === 'bar' && (
          <div className="bar-content">
            <span className="bar-task">{taskName || 'No Task'}</span>
            <span className="bar-clock">{currentTime.slice(0, 5)}</span>
            <span className="bar-time">{formatTime(timeLeft)}</span>
            <div className="bar-controls">
              <button onClick={toggleTimer} className="icon-btn" aria-label={isRunning ? '一時停止' : '開始'}>{isRunning ? <PauseIcon /> : <PlayIcon />}</button>
              <button onClick={() => resetTimer()} className="icon-btn" aria-label="リセット"><StopIcon /></button>
            </div>
            <button className="btn-expand" aria-label="メインに戻る" onClick={() => setViewMode('main')}><ExpandIcon /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;