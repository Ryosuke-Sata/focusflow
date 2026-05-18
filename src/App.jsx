import { useState, useEffect, useRef } from 'react';
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

// --- GitHub Gist API 連携関数 ---
const GIST_DESC = "FocusFlow Data";
const FILENAME = "focusflow_history.json";

const getHeaders = (token) => ({
  "Accept": "application/vnd.github.v3+json",
  "Authorization": `token ${token}`
});

const findOrCreateGist = async (token, contentStr = null) => {
  const res = await fetch("https://api.github.com/gists", { headers: getHeaders(token) });
  if (!res.ok) throw new Error("PATが無効，またはAPIの制限です．");
  const gists = await res.json();
  const target = gists.find(g => g.description === GIST_DESC);

  if (target) return target.id;

  if (!contentStr) contentStr = "[]";
  const createRes = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      description: GIST_DESC,
      public: false,
      files: { [FILENAME]: { content: contentStr } }
    })
  });
  if (!createRes.ok) throw new Error("Gistの作成に失敗しました．");
  const newGist = await createRes.json();
  return newGist.id;
};

const pullFromGist = async (token) => {
  const gistId = await findOrCreateGist(token);
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: getHeaders(token) });
  if (!res.ok) throw new Error("データの取得に失敗しました．");
  const gist = await res.json();
  const file = gist.files[FILENAME];
  if (!file || !file.content) return [];
  try { return JSON.parse(file.content); } catch { return []; }
};

const pushToGist = async (token, historyData) => {
  const contentStr = JSON.stringify(historyData);
  const gistId = await findOrCreateGist(token, contentStr);
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: getHeaders(token),
    body: JSON.stringify({ files: { [FILENAME]: { content: contentStr } } })
  });
  if (!res.ok) throw new Error("データの保存に失敗しました．");
};

const mergeHistory = (local, remote) => {
  const combined = [...local, ...remote];
  const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
  return unique.sort((a, b) => b.id - a.id).slice(0, 50); // 最新50件
};


