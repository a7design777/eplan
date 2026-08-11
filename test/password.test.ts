import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hashPassword, verifyPassword } from '../src/auth/password';

describe('hashPassword / verifyPassword', () => {
  it('приймає правильний пароль', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
  });

  it('відхиляє неправильний пароль', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse batteries', stored)).toBe(false);
  });

  it('однаковий пароль дає різні хеші — сіль випадкова', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('не падає на пошкодженому записі', async () => {
    for (const bad of ['', 'сміття', 'pbkdf2$', 'pbkdf2$abc$c2FsdA==$aGFzaA==', 'md5$1$a$b']) {
      expect(await verifyPassword('pass', bad)).toBe(false);
    }
  });

  it('кількість ітерацій зберігається в самому хеші', async () => {
    const stored = await hashPassword('pass');
    const [scheme, iterations] = stored.split('$');
    expect(scheme).toBe('pbkdf2');
    expect(Number(iterations)).toBeGreaterThan(0);
  });

  /**
   * Workers відхиляють PBKDF2 понад 100 000 ітерацій. Локально (Node) такий хеш
   * порахується без помилки, тому баг ловиться тільки в проді — звідси перевірка
   * саме константи, а не поведінки.
   */
  it('не перевищує стелю Workers у 100 000 ітерацій', async () => {
    const source = readFileSync(new URL('../src/auth/password.ts', import.meta.url), 'utf8');
    const match = source.match(/const ITERATIONS = ([\d_]+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1]!.replace(/_/g, ''))).toBeLessThanOrEqual(100_000);

    const stored = await hashPassword('pass');
    expect(Number(stored.split('$')[1])).toBeLessThanOrEqual(100_000);
  });
});
