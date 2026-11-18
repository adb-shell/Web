import { createMonitor } from './monitor.js';
import { showDirectory } from './directory.js';

const $ = id => document.getElementById(id);
const meter = createMonitor($('scope'));
let invite = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
function invitedNumber(ticket) {
  try {
    const payload = JSON.parse(atob(ticket.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return /^\d{6}$/.test(payload.number) ? payload.number : '';
  } catch { return ''; }
}
let number = invitedNumber(invite);
let active;

function selectRoom(room) {
  number = room.roomNumber;
  invite = room.invite;
  history.replaceState(null, '', '#invite=' + encodeURIComponent(invite));
  paint();
}

function say(message = '', error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(error);
  $('notice').hidden = !message;
}
function label(text, connected = false) {
  $('connection').textContent = text;
  $('lamp').dataset.on = String(connected);
}
function paint() {
  const c = active;
  const inRoom = Boolean(invite);
  $('lobby').hidden = inRoom;
  $('roomView').hidden = !inRoom;
  const awaitingAdmission = Boolean(inRoom && c?.roomID && !c.admitted);
  showDirectory(!inRoom || awaitingAdmission, awaitingAdmission ? rooms => {
    if (!rooms.some(room => room.roomID === c.roomID)) returnToLobby(c, '房间已关闭或已过期。');
  } : undefined);
  $('pageTitle').textContent = inRoom ? '语音房间' : '语音大厅';
  $('formTitle').textContent = c ? '当前房间' : '加入房间';
  $('lead').textContent = inRoom ? c ? '分享房间号或邀请链接，让朋友加入通话。' : '你已收到房间邀请，点击加入即可通话。' : '创建自己的语音房间，或输入朋友的房间号加入通话。';
  $('roomBadge').hidden = !number;
  $('shownNumber').textContent = number;
  $('backLobby').hidden = Boolean(c);
  $('createRoom').disabled = Boolean(c);
  $('joinByNumber').disabled = Boolean(c);
  $('joinForm').hidden = Boolean(c);
  $('live').hidden = !c;
  $('copy').hidden = !invite;
  $('mute').disabled = !c?.publishing;
  $('mute').setAttribute('aria-pressed', String(Boolean(c?.muted)));
  $('mute').textContent = c?.muted ? '打开麦克风' : '麦克风静音';
  $('micState').textContent = c?.local ? c.muted ? '已静音' : '已开启' : '未开启';
  $('monitorTag').textContent = c?.muted ? '已静音' : c?.publishing ? '采集中' : c ? '连接中' : '待接入';
  $('resume').hidden = !c || ![...c.remote.values()].some(x => x.blocked || x.failed);
  $('memberTotal').textContent = c && !c.rosterCurrent ? '正在同步' : (c?.users.size || 0) + ' 人';
  $('members').replaceChildren(...Array.from(c?.users || [], ([id, name]) => {
    const li = document.createElement('li');
    li.textContent = name + (id === c.userID ? '（你）' : '');
    return li;
  }));
}
async function post(path, body, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, {once:true});
  const timeout = setTimeout(cancel, 15000);
  try {
    const response = await fetch('/api/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', signal:controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { httpStatus: response.status });
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
function friendly(e) {
  const code = Number(e?.errorCode ?? e?.code);
  if (code === 1103064 || e?.name === 'NotAllowedError') return '麦克风权限被拒绝。请在浏览器的站点设置中允许麦克风，然后重新加入。';
  if (code === 1103065 || ['NotReadableError','NotFoundError'].includes(e?.name)) return '麦克风不可用。请检查设备连接和其他应用的占用，再重新加入。';
  if (e?.httpStatus || e?.userMessage) return e.message;
  return '连接失败，请检查网络和麦克风后重试。' + (code ? ' 错误码 ' + code : '');
}
const warning = message => Object.assign(new Error(message), { userMessage: true });
function quiet(fn) { try { Promise.resolve(fn()).catch(() => {}); } catch {} }
function stopMicrophone(c, local) {
  const tracks = new Set([...local.getAudioTracks(), ...(local.audioCaptureStream?.getAudioTracks() || [])]);
  quiet(() => c.engine.destroyStream(local));
  for (const track of tracks) track.stop();
}
function removeRemote(c, id) {
  const slot = c.remote.get(id);
  if (!slot) return;
  c.remote.delete(id);
  if (slot.audio) { slot.audio.pause(); slot.audio.srcObject = null; slot.audio.remove(); }
  if (slot.started) quiet(() => c.engine.stopPlayingStream(id));
}
async function playRemote(c, id, user) {
  if (active !== c || c.remote.has(id) || id === c.streamID) return;
  const slot = { user };
  c.remote.set(id, slot);
  try {
    if (!await c.admission || active !== c || c.remote.get(id) !== slot) return;
    slot.started = true;
    const media = await c.engine.startPlayingStream(id);
    if (active !== c || c.remote.get(id) !== slot) return;
    const audio = document.createElement('audio');
    slot.audio = audio;
    audio.srcObject = media;
    $('audioHost').append(audio);
    try { await audio.play(); } catch { slot.blocked = true; }
  } catch { slot.failed = true; }
  if (active === c) paint();
}
function release(c, message = '', isError = false) {
  if (!c || active !== c) return;
  active = undefined;
  c.confirmAdmission(false);
  c.abort.abort();
  clearInterval(c.clock);
  clearTimeout(c.renewTimer);
  clearTimeout(c.presenceRetry);
  clearTimeout(c.presenceDeadline);
  clearTimeout(c.publishTimer);
  if (c.engine) {
    for (const [name, fn] of c.listeners) quiet(() => c.engine.off(name, fn));
    for (const id of [...c.remote.keys()]) removeRemote(c, id);
    if (c.pubRequested) quiet(() => c.engine.stopPublishingStream(c.streamID));
    if (c.local) stopMicrophone(c, c.local);
    if (c.roomID) quiet(() => c.engine.logoutRoom(c.roomID));
    quiet(() => c.engine.destroyEngine());
  }
  $('duration').textContent = '00:00';
  meter(0); label('未连接'); paint(); say(message, isError);
}
async function renew(c) {
  if (active !== c || c.renewing) return;
  c.renewing = true;
  try {
    const updated = await post('renew', { session: c.session }, c.abort.signal);
    if (active !== c) return;
    if (!c.engine.renewToken(updated.token, c.roomID)) throw warning('语音凭证更新失败。');
    const previousEnd = c.expiresAt;
    c.expiresAt = updated.expiresAt;
    if (c.expiresAt > previousEnd) scheduleRenew(c);
    else {
      clearTimeout(c.renewTimer);
      c.renewTimer = setTimeout(() => renew(c), Math.max(1000, c.expiresAt * 1000 - Date.now() + 1000));
    }
  } catch (e) {
    if (active !== c) return;
    if (e.httpStatus === 410) return returnToLobby(c, '房间已关闭或已过期。');
    if (e.httpStatus === 403 || Date.now() >= c.expiresAt * 1000) return release(c, '通话凭证已过期，请重新加入。', true);
    clearTimeout(c.renewTimer);
    c.renewTimer = setTimeout(() => renew(c), 5000);
  } finally { c.renewing = false; }
}
async function keepPresence(c) {
  try {
    const response = await fetch('/api/presence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: c.session }), signal: c.abort.signal,
    });
    if (response.status === 410) return returnToLobby(c, '房间已关闭或已过期。');
    if (response.status === 403) return returnToLobby(c, '通话凭证已过期，请重新加入。');
    if (response.ok && active === c) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (active === c) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (active !== c) return;
        buffer += decoder.decode(chunk.value, {stream: true});
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          const update = JSON.parse(frame.slice(6));
          if (update.type === 'closed') return returnToLobby(c, '房间已关闭，已返回大厅。');
          if (update.type === 'members' && active === c) {
            c.users = new Map(update.members.map(m => [m.id, m.name]));
            if (!c.users.has(c.userID)) continue;
            c.rosterCurrent = true;
            c.admitted = true;
            c.confirmAdmission(true);
            paint();
          }
        }
        // Once admitted, three missed server heartbeats indicate a stale connection.
        if (c.admitted) {
          clearTimeout(c.presenceDeadline);
          c.presenceDeadline = setTimeout(() => release(c, '与房间服务的连接已中断，请重新加入。', true), 45000);
        }
      }
    }
  } catch {}
  if (active === c) {
    c.rosterCurrent = false;
    paint();
    c.presenceRetry = setTimeout(() => keepPresence(c), 1500);
  }
}
function scheduleRenew(c) {
  clearTimeout(c.renewTimer);
  c.renewTimer = setTimeout(() => renew(c), Math.max(1000, c.expiresAt * 1000 - Date.now() - 30000));
}
function bindEvents(c) {
  function on(name, handler) {
    const fn = (...args) => { if (active === c) handler(...args); };
    c.engine.on(name, fn);
    c.listeners.push([name, fn]);
  }
  on('roomStateChanged', (_room, reason, code) => {
    if (reason === 'RECONNECTING') { c.reconnecting = true; label('正在重连'); }
    if (reason === 'RECONNECTED') { c.reconnecting = false; label(c.publishing ? '已连接' : '正在连接', c.publishing); }
    if (['KICKOUT','RECONNECT_FAILED','LOGIN_FAILED'].includes(reason)) release(c, (reason === 'KICKOUT' ? '已从房间断开' : '房间连接失败') + (code ? '（' + code + '）' : '') + '，请重新加入。', true);
  });
  on('roomStreamUpdate', (_room, type, streams) => {
    for (const stream of streams) {
      if (type === 'ADD') {
        void playRemote(c, stream.streamID, stream.user);
      } else removeRemote(c, stream.streamID);
    }
    paint();
  });
  on('publisherStateUpdate', event => {
    if (event.streamID !== c.streamID) return;
    if (event.state === 'PUBLISHING') {
      c.publishing = true; clearTimeout(c.publishTimer); if (!c.reconnecting) label('已连接', true); paint();
    } else if (event.state === 'NO_PUBLISH' && event.errorCode) {
      release(c, '麦克风发布失败，错误码 ' + event.errorCode + '。请重新加入。', true);
    }
  });
  on('playerStateUpdate', event => {
    const slot = c.remote.get(event.streamID);
    if (slot && event.state === 'NO_PLAY' && event.errorCode) { slot.failed = true; paint(); }
  });
  on('soundLevelUpdate', streams => {
    const local = streams.find(s => s.type === 'push' && s.streamID === c.streamID);
    if (local) meter(c.muted ? 0 : local.soundLevel);
  });
  on('tokenWillExpire', () => void renew(c));
}
async function join(target) {
  if (active) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    say('无法使用麦克风。请用 HTTPS 打开服务器地址，或在本机使用 localhost。', true); return;
  }
  if (typeof window.ZegoExpressEngine !== 'function') { say('语音 SDK 加载失败，请刷新页面。', true); return; }
  const c = { abort: new AbortController(), listeners: [], remote: new Map(), users: new Map(), muted: false, publishing: false };
  c.admission = new Promise(resolve => { c.confirmAdmission = resolve; });
  active = c; label('正在连接'); say(); paint();
  try {
    if (!target) {
      const created = await post('rooms', {}, c.abort.signal);
      if (active !== c) return;
      selectRoom(created);
      target = { invite: created.invite };
    }
    const access = await post('join', target, c.abort.signal);
    if (active !== c) return;
    selectRoom(access);
    Object.assign(c, { roomID: access.roomID, userID: access.userID, streamID: access.streamID, session: access.session, expiresAt: access.expiresAt });
    paint();
    c.engine = new window.ZegoExpressEngine(access.appID, access.server);
    bindEvents(c);
    const support = await c.engine.checkSystemRequirements('webRTC');
    if (active !== c) return;
    if (!support.result) throw warning('当前浏览器不支持 WebRTC，请换用新版浏览器。');
    label('等待麦克风');
    const local = await c.engine.createZegoStream({ camera: { audio: true, video: false } });
    if (active !== c) { stopMicrophone(c, local); return; }
    c.local = local;
    const microphone = local.audioCaptureStream?.getAudioTracks()[0] || local.getAudioTracks()[0];
    if (!microphone || microphone.readyState === 'ended') throw warning('麦克风不可用，请检查设备后重新加入。');
    microphone.addEventListener('ended', () => release(c, '麦克风已断开，请检查设备后重新加入。', true), {once:true, signal:c.abort.signal});
    label('正在连接');
    const loggedIn = await c.engine.loginRoom(c.roomID, access.token, { userID: c.userID, userName: '成员' });
    if (active !== c) return;
    if (!loggedIn) throw warning('暂时无法进入语音房间，请稍后重试。');
    label('正在确认进房');
    c.presenceDeadline = setTimeout(() => release(c, '进房确认超时，请重新加入。', true), 15000);
    void keepPresence(c);
    if (!await c.admission || active !== c) return;
    const start = Date.now();
    c.clock = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      $('duration').textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    }, 1000);
    c.pubRequested = true;
    c.publishTimer = setTimeout(() => release(c, '麦克风发布超时，请检查网络后重新加入。', true), 30000);
    label('正在发布');
    if (!c.engine.startPublishingStream(c.streamID, local)) throw warning('麦克风发布失败，请重新加入。');
    quiet(() => c.engine.setSoundLevelDelegate(true, 350));
    scheduleRenew(c); paint();
  } catch (e) {
    if (e.httpStatus === 410) return returnToLobby(c, '房间已关闭或已过期。');
    if (target?.invite && e.httpStatus === 403) return returnToLobby(c, friendly(e), true);
    if (active === c) release(c, friendly(e), true);
  }
}
for (const id of ['createForm', 'numberForm', 'joinForm']) {
  $(id).onsubmit = event => {
    event.preventDefault();
    if (id === 'numberForm') return join({ roomNumber: $('roomNumber').value.trim() });
    if (id === 'joinForm') return join({ invite });
    return join();
  };
}
$('roomRows').onclick = async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || active || button.disabled) return;
  const row = button.closest('li');
  const target = { roomNumber: row.dataset.number, roomID: row.dataset.roomId };
  if (button.dataset.action === 'join') return join(target);
  button.disabled = true;
  try {
    await post('rooms/close', target);
    if (!active) say('房间 ' + target.roomNumber + ' 已关闭。');
  } catch (error) {
    if (!active) say(error.httpStatus ? error.message : '关闭失败，请检查网络后重试。', true);
  } finally { button.disabled = false; }
};
function returnToLobby(c, message, isError = false) {
  if (!c || active !== c) return;
  invite = ''; number = '';
  history.replaceState(null, '', location.pathname + location.search);
  $('manualCopy').hidden = true;
  release(c, message, isError);
}
$('leave').onclick = () => returnToLobby(active, '已离开房间，麦克风已释放。');
$('mute').onclick = () => {
  const c = active;
  if (!c?.local) return;
  if (!c.engine.muteMicrophone(!c.muted)) { say('麦克风状态切换失败，请重试。', true); return; }
  c.muted = !c.muted; if (c.muted) meter(0); paint();
};
$('resume').onclick = async () => {
  const c = active;
  if (!c) return;
  await Promise.all([...c.remote].map(async ([id, slot]) => {
    if (slot.failed) { removeRemote(c, id); await playRemote(c, id, slot.user); }
    else if (slot.blocked && slot.audio) { try { await slot.audio.play(); slot.blocked = false; } catch {} }
  }));
  if (active === c) paint();
};
$('copy').onclick = async () => {
  const ticket = invite;
  const url = location.origin + location.pathname + '#invite=' + encodeURIComponent(ticket);
  try {
    await navigator.clipboard.writeText(url);
    if (invite === ticket) say('邀请链接已复制，可发送给对方。');
  } catch {
    if (invite !== ticket) return;
    $('manualCopy').hidden = false; $('inviteLink').value = url; $('inviteLink').select(); say('请复制邀请链接输入框中的地址。');
  }
};
window.addEventListener('pagehide', () => { release(active); showDirectory(false); });
window.addEventListener('pageshow', paint);
window.addEventListener('hashchange', () => {
  release(active); invite = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  number = invitedNumber(invite);
  $('manualCopy').hidden = true; say(); paint();
});
paint();
fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).then(status => {
  if (!status.configured && !active) say('语音服务暂未就绪，请稍后再试。');
}).catch(() => {});
