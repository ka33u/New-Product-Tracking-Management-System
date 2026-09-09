export class NpdLoginRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, Math.min(900, Math.ceil(retryAfterSeconds)));
    super(`登录尝试过于频繁，请约 ${Math.ceil(seconds / 60)} 分钟后重试。账户未被永久锁定。`);
    this.name = "NpdLoginRateLimitError";
    this.retryAfterSeconds = seconds;
  }
}

async function takeSlot(database: D1Database, bucket: string, limit: number, windowSeconds: number) {
  // One SQLite statement reserves an attempt. A read-then-write counter would
  // allow concurrent requests to all pass the same remaining slot.
  const slot = await database.prepare(`INSERT INTO npd_local_login_limits(bucket,window_started_at,attempt_count)
    VALUES (?,unixepoch(),1)
    ON CONFLICT(bucket) DO UPDATE SET
      attempt_count=CASE WHEN window_started_at<=unixepoch()-? THEN 1 ELSE attempt_count+1 END,
      window_started_at=CASE WHEN window_started_at<=unixepoch()-? THEN unixepoch() ELSE window_started_at END
    WHERE attempt_count<? OR window_started_at<=unixepoch()-?
    RETURNING window_started_at,attempt_count`).bind(bucket, windowSeconds, windowSeconds, limit, windowSeconds)
    .first<{ window_started_at: number; attempt_count: number }>();
  if (slot) return;
  const row = await database.prepare(`SELECT max(1,window_started_at+?-unixepoch()) AS retry
    FROM npd_local_login_limits WHERE bucket=?`).bind(windowSeconds, bucket).first<{ retry: number }>();
  throw new NpdLoginRateLimitError(row?.retry || windowSeconds);
}

export async function reserveLocalLoginAttempt(database: D1Database, email: string, setup = false) {
  // This loopback-only deployment has no trustworthy per-client IP. Forwarded
  // headers are deliberately ignored. A global cap bounds random-email abuse.
  await takeSlot(database, "local-global", 60, 60);
  await database.prepare("DELETE FROM npd_local_login_limits WHERE window_started_at<unixepoch()-3600").run();
  if (setup) { await takeSlot(database, "local-setup", 5, 900); return; }
  const normalized = email.trim().toLowerCase().slice(0, 320);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await takeSlot(database, `account:${key}`, 10, 900);
}