function App() {
  const [viewMode, setViewMode] = useState('main'); 
  const [activeTab, setActiveTab] = useState('Timer'); 

  const [currentCalDate, setCurrentCalDate] = useState(new Date());
  const formatDateStr = (date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1; // ← ゼロ埋めを削除
    const d = date.getDate();      // ← ゼロ埋めを削除
    return `${y}-${m}-${d}`;
  };
  const [selectedCalDateStr, setSelectedCalDateStr] = useState(formatDateStr(new Date()));

  const [timerMode, setTimerMode] = useState('Focus 25');
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString('ja-JP'));
  const [history, setHistory] = useState([]);

  const startTimeRef = useRef(null);
  const audioCtxRef = useRef(null);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  
  // スマホ（iPhone）用のインストール通知状態
  const [showIosPrompt, setShowIosPrompt] = useState(false);

  const [customAlert, setCustomAlert] = useState(null);
  const [customConfirm, setCustomConfirm] = useState(null);

  const [githubToken, setGithubToken] = useState('');
  const [patInput, setPatInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const [isMobileOS, setIsMobileOS] = useState(false);

  useEffect(() => {
    const savedHistory = JSON.parse(localStorage.getItem('pomodoroHistory') || '[]');
    setHistory(savedHistory);

    const savedToken = localStorage.getItem('focusflow_pat');
    if (savedToken) {
      setGithubToken(savedToken);
      autoPull(savedToken, savedHistory);
    }

    // すでにインストール済み（アプリ化）されているか判定
    const checkStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsStandalone(checkStandalone);

    // iOS と Android を明確に判定
    const isIosDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()) || 
                        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroidDevice = /android/.test(window.navigator.userAgent.toLowerCase());
    
    // どちらかのOSであればフラグをオンにする
    if (isIosDevice || isAndroidDevice) {
      setIsMobileOS(true);
    }
    
    // iOSかつブラウザ開いている場合のみ，iPhone用案内を出す
    if (isIosDevice && !checkStandalone) {
      setShowIosPrompt(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // 履歴から統計情報をリアルタイムに計算するロジック（useEffectの群れの少し下あたりに追加）
  const stats = (() => {
    const today = new Date().toLocaleDateString('ja-JP').replace(/\//g, '-');
    let todayMins = 0; let todayCount = 0;
    let weekMins = 0;
    let totalMins = 0; let totalCount = history.length;

    // 直近7日間のタイムスタンプ
    const sevenDaysAgoDate = new Date();
    sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
    sevenDaysAgoDate.setHours(0,0,0,0);
    const sevenDaysAgo = sevenDaysAgoDate.getTime();

    history.forEach(log => {
      totalMins += log.duration_minutes;
      if (log.date === today) {
        todayMins += log.duration_minutes;
        todayCount++;
      }
      const [year, month, day] = log.date.split('-');
      const logDate = new Date(year, month - 1, day).getTime();
      if (logDate >= sevenDaysAgo) {
        weekMins += log.duration_minutes;
      }
    });

    return { todayMins, todayCount, weekMins, totalMins, totalCount };
  })();

  // --- カレンダー生成ロジック ---
  const getCalendarDays = () => {
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    const days = [];
    // 月初めの前の空白を埋める
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    // 当月の日付を詰める
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${month + 1}-${d}`;
      days.push({ day: d, dateStr });
    }
    return days;
  };

  const handlePrevMonth = () => {
    setCurrentCalDate(new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentCalDate(new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + 1, 1));
  };

  // スマホのフチ（ステータスバーやセーフエリア）の色をモードに合わせて動的に変更する
  useEffect(() => {
    const defaultColor = '#2b2b2b';
    const blackColor = '#000000';
    
    // スマホOSで，かつminiモード（またはbarモード）の時だけ真っ黒にする
    const isBlackMode = isMobileOS && (viewMode === 'mini' || viewMode === 'bar');
    const targetColor = isBlackMode ? blackColor : defaultColor;

    // 1. 画面の裏側（大元のbody）の背景色を変更
    document.body.style.backgroundColor = targetColor;

    // 2. スマホのステータスバー（時計やバッテリーの領域）の色をメタタグで変更
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.name = "theme-color";
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.content = targetColor;

  }, [viewMode, isMobileOS]);

  const autoPull = async (token, localHistory) => {
    if (!navigator.onLine) return; 
    try {
      setIsSyncing(true);
      const remote = await pullFromGist(token);
      if (remote.length > 0) {
        const merged = mergeHistory(localHistory, remote);
        setHistory(merged);
        localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
      }
    } catch (e) {
      console.error("自動同期エラー:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!isStandalone) return;
    // スマホではリサイズ命令は無視されるため，PC版のPWAのみで機能します
    const setOptimalWindowSize = () => {
      if (viewMode === 'main') window.resizeTo(400, 750);
      else if (viewMode === 'mini') window.resizeTo(220, 260); 
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

  useEffect(() => {
    let interval = null;
    if (isRunning && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    } else if (timeLeft === 0 && isRunning) {
      setIsRunning(false);
      handleTimerFinish();
    }
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  const initAudio = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
  };

  const playAlarm = () => {
    initAudio();
    const ctx = audioCtxRef.current;
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

  const handleTimerFinish = () => {
    playAlarm();
    const isFocus = timerMode.includes('Focus');
    if (Notification.permission === 'granted') {
      new Notification('FocusFlow', { body: isFocus ? "お疲れ様でした！休憩しましょう．" : "休憩終了！作業に戻りましょう．" });
    }

    if (isFocus) {
      const now = new Date();
      const endTimeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const startTimeStr = startTimeRef.current || endTimeStr; 
      const newLog = {
        id: Date.now(), date: now.toLocaleDateString('ja-JP').replace(/\//g, '-'),
        duration_minutes: timerMode.includes('25') ? 25 : 50,
        task_name: taskName || '名無しのタスク', time_range: `${startTimeStr} - ${endTimeStr}`
      };
      
      const newHistory = [newLog, ...history].slice(0, 50);
      setHistory(newHistory);
      localStorage.setItem('pomodoroHistory', JSON.stringify(newHistory));

      if (githubToken) {
        if (!navigator.onLine) {
          setCustomAlert("現在オフラインのため，\nGistとの同期は一時停止しています．\n（データは手元に保存済みです）");
        } else {
          (async () => {
            try {
              const remote = await pullFromGist(githubToken);
              const merged = mergeHistory(newHistory, remote);
              setHistory(merged);
              localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
              await pushToGist(githubToken, merged);
            } catch (e) {
              console.error("作業完了時の自動同期エラー:", e);
            }
          })();
        }
      }
    }
    startTimeRef.current = null;
  };

  const toggleTimer = () => {
    if (!isRunning && timeLeft === (timerMode.includes('25') ? 25 : timerMode.includes('50') ? 50 : timerMode.includes('15') ? 15 : 5) * 60) {
      startTimeRef.current = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    if (!isRunning) initAudio();
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft((timerMode.includes('25') ? 25 : timerMode.includes('50') ? 50 : timerMode.includes('15') ? 15 : 5) * 60);
    startTimeRef.current = null;
  };

  const handleModeChange = (mode) => {
    setIsRunning(false); setTimerMode(mode);
    setTimeLeft((mode.includes('25') ? 25 : mode.includes('50') ? 50 : mode.includes('15') ? 15 : 5) * 60);
    startTimeRef.current = null;
  };

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
    if (history.length === 0) return setCustomAlert("出力する履歴データが\nありません．");
    
    setCustomConfirm({
      message: githubToken 
        ? "Gistの最新データを\nCSVファイルとして出力しますか？" 
        : "CSVを出力しますか？\n（※出力後にアプリ内の履歴は\n完全にクリアされます）",
      onConfirm: () => {
        const csvContent = ["ID,Date,Minutes,Task Name,Time Range", ...history.map(row => `"${row.id}","${row.date}","${row.duration_minutes}","${row.task_name.replace(/"/g, '""')}","${row.time_range}"`)].join("\n");
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `focusflow_export_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '')}.csv`;
        a.click();
        
        setCustomConfirm(null); 
        
        if (githubToken) {
          setCustomAlert("Gistの最新データを\nCSV出力しました．");
        } else {
          setHistory([]); 
          localStorage.removeItem('pomodoroHistory');
          setCustomAlert("CSVを出力し，\n履歴をクリアしました．");
        }
      }
    });
  };

  const handleSavePat = () => {
    if (!patInput) return;
    setCustomConfirm({
      message: "【最終確認】\nこのトークンに個人の機密情報が含まれていないこと，また権限が『gist』のみに制限されていることを確認しましたか？",
      onConfirm: () => {
        localStorage.setItem('focusflow_pat', patInput);
        setGithubToken(patInput);
        setPatInput('');
        setCustomConfirm(null);
        setCustomAlert("PATを保存しました．\nGistとの同期が有効になりました．");
      }
    });
  };

  const handleManualPull = async () => {
    if (!githubToken) return;
    if (!navigator.onLine) {
      return setCustomAlert("現在オフラインのため，\nネットワーク接続を確認してください．");
    }
    
    try {
      setIsSyncing(true);
      const remote = await pullFromGist(githubToken);
      const merged = mergeHistory(history, remote);
      setHistory(merged);
      localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
      setCustomAlert("Gistから最新データを取得し，\n履歴を統合しました．");
    } catch (e) {
      setCustomAlert("エラーが発生しました:\n" + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualPush = async () => {
    if (!githubToken) return;
    if (!navigator.onLine) {
      return setCustomAlert("現在オフラインのため，\nネットワーク接続を確認してください．");
    }

    try {
      setIsSyncing(true);
      const remote = await pullFromGist(githubToken);
      const merged = mergeHistory(history, remote);
      setHistory(merged);
      localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
      
      await pushToGist(githubToken, merged);
      setCustomAlert("Gistの最新データと統合し，\nアップロードを完了しました．");
    } catch (e) {
      setCustomAlert("エラーが発生しました:\n" + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className={`app-container ${viewMode} ${isMobileOS ? 'is-mobile-os' : ''}`}>
      
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
          <div className="custom-alert-box">
            <p className="custom-alert-text">{customAlert}</p>
            <button className="btn-alert-ok" onClick={() => setCustomAlert(null)}>OK</button>
          </div>
        </div>
      )}

      {/* カスタム確認ダイアログ */}
      {customConfirm && (
        <div className="custom-alert-overlay">
          <div className="custom-alert-box">
            <p className="custom-alert-text">{customConfirm.message}</p>
            <div style={{display: 'flex', gap: '10px', justifyContent: 'center'}}>
              <button className="btn-alert-cancel" onClick={() => setCustomConfirm(null)}>キャンセル</button>
              <button className="btn-alert-ok" onClick={customConfirm.onConfirm}>OK</button>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'main' && <div className="title-bar">FocusFlow</div>}

      <div className="main-content">
        {viewMode === 'main' && (
          <div className="main-layout-inner">
            <div className="clock">{currentTime}</div>
            
            <div className="tabs">
              <button className={activeTab === 'Timer' ? 'active' : ''} onClick={() => setActiveTab('Timer')}>Timer</button>
              <button className={activeTab === 'History' ? 'active' : ''} onClick={() => setActiveTab('History')}>History</button>
              <button className={activeTab === 'Settings' ? 'active' : ''} onClick={() => setActiveTab('Settings')}>Settings</button>
            </div>

            {/* Timer タブ */}
            {activeTab === 'Timer' && (
              <div className="tab-content">
                <div className="task-input-container">
                  <p style={{ margin: '5px 0', fontSize: '12px' }}>作業内容</p>
                  <input type="text" className="task-input" placeholder="例: 英語の勉強" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
                </div>

                <div className="mode-segments">
                  {['Focus 25', 'Focus 50', 'Break 5', 'Break 15'].map(m => (
                    <button key={m} className={timerMode === m ? 'active' : ''} onClick={() => handleModeChange(m)}>{m}</button>
                  ))}
                </div>
                <div className="time-display">{formatTime(timeLeft)}</div>
                <div className="controls">
                  <button className="btn-start" style={{ backgroundColor: isRunning ? 'orange' : '#1f6aa5' }} onClick={toggleTimer}>{isRunning ? 'PAUSE' : 'START'}</button>
                  <button className="btn-reset" onClick={resetTimer}>RESET</button>
                </div>

                {isStandalone && (
                  <div className="view-controls">
                    <button className="btn-mini" onClick={() => setViewMode('mini')}>mini</button>
                    <button className="btn-bar" onClick={() => setViewMode('bar')}>bar</button>
                  </div>
                )}
                
                <p className="status-text" style={{ color: isRunning ? '#3B8ED0' : 'gray' }}>{isRunning ? 'Concentrating...' : 'Ready'}</p>
              </div>
            )}

            {/* History タブ */}
            {activeTab === 'History' && (
              <div className="tab-content history">
                {/* ★修正：ダッシュボードのタイトルと、小さな同期アイコンボタンを横並びにする */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ margin: 0 }}>ダッシュボード</h3>
                  
                  {githubToken && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        className="icon-btn" 
                        style={{ background: '#333', borderRadius: '6px', padding: '8px', opacity: isSyncing ? 0.5 : 1 }} 
                        onClick={handleManualPull} 
                        disabled={isSyncing} 
                        title="Gistからデータを取得（同期）"
                      >
                        <RefreshIcon />
                      </button>
                      <button 
                        className="icon-btn" 
                        style={{ background: '#333', borderRadius: '6px', padding: '8px', opacity: isSyncing ? 0.5 : 1 }} 
                        onClick={handleManualPush} 
                        disabled={isSyncing} 
                        title="手元のデータをGistに送信"
                      >
                        <UploadIcon />
                      </button>
                    </div>
                  )}
                </div>
                
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
                    <button onClick={handlePrevMonth} className="icon-btn cal-nav-btn">◀</button>
                    <span className="calendar-title">
                      {currentCalDate.getFullYear()}年 {currentCalDate.getMonth() + 1}月
                    </span>
                    <button onClick={handleNextMonth} className="icon-btn cal-nav-btn">▶</button>
                  </div>

                  <div className="calendar-grid-weeks">
                    <span style={{ color: '#ff6b6b' }}>日</span>
                    <span>月</span><span>火</span><span>水</span><span>木</span><span>金</span>
                    <span style={{ color: '#74c0fc' }}>土</span>
                  </div>

                  <div className="calendar-grid-days">
                    {getCalendarDays().map((item, index) => {
                      if (!item) return <div key={`empty-${index}`} className="calendar-day-empty"></div>;
                      const dayLogs = history.filter(log => log.date === item.dateStr);
                      const dayTotalMins = dayLogs.reduce((sum, log) => sum + log.duration_minutes, 0);
                      const isSelected = item.dateStr === selectedCalDateStr;
                      const isToday = item.dateStr === formatDateStr(new Date());

                      return (
                        <div 
                          key={item.dateStr} 
                          onClick={() => setSelectedCalDateStr(item.dateStr)}
                          className={`calendar-day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${dayTotalMins > 0 ? 'has-data' : ''}`}
                        >
                          <span className="day-number" style={{ 
                            color: isSelected ? 'white' : index % 7 === 0 ? '#ff6b6b' : index % 7 === 6 ? '#74c0fc' : 'white'
                          }}>{item.day}</span>
                          
                          {/* ★ カレンダー内のバッジにも formatMins を適用 */}
                          {dayTotalMins > 0 ? <span className="day-mins-badge">{formatMins(dayTotalMins)}</span> : <span className="day-mins-empty"></span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* カレンダーで選択した日の作業内容詳細エリア */}
                <div className="selected-day-details">
                  <div className="details-header">
                    <span>📅 {selectedCalDateStr.slice(5).replace('-', '月')}日の詳細</span>
                    <span className="details-total-mins">
                      {/* ★ 詳細エリアの合計時間にも formatMins を適用 */}
                      合計 {formatMins(history.filter(log => log.date === selectedCalDateStr).reduce((sum, log) => sum + log.duration_minutes, 0))}
                    </span>
                  </div>
                  <div className="history-scroll" style={{ maxHeight: '200px' }}>
                    {history.filter(log => log.date === selectedCalDateStr).length === 0 ? (
                      <p style={{ textAlign: 'center', color: 'gray', fontSize: '12px', margin: '20px 0' }}>この日の作業履歴はありません</p>
                    ) : (
                      history.filter(log => log.date === selectedCalDateStr).map((log) => (
                        <div key={log.id} className="history-item">
                          <span className="history-date">{log.time_range}</span>
                          <span className="history-task" title={log.task_name}>{log.task_name}</span>
                          
                          {/* ★ 各タスクの分数にも formatMins を適用 */}
                          <span className="history-mins">{formatMins(log.duration_minutes)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* CSV出力ボタンの分岐配置 */}
                {githubToken ? (
                  <details style={{ marginTop: '20px', borderTop: '1px solid #444', paddingTop: '15px' }}>
                    <summary className="summary-btn" style={{color: '#666', textAlign: 'center', display: 'block'}}>
                      高度な操作 ▼
                    </summary>
                    <div style={{ padding: '10px', background: '#222', borderRadius: '5px', marginTop: '10px' }}>
                      <p style={{fontSize: '11px', color: '#888', margin: '0 0 10px 0', textAlign: 'center'}}>
                        ※Gist同期中は自動保存されるため通常は不要です．
                      </p>
                      <button className="btn-export" style={{ backgroundColor: '#444', width: '100%', color: '#aaa' }} onClick={exportCSV}>
                        CSVファイルとして保存
                      </button>
                    </div>
                  </details>
                ) : (
                  <button className="btn-export" style={{ marginTop: '15px' }} onClick={exportCSV}>CSV出力（履歴をクリア）</button>
                )}
              </div>
            )}

            {/* Settings タブ */}
            {activeTab === 'Settings' && (
              <div className="tab-content settings-content">
                <div className="settings-section">
                  <h4>GitHub Gist 同期設定</h4>
                  
                  {githubToken ? (
                    <div className="pat-success-box">
                      <p className="pat-success-text">✓ PATは設定済みです<br/>(セキュリティのため非表示)</p>

                      <details style={{marginTop: '20px'}}>
                        <summary className="summary-btn">PATを上書き再設定する</summary>
                        <div style={{marginTop: '10px'}}>
                          <input type="password" className="pat-input" placeholder="ghp_..." value={patInput} onChange={(e) => setPatInput(e.target.value)} />
                          <button className="btn-save-pat" onClick={handleSavePat}>上書き保存</button>
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
              <button onClick={toggleTimer} className="icon-btn">{isRunning ? <PauseIcon /> : <PlayIcon />}</button>
              <button onClick={resetTimer} className="icon-btn"><StopIcon /></button>
            </div>
            <button className="btn-expand" onClick={() => setViewMode('main')}><ExpandIcon /> 拡大</button>
          </div>
        )}

        {viewMode === 'bar' && (
          <div className="bar-content">
            <span className="bar-task">{taskName || 'No Task'}</span>
            <span className="bar-clock">{currentTime.slice(0, 5)}</span>
            <span className="bar-time">{formatTime(timeLeft)}</span>
            <div className="bar-controls">
              <button onClick={toggleTimer} className="icon-btn">{isRunning ? <PauseIcon /> : <PlayIcon />}</button>
              <button onClick={resetTimer} className="icon-btn"><StopIcon /></button>
            </div>
            <button className="btn-expand" onClick={() => setViewMode('main')}><ExpandIcon /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;