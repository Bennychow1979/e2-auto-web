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

**2026-11-15 已完成一份真实数据库备份的本机隔离还原，结果见下方验收记录；Storage 文件恢复仍需另行演练。** Benny 从 AWS 控制台下载 daily 的 `.sql.gz.gpg` 和对应周备份 `.tar.gz.gpg`。这把 runner 密钥不能下载；不必扩大它的权限。

1. 在本机加密磁盘上的私有目录工作，不放在 git checkout、云同步目录或录屏共享终端中。Linux/macOS/WSL 示例：`umask 077`。准备 GPG、gzip、Python 和 `psycopg[binary]==3.2.9`，以及支持 dump 中 `\restrict` 命令的 `psql`；本次成功使用 PostgreSQL 17.6 的客户端/服务端。备份 runner 的 PG18 客户端与还原服务端版本是两件事，不能只按导出客户端的大版本选镜像。
2. GPG 交互输入 passphrase，**不写入命令行参数、环境变量、脚本或聊天**。先完整解密并验证完整性，再执行 SQL，不能把尚未认证完成的解密流直接送进 `psql`：

   ```sh
   gpg --output e2-db.sql.gz --decrypt e2-db-YYYY-MM-DD.sql.gz.gpg
   gzip -t e2-db.sql.gz
   gzip -d e2-db.sql.gz
   python /path/to/repo/scripts/backup/verify_restore.py manifest e2-db.sql
   ```

3. 查看 manifest 的源 PostgreSQL 和扩展版本。使用**完全隔离、无外网出口**的空白集群。本次实测使用 `supabase/postgres:17.6.1.178`（源/目标 PostgreSQL 均为 17.6），镜像 digest 为 `sha256:c282d393ae56fd165b7ada2ddbac55e582a601b86f3840aa2bbc112e43d3a570`。绕过镜像默认 entrypoint 和 Supabase 初始化脚本，不预建应用 schema 或其他源角色。**必须以 `initdb -U supabase_admin` 初始化**，让源 bootstrap 管理员保持 OID 10；另建任意 SUPERUSER 不能替代这一身份。使用隔离集群内的 `postgres` 数据库，以保留 dump 中按数据库名称指定的权限/设置。

   本次隔离配置：Docker `--network none`、不发布端口、不挂载主机目录、`--log-driver none`；服务端 `listen_addresses=''`，仅使用容器内 Unix socket。设置 `shared_preload_libraries='pg_cron,pg_net,pg_stat_statements'`、`cron.database_name=postgres`、`cron.launch_active_jobs=off`，将 `pg_net.database_name=e2_disabled` 指向不存在的数据库。关闭 SQL statement 日志，不使用正式连接串。恢复后的 cron/webhook 不得联系正式服务。不要把完整 dump 直接倒入已经初始化的托管 Supabase 项目。

4. 在上述隔离实例中确认当前用户和 bootstrap 身份：

   ```sql
   SELECT current_user, oid, rolsuper
   FROM pg_roles WHERE rolname = 'supabase_admin';
   ```

   预期当前用户为 `supabase_admin`，OID 为 10，`rolsuper` 为 true。只有确认该角色由本次空白 `initdb` 创建后，才能做以下唯一兼容适配：原始 SQL 中必须恰好有一整行 `CREATE ROLE "supabase_admin";`，仅将这一行替换为注释，保留其后所有 `ALTER ROLE`、`GRANT`、业务结构和数据。本次实际演练在内存输入中替换，没有改写原始 SQL；手工演练也可在私有目录生成单独的输入副本：

   ```sh
   python - <<'PY'
   from pathlib import Path
   source = Path("e2-db.sql").read_bytes()
   lines = source.splitlines(keepends=True)
   matches = [i for i, line in enumerate(lines)
              if line.rstrip(b"\r\n") == b'CREATE ROLE "supabase_admin";']
   if len(matches) != 1:
       raise SystemExit("Expected exactly one bootstrap role declaration; stop")
   lines[matches[0]] = b"-- supabase_admin already created by isolated initdb\n"
   with Path("e2-db.restore.sql").open("xb") as target:
       target.write(b"".join(lines))
   PY
   ```

   将适配输入只送到该隔离实例，使用 `supabase_admin` 连接 `postgres`。下面命令应在已经配置好隔离 Unix socket/用户/数据库的环境中执行；凭据如有需要由本人交互输入。禁止使用正式 `PGHOST` 或连接串。禁止记录 SQL、错误语句上下文或查询资料：

   ```sh
   psql -X -q --set ON_ERROR_STOP=on --set VERBOSITY=sqlstate \
     --set SHOW_CONTEXT=never --single-transaction \
     --file e2-db.restore.sql > /dev/null
   # 仅在 psql 退出码为 0 后执行；比较基准仍是未经修改的原始 SQL。
   python /path/to/repo/scripts/backup/verify_restore.py database e2-db.sql
   ```

   验证工具隐藏测试数据库连接串输入，要求输入 `ISOLATED`，按快照逐表核对（包括 `public.vehicles`、`auth`、`storage`）。任何 SQL 错误或行数不一致都不算通过。不得忽略错误、删除失败数据或省略授权来宣布成功；环境/扩展不匹配应重建干净实例。适配副本同样属于明文，验收后必须清理。
