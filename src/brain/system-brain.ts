import crypto from 'crypto';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderController, ProviderError } from '../providers/controller.js';
import { QuotaTracker } from './quota-tracker.js';
import { ResumeManager, TaskCheckpoint, TaskStatus, VerificationLevel } from './resume.js';
import { detectEnvironment, EnvInfo, isInteractive } from './environment.js';
import { interactiveSetup } from './setup.js';
import { acquireTaskLock } from './task-lock.js';

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
  status: TaskStatus;
  verified: boolean;
  verificationLevel: VerificationLevel;
  providerUsed?: string;
  modelUsed?: string;
  answer?: string;
  elapsedSeconds: number;
  rounds: number;
  reason?: string;
}

const MAX_CONSECUTIVE_FAILURES = 10;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const PER_REQUEST_TIMEOUT_MS = 60_000;

export class SystemBrain {
  readonly registry: ProviderRegistry;
  readonly quota: QuotaTracker;
  readonly controller: ProviderController;
  readonly resume: ResumeManager;
  readonly env: EnvInfo;

  private authFailedProviders = new Set<string>();

  constructor(baseDir: string = process.cwd()) {
    this.registry = new ProviderRegistry(baseDir);
    this.quota = new QuotaTracker(baseDir);
    this.controller = new ProviderController(this.registry, this.quota);
    this.resume = new ResumeManager(baseDir);
    this.env = detectEnvironment();
  }

  async boot(): Promise<void> {
    console.error(`[brain] env=${this.env.env} platform=${this.env.platform}`);
    if (isInteractive() && this.registry.getEnabled().length === 0) {
      await interactiveSetup(this.registry);
    }
  }

  async run(task: BrainTask): Promise<BrainResult> {
    const taskId = task.taskId || crypto.randomBytes(16).toString('hex');
    if (!/^[a-f0-9]{8,64}$/i.test(taskId)) {
      throw new Error(`Invalid taskId: ${taskId}`);
    }

    // ⭐ Bug 7 FIX: exclusive task lock
    const lock = acquireTaskLock(taskId);
    try {
      return await this.runLocked(task, taskId);
    } finally {
      lock.release();
    }
  }

