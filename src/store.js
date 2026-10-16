import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fields, immutable, validateSession } from './schema.js';

const MAX_BYTES = 2 * 1024 * 1024;
const digest = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');

export function initialSession() {
  return { schemaVersion: 1, dataset:null, importedHistory:null, sessionId: randomUUID(), revision: 0, requirements: Object.fromEntries(fields.map(field => [field, null])), provenance: {}, openQuestions: [], messages: [] };
}

export async function readBounded(path, limit = MAX_BYTES) {
  const file = await open(path, 'r');
  try {
    const chunks = []; let length = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, limit + 1 - length));
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) return Buffer.concat(chunks);
      length += bytesRead;
      if (length > limit) throw new Error('session/input exceeds byte limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally { await file.close(); }
}

async function snapshot(path) {
  try { const raw = await readBounded(path); return { session: validateSession(JSON.parse(raw)), sha256: digest(raw) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { session: initialSession(), sha256: null }; }
}

export class SessionStore {
  constructor(path) { this.path = resolve(path); this.lockPath = `${this.path}.lock`; }
  async load() { return (await snapshot(this.path)).session; }

  async withLock(work, { signal } = {}) {
    signal?.throwIfAborted();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let lock;
    try { lock = await open(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw Object.assign(new Error(`session is busy; inspect owner lock ${this.lockPath}`), { code: 'SESSION_BUSY', lockPath: this.lockPath });
    }
    const owner = JSON.stringify({ schemaVersion: 1, token: randomUUID(), pid: process.pid, createdAt: new Date().toISOString() });
    let ownerWritten = false, temporary;
    const assertOwner = async () => {
      signal?.throwIfAborted();
      if ((await readBounded(this.lockPath, 4096)).toString() !== owner) throw new Error('session lock ownership changed');
    };
    try {
      await lock.writeFile(owner); await lock.sync(); ownerWritten = true;
      const initial = await snapshot(this.path);
      let saved = false;
      return await work({
        session: immutable(initial.session), initialSha256: initial.sha256,
        save: async value => {
          if (saved) throw new Error('session already saved by this writer');
          await assertOwner();
          const current = await snapshot(this.path);
          if (current.sha256 !== initial.sha256) throw new Error('session changed during turn');
          const next = validateSession(value);
          if ((initial.sha256 !== null && next.sessionId !== initial.session.sessionId) || next.revision !== initial.session.revision + 1) throw new Error('invalid session identity/revision transition');
          const raw = JSON.stringify(next, null, 2) + '\n';
          if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('session exceeds byte limit');
          temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
          const staged = await open(temporary, 'wx', 0o600);
          try { await staged.writeFile(raw); await staged.sync(); } finally { await staged.close(); }
          await assertOwner();
          if ((await snapshot(this.path)).sha256 !== initial.sha256) throw new Error('session changed before publication');
          await rename(temporary, this.path); temporary = undefined; saved = true;
          return { sha256: digest(Buffer.from(raw)), session: next };
        },
      });
    } finally {
      await lock.close();
      if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!ownerWritten) await unlink(this.lockPath);
      else {
        let current;
        try { current = (await readBounded(this.lockPath, 4096)).toString(); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current === owner) await unlink(this.lockPath);
      }
    }
  }

  async save(expectedRevision, next) {
    return this.withLock(async writer => {
      if (writer.session.revision !== expectedRevision) throw new Error('stale session revision');
      return writer.save(next);
    });
  }
}
