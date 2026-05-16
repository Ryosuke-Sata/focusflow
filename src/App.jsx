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

// --- GitHub Gist API 連携関数 ---
const GIST_DESC = "FocusFlow Data";
const FILENAME = "focusflow_history.json";

const getHeaders = (token) => ({
  "Accept": "application/vnd.github.v3+json",
  "Authorization": `token ${token}`
});

const findOrCreateGist = async (token, contentStr = null) => {
  const res = await fetch("https://api.github.com/gists", { headers: getHeaders(token) });
  if (!res.ok) throw new Error("PATが無効、またはAPIの制限です。");
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
  if (!createRes.ok) throw new Error("Gistの作成に失敗しました。");
  const newGist = await createRes.json();
  return newGist.id;
};

const pullFromGist = async (token) => {
  const gistId = await findOrCreateGist(token);
  const res = await fetch(`https://api.github.com/gists/${gistId}`, { headers: getHeaders(token) });
  if (!res.ok) throw new Error("データの取得に失敗しました。");
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
  if (!res.ok) throw new Error("データの保存に失敗しました。");
};

const mergeHistory = (local, remote) => {
  const combined = [...local, ...remote];
  const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
  return unique.sort((a, b) => b.id - a.id).slice(0, 50); // 最新50件
};


function App() {
  const [viewMode, setViewMode] = useState('main'); 
  const [activeTab, setActiveTab] = useState('Timer'); 

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

    // iOS (iPhone/iPad) 判定
    const isIosDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()) || 
                        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // iOSかつブラウザ開いている場合のみ、iPhone用案内を出す
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
    // スマホではリサイズ命令は無視されるため、PC版のPWAのみで機能します
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
      new Notification('FocusFlow', { body: isFocus ? "お疲れ様でした！休憩しましょう。" : "休憩終了！作業に戻りましょう。" });
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
          setCustomAlert("現在オフラインのため、\nGistとの同期は一時停止しています。\n（データは手元に保存済みです）");
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

  const exportCSV = () => {
    if (history.length === 0) return setCustomAlert("出力する履歴データが\nありません。");
    
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
          setCustomAlert("Gistの最新データを\nCSV出力しました。");
        } else {
          setHistory([]); 
          localStorage.removeItem('pomodoroHistory');
          setCustomAlert("CSVを出力し、\n履歴をクリアしました。");
        }
      }
    });
  };

  const handleSavePat = () => {
    if (!patInput) return;
    setCustomConfirm({
      message: "【最終確認】\nこのトークンに個人の機密情報が含まれていないこと、また権限が『gist』のみに制限されていることを確認しましたか？",
      onConfirm: () => {
        localStorage.setItem('focusflow_pat', patInput);
        setGithubToken(patInput);
        setPatInput('');
        setCustomConfirm(null);
        setCustomAlert("PATを保存しました。\nGistとの同期が有効になりました。");
      }
    });
  };

  const handleManualPull = async () => {
    if (!githubToken) return;
    if (!navigator.onLine) {
      return setCustomAlert("現在オフラインのため、\nネットワーク接続を確認してください。");
    }
    
    try {
      setIsSyncing(true);
      const remote = await pullFromGist(githubToken);
      const merged = mergeHistory(history, remote);
      setHistory(merged);
      localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
      setCustomAlert("Gistから最新データを取得し、\n履歴を統合しました。");
    } catch (e) {
      setCustomAlert("エラーが発生しました:\n" + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualPush = async () => {
    if (!githubToken) return;
    if (!navigator.onLine) {
      return setCustomAlert("現在オフラインのため、\nネットワーク接続を確認してください。");
    }

    try {
      setIsSyncing(true);
      const remote = await pullFromGist(githubToken);
      const merged = mergeHistory(history, remote);
      setHistory(merged);
      localStorage.setItem('pomodoroHistory', JSON.stringify(merged));
      
      await pushToGist(githubToken, merged);
      setCustomAlert("Gistの最新データと統合し、\nアップロードを完了しました。");
    } catch (e) {
      setCustomAlert("エラーが発生しました:\n" + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className={`app-container ${viewMode}`}>
      
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
            アプリとして利用するには、下部の<br />
            <b>[共有ボタン]</b> から <b>[ホーム画面に追加]</b><br />
            をタップしてください。
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
                <h3 style={{ textAlign: 'center', marginTop: '0' }}>作業履歴</h3>
                <div className="history-scroll">
                  {history.length === 0 ? <p style={{ textAlign: 'center', color: 'gray', marginTop: '20px' }}>履歴なし</p> : history.map((log) => (
                    <div key={log.id} className="history-item">
                      <span className="history-date">{log.date.slice(5)} {log.time_range}</span>
                      <span className="history-task">{log.task_name}</span>
                      <span className="history-mins">{log.duration_minutes}分</span>
                    </div>
                  ))}
                </div>
                <button className="btn-export" onClick={exportCSV}>CSV出力</button>
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
                      
                      <div className="sync-controls">
                        <button onClick={handleManualPull} disabled={isSyncing}>
                          {isSyncing ? '同期中...' : 'Gistから取得'}
                        </button>
                        <button onClick={handleManualPush} disabled={isSyncing}>
                          {isSyncing ? '同期中...' : 'Gistへ保存'}
                        </button>
                      </div>

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
                        <p>複数端末で履歴を同期するには、GitHubのPersonal Access Tokenを入力してください。</p>
                        <ul style={{paddingLeft: '20px', margin: '10px 0'}}>
                          <li>GitHubの <b>[Settings]</b> ➔ <b>[Developer settings]</b> ➔ <b>[Personal access tokens]</b> ➔ <b>[Tokens (classic)]</b> から作成できます。</li>
                          <li>権限は必ず <b>[gist]</b> のみを選択してください。</li>
                          <li>トークンはブラウザ内にのみ保存されます。</li>
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