  private async runLocked(task: BrainTask, taskId: string): Promise<BrainResult> {
    let cp = this.resume.load(taskId);

    // ⭐ Bug 5 FIX: resume must use saved question
    if (cp) {
      if (task.question && task.question !== cp.question) {
        throw new Error(
          `Task ${taskId} exists with a different question. ` +
          `Use a new taskId or resume without --question conflict.`
        );
      }
      // ⭐ Bug 8 FIX: reject failed checkpoints without explicit reset
      if (cp.status === 'failed') {
        throw new Error(
          `Task ${taskId} has status=failed. Cannot resume automatically. ` +
          `Delete checkpoint or start new task.`
        );
      }
      if (cp.status === 'done') {
        // Task already done — return saved result
        return {
          taskId,
          status: 'done',
          verified: cp.verificationLevel === 'verified',
          verificationLevel: cp.verificationLevel,
          answer: cp.winner,
          elapsedSeconds: cp.elapsedSeconds,
          rounds: cp.round,
          reason: 'already-done',
        };
      }
    } else {
      // New task
      const maxHours = task.maxRuntimeHours ?? 720;
      cp = {
        version: '1.1',
        taskId,
        question: task.question,
        mode: task.mode || 'medium',
        maxRuntimeHours: maxHours,        // ⭐ Bug 15 FIX: persist limit
        deadlineAt: Date.now() + maxHours * 3600 * 1000,
        startedAt: Date.now(),
        lastUpdate: Date.now(),
        elapsedSeconds: 0,
        round: 0,
        status: 'running',
        verificationLevel: 'none',
      };
      this.resume.save(cp);
    }

    cp.status = 'running';
    this.resume.save(cp);

    const activeIds = this.registry.getActive().map((p) => p.id);
    if (activeIds.length === 0) {
      cp.status = 'failed';
      this.resume.save(cp);
      return {
        taskId, status: 'failed', verified: false, verificationLevel: 'none',
        elapsedSeconds: cp.elapsedSeconds, rounds: cp.round,
        reason: 'no-active-providers',
      };
    }

    let consecutiveNonQuotaFailures = 0;

    while (true) {
      const remainingMs = cp.deadlineAt - Date.now();

      // ⭐ Bug 5 (max runtime) FIX: PAUSED, not done
      if (remainingMs <= 0) {
        cp.status = 'paused';
        cp.pausedReason = 'max-runtime-reached';
        cp.pausedAt = Date.now();
        cp.elapsedSeconds = Math.floor((Date.now() - cp.startedAt) / 1000);
        this.resume.save(cp);
        return {
          taskId, status: 'paused', verified: false, verificationLevel: cp.verificationLevel,
          elapsedSeconds: cp.elapsedSeconds, rounds: cp.round,
          reason: 'max-runtime-reached',
        };
      }

      // ⭐ Bug 8 FIX: circuit breaker
      if (consecutiveNonQuotaFailures >= MAX_CONSECUTIVE_FAILURES) {
        cp.status = 'paused';
        cp.pausedReason = 'repeated-provider-failures';
        cp.pausedAt = Date.now();
        cp.elapsedSeconds = Math.floor((Date.now() - cp.startedAt) / 1000);
        this.resume.save(cp);
        return {
          taskId, status: 'paused', verified: false, verificationLevel: cp.verificationLevel,
          elapsedSeconds: cp.elapsedSeconds, rounds: cp.round,
          reason: 'repeated-provider-failures',
        };
      }

      const eligibleIds = this.registry
        .getActive()
        .map((p) => p.id)
        .filter((id) => !this.authFailedProviders.has(id));

      if (eligibleIds.length === 0) {
        cp.status = 'failed';
        cp.pausedReason = 'all-providers-auth-failed';
        this.resume.save(cp);
        return {
          taskId, status: 'failed', verified: false, verificationLevel: 'none',
          elapsedSeconds: cp.elapsedSeconds, rounds: cp.round,
          reason: 'all-providers-auth-failed',
        };
      }

      if (this.quota.allExhausted(eligibleIds)) {
        const waitMs = this.quota.nextAvailableIn(eligibleIds);
        console.error(`[brain] all exhausted — pause ${Math.ceil(waitMs / 1000)}s`);
        cp.status = 'paused';
        cp.pausedReason = 'all-providers-exhausted';
        cp.pausedAt = Date.now();
        cp.nextRunAt = Date.now() + waitMs + 2000;   // ⭐ Bug 16: persist for restart
        cp.elapsedSeconds = Math.floor((Date.now() - cp.startedAt) / 1000);
        this.resume.save(cp);

        await this.sleepUntil(cp.nextRunAt, taskId);

        cp.status = 'running';
        cp.pausedReason = undefined;
        cp.pausedAt = undefined;
        cp.nextRunAt = undefined;
        this.resume.save(cp);
        continue;
      }

      let result: { provider: string; model: string; text: string } | null = null;
      const requestTimeout = Math.min(PER_REQUEST_TIMEOUT_MS, remainingMs);
      const abortSignal = AbortSignal.timeout(requestTimeout);

      try {
        const r = await this.controller.complete(
          this.buildPrompt(cp),
          task.system,
          {
            excludeProviderIds: this.authFailedProviders, // ⭐ Bug 4 FIX
            preferredId: task.preferredProvider,           // ⭐ Bug 4 FIX
            timeoutMs: requestTimeout,                     // ⭐ Bug 6 FIX
            signal: abortSignal,
          }
        );
        // r.provider is actual successful provider
        this.quota.markOK(r.provider);                    // ⭐ Bug 3 FIX
        result = { provider: r.provider, model: r.model, text: r.text };
        consecutiveNonQuotaFailures = 0;
      } catch (err: any) {
        if (err instanceof ProviderError) {
          if (err.errorClass === 'AUTH_ERROR' || err.errorClass === 'PERMISSION_ERROR') {
            const perProvider = (err as any).errors as ProviderError[] | undefined;
            if (perProvider) {
              for (const pe of perProvider) {
                if (pe.errorClass === 'AUTH_ERROR' || pe.errorClass === 'PERMISSION_ERROR') {
                  this.authFailedProviders.add(pe.providerId);
                  console.error(`[brain] ${pe.providerId} disabled (${pe.errorClass})`);
                }
              }
            }
          }
        }
        consecutiveNonQuotaFailures++;
        cp.elapsedSeconds = Math.floor((Date.now() - cp.startedAt) / 1000);
        this.resume.save(cp);
        const backoff = Math.min(
          BACKOFF_MAX_MS,
          BACKOFF_BASE_MS * Math.pow(2, Math.min(consecutiveNonQuotaFailures, 6))
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      cp.round++;
      cp.elapsedSeconds = Math.floor((Date.now() - cp.startedAt) / 1000);
      this.resume.save(cp);

      // ⭐ Bug 14 FIX: weak heuristic → candidate, NOT done
      if (this.weakHeuristicPass(result.text)) {
        cp.status = 'candidate';
        cp.verificationLevel = 'weak-heuristic';
        cp.winner = result.text;
        this.resume.save(cp);
        return {
          taskId,
          status: 'candidate',
          verified: false,                       // never true for weak-heuristic
          verificationLevel: 'weak-heuristic',
          providerUsed: result.provider,
          modelUsed: result.model,
          answer: result.text,
          elapsedSeconds: cp.elapsedSeconds,
          rounds: cp.round,
          reason: 'weak-heuristic-only — independent verifier not implemented (Phase 4)',
        };
      }
    }
  }

  private async sleepUntil(targetMs: number, taskId: string): Promise<void> {
    while (Date.now() < targetMs) {
      const remaining = targetMs - Date.now();
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(remaining, 5000)));
      if (Date.now() < targetMs) {
        const left = Math.ceil((targetMs - Date.now()) / 1000);
        if (left % 30 === 0) console.error(`[brain] ${taskId} paused — ${left}s to resume`);
      }
    }
    console.error(`[brain] auto-resuming ${taskId}`);
  }

  private buildPrompt(cp: TaskCheckpoint): string {
    // ⭐ Bug 5 FIX: uses cp.question (authoritative)
    return `Round ${cp.round}. Question: ${cp.question}\nMode: ${cp.mode}\nGive a complete answer.`;
  }

  private weakHeuristicPass(text: string): boolean {
    if (!text || text.trim().length < 20) return false;
    const lower = text.toLowerCase();
    if (lower.includes("i don't know") || lower.includes('cannot answer')) return false;
    if (lower.includes('as an ai') && lower.includes("can't")) return false;
    return true;
  }
}
