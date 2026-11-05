import crypto from 'crypto';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderController } from '../providers/controller.js';
import { QuotaTracker } from './quota-tracker.js';
import { ResumeManager, TaskCheckpoint } from './resume.js';
import { detectEnvironment, EnvInfo, isInteractive } from './environment.js';
import { interactiveSetup } from './setup.js';

export interface BrainTask {
  question: string;
  mode?: 'fast' | 'medium' | 'high' | 'unlimited';
  system?: string;
  preferredProvider?: string;
  maxRuntimeHours?: number;
  taskId?: string;
}

export interface BrainResult {
  taskId: string;
  status: 'done' | 'paused' | 'failed';
  providerUsed?: string;
  modelUsed?: string;
  answer?: string;
  elapsedSeconds: number;
  rounds: number;
  reason?: string;
}

export class SystemBrain {
  readonly registry: ProviderRegistry;
  readonly controller: ProviderController;
  readonly quota: QuotaTracker;
  readonly resume: ResumeManager;
  readonly env: EnvInfo;

  constructor() {
    this.registry = new ProviderRegistry();
    this.controller = new ProviderController(this.registry, 'fallback');
    this.quota = new QuotaTracker();
    this.resume = new ResumeManager();
    this.env = detectEnvironment();
  }

  async boot(): Promise<void> {
    console.error(
      `[brain] env=${this.env.env} platform=${this.env.platform} tty=${this.env.isTTY}`
    );

    if (isInteractive() && this.registry.getEnabled().length === 0) {
      await interactiveSetup(this.registry);
    }
  }

  async run(task: BrainTask): Promise<BrainResult> {
    const taskId = task.taskId || crypto.randomBytes(8).toString('hex');
    const startTime = Date.now();
    const maxRuntimeMs = (task.maxRuntimeHours ?? 720) * 3600 * 1000;

    let cp = this.resume.load(taskId);
    if (!cp || cp.status === 'done') {
      cp = {
        taskId,
        question: task.question,
        mode: task.mode || 'medium',
        startedAt: startTime,
        lastUpdate: startTime,
        elapsedSeconds: 0,
        round: 0,
        bestScore: 0,
        status: 'running',
      };
      this.resume.save(cp);
    }

    const providers = this.registry.getActive();
    if (providers.length === 0) {
      return {
        taskId,
        status: 'failed',
        elapsedSeconds: 0,
        rounds: 0,
        reason: 'no-active-providers',
      };
    }

    const providerIds = providers.map((p) => p.id);
    let round = cp.round;

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxRuntimeMs) {
        cp.status = 'done';
        cp.pausedReason = 'max-runtime-reached';
        this.resume.save(cp);
        return {
          taskId,
          status: 'done',
          elapsedSeconds: Math.floor(elapsed / 1000),
          rounds: round,
          reason: 'max-runtime-reached',
        };
      }

      if (this.quota.allExhausted(providerIds)) {
        const waitMs = this.quota.nextAvailableIn(providerIds);
        console.error(
          `[brain] ALL exhausted. Pause. Next recovery in ${Math.ceil(waitMs / 1000)}s`
        );
        cp.status = 'paused';
        cp.pausedReason = 'all-providers-exhausted';
        cp.elapsedSeconds = Math.floor(elapsed / 1000);
        cp.round = round;
        this.resume.save(cp);

        await this.waitAndResume(waitMs + 2000, taskId);

        cp.status = 'running';
        cp.pausedReason = undefined;
        this.resume.save(cp);
        continue;
      }

      let result: { provider: string; model: string; text: string } | null = null;

      for (const p of providers) {
        if (!this.quota.isAvailable(p.id)) continue;
        try {
          const r = await this.controller.complete(
            this.buildPrompt(task, round),
            task.system,
            p.id
          );
          result = { provider: r.provider, model: r.model, text: r.text };
          this.quota.markOK(p.id);
          break;
        } catch (err: any) {
          if (err?.isQuota) {
            this.quota.markExhausted(err.providerId, err.retryAfter, err.message);
          } else {
            console.error(`[brain] ${p.id} error: ${err.message}`);
          }
        }
      }

      if (!result) {
        round++;
        cp.round = round;
        cp.elapsedSeconds = Math.floor(elapsed / 1000);
        this.resume.save(cp);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      round++;
      cp.round = round;
      cp.elapsedSeconds = Math.floor(elapsed / 1000);
      this.resume.save(cp);

      if (this.verifyAnswer(result.text, task.question)) {
        cp.status = 'done';
        cp.winner = result.text;
        this.resume.save(cp);
        this.resume.delete(taskId);
        return {
          taskId,
          status: 'done',
          providerUsed: result.provider,
          modelUsed: result.model,
          answer: result.text,
          elapsedSeconds: Math.floor(elapsed / 1000),
          rounds: round,
        };
      }
    }
  }

  private async waitAndResume(waitMs: number, taskId: string): Promise<void> {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 5000));
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining % 30 === 0) {
        console.error(`[brain] task ${taskId} paused — ${remaining}s to resume`);
      }
    }
    console.error(`[brain] AUTO-RESUMING task ${taskId}`);
  }

  private buildPrompt(task: BrainTask, round: number): string {
    return `Round ${round}. Question: ${task.question}\nMode: ${task.mode || 'medium'}\nProvide a complete, exact answer.`;
  }

  private verifyAnswer(text: string, _question: string): boolean {
    if (!text || text.length < 5) return false;
    const lower = text.toLowerCase();
    if (lower.includes("i don't know") || lower.includes('cannot answer')) return false;
    return true;
  }
}