5. 核对 Storage 完整性：

   ```sh
   gpg --output e2-storage.tar.gz --decrypt e2-storage-YYYY-MM-DD.tar.gz.gpg
   python /path/to/repo/scripts/backup/verify_restore.py storage e2-storage.tar.gz
   ```

   工具不展开不受信任的路径；逐个检查归档文件数、字节数和 SHA-256。需要恢复 Storage 服务时，在隔离测试项目按 manifest 的 bucket 配置创建 bucket，用 Storage API 按 `source.bucket_id` / `source.name` 上传对应 `archive_path` 的内容及 MIME type；**只恢复数据库中的 `storage.objects` 不会恢复实际文件**。上传后让 Storage 服务生成自己的对象记录，不应再覆盖这些新记录。至少抽查三个私有 bucket 中的样本能由授权用户下载、匿名请求被拒绝。
6. 记录：日期、S3 object key/Version ID、源/目标 PostgreSQL 与扩展版本、GPG 完整性结果、表数和匹配/不匹配结果、`vehicles` 行数、Storage 数量/字节及哈希结果、演练用时和异常。原始数据/SQL/备份留在本机；仓库只记录演练是否通过及非敏感总结，不提交客户资料或备份。验收后销毁隔离实例和本机临时明文。


## 2026-11-15 真实数据库还原验收

验收完成于马来西亚时间 `2026-11-15T15:10:03+08:00`。使用真实 `e2-db-2026-11-15.sql.gz.gpg`，密文 1,905,255 bytes；比较基准为备份快照 `2026-11-14T21:27:25Z`，不是仍在变化的正式库。Passphrase 由本人在本机 Pinentry 输入。GPG 完整性认证与 gzip CRC 校验通过后才执行 SQL。

| 验收项 | 结果 |
| --- | --- |
| SQL 还原 | 单事务、ON_ERROR_STOP，退出码 0 |
| 车辆数量 | 备份与还原均为 153，匹配 |
| 快照行数 | 94 张非扩展表全部匹配 |
| 记录内容 | 96 个 COPY 数据块、76,996 条记录，逐行 SHA-256 多重集全部匹配，保留重复次数 |
| 外键 / CHECK | 107 / 236 项检查，均无违规 |
| 序列 | 11 个 last_value / is_called 全部匹配 |
| 索引 | 无无效或未就绪索引 |
| 视图 | 3 个视图 LIMIT 0 查询通过 |
| 角色属性 / 成员授权 / 参数权限 | 16 / 21 / 1 项全部匹配，无额外用户角色授权 |
| 扩展 | 7 项名称和版本完全匹配 |

恢复对象包含 99 张表（含扩展对象）、285 个函数、70 项 RLS policy、47 个非内部触发器、251 个索引、82 张启用 RLS 的表。94 张清单表不包含扩展表；96 个 COPY 块还包含扩展配置数据，因此这些数量不是互相矛盾的总表数。

上述内容哈希、约束、角色等深入检查来自本次本机专用验收，并非现有 `verify_restore.py database` 都已实现；仓库验证器主要核对快照行数。结论是**这份真实数据库备份可恢复，记录与备份内容一致**。本次未恢复 Storage 实际文件，也未进行整个网站、外部服务或全部业务权限的端到端验收；LIMIT 0 不证明视图业务结果正确。数据库登录密码、环境 secrets、Edge Functions 和平台设置需另行恢复。

### 管理员和扩展兼容性

