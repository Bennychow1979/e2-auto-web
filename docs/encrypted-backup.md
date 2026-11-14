# E2 Auto：每日加密备份与还原演练

## Benny 首次启用

在本仓库 **Settings → Secrets and variables → Actions → Repository secrets** 自行填写：

| Secret | 内容与用途 |
| --- | --- |
| `BACKUP_DATABASE_URL` | Supabase `postgres` 数据库连接串，具有完整数据导出、所有角色定义读取权限。优先 Direct connection；GitHub runner IPv6 无法连接时用 **Session pooler / 5432**。不要用 Transaction pooler / 6543；备份和行数核对要共享一个 PostgreSQL snapshot。密码中的特殊字符应按连接串要求编码。 |
| `BACKUP_SUPABASE_URL` | 同一个正式 Supabase project 的 HTTPS 根网址，无 `/rest/v1` 等后缀。 |
| `BACKUP_SUPABASE_SERVICE_ROLE_KEY` | 同一项目的 legacy `service_role` key，仅供 runner 下载全部 private/public Storage 文件；不能用 anon key。 |

已经配置的 `BACKUP_AWS_ACCESS_KEY_ID`、`BACKUP_AWS_SECRET_ACCESS_KEY`、`BACKUP_PASSPHRASE` 继续使用。失败通知复用现有 `E2AUTO_CHECK_BOT_TOKEN`、`E2AUTO_CHECK_CHAT_ID` 和已核验的 `E2auto_check_bot`。不需要新增通知渠道、S3 读取权限或公开 bucket。

**不要把任何 secret 值贴到聊天、issue、代码、命令历史或 PR。** Passphrase 是单行文本，由 Benny 自行保存离线副本；不要只存在 GitHub Secrets 中。更换 passphrase 后仍须保留旧版，旧备份不会自动重新加密。

`backup-status` 分支须已有下述初始化 JSON；Actions 使用自身 `GITHUB_TOKEN` 更新该分支。如果组织策略禁用 Actions 写仓库，管理员需允许本 workflow 的 `contents: write`。此分支不要设置阻止该 bot 更新的规则，不需要个人 PAT。

配置完成后，打开 **Actions → E2 encrypted backups → Run workflow → main**，勾选 `include_files` 做首次备份。第一次没有文件备份成功时间时也会自动备份所有文件。查看各阶段成功、公开状态变成 `ok: true`，再由 Benny 在 AWS 后台确认对象存在。没有完成这一步，不能把安装 workflow 当成已完成首次正式备份。

## 调度和文件

- 每日 `19:00 UTC`，即次日马来西亚时间 **03:00**。GitHub 排程可能延迟，不保证整点执行；文件名使用实际开始运行的马来西亚日期。
- 数据库每天：`s3://e2auto-web-backup-2026/daily/e2-db-YYYY-MM-DD.sql.gz.gpg`。
- 马来西亚每月 1 日：将 runner 上同一份密文再次上传为 `monthly/e2-db-YYYY-MM.sql.gz.gpg`。这是两个本地到 S3 的 `aws s3 cp`，不需要 `GetObject`。月初额外上传失败时，整次 DB 备份不标成功；当天修复并重跑。若已过 1 日，由 Benny 在 AWS 后台将对应 1 日的 daily 对象复制到当月 monthly 键（runner 不做需要读取权限的复制）。
- 每周日、首次运行、距上次文件备份超过 7 天、或手动选择 `include_files` 时：`files/e2-storage-YYYY-MM-DD.tar.gz.gpg`。周日失败后，后续每天会重试，直到本周成功。
- Bucket `e2auto-web-backup-2026`，region `ap-southeast-2`；保留 Versioning、Block Public Access 和现有 Lifecycle。重复同日运行生成新版本。workflow 不列举、不读回、不删除 S3 对象，不设置 public ACL，不使用 `sync`。
- 成功以 AWS CLI 完成上传并返回 0 为准；公开大小为本地密文的字节数。此写入专用密钥无法独立读回验证，实际可还原性由 Benny 下载后的演练验证。

## 备份范围与保密

`pg_dumpall --roles-only --no-role-passwords` + 完整 `pg_dump`，保留用户 schema、数据、ownership、grants、RLS、函数、触发器、序列、大对象，以及可读取的 `auth`、`storage` 数据。没有 `--schema=public` 或排除业务表的过滤条件。数据库 dump 与行数清单使用同一 repeatable-read snapshot；导出权限不足、客户端版本不支持、缺少 `public.vehicles` 等情况会失败，不会发布不完整成功。

角色定义和成员关系会导出；**数据库角色的登录密码不会导出**（Supabase 不允许读取全部 `pg_authid`）。恢复后需重新配置这些数据库登录密码。`auth.users` 中的应用用户数据仍随数据库导出。托管平台配置、Edge Function 源码、环境 secrets、OAuth/SMTP 设置、外部服务数据不属于 PostgreSQL 逻辑备份，仍需分别保管。

