import { useEffect, useRef, useState } from 'react';
import { calendarDate, dateInputValue } from './history.js';

function toTimeInput(time = '') {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

export default function HistoryEditor({ record, date, onSave, onCancel }) {
  const dialog = useRef(null);
  const [error, setError] = useState('');
  const [start, end] = (record?.time_range ?? '').split(/\s*-\s*/);

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const task = fields.get('task').trim();
    if (!task) {
      setError('タスク名を入力してください。');
      return;
    }

    const changes = {
      date: calendarDate(new Date(fields.get('date') + 'T12:00:00')),
      task_name: task,
      time_range: `${fields.get('start')} - ${fields.get('end')}`,
      duration_minutes: Number(fields.get('minutes'))
    };
    setError(onSave(changes));
  }

  return (
    <dialog ref={dialog} className="history-editor" aria-labelledby="editor-title" onCancel={event => {
      event.preventDefault();
      onCancel();
    }}>
      <form onSubmit={submit}>
        <h2 id="editor-title">{record ? '作業履歴を編集' : '作業履歴を追加'}</h2>
        <label>タスク名<input name="task" required defaultValue={record?.task_name} /></label>
        <label>日付<input name="date" type="date" min="0001-01-01" max="9999-12-31" required defaultValue={dateInputValue(record?.date ?? date)} /></label>
        <div className="editor-times">
          <label>開始時刻<input name="start" type="time" required defaultValue={toTimeInput(start)} /></label>
          <label>終了時刻<input name="end" type="time" required defaultValue={toTimeInput(end)} /></label>
        </div>
        <label>作業時間（分）<input name="minutes" type="number" required min="1" max="1440" defaultValue={record?.duration_minutes ?? 25} /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="editor-actions">
          <button type="button" className="btn-alert-cancel" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="btn-alert-ok">保存</button>
        </div>
      </form>
    </dialog>
  );
}
