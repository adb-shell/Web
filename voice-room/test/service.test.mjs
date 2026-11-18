import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voiceServer } from '../server.mjs';

const settings = { ZEGO_APP_ID: '123456', ZEGO_SERVER_SECRET: randomBytes(16).toString('hex'), ROOM_CREATE_CODE: 'test-room-creator' };

async function start(t, env = settings) {
  const server = voiceServer(env);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise(resolve => server.listening ? server.close(resolve) : resolve());
  t.after(close);
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, close, get: path => fetch(base + path), post: async (path, body) => {
    const response = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  } };
}
function decodeToken(token) {
  assert.equal(token.slice(0,2), '04');
  const wire = Buffer.from(token.slice(2), 'base64');
  const expiry = Number(wire.readBigInt64BE());
  const ivLength = wire.readUInt16BE(8);
  assert.equal(ivLength, 12);
  const lengthOffset = 10 + ivLength;
  const size = wire.readUInt16BE(lengthOffset);
  const body = wire.subarray(lengthOffset + 2, -1);
  assert.equal(body.length, size);
  assert.equal(wire.at(-1), 1);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(settings.ZEGO_SERVER_SECRET), wire.subarray(10, lengthOffset));
  decipher.setAuthTag(body.subarray(-16));
  const claims = JSON.parse(Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]));
  assert.equal(claims.expire, expiry);
  assert.ok(claims.expire - claims.ctime <= 3600 && claims.expire > claims.ctime);
  return claims;
}
test('two invited users receive distinct identities and tokens scoped to the same room', async t => {
  const api = await start(t);
  const created = await api.post('rooms', {});
  assert.equal(created.status, 201);
  const {invite, roomID} = created.data;
  const [a, b] = await Promise.all([api.post('join', {invite}), api.post('join', {invite})]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.data.userID, b.data.userID);
  assert.notEqual(a.data.streamID, b.data.streamID);
  for (const member of [a,b]) {
    const data = member.data;
    assert.equal(data.roomID, roomID);
    const claims = decodeToken(data.token);
    assert.equal(claims.user_id, data.userID);
    assert.equal(claims.app_id, Number(settings.ZEGO_APP_ID));
    assert.deepEqual(JSON.parse(claims.payload), {room_id: roomID, privilege: {1:1,2:1}, stream_id_list:[data.streamID]});
    const renewed = await api.post('renew', {session:data.session});
    assert.equal(renewed.status, 200);
    assert.equal(renewed.data.userID, data.userID);
    assert.equal(renewed.data.streamID, data.streamID);
    assert.equal(decodeToken(renewed.data.token).payload, claims.payload);
  }
  assert.equal((await api.post('join', { invite, name:'' })).status, 200);
  assert.equal((await api.post('renew', { session:invite })).status, 403);
  assert.equal((await api.post('join', { invite:a.data.session, name:'访客' })).status, 403);
  assert.equal((await api.post('join', { invite:invite + 'x', name:'访客' })).status, 403);
});
test('missing credentials leave the interface accessible and return a clear setup error', async t => {
  const api = await start(t, {});
  assert.deepEqual(await (await api.get('/api/health')).json(), {configured:false});
  assert.equal((await api.get('/')).status, 200);
  assert.equal((await api.get('/vendor/rtc-3.13.0.js')).status, 200);
  assert.equal((await api.get('/.env')).status, 404);
  assert.equal((await api.post('rooms', {})).status, 503);
});

test('a numbered invitation whose registry entry is missing never recreates the room', async t => {
  const original = await start(t);
  const {data} = await original.post('rooms', {});
  await original.close();
  const empty = await start(t);
  assert.equal((await empty.post('join', {invite:data.invite})).status,410);
  assert.deepEqual(await (await empty.get('/api/rooms')).json(),[]);
});

async function attend(api, grant, signals) {
  const stop = new AbortController();
  signals.push(stop);
  const res = await fetch(api.base + '/api/presence', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session:grant.session}), signal:stop.signal
  });
  assert.equal(res.status,200);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  async function event() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) {
        const chunk = await reader.read();
        assert.equal(chunk.done,false);
        buffer += chunk.value;
        continue;
      }
      const frame = buffer.slice(0,end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6));
    }
  }
  return {event, stop};
}