最初用另一名称的 bootstrap superuser 建库，执行原始 `GRANTED BY supabase_admin` 时触发 SQLSTATE 42501，整次事务回滚。解决方法是上述 `initdb -U supabase_admin`，保持 bootstrap OID 10，并仅处理重复的 CREATE ROLE 行；没有删除 GRANT 或降低权限检查。

较早镜像 `supabase/postgres:17.6.1.136` 的 pg_net 为 0.20.3，与源不一致；成功镜像 `17.6.1.178` 包含所需 0.20.4。还原前必须检查实际可用扩展版本，不能只看 PostgreSQL 大版本。以下是本次成功版本基线，未来备份应按其自身 manifest 重新核对：

| 扩展 | 源与还原版本 |
| --- | --- |
| pg_cron | 1.6.4 |
| pg_net | 0.20.4 |
| pg_stat_statements | 1.11 |
| pgcrypto | 1.3 |
| plpgsql | 1.0 |
| supabase_vault | 0.3.1 |
| uuid-ossp | 1.1 |

### 清理结果

本次专用 WSL `E2RestoreDrill-20261115` 已注销，虚拟磁盘、临时 SQL/gzip 和 GPG 工作目录已移除；再次核对 WSL 注册信息和路径确认不存在。原始下载的加密备份保留，SHA-256 与清理前一致。`cleanup-status.json` 的非敏感状态为：

```json
{
  "test_distro_removed": true,
  "virtual_disk_removed": true,
  "temporary_sql_removed": true,
  "temporary_gzip_removed": true,
  "gpg_workdir_removed": true,
  "original_encrypted_backup_preserved": true
}
```

未连接或修改正式数据库；真实备份、解密资料未上传到 GitHub、artifact 或 cache，业务记录和密钥未写入验收日志。普通文件删除不等同于取证级磁盘擦除。

## Edge Functions 源码恢复清单（2026-11-15 核对）

数据库备份不包含 Edge Functions。已逐一检查 Supabase 后台全部 8 个已部署函数及其源码文件，仓库来源如下。相对路径均以 `supabase/functions/` 为起点：

| 函数 | 仓库源码 / 后台对应关系 |
| --- | --- |
| e2-drive-photos | 同名目录 4 个文件；后台入口固定引用提交 `2ef3bf998b8418708d4fa699fcbe9dd487093c2e`，入口及其相对依赖与 main 一致 |
| e2-guest-intake | 同名目录 index.ts、handler.mjs；后台为合并入口，核对为相同源码（模块导出/导入及排版差异） |
| e2-inventory-refresh | 同名目录 index.ts、handler.mjs，与后台一致 |
| e2-invite-user | 同名目录 index.ts，与后台一致 |
| e2-mileage-evidence | 本次补入同名目录 index.ts、handler.mjs、image-validation.mjs；逐个与后台核对，统一换行后字节一致 |
| e2-translate-vehicle | 同名目录 index.ts、core.mjs、handler.mjs，与后台一致 |
| e2-vehicle-import | 同名目录 6 个文件及 e2-drive-photos/google.mjs；后台入口固定引用提交 `f12d3293e7374a3bc8c981261137474d4a70b66b`，入口及其相对依赖与 main 一致 |
| e2-viewing-notify | 同名目录 index.ts、handler.mjs；后台将这两个文件合并，源码逻辑一致，排版/模块入口不同 |

此次缺失的是 `e2-mileage-evidence`，现已补齐，8 个函数都有仓库源码。仅归档已部署源码和对应配置，没有重新部署或调用正式函数。里程函数的 `verify_jwt=false` 与后台现状一致；handler 自行验证 Auth 用户及数据库中的有效员工权限，不能移除这些验证。

里程函数依赖固定为 `@supabase/supabase-js@2.57.4`、`@imagemagick/magick-wasm@0.0.44`；恢复部署时须包含该依赖的 `magick.wasm`，并在隔离环境验证图像解码。源文件没有内嵌 key，运行时通过 `Deno.env.get` 获取配置。数据库中的相关 RPC/表/Storage bucket 也须先恢复。

发生灾难恢复时，使用仓库的对应函数目录和 `supabase/config.toml` 配置，在**明确选定的新测试/恢复项目**重新部署并验证权限与依赖。环境 secret 值、OAuth/SMTP、Telegram/Google 等服务配置仍由管理员单独保管和重新配置，不在 Git 或数据库备份中。此清单是本日状态，新增或修改函数时须同步入库，不能只在后台编辑。

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