数据库 SQL 不落盘：SQL 流 → gzip → GPG AES-256；GPG passphrase 通过匿名文件描述符传递，不出现在进程参数或日志中。Storage 每个文件仅暂存在 runner 私有临时文件中，然后写入 tar → gzip → GPG；归档内的 `manifest.json` 保存 bucket 元数据、原路径、对象元数据、实际字节数和 SHA-256。原始文件名不作为 tar 路径，避免特殊路径或名称冲突；`objects/000000000` 等编号通过 manifest 映射回原名。

Storage 清单直接读取 `storage.buckets` 和 `storage.objects` 的全部行，使用数据库游标，无 REST 分页默认 100/1000 限制，包含空 bucket、子目录、新 bucket 及三个现有私有 bucket。当前 354 文件/约 182 MB 是现状参考，**不会硬编码为上限**。每个下载核对字节数，前后清单发生变化则整份文件备份失败并重试。Storage 与数据库无法形成跨服务的原子快照；需要严格业务一致性的演练请选择无上传、改名和删除的窗口。

只有完整完成加密的 `.gpg` 才能进入上传步骤。临时目录位于 `$RUNNER_TEMP`，不是 checkout 或 Pages 输出目录，结束时清理 runner 临时文件。没有备份 artifact、cache、SQL 日志、文件名日志或 secret 日志。错误只打印固定阶段名；不要为了排查打开 `set -x`、HTTP 响应打印、SQL 输出或 secret 回显。

## 公开状态接口（交给每日报告）

固定网址：

<https://raw.githubusercontent.com/Bennychow1979/e2-auto-web/backup-status/status.json>

格式仅允许以下字段；初始未成功时为 `null` 和 `0`，不是虚构成功记录：

```json
{"updated_at":null,"db_last_ok":null,"db_bytes":0,"files_last_ok":null,"files_bytes":0,"ok":false}
```

运行后的示例（示例数值不是实际备份结果）：

```json
{"updated_at":"2026-11-15T19:06:00Z","db_last_ok":"2026-11-15T19:00:00Z","db_bytes":12345678,"files_last_ok":"2026-11-15T19:05:00Z","files_bytes":190000000,"ok":true}
```

- `updated_at`：最近一次尝试发布状态的时间；失败运行也更新，并设置 `ok:false`。
- `db_last_ok` / `files_last_ok`：各自最近完成加密与 S3 上传的时间（UTC）。失败时保留上次成功时间和大小；当天跳过周备份也保留上次文件备份记录。
- `db_bytes` / `files_bytes`：最近一次成功上传的 **加密文件** 字节数，不是明文数据库大小。
- `ok`：本次应执行的操作全部成功，且 DB 未超过 2 天、文件未超过 8 天。它是生成当时的状态，不能代替读取时的时间检查。

每日报告应在 HTTP 错误、JSON 无效、`ok != true`、`updated_at` 缺失或超过 **48 小时**、`db_last_ok` 缺失或超过 **48 小时**时警告；文件按 **8 天**检查。不要因为每周备份在第 3 天没有更新就误报。Raw GitHub 有短暂缓存；读取时可加当前时间的 `?t=...` 并发送 `Cache-Control: no-cache`。

状态只提交这一个白名单 JSON，不触发 main 的网站部署。若状态发布本身失败，旧时间不会伪装成新成功，workflow 失败并通知 Benny。runner 被强制终止或 GitHub 整体故障时，`always()` 也可能无法运行；每日报告的过期告警是外部兜底。

## 还原演练：Benny 本机执行

**当前不能仅凭 workflow/合成测试宣称正式数据已演练成功。** 第一次实际备份后，Benny 从 AWS 控制台下载 daily 的 `.sql.gz.gpg` 和对应周备份 `.tar.gz.gpg`。这把 runner 密钥不能下载；不必扩大它的权限。

1. 在本机加密磁盘上的私有目录工作，不放在 git checkout、云同步目录或录屏共享终端中。Linux/macOS/WSL 示例：`umask 077`。准备 GPG、gzip、Python 和 `psycopg[binary]==3.2.9`，以及 PostgreSQL 18 的 `psql`（识别 dump 的 `\restrict` 命令）。
2. GPG 交互输入 passphrase，**不写入命令行参数、环境变量、脚本或聊天**。先完整解密并验证完整性，再执行 SQL，不能把尚未认证完成的解密流直接送进 `psql`：

   ```sh
   gpg --output e2-db.sql.gz --decrypt e2-db-YYYY-MM-DD.sql.gz.gpg
   gzip -t e2-db.sql.gz
   gzip -d e2-db.sql.gz
   python /path/to/repo/scripts/backup/verify_restore.py manifest e2-db.sql
   ```

