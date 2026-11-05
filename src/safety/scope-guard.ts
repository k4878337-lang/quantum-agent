import fs from 'fs';

export class ScopeGuard {
  verify(target: string, scopeFile: string): void {
    if (!fs.existsSync(scopeFile)) {
      throw new Error('AUTHORIZATION REQUIRED: scope file missing.');
    }
    const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf-8'));
    const allowed = scope.targets?.some((t: string) => target.includes(t));
    if (!allowed) {
      throw new Error(`BLOCKED: ${target} not in authorized scope.`);
    }
    console.error(`[guard] authorized scan: ${target}`);
  }
}
