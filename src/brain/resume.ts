import fs from 'fs';
import path from 'path';

export interface TaskCheckpoint {
  taskId: string;
  question: string;
  mode: string;
  startedAt: number;
  lastUpdate: number;
  elapsedSeconds: number;
  round: number;
  bestScore: number;
  winner?: string;
  status: 'running' | 'paused' | 'done' | 'failed';
  pausedReason?: string;
  pausedAt?: number;
}

const CHECKPOINT_DIR = path.join(process.cwd(), '.quantum-checkpoints');

export class ResumeManager {
  constructor() {
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    }
  }

  pathFor(taskId: string): string {
    return path.join(CHECKPOINT_DIR, `${taskId}.json`);
  }

  save(cp: TaskCheckpoint) {
    cp.lastUpdate = Date.now();
    fs.writeFileSync(this.pathFor(cp.taskId), JSON.stringify(cp, null, 2));
  }

  load(taskId: string): TaskCheckpoint | null {
    const p = this.pathFor(taskId);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
      return null;
    }
  }

  listPaused(): TaskCheckpoint[] {
    if (!fs.existsSync(CHECKPOINT_DIR)) return [];
    return fs
      .readdirSync(CHECKPOINT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(CHECKPOINT_DIR, f), 'utf-8')
          ) as TaskCheckpoint;
        } catch {
          return null;
        }
      })
      .filter(
        (cp): cp is TaskCheckpoint =>
          !!cp && (cp.status === 'paused' || cp.status === 'running')
      );
  }

  delete(taskId: string) {
    const p = this.pathFor(taskId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
