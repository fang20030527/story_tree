import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    unlimited: { type: 'boolean' },
    limited: { type: 'boolean' },
  },
  strict: true,
});
const email = values.email?.trim().toLowerCase();
if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    Boolean(values.unlimited) === Boolean(values.limited)) {
  throw new Error('用法：--email <邮箱>，并且只选择 --unlimited 或 --limited');
}
for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_API_TOKEN']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}` +
  '/d1/database/9466eeba-614c-4eac-8b97-8d71a781dfbb/query';

async function query(sql, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.CLOUDFLARE_D1_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || !data.success || !data.result?.[0]?.success) {
    const codes = data.errors?.map((error) => error.code).join(',') ?? '';
    throw new Error(`D1 请求失败：HTTP ${response.status}，错误码 ${codes}`);
  }
  return data.result[0].results;
}

const owners = await query(`
  SELECT user.id AS userId FROM email_accounts AS account
  JOIN users AS user ON user.id = account.user_id
  WHERE account.email = ?1 AND user.kind = 'registered' AND user.deleted_at IS NULL
`, [email]);
if (owners.length !== 1) throw new Error('未找到唯一有效注册账号，未修改权限');
const userId = owners[0].userId;
const unlimited = values.unlimited ? '1' : '0';
// 在写入时再次校验邮箱和账号，防止读取后身份被删除或变更。
const changed = await query(`
  INSERT INTO user_practice_access (user_id, unlimited_practices)
  SELECT user.id, ?1 FROM users AS user
  JOIN email_accounts AS account ON account.user_id = user.id
  WHERE user.id = ?2 AND account.email = ?3
    AND user.kind = 'registered' AND user.deleted_at IS NULL
  ON CONFLICT(user_id) DO UPDATE SET
    unlimited_practices = excluded.unlimited_practices,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING user_id AS userId, unlimited_practices AS unlimitedPractices
`, [unlimited, userId, email]);
if (changed.length !== 1 || changed[0].userId !== userId ||
    changed[0].unlimitedPractices !== Number(unlimited)) {
  throw new Error('账号权限写入结果不符合预期');
}
const verified = await query(`
  SELECT access.user_id AS userId, access.unlimited_practices AS unlimitedPractices
  FROM user_practice_access AS access
  JOIN users AS user ON user.id = access.user_id
  JOIN email_accounts AS account ON account.user_id = user.id
  WHERE user.id = ?1 AND account.email = ?2 AND user.deleted_at IS NULL
`, [userId, email]);
if (verified.length !== 1 || verified[0].unlimitedPractices !== Number(unlimited)) {
  throw new Error('账号权限复核失败');
}
console.log(JSON.stringify({ userId, unlimitedPractices: values.unlimited === true, verified: true }));
