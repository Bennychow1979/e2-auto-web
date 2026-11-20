# Codex 修复交接 — rental plate move v3（2026-11-20）

在 Claude v2（基准 74631be8）上修复以下四点：

1. `cancelEditHand` 仅还原当前交接行；取消及无改动保存不会清空付款、备注等其他草稿。
2. 同一个未发布 migration 除新增 `rental_move_plate` 外，还 `CREATE OR REPLACE rental_save`：拒绝对 MOVED 记录的任何普通保存，以及伪造 MOVED/moved_to。原函数签名、鉴权、revision、审计和 grants 保留。
3. 普通新增/保存及搬移统一以去除分隔符、转大写后的车牌检查重复。两个 RPC 都先取得同一把事务锁再取 id/row 锁，防止不同拼写并发插入。前端复用 plateKey 校验。仍允许同一车辆仅更正车牌格式。
4. CARSOME check_note 和 pay_reference 在两个保存路径共用；搬移时缺 Ref-2 会写提醒，补齐时会清除自动提醒，人工备注保留。

不改表结构，不改已发布的旧 migration，不迁移现有车辆数据。新增 migration 的职责已超出 Claude v2 的“只加函数”：也替换现有 rental_save；部署时必须使用本修订版完整 SQL。

测试增加：MOVED 合并/覆盖/付款追加拒绝、伪造搬移标记拒绝、车牌格式重复、同车格式更正、插入后故障导致数据与审计一起回滚、函数权限、取消/无改动保存保留其他草稿、跨区块保存恢复交接编辑，以及 CARSOME 提醒生成/清除与付款 reference。

JS 页面及数据模块都更新版本参数为 move-plate-2，防止缓存旧数据模块。
库存浏览器测试在 Windows 使用 Edge；其他平台保持默认 Chromium。

数据库已于 2026-11-20 23:15 MYT 部署；migration 文件名对齐数据库实际版本 `20261120151522_rental_move_plate.sql`。不要再运行 Claude 原版 `20261120090000` SQL。

部署次序：先 migration，再页面。线上版本、部署记录和最终测试结果见交付包 DEPLOYMENT.json。

以下保留 Claude v2 原说明作为来源记录；与上面的 v3 修正冲突时以上面为准。

---

# 改动说明 v2：修正车牌（单一事务 RPC）+ 交接记录可编辑
基准：74631be8（含 PR #64/#65/#66）。日期：20/11/2026。作者：Claude。
未部署、未改正式网站或数据库。本次**新增一个 migration**（见下），需单独评审。

## 对 Codex 四点的回应
| # | 问题 | 处理 |
|---|---|---|
| 1 | 改车牌可能留下两份有效记录 | 改为服务端 RPC `rental_move_plate`，新建新记录 + 旧记录标 MOVED 在**同一个函数调用（同一事务）**完成；revision 不符、新车牌已存在、旧记录已搬移、id 不合法任一情况整体回滚。不再有客户端两步写入。表单其他栏位改动通过 `p_patch` 在同一事务套用。 |
| 2 | 同时编辑两条交接写错记录 | 输入框 id 改为按行 `eh_<idx>_<field>`，保存只从该行元素读取；同一时间只允许一条在编辑，点第二条会提示先保存/取消第一条。 |
| 3 | 自动刷新清掉行内编辑 | 打开编辑器时即把该行所有栏位登记为 panelDrafts（不用等打字），`canRefreshDetail()` 因此阻止 15 秒刷新与 Realtime 重绘；其他区块保存后的草稿还原流程会重新打开编辑行并回填（与 `vr_` 作废框同一机制）。取消编辑清掉该行草稿。 |
| 4 | 改 Upfront 后汇总不一致 | `actual_rent` 只跟随「最后一条未作废的租出」：编辑该条的 upfront 时同步更新 `actual_rent`（列表、标题汇总一起变）；编辑历史交接不动汇总。 |

