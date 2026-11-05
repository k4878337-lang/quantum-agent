import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ScopeGuard } from '../src/safety/scope-guard.js';
import { isPrivateHostname } from '../src/utils/net.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { mkTmpDir, cleanTmpDir } from './helpers.js';

function writeScope(dir: string, scope: any): string {
  const p = path.join(dir, 'scope.json');
  fs.writeFileSync(p, JSON.stringify(scope));
  return p;
}

describe('ScopeGuard — Bug 1, 2, 3, 11', () => {
  it('rejects wrong port', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['https://example.com:8080'] });
      const g = new ScopeGuard();
      expect(() => g.verify('https://example.com:9090', scope)).toThrow(/not in authorized/);
    } finally { cleanTmpDir(dir); }
  });

  it('accepts exact port match', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['https://example.com:8080'] });
      expect(() => new ScopeGuard().verify('https://example.com:8080/api', scope)).not.toThrow();
    } finally { cleanTmpDir(dir); }
  });

  it('normalizes default https port 443', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['https://example.com'] });
      expect(() => new ScopeGuard().verify('https://example.com:443/x', scope)).not.toThrow();
    } finally { cleanTmpDir(dir); }
  });

  it('/app does NOT match /application (Bug 3)', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['https://example.com/app'] });
      expect(() => new ScopeGuard().verify('https://example.com/application', scope)).toThrow();
      expect(() => new ScopeGuard().verify('https://example.com/app', scope)).not.toThrow();
      expect(() => new ScopeGuard().verify('https://example.com/app/users', scope)).not.toThrow();
    } finally { cleanTmpDir(dir); }
  });

  it('rejects credentials in URL', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['https://example.com'] });
      expect(() => new ScopeGuard().verify('https://user:pass@example.com', scope)).toThrow(/credentials/);
    } finally { cleanTmpDir(dir); }
  });

  it('rejects private IP unless allow_private', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['http://127.0.0.1:8080'] });
      expect(() => new ScopeGuard().verify('http://127.0.0.1:8080/x', scope)).toThrow(/private/);
    } finally { cleanTmpDir(dir); }
  });

  it('allows private IP when scope allow_private=true', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, { targets: ['http://127.0.0.1:8080'], allow_private: true });
      expect(() => new ScopeGuard().verify('http://127.0.0.1:8080/x', scope)).not.toThrow();
    } finally { cleanTmpDir(dir); }
  });

  it('rejects expired scope', () => {
    const dir = mkTmpDir();
    try {
      const scope = writeScope(dir, {
        targets: ['https://example.com'],
        expires_at: '2020-01-01T00:00:00Z',
      });
      expect(() => new ScopeGuard().verify('https://example.com', scope)).toThrow(/expired/);
    } finally { cleanTmpDir(dir); }
  });
});

describe('isPrivateHostname', () => {
  it('detects RFC1918 ranges', () => {
    expect(isPrivateHostname('10.0.0.1')).toBe(true);
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('example.com')).toBe(false);
    expect(isPrivateHostname('localhost')).toBe(true);
  });
});

describe('Registry — Bug 12, 13', () => {
  it('does not leak apiKey in listSafe()', () => {
    const dir = mkTmpDir();
    try {
      const r = new ProviderRegistry(dir);
      r.add({
        id: 'x', type: 'openai', name: 'X', apiKey: 'SECRET-KEY',
        model: 'm', enabled: true, priority: 1, addedAt: new Date().toISOString(),
      });
      const safe = r.listSafe();
      expect(JSON.stringify(safe)).not.toContain('SECRET-KEY');
      expect(safe[0].hasApiKey).toBe(true);
    } finally { cleanTmpDir(dir); }
  });

  it('quarantines corrupt file (Bug 13)', () => {
    const dir = mkTmpDir();
    try {
      fs.writeFileSync(path.join(dir, '.quantum-providers.json'), 'not-json{');
      const r = new ProviderRegistry(dir);
      expect(r.list().length).toBe(0);
      const files = fs.readdirSync(dir);
      expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
    } finally { cleanTmpDir(dir); }
  });
});
