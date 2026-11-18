import { createCipheriv, randomBytes, randomInt } from 'node:crypto';

// ZEGO Token04, AES-256-GCM. The on-wire lengths and expiry use network byte order.
// Reference: zegoim/zego_server_assistant, token/nodejs/token04.
export function rtcToken(appID, secret, userID, roomID, streamID, expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ room_id: roomID, privilege: { 1: 1, 2: 1 }, stream_id_list: [streamID] });
  const claims = { app_id: appID, user_id: userID, nonce: randomInt(-2147483648, 2147483648), ctime: now, expire: expiresAt, payload };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(10);
  header.writeBigInt64BE(BigInt(expiresAt));
  header.writeUInt16BE(iv.length, 8);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(encrypted.length);
  return '04' + Buffer.concat([header, iv, size, encrypted, Buffer.from([1])]).toString('base64');
}
