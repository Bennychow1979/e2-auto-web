import {notificationConfig, verifyNotificationTarget} from './notify-stock-publication.mjs';

try {
  const config = notificationConfig();
  await verifyNotificationTarget(config);
  const run = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (!/^\d+$/.test(run || '') || !/^\d+$/.test(attempt || '')) throw Error();
  const url = `https://github.com/Bennychow1979/e2-auto-web/actions/runs/${run}/attempts/${attempt}`;
  const text = `⚠️ E2 Auto 加密备份失败或取消\n请检查 Actions 的失败阶段及公开备份状态。失败的备份不会刷新成功时间。\n${url}`;
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: config.chatId, text, disable_web_page_preview: true}),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true || !Number.isSafeInteger(result.result?.message_id)) throw Error();
  console.log('Backup failure notification delivered to Benny.');
} catch {
  console.error('Backup failure notification failed; check existing bot secrets and Telegram access.');
  process.exitCode = 1;
}
