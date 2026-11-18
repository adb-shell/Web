const rows = document.getElementById('roomRows');
const status = document.getElementById('syncState');
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
let stream;
let retry;
let pending;
let firstSnapshotTimer;
let observer;

function render(rooms) {
  const existing = new Map(Array.from(rows.children, item => [item.dataset.roomId, item]));
  for (const [index, room] of rooms.entries()) {
    let item = existing.get(room.roomID);
    if (!item) {
      item = document.createElement('li');
      item.dataset.number = room.number;
      const number = document.createElement('strong');
      number.textContent = room.number;
      const created = document.createElement('time');
      const date = new Date(room.createdAt * 1000);
      created.dateTime = date.toISOString();
      created.textContent = timeFormat.format(date) + ' 创建';
      const count = document.createElement('span');
      count.className = 'online';
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      for (const [action, label] of [['close', '关闭'], ['join', '加入']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = action;
        button.textContent = label;
        button.setAttribute('aria-label', label + '房间 ' + room.number);
        actions.append(button);
      }
      item.append(number, created, count, actions);
    }
    item.dataset.roomId = room.roomID;
    existing.delete(room.roomID);
    const count = item.querySelector('.online');
    count.textContent = room.online + ' 人在线';
    count.dataset.occupied = String(room.online > 0);
    if (rows.children[index] !== item) rows.insertBefore(item, rows.children[index] || null);
  }
  for (const item of existing.values()) item.remove();
  document.getElementById('emptyRooms').hidden = rooms.length > 0;
  observer?.(rooms);
}

function setStatus(message, live = false) {
  status.textContent = message;
  status.dataset.live = String(live);
}

async function refresh() {
  if (pending) return;
  const controller = new AbortController();
  pending = controller;
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/rooms', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error();
    const list = await response.json();
    if (pending === controller) { setStatus('定时同步中'); render(list); }
  } catch {
    if (pending === controller) setStatus('连接中断，正在重试');
  } finally {
    clearTimeout(timeout);
    if (pending === controller) pending = undefined;
  }
}

function stopPolling() {
  clearTimeout(firstSnapshotTimer);
  clearInterval(retry);
  retry = undefined;
  pending?.abort();
  pending = undefined;
}

export function showDirectory(subscribed, onSnapshot) {
  observer = onSnapshot;
  if (!subscribed) {
    stream?.close();
    stream = undefined;
    stopPolling();
    return;
  }
  if (stream || retry) return;
  setStatus('正在同步');
  function poll() {
    if (retry) return;
    setStatus('正在恢复同步');
    void refresh();
    retry = setInterval(refresh, 4000);
  }
  if (!window.EventSource) { poll(); return; }
  const connection = new EventSource('/api/rooms/events');
  stream = connection;
  firstSnapshotTimer = setTimeout(poll, 4000);
  connection.onmessage = event => {
    if (connection !== stream) return;
    stopPolling();
    setStatus('实时同步中', true);
    render(JSON.parse(event.data));
  };
  connection.onerror = () => { if (connection === stream) poll(); };
}
