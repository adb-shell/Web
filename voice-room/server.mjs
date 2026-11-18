import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rtcToken } from './token.mjs';
import { RoomDirectory } from './rooms.mjs';

const publicFiles = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/directory.js', ['public/directory.js', 'text/javascript']],
  ['/monitor.js', ['public/monitor.js', 'text/javascript']],
  ['/style.css', ['public/style.css', 'text/css']],
  ['/vendor/zego-3.13.0.js', ['node_modules/zego-express-engine-webrtc/ZegoExpressWebRTC.js', 'text/javascript']],
  ['/vendor/rtc-3.13.0.js', ['node_modules/zego-express-engine-webrtc/ZegoExpressWebRTC.js', 'text/javascript']],
]);
const now = () => Math.floor(Date.now() / 1000);
const id = () => randomBytes(12).toString('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请使用 JSON 请求。');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw fail(413, '请求内容过长。');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {}
  throw fail(400, '请求内容有误。');
}

export function voiceServer(env = process.env) {
  const appID = Number(env.ZEGO_APP_ID);
  const secret = env.ZEGO_SERVER_SECRET || '';
  const code = env.ROOM_CREATE_CODE || '';
  const ready = Number.isSafeInteger(appID) && appID > 0 && appID <= 0xffffffff && Buffer.byteLength(secret) === 32;
  const signKey = createHmac('sha256', secret).update('shengjian-v1:' + appID + ':' + code).digest();
  const rooms = new RoomDirectory(env.ROOM_DB_PATH || ':memory:');
  const cached = new Map();
  function sign(data) {
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    return encoded + '.' + createHmac('sha256', signKey).update(encoded).digest('base64url');
  }
  function verify(ticket, type) {
    if (typeof ticket === 'string' && ticket.length < 1200) {
      const parts = ticket.split('.');
      if (parts.length === 2 && equal(parts[1], createHmac('sha256', signKey).update(parts[0]).digest('base64url'))) {
        const data = JSON.parse(Buffer.from(parts[0], 'base64url'));
        if (data.kind === type && data.end > now()) return data;
      }
    }
    throw fail(403, type === 'room' ? '邀请链接无效或已过期，请房主重新创建房间。' : '通话凭证已过期，请重新加入房间。');
  }
  function issue(member, room) {
    const expiresAt = Math.min(now() + 3600, member.end, room.end);
    return { appID, server: env.ZEGO_SERVER || '', roomID: member.room, userID: member.user, streamID: member.stream,
      token: rtcToken(appID, secret, member.user, member.room, member.stream, expiresAt), expiresAt };
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  function roomAccess(room) {
    return { roomID: room.id, roomNumber: room.number, invite: sign({ kind: 'room', room: room.id, number: room.number, end: room.end }) };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=()');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { configured: ready });
      if (req.method === 'GET' && path === '/api/rooms') return json(res, 200, rooms.list());
      if (req.method === 'GET' && path === '/api/rooms/events') return rooms.watch(res);
      const asset = publicFiles.get(path);
      if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
        const immutable = path.startsWith('/vendor/');
        const bytes = cached.get(path) ?? await readFile(new URL(asset[0], import.meta.url));
        if (immutable) cached.set(path, bytes);
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      if (req.method !== 'POST' || !['/api/rooms','/api/rooms/close','/api/join','/api/renew','/api/presence'].includes(path)) throw fail(404, '没有找到此地址。');
      if (!ready) throw fail(503, '语音服务尚未就绪，请稍后再试。');
      const data = await readBody(req);
      if (path === '/api/rooms') {
        return json(res, 201, roomAccess(rooms.register('r_' + id(), now() + 12 * 3600)));
      }
      if (path === '/api/presence') return rooms.attend(verify(data.session, 'session'), res);
      if (path === '/api/rooms/close') {
        if (typeof data.roomID !== 'string' || typeof data.roomNumber !== 'string') throw fail(400, '请从房间列表选择要关闭的房间。');
        rooms.closeRoom(data.roomNumber, data.roomID);
        return json(res, 200, { closed: true });
      }
      if (path === '/api/renew') {
        const member = verify(data.session, 'session');
        return json(res, 200, issue(member, rooms.activeRoom(member.room)));
      }
      let room;
      if (data.invite !== undefined) {
        const ticket = verify(data.invite, 'room');
        // Only legacy, unnumbered invitations predate the room directory.
        room = ticket.number === undefined ? rooms.register(ticket.room, ticket.end) : rooms.activeRoom(ticket.room);
        if (ticket.number !== undefined && room.number !== ticket.number) throw fail(410, '原房间已失效。');
      } else {
        if (typeof data.roomNumber !== 'string' || !/^\d{6}$/.test(data.roomNumber)) throw fail(400, '请输入 6 位数字房间号。');
        room = rooms.lookup(data.roomNumber);
        if (!room) throw fail(404, '找不到这个房间，房间号有误或已经过期。');
        if (data.roomID !== undefined && data.roomID !== room.id) throw fail(410, '房间已失效。');
      }
      const member = { kind: 'session', room: room.id, user: 'u_' + id(), stream: 's_' + id(), end: room.end };
      return json(res, 200, { ...issue(member, room), ...roomAccess(room), session: sign(member) });
    } catch (error) {
      if (!res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试。' });
    }
  });
  server.once('close', () => rooms.close());
  return server;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || '127.0.0.1';
  voiceServer({ ...process.env, ROOM_DB_PATH: process.env.ROOM_DB_PATH || './data/rooms.sqlite' })
    .listen(port, host, () => console.log('声间已启动 http://' + host + ':' + port));
}