## 数据库改动（需单独评审）
`supabase/migrations/20261120090000_rental_move_plate.sql`
- `rental_move_plate(p_old_id text, p_new_id text, p_new_plate text, p_revision bigint, p_patch jsonb default '{}')` → jsonb `{moved_from, record}`。
- security definer、`search_path=''`；先 `rental_ok()`；`revoke from public, anon`，仅 `authenticated` 可执行（与 rental_save 一致）。
- 校验：id 格式 `^[A-Z0-9][A-Z0-9-]{0,39}$`、新旧 id 不同、plate 与 id 一致、patch 不得含 plate/payments/handovers/history/car_status/moved_to。
- 以固定顺序对两个 id 取 advisory lock（避免两个并发搬移互相死锁），`for update` 读旧记录，revision 不符 → 40001，新 id 已存在 → 23505。
- 新记录 history 由服务端追加（by = `rental_identity()` 显示名，by_id = auth.uid()）；`pay_reference` 等于旧车牌时同步改成新车牌。
- 审计触发器自动记录 INSERT(new) + UPDATE(old)，actor 为 auth.uid()；不读任何请求头。
- `rental_save` 不变，仍拒绝改 plate；现有三份 migration 未动。

## 文件
| 文件 | 改动 |
|---|---|
| supabase/migrations/20261120090000_rental_move_plate.sql | 新增 RPC（见上）。 |
| supabase/tests/rental.mjs | 载入新 migration；新增 `rental_move_plate` 测试：各角色拒绝、stale revision、同 id、非法 id、plate/id 不符、patch 禁改栏位、不存在、新 id 已存在 → 每一种失败后断言表内容完全不变；成功搬移后断言新旧记录、history 操作者、pay_reference、审计 3 行、已搬移不可再搬、rental_save 仍拒改 plate。`db.close()` 移到文件末尾。 |
| rental-data.mjs | 新增 `movePlate()`（走新 RPC，带 revision 检查）。 |
| rental.js | saveContract：车牌改动改走 `db.movePlate`，其余栏位作为 patch；MOVED 记录从 rows 过滤；搬移后自动打开新记录；validate 车牌重复检查排除自己并显示搬移提示；`editHandover/askEditHand/saveEditHand/cancelEditHand`（按行 id、单一编辑、草稿登记、actual_rent 规则）；handoverRow 编辑按钮与「已修改…原本」提示；草稿还原支持 `eh_`；gate 清 `__pendingOpen`。 |
| rental.html | `rental.js?v=move-plate-1`。 |
| tests/fixtures/rental-sdk.mjs | 模拟 `rental_move_plate`（含 revision/dup/MOVED 检查、原子语义）；`conflict()` 作用于未搬移记录；假资料补齐编辑表单必填栏位。 |
| tests/rental-browser.mjs | Super Admin 流程新增回归：拉回 + 第二次租出；同时编辑两条被拒；打开编辑后立即 Realtime + 16 秒刷新两次，输入保留；改历史交接 upfront 汇总不变；改当前租出 upfront 汇总与列表更新；取消/无改动；搬移在 revision 冲突时失败且**无任何改动、无重复记录**，刷新后重试成功，旧记录 MOVED 并从列表消失，新记录自动打开。后续步骤改为不依赖固定 DEMO1。 |
| docs/rental-tracker.md | 新增说明。 |

## 测试结果（Node v22.23.4，Playwright 1.63 + Chromium，@electric-sql/pglite 0.3.14，交接包内）
- `node supabase/tests/rental.mjs` → PASS（原有 + rental_move_plate）
- `node tests/rental-browser.mjs` → PASS（含上述新断言）
- `node tests/rental-audit-browser.mjs` → PASS
- `node tests/rental-stock-browser.mjs` → PASS
- `node --test tests/rental-audit-view.mjs tests/rental-stock.mjs` → 6 pass
- `npm run check` 需仓库环境，请在仓库内执行。

## 上线顺序
1. 先在 Supabase 执行新 migration（只新增函数，不动表）。
2. 再发布 rental.js / rental-data.mjs / rental.html。顺序反了的话，改车牌会报 RPC 不存在，其他功能不受影响。
