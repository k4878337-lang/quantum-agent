import fs from 'fs';
import { isPrivateHostname } from '../utils/net.js';

interface ScopeFile {
  targets: string[];
  expires_at?: string;
  issued_by?: string;
  allow_private?: boolean;
}

export class ScopeGuard {
  /**
   * Fixes: Bug 1 (port), Bug 2 (redirect — used by safeFetch),
   * Bug 3 (path boundary), and rejects credentials/malformed.
   */
  verify(target: string, scopeFile: string): void {
    if (!fs.existsSync(scopeFile)) {
      throw new Error('AUTHORIZATION REQUIRED: scope file missing.');
    }

    let scope: ScopeFile;
    try {
      scope = JSON.parse(fs.readFileSync(scopeFile, 'utf-8'));
    } catch {
      throw new Error('Invalid scope file: not valid JSON.');
    }

    if (!Array.isArray(scope.targets) || scope.targets.length === 0) {
      throw new Error('Invalid scope file: targets array missing or empty.');
    }

    if (scope.expires_at) {
      const exp = new Date(scope.expires_at).getTime();
      if (isNaN(exp) || Date.now() > exp) {
        throw new Error(`Scope expired at ${scope.expires_at}.`);
      }
    }

    const parsed = this.parseTarget(target);
    this.assertSafeTarget(parsed, !!scope.allow_private);

    const allowed = scope.targets.some((t) => this.matchesStrict(parsed, t));
    if (!allowed) {
      throw new Error(
        `BLOCKED: ${target} not in authorized scope. ` +
        `Exact scheme+host+port required.`
      );
    }

    console.error(`[guard] authorized: ${target}`);
  }

  /** Call this for every redirect destination. Fixes Bug 2. */
  verifyUrl(target: URL, scopeFile: string): void {
    this.verify(target.toString(), scopeFile);
  }

  private parseTarget(target: string): URL {
    let u: URL;
    try {
      u = new URL(target);
    } catch {
      throw new Error(`Invalid target URL: ${target}`);
    }
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error(`Protocol must be http/https: ${target}`);
    }
    if (u.username || u.password) {
      throw new Error('BLOCKED: URL contains credentials');
    }
    return u;
  }

  private assertSafeTarget(u: URL, allowPrivate: boolean): void {
    if (!allowPrivate && isPrivateHostname(u.hostname)) {
      throw new Error(
        `BLOCKED: private/reserved host ${u.hostname}. ` +
        `Add "allow_private": true to scope only if explicitly authorized.`
      );
    }
  }

  private matchesStrict(target: URL, pattern: string): boolean {
    try {
      const p = new URL(pattern);
      // ⭐ Bug 1 FIX: compare normalized ports
      const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
      const patternPort = p.port || (p.protocol === 'https:' ? '443' : '80');
      if (target.protocol !== p.protocol) return false;
      if (target.hostname !== p.hostname) return false;
      if (targetPort !== patternPort) return false;

      // ⭐ Bug 3 FIX: path boundary — /app does not match /application
      const base = p.pathname.replace(/\/+$/, '');
      const path = target.pathname.replace(/\/+$/, '');
      if (base === '') return true;
      return path === base || path.startsWith(`${base}/`);
    } catch {
      return false;
    }
  }
}
