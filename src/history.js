export function calendarDate(date) {
  return [String(date.getFullYear()).padStart(4, '0'), date.getMonth() + 1, date.getDate()].join('-');
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function dateInputValue(date) {
  const [year, month, day] = date.split('-');
  return [year.padStart(4, '0'), month.padStart(2, '0'), day.padStart(2, '0')].join('-');
}

function validateRecord(record) {
  if (!record || !['number', 'string'].includes(typeof record.id) ||
      typeof record.date !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(record.date) ||
      !Number.isInteger(record.duration_minutes) || record.duration_minutes <= 0 ||
      typeof record.task_name !== 'string' || typeof record.time_range !== 'string') {
    throw new Error('履歴データの形式を確認してください。');
  }
  const date = dateInputValue(record.date);
  const parsed = new Date(date + 'T12:00:00');
  if (!Number.isFinite(parsed.getTime()) || dateInputValue(calendarDate(parsed)) !== date) {
    throw new Error('履歴の日付が無効です。');
  }
  return calendarDate(parsed);
}

export function legacyOperations(records) {
  if (!Array.isArray(records)) throw new Error('旧履歴データの形式を確認してください。');
  return records.map(record => {
    const date = validateRecord(record);
    return {
      id: `legacy:${record.id}`,
      recordId: String(record.id),
      at: Number(record.id) || 0,
      parents: [],
      value: { ...record, date }
    };
  });
}

export function readOperations(operations) {
  if (!Array.isArray(operations)) throw new Error('変更履歴の形式を確認してください。');
  for (const { id, recordId, at, parents, value } of operations) {
    if (typeof id !== 'string' || typeof recordId !== 'string' || !Number.isFinite(at) ||
        !Array.isArray(parents) || parents.includes(id) || parents.some(parent => typeof parent !== 'string')) {
      throw new Error('変更履歴の形式を確認してください。');
    }
    if (value !== null) {
      validateRecord(value);
      if (String(value.id) !== recordId) throw new Error('履歴 ID が一致しません。');
    }
  }
  return operations;
}

export function makeOperation(recordId, value, parents = []) {
  return { id: newId(), recordId: String(recordId), at: Date.now(), parents, value };
}

export function mergeOperations(...groups) {
  return [...new Map(groups.flat().map(operation => [operation.id, operation])).values()];
}

export function materializeHistory(operations) {
  const byRecord = new Map();
  for (const operation of operations) {
    const changes = byRecord.get(operation.recordId) ?? [];
    changes.push(operation);
    byRecord.set(operation.recordId, changes);
  }
  const history = [];
  for (const changes of byRecord.values()) {
    if (changes.some(change => change.value === null)) continue;

    const superseded = new Set(changes.flatMap(change => change.parents));
    const heads = changes.filter(change => !superseded.has(change.id));
    heads.sort((left, right) => right.at - left.at || right.id.localeCompare(left.id));
    if (heads.length) {
      history.push({
        record: heads[0].value,
        heads: heads.map(change => change.id),
        alternatives: heads.slice(1).map(change => change.value)
      });
    }
  }

  return history.sort((left, right) => {
    const a = left.record;
    const b = right.record;
    return dateInputValue(b.date).localeCompare(dateInputValue(a.date)) ||
      b.time_range.localeCompare(a.time_range) || String(b.id).localeCompare(String(a.id));
  });
}
