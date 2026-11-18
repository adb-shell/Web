import { randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const seconds = () => Math.floor(Date.now() / 1000);

// One SQLite file persists room numbers. Online counts follow live browser connections.
export class RoomDirectory {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, end INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS room_expiry ON rooms(end);
    CREATE TABLE IF NOT EXISTS closed_rooms (
      room TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS admissions (
      room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(room, user), UNIQUE(room, ordinal)
    )`);
    this.byId = this.db.prepare('SELECT * FROM rooms WHERE id = ? AND end > ?');
    this.byNumber = this.db.prepare('SELECT * FROM rooms WHERE number = ? AND end > ?');
    this.insert = this.db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?) ON CONFLICT(number) DO NOTHING');
    this.all = this.db.prepare('SELECT * FROM rooms WHERE end > ? AND id NOT IN (SELECT room FROM closed_rooms) ORDER BY created DESC, rowid DESC');
    this.isClosed = this.db.prepare('SELECT 1 FROM closed_rooms WHERE room = ?');
    this.markClosed = this.db.prepare('INSERT OR IGNORE INTO closed_rooms VALUES (?)');
    this.admit = this.db.prepare(`INSERT INTO admissions(room, user, ordinal)
      SELECT ?, ?, COALESCE(MAX(ordinal),0) + 1 FROM admissions WHERE room=?
      ON CONFLICT(room,user) DO NOTHING`);
    this.seat = this.db.prepare('SELECT ordinal FROM admissions WHERE room=? AND user=?');
    this.prune = this.db.prepare('DELETE FROM rooms WHERE end <= ?');
    this.watchers = new Set();
    this.members = new Map();
    this.prune.run(seconds());
    this.sweep = setInterval(() => {
      if (this.prune.run(seconds()).changes) {
        for (const id of this.members.keys()) if (!this.byId.get(id, seconds())) this.disconnect(id);
        this.notify();
      }
    }, 10000).unref();
  }
  register(id, end) {
    const time = seconds();
    const existing = this.byId.get(id, time);
    if (existing) return this.requireOpen(existing);
    for (let i = 0; i < 40; i++) {
      const number = String(randomInt(100000, 1000000));
      if (this.insert.run(id, number, time, end).changes) {
        this.notify();
        return { id, number, created: time, end };
      }
    }
    throw Object.assign(new Error('暂时无法分配房间号，请重试。'), { status: 503 });
  }
  requireOpen(room) {
    if (!room || this.isClosed.get(room.id)) throw Object.assign(new Error('房间已关闭或已过期。'), { status: 410 });
    return room;
  }
  activeRoom(id) { return this.requireOpen(this.byId.get(id, seconds())); }
  lookup(number) {
    const room = this.byNumber.get(number, seconds());
    return room && this.requireOpen(room);
  }
  closeRoom(number, id) {
    const room = this.byId.get(id, seconds());
    if (!room || room.number !== number) throw Object.assign(new Error('房间已失效。'), {status: 410});
    if (this.markClosed.run(id).changes) {
      this.disconnect(id);
      this.notify();
    }
  }
  disconnect(id) {
    const group = this.members.get(id);
    this.members.delete(id);
    if (group) for (const {res} of group.values()) res.end('data: {"type":"closed"}\n\n');
  }
  list() {
    return this.all.all(seconds()).map(r => ({
      roomID: r.id, number: r.number, createdAt: r.created, online: this.members.get(r.id)?.size || 0
    }));
  }
  notify() {
    if (!this.watchers.size) return;
    const frame = 'data: ' + JSON.stringify(this.list()) + '\n\n';
    for (const res of this.watchers) {
      if (res.writableLength > 262144) res.destroy();
      else res.write(frame);
    }
  }
  openStream(res, closed) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000).unref();
    res.once('close', () => { clearInterval(heartbeat); closed(); });
  }
  watch(res) {
    this.openStream(res, () => this.watchers.delete(res));
    this.watchers.add(res);
    res.write('data: ' + JSON.stringify(this.list()) + '\n\n');
  }
  attend(member, res) {
    this.activeRoom(member.room);
    this.admit.run(member.room, member.user, member.room);
    const { ordinal } = this.seat.get(member.room, member.user);
    const group = this.members.get(member.room) || new Map();
    const previous = group.get(member.user);
    this.members.set(member.room, group);
    group.set(member.user, { res, ordinal });
    previous?.res.end();
    const broadcast = () => {
      const members = Array.from(group, ([id, entry]) => ({ id, ordinal: entry.ordinal }))
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(({id, ordinal}) => ({ id, name: '用户' + String(ordinal).padStart(2, '0') }));
      const frame = 'data: ' + JSON.stringify({ type: 'members', members }) + '\n\n';
      for (const entry of group.values()) {
        if (entry.res.writableLength > 262144) entry.res.destroy();
        else entry.res.write(frame);
      }
    };
    this.openStream(res, () => {
      if (this.members.get(member.room) !== group || group.get(member.user)?.res !== res) return;
      group.delete(member.user);
      if (group.size) broadcast();
      else this.members.delete(member.room);
      this.notify();
    });
    broadcast();
    this.notify();
  }
  close() {
    clearInterval(this.sweep);
    this.db.close();
  }
}