test('admission order, reconnects and closure persist per room', {timeout:12000}, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'voice-admissions-'));
  const env = {...settings, ROOM_DB_PATH:join(folder,'rooms.sqlite')};
  let api = await start(t, env);
  const stops = [];
  try {
    const {data:room} = await api.post('rooms',{});
    const {data:other} = await api.post('rooms',{});
    const enter = async target => (await api.post('join',{invite:target.invite})).data;
    const earlierGrant = await enter(room);
    const laterGrant = await enter(room);
    const a = await attend(api,laterGrant,stops);
    assert.deepEqual((await a.event()).members,[{id:laterGrant.userID,name:'用户01'}]);
    const b = await attend(api,earlierGrant,stops);
    const pair = (await b.event()).members;
    assert.deepEqual(pair.map(m=>m.name),['用户01','用户02']);
    assert.equal(pair[1].id, earlierGrant.userID);
    assert.deepEqual((await a.event()).members,pair);
    const otherMember = await attend(api,await enter(other),stops);
    assert.equal((await otherMember.event()).members[0].name,'用户01');
    for (const ctrl of stops) ctrl.abort();
    await api.close();
    api = await start(t,env);
    const back = await attend(api,laterGrant,stops);
    assert.equal((await back.event()).members[0].name,'用户01');
    const reentry = await attend(api,await enter(room),stops);
    assert.deepEqual((await reentry.event()).members.map(m=>m.name),['用户01','用户03']);
    await back.event();
    const close = () => api.post('rooms/close',{roomID:room.roomID,roomNumber:room.roomNumber});
    assert.equal((await close()).status,200);
    assert.deepEqual(await back.event(),{type:'closed'});
    assert.deepEqual(await reentry.event(),{type:'closed'});
    assert.equal((await close()).status,200);
    assert.deepEqual((await (await api.get('/api/rooms')).json()).map(r=>r.roomID),[other.roomID]);
    await api.close();
    api = await start(t,env);
    for (const body of [{invite:room.invite},{roomNumber:room.roomNumber}]) assert.equal((await api.post('join',body)).status,410);
    for (const path of ['renew','presence']) assert.equal((await api.post(path,{session:earlierGrant.session})).status,410);
    assert.equal((await api.post('join',{roomNumber:other.roomNumber})).status,200);
  } finally {
    for (const ctrl of stops) ctrl.abort();
    await api.close();
    await rm(folder,{recursive:true,force:true});
  }
});
test('concurrent creators get independent public rooms that survive a restart', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'voice-rooms-'));
  const env = { ...settings, ROOM_CREATE_CODE: undefined, ROOM_DB_PATH: join(folder, 'rooms.sqlite') };
  try {
    const api = await start(t, env);
    const created = await Promise.all(Array.from({length: 6}, () => api.post('rooms', {})));
    const numbers = created.map(r => r.data.roomNumber);
    assert.equal(new Set(numbers).size, 6);
    assert.ok(created.every(r => r.status === 201 && /^\d{6}$/.test(r.data.roomNumber)));
    await api.close();
    const restarted = await start(t, env);
    const list = await (await restarted.get('/api/rooms')).json();
    assert.equal(list.length, 6);
    for (const {data} of created) {
      assert.ok(list.some(r => r.number === data.roomNumber && r.online === 0));
      const byNumber = await restarted.post('join', {roomNumber: data.roomNumber, name:'访客'});
      assert.equal(byNumber.data.roomID, data.roomID);
      assert.equal(byNumber.data.invite, data.invite);
    }
    assert.equal((await restarted.post('join', {roomNumber:'123', name:'访客'})).status,400);
    assert.equal((await restarted.post('join', {roomNumber:'000000', name:'访客'})).status,404);
    await restarted.close();
  } finally { await rm(folder, {recursive:true, force:true}); }
});

test('a valid older invite gains a room number, while an expired invite cannot join', async t => {
  const api = await start(t);
  const room = 'r_legacy';
  const key = createHmac('sha256', settings.ZEGO_SERVER_SECRET).update('shengjian-v1:' + settings.ZEGO_APP_ID + ':' + settings.ROOM_CREATE_CODE).digest();
  function legacyInvite(end) {
    const body = Buffer.from(JSON.stringify({kind:'room', room, end})).toString('base64url');
    return body + '.' + createHmac('sha256', key).update(body).digest('base64url');
  }
  const now = Math.floor(Date.now() / 1000);
  const end = now + 120;
  const result = await api.post('join', {invite:legacyInvite(end), name:'老用户'});
  assert.equal(result.data.roomID,room);
  assert.match(result.data.roomNumber,/^\d{6}$/);
  assert.equal(result.data.expiresAt, end);
  assert.equal(decodeToken(result.data.token).expire, end);
  const renewal = await api.post('renew', {session:result.data.session});
  assert.equal(decodeToken(renewal.data.token).expire,end);
  assert.equal((await api.post('join', {roomNumber:result.data.roomNumber, name:'新用户'})).data.roomID,room);
  assert.equal((await api.post('join', {invite:legacyInvite(now - 1), name:'访客'})).status,403);
});

test('a lobby receives creation, arrival and departure without reloading', {timeout:10000}, async t => {
  const api = await start(t);
  const stop = new AbortController();
  const member = new AbortController();
  try {
    const response = await fetch(api.base + '/api/rooms/events', { signal:stop.signal });
    assert.equal(response.headers.get('x-accel-buffering'),'no');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    async function next() {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end < 0) {
          const chunk = await reader.read();
          assert.equal(chunk.done,false);
          buffer += chunk.value;
          continue;
        }
        const event = buffer.slice(0,end);
        buffer = buffer.slice(end + 2);
        if (event.startsWith('data: ')) return JSON.parse(event.slice(6));
      }
    }
    assert.deepEqual(await next(), []);
    const {data} = await api.post('rooms', {});
    assert.equal((await next())[0].number, data.roomNumber);
    const grant = await api.post('join', {roomNumber:data.roomNumber, name:'访客'});
    const presence = await fetch(api.base + '/api/presence', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({session:grant.data.session}), signal:member.signal
    });
    assert.equal(presence.status,200);
    assert.equal((await next())[0].online,1);
    member.abort();
    assert.equal((await next())[0].online,0);
  } finally { member.abort(); stop.abort(); }
});