3. 查看 manifest 的源 PostgreSQL 版本和 extensions 清单。准备**完全隔离、无外网出口**的临时 PostgreSQL 实例，安装兼容源项目的全部 extensions/所需 preload 配置，使用空白数据库和独立的 bootstrap superuser（如 `e2_restore_admin`），不能预先存在源角色/应用 schema。不要直接把包含 Supabase 内部对象的完整 dump 倒入一个已初始化的新托管 Supabase 项目；它的保留角色和 schema 会冲突。通常需要与源版本兼容的 Supabase PostgreSQL 扩展环境，而非缺少 `pg_net`、`pg_graphql` 等扩展的原生 PostgreSQL 镜像。保持网络隔离，防止恢复的 cron、webhook 或 subscription 联系生产服务。
4. 仅在该测试实例中，以独立 superuser 创建空数据库，例如 `createdb -T template0 e2_restore`。在本机交互设置测试环境的 `PGHOST`、`PGPORT`、`PGUSER`、`PGDATABASE=e2_restore`；密码由 `psql -W` 自行输入。先确认主机是隔离测试实例，不要使用生产连接串。执行：

   ```sh
   psql -X -W --set ON_ERROR_STOP=on --single-transaction --file e2-db.sql
   python /path/to/repo/scripts/backup/verify_restore.py database e2-db.sql
   ```

   验证工具会隐藏输入测试数据库连接串，要求输入 `ISOLATED`，对照备份快照逐表核对（包括 `public.vehicles`、`auth`、`storage` 和其他业务表）。任何 SQL 错误或行数不一致均不算通过。不要使用忽略错误继续的 restore，也不要为了通过而过滤掉未知失败语句。若环境缺少扩展或存在角色冲突，应重建干净兼容的测试环境后重试。
5. 核对 Storage 完整性：

   ```sh
   gpg --output e2-storage.tar.gz --decrypt e2-storage-YYYY-MM-DD.tar.gz.gpg
   python /path/to/repo/scripts/backup/verify_restore.py storage e2-storage.tar.gz
   ```

   工具不展开不受信任的路径；逐个检查归档文件数、字节数和 SHA-256。需要恢复 Storage 服务时，在隔离测试项目按 manifest 的 bucket 配置创建 bucket，用 Storage API 按 `source.bucket_id` / `source.name` 上传对应 `archive_path` 的内容及 MIME type；**只恢复数据库中的 `storage.objects` 不会恢复实际文件**。上传后让 Storage 服务生成自己的对象记录，不应再覆盖这些新记录。至少抽查三个私有 bucket 中的样本能由授权用户下载、匿名请求被拒绝。
6. 记录：日期、S3 object key/Version ID、源/目标 PostgreSQL 与扩展版本、GPG 完整性结果、表数和匹配/不匹配结果、`vehicles` 行数、Storage 数量/字节及哈希结果、演练用时和异常。原始数据/SQL/备份留在本机；仓库只记录演练是否通过及非敏感总结，不提交客户资料或备份。验收后销毁隔离实例和本机临时明文。

## 故障定位

- `configuration`：缺少 secret、状态分支/文件无法读取；只核对名字和设置状态，不打印值。
- `database` / `database-roles` / `database-schema-and-data`：检查 session pooler、密码编码、网络、源服务器版本及权限。客户端固定 PG18；若项目升级到更高大版本，应先更新客户端并重跑还原测试。完整导出失败不应改成只导 public 来掩盖问题。
- `database-upload` / `monthly-upload` / `storage-upload`：Benny 在 AWS 核对区域、bucket 和对应 prefix 的 PutObject / AbortMultipartUpload 授权。没有上传后读回步骤；不要通过增加 List/Get 权限来“修复”预期的写入专用设计。
- `storage-download-and-encryption`：检查同项目 service_role、下载权限和存储写入是否仍在进行；安静窗口重跑。任何对象下载/大小检查失败都会使整份文件包不上传。
- 状态发布：检查 `contents: write`、`backup-status/status.json` 是否存在且格式正确、分支规则是否允许 bot 更新。
- Telegram：复用原有 bot，检查两个已有 secret 和对话访问。若 Telegram 自身不可用，Actions 保持失败状态，每日报告继续依赖时间检查告警。

## 验证与依据

`python -m unittest discover -s scripts/backup -p 'test_*.py' -v` 检查 MYT 月初、每周重试、状态失败保留、白名单、写入专用上传、354 个合成对象及哈希。`backup-checks.yml` 使用两个隔离 PostgreSQL 18 service 做真实 roles + schema + data → gzip → GPG → 解密 → SQL 还原 → 行数/权限核对，并检测损坏密文；不使用生产 secrets。该测试不能替代 Benny 下载真实 S3 备份后的演练。

官方参考：[PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)、[pg_dumpall](https://www.postgresql.org/docs/18/app-pg-dumpall.html)、[Supabase 备份范围](https://supabase.com/docs/guides/platform/backups)、[Supabase 还原注意事项](https://supabase.com/docs/guides/self-hosting/restore-from-platform)、[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
