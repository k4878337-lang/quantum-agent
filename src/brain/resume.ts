import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';

export type TaskStatus = 'running' | 'paused' | 'candidate' | 'failed' | 'done';
export type VerificationLevel = 'none' | 'weak-heuristic' | 'verified';

export interface TaskCheckpoint {
  version: '1.1';
  taskId: string;
  question: string;
  mode: string;
  maxRuntimeHours: number;
  deadlineAt: number;
  startedAt: number;
  lastUpdate: number;
  elapsedSeconds: number;
  round: number;
  status: TaskStatus;
  verificationLevel: VerificationLevel;
  pausedReason?: string;
  pausedAt?: number;
  nextRunAt?: number;
  winner?: string;
}

const CheckpointSchema = z.object({
  version: z.literal('1.1'),
  taskId: z.string().regex(/^[a-f0-9]{8,64}$/i),
  question: z.string(),
  mode: z.string(),
  maxRuntimeHours: z.number(),
  deadlineAt: z.number(),
  startedAt: z.number(),
  lastUpdate: z.number(),
  elapsedSeconds: z.number(),
  round: z.number(),
  status: z.enum(['running', 'paused', 'candidate', 'failed', 'done']),
  verificationLevel: z.enum(['none', 'weak-heuristic', 'verified']),
  pausedReason: z.string().optional(),
  pausedAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  winner: z.string().optional(),
});

interface SignedCheckpoint extends TaskCheckpoint {
  checksum: string;
  signature: string;
}

const TASK_ID_RE = /^[a-f0-9]{8,64}$/i;

export class ResumeManager {
  private secret: Buffer;
  private readonly dirPath: string;
  private readonly secretPath: string;

  constructor(baseDir: string = process.cwd()) {
    this.dirPath = path.join(baseDir, '.quantum-checkpoints');
    this.secretPath = path.join(baseDir, '.quantum-secret');
    if (!fs.existsSync(this.dirPath)) fs.mkdirSync(this.dirPath, { recursive: true });
    this.secret = this.loadOrCreateSecret();
  }

  private loadOrCreateSecret(): Buffer {
    if (fs.existsSync(this.secretPath)) {
      const stat = fs.statSync(this.secretPath);
      if ((stat.mode & 0o077) !== 0) {
        console.error(`[resume] WARN: secret file has loose permissions (${stat.mode.toString(8)})`);
      }
      const s = fs.readFileSync(this.secretPath);
      if (s.length < 32) throw new Error('secret too short — corrupt?');
      return s;
    }
    const s = crypto.randomBytes(32);
    try {
      fs.writeFileSync(this.secretPath, s, { mode: 0o600, flag: 'wx' });
    } catch (err: any) {
      if (err.code === 'EEXIST') return this.loadOrCreateSecret();
      throw err;
    }
    return s;
  }

  private assertTaskId(taskId: string) {
    if (!TASK_ID_RE.test(taskId)) {
      throw new Error(`Invalid task ID (path traversal guard): ${taskId}`);
    }
  }

  pathFor(taskId: string): string {
    this.assertTaskId(taskId);
    return path.join(this.dirPath, `${taskId}.json`);
  }

  save(cp: TaskCheckpoint): void {
    this.assertTaskId(cp.taskId);
    cp.lastUpdate = Date.now();

    const content = JSON.stringify(cp);
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    const signed: SignedCheckpoint = {
      ...cp,
      checksum,
      signature: '',
    };
    signed.signature = crypto
      .createHmac('sha256', this.secret)
      .update(checksum)
      .digest('hex');

    const filePath = this.pathFor(cp.taskId);
    const tmpPath = `${filePath}.tmp`;

    const fd = fs.openSync(tmpPath, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(signed, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);

    // ⭐ Bug 10 FIX: parent directory fsync
    try {
      const dirFd = fs.openSync(this.dirPath, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* best-effort */ }
  }

  load(taskId: string): TaskCheckpoint | null {
    this.assertTaskId(taskId);
    const filePath = this.pathFor(taskId);
    if (!fs.existsSync(filePath)) return null;

    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      this.quarantine(taskId, 'invalid-json');
      return null;
    }

    // ⭐ Bug 9 FIX: checksum & signature mandatory
    if (!raw || typeof raw.checksum !== 'string' || typeof raw.signature !== 'string') {
      this.quarantine(taskId, 'missing-checksum-or-signature');
      return null;
    }

    const { checksum, signature, ...rest } = raw;

    // Verify checksum
    const expectedChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(rest))
      .digest('hex');
    if (checksum !== expectedChecksum) {
      this.quarantine(taskId, 'checksum-mismatch');
      return null;
    }

    // Verify HMAC
    const expectedSig = crypto
      .createHmac('sha256', this.secret)
      .update(checksum)
      .digest('hex');
    if (signature !== expectedSig) {
      this.quarantine(taskId, 'signature-mismatch');
      return null;
    }

    // Schema validation
    const parsed = CheckpointSchema.safeParse(rest);
    if (!parsed.success) {
      this.quarantine(taskId, 'schema-invalid');
      return null;
    }
    return parsed.data as TaskCheckpoint;
  }

  private quarantine(taskId: string, reason: string) {
    try {
      const p = this.pathFor(taskId);
      const backup = `${p}.corrupt-${Date.now()}`;
      fs.renameSync(p, backup);
      console.error(`[resume] ${taskId}: rejected (${reason}) → ${backup}`);
    } catch { /* best effort */ }
  }

  listPaused(): TaskCheckpoint[] {
    if (!fs.existsSync(this.dirPath)) return [];
    const out: TaskCheckpoint[] = [];
    for (const f of fs.readdirSync(this.dirPath)) {
      if (!f.endsWith('.json')) continue;
      const taskId = f.replace(/\.json$/, '');
      if (!TASK_ID_RE.test(taskId)) continue;
      const cp = this.load(taskId);
      if (cp && (cp.status === 'paused' || cp.status === 'running' || cp.status === 'candidate')) {
        out.push(cp);
      }
    }
    return out;
  }

  delete(taskId: string): void {
    this.assertTaskId(taskId);
    const p = this.pathFor(taskId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
