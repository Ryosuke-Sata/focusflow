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

  useEffect(() => {
    const savedHistory = JSON.parse(localStorage.getItem('pomodoroHistory') || '[]');
    setHistory(savedHistory);

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const checkStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsStandalone(checkStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // --- ウィンドウサイズ固定（Macタイトルバー考慮） ---
  useEffect(() => {
    if (!isStandalone) return;

    const enforceWindowSize = () => {
      if (viewMode === 'main') window.resizeTo(400, 750);
      // ★ミニモードの高さを 200 → 260 に増やし、上下の余白を確実に確保しました
      else if (viewMode === 'mini') window.resizeTo(220, 260); 
      else if (viewMode === 'bar') window.resizeTo(520, 100); 
    };

    enforceWindowSize();
    window.addEventListener('resize', enforceWindowSize);
    return () => window.removeEventListener('resize', enforceWindowSize);
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
    if (history.length === 0) return alert("出力する履歴データがありません。");
    const csvContent = ["ID,Date,Minutes,Task Name,Time Range", ...history.map(row => `"${row.id}","${row.date}","${row.duration_minutes}","${row.task_name.replace(/"/g, '""')}","${row.time_range}"`)].join("\n");
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `focusflow_export_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '')}.csv`;
    a.click();
    setHistory([]); localStorage.removeItem('pomodoroHistory');
    alert("CSVを出力し、履歴をクリアしました。");
  };

  return (
    <div className={`app-container ${viewMode}`}>
      {deferredPrompt && !isStandalone && (
        <div className="install-prompt">
          <span>アプリとしてPCにインストールしますか？</span>
          <div>
            <button className="btn-install" onClick={handleInstallClick}>はい</button>
            <button className="btn-close" onClick={() => setDeferredPrompt(null)}>✕</button>
          </div>
        </div>
      )}

      {viewMode === 'main' && <div className="title-bar">FocusFlow - Pomodoro Timer</div>}

      <div className="main-content">
        {viewMode === 'main' && (
          <div className="main-layout-inner">
            <div className="clock">{currentTime}</div>
            <div className="tabs">
              <button className={activeTab === 'Timer' ? 'active' : ''} onClick={() => setActiveTab('Timer')}>Timer</button>
              <button className={activeTab === 'History' ? 'active' : ''} onClick={() => setActiveTab('History')}>History</button>
            </div>

            {activeTab === 'Timer' && (
              <div className="tab-content">
                <div className="task-input-container">
                  <p style={{ margin: '5px 0', fontSize: '12px' }}>作業内容 (Task Name)</p>
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
                    <button className="btn-mini" onClick={() => setViewMode('mini')}>ミニ</button>
                    <button className="btn-bar" onClick={() => setViewMode('bar')}>バー</button>
                  </div>
                )}
                
                <p className="status-text" style={{ color: isRunning ? '#3B8ED0' : 'gray' }}>{isRunning ? 'Concentrating...' : 'Ready'}</p>
              </div>
            )}

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
          </div>
        )}

        {viewMode === 'mini' && (
          <div className="mini-content">
            <div className="clock-mini">{currentTime}</div>
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