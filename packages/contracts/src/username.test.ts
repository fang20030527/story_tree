import { describe, expect, it } from 'vitest';
import {
  AccountProfileSchema, EmailAuthRequestSchema, EmailAuthResponseSchema, MessageBottleProfileSchema,
  RESERVED_USERNAMES, UpdateUsernameRequestSchema, UsernameInputSchema, UsernameSchema,
  checkUsername, isReservedUsername, usernameKey,
} from './index';

const password = 'correct-horse-battery';

describe('用户名规则', () => {
  it('去掉首尾空白并做 NFKC 规范化，接受中英文、数字和 _ · . -', () => {
    expect(checkUsername('  Ａlice  ')).toEqual({ ok: true, username: 'Alice' });
    for (const name of ['小林', 'Zhang_San.1-2·x', '__a', 'ab', 'a'.repeat(24), 'ａｂ１２']) {
      expect(checkUsername(name).ok).toBe(true);
    }
    expect(checkUsername('ａｂ１２')).toEqual({ ok: true, username: 'ab12' });
  });

  it('长度以 2–24 个字符为界，并给出对应提示', () => {
    expect(checkUsername('')).toEqual({ ok: false, message: '请输入用户名' });
    expect(checkUsername('   ')).toEqual({ ok: false, message: '请输入用户名' });
    expect(checkUsername('a')).toEqual({ ok: false, message: '用户名需为 2–24 个字符' });
    expect(checkUsername('a'.repeat(25))).toEqual({ ok: false, message: '用户名需为 2–24 个字符' });
    expect(checkUsername('名'.repeat(24)).ok).toBe(true);
    expect(checkUsername('名'.repeat(25)).ok).toBe(false);
  });

  it('拒绝邮箱、空格、换行、表情、标签等不在字符集内的输入', () => {
    for (const name of ['a@b.com', 'a b', 'a\nb', '😀😀', '<script>', 'a/b', "o'neil", 'a+b', '张 三']) {
      expect(checkUsername(name), name).toEqual({
        ok: false, message: '用户名只能包含文字、数字、下划线、点、连字符和间隔号',
      });
    }
  });

  it('至少包含一个文字或数字，不能只由标点组成', () => {
    for (const name of ['..', '--', '___', '·-·', '._']) {
      expect(checkUsername(name), name).toEqual({ ok: false, message: '用户名需至少包含一个文字或数字' });
    }
  });

  it('拦截保留字，忽略大小写、全角和分隔符，但不误伤普通名字', () => {
    for (const name of ['admin', 'Admin', 'ＡＤＭＩＮ', 'a.d.m.i.n', 'admin_', '_root_', 'Support', '管理员', '官方', '黑洞英语', '官_方']) {
      expect(checkUsername(name), name).toEqual({ ok: false, message: '这个用户名不可使用，请换一个' });
    }
    for (const name of ['admin1', 'administrator2', 'my_system', '官方账号', 'blackhole', '小官']) {
      expect(checkUsername(name).ok, name).toBe(true);
    }
    expect(RESERVED_USERNAMES.every(name => isReservedUsername(name))).toBe(true);
  });

  it('唯一性键忽略大小写和全角差异，中文保持不变', () => {
    expect(usernameKey('Alice')).toBe('alice');
    expect(usernameKey('ＡＬＩＣＥ')).toBe('alice');
    expect(usernameKey('小林')).toBe('小林');
    expect(usernameKey('Zhang_San')).toBe(usernameKey('zhang_san'));
  });

  it('读取已保存名字时只检查长度和字符集，保留字和标点名字不会让接口报错', () => {
    expect(UsernameSchema.safeParse('admin').success).toBe(true);
    expect(UsernameSchema.safeParse('..').success).toBe(true);
    expect(UsernameSchema.safeParse('a@b.com').success).toBe(false);
    expect(UsernameInputSchema.safeParse('admin').success).toBe(false);
    expect(UsernameInputSchema.parse(' Ａlice ')).toBe('Alice');
  });
});

describe('邮箱注册请求的用户名', () => {
  it('用户名可选：旧客户端只发邮箱和密码时仍然有效，且输出里没有 username', () => {
    const parsed = EmailAuthRequestSchema.parse({ email: ' Reader@Example.com ', password });
    expect(parsed).toEqual({ email: 'reader@example.com', password });
    expect('username' in parsed).toBe(false);
  });

  it('提供用户名时规范化并校验，失败信息指向 username 字段', () => {
    expect(EmailAuthRequestSchema.parse({ email: 'a@b.co', password, username: ' Ａlice ' }))
      .toEqual({ email: 'a@b.co', password, username: 'Alice' });
    const rejected = EmailAuthRequestSchema.safeParse({ email: 'a@b.co', password, username: 'a@b.co' });
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      expect(rejected.error.issues[0]).toMatchObject({
        path: ['username'], message: '用户名只能包含文字、数字、下划线、点、连字符和间隔号',
      });
    }
    expect(EmailAuthRequestSchema.safeParse({ email: 'a@b.co', password, username: '' }).success).toBe(false);
  });

  it('请求仍是严格对象，响应结构保持不变以免旧客户端解析失败', () => {
    expect(EmailAuthRequestSchema.safeParse({ email: 'a@b.co', password, nickname: 'x' }).success).toBe(false);
    const response = { userId: crypto.randomUUID(), kind: 'registered', remainingFreePractices: 3 };
    expect(EmailAuthResponseSchema.safeParse(response).success).toBe(true);
    expect(EmailAuthResponseSchema.safeParse({ ...response, username: 'Alice' }).success).toBe(false);
  });
});

describe('账号资料契约', () => {
  it('资料只含身份类型和用户名，游客用户名为空', () => {
    expect(AccountProfileSchema.parse({ kind: 'registered', username: 'Alice' }))
      .toEqual({ kind: 'registered', username: 'Alice' });
    expect(AccountProfileSchema.parse({ kind: 'guest', username: null }).username).toBeNull();
    expect(AccountProfileSchema.safeParse({ kind: 'registered', username: 'Alice', email: 'a@b.co' }).success).toBe(false);
    expect(AccountProfileSchema.safeParse({ kind: 'admin', username: 'Alice' }).success).toBe(false);
  });

  it('修改请求使用完整新输入规则且不接受额外字段', () => {
    expect(UpdateUsernameRequestSchema.parse({ username: '  Bob_2 ' })).toEqual({ username: 'Bob_2' });
    for (const username of ['', 'b', 'admin', 'a@b.co', '..']) {
      expect(UpdateUsernameRequestSchema.safeParse({ username }).success, username).toBe(false);
    }
    expect(UpdateUsernameRequestSchema.safeParse({ username: 'Bob_2', userId: crypto.randomUUID() }).success).toBe(false);
  });

  it('留言瓶账号资格的结构不变，沿用同一套用户名格式', () => {
    expect(MessageBottleProfileSchema.parse({ username: 'Alice', canPost: true })).toEqual({ username: 'Alice', canPost: true });
    expect(MessageBottleProfileSchema.parse({ username: null, canPost: false }).username).toBeNull();
    expect(MessageBottleProfileSchema.safeParse({ username: 'a@b.co', canPost: true }).success).toBe(false);
  });
});
