# CODEX 开发提示词包 + 分阶段验收检查点（PG 版）v1.0

> 适用对象：你在 CODEX 云端实现代码；你本地拉取后做验收。  
> 数据库：**PostgreSQL（PG）**（已确认）。  
> 原型/范围冻结：以《PRD_预决算报告智能生成系统_v1.0_原型冻结.md》为准（一期预算、二期决算预留口子；后台 IA=部门树+单位列表；纠错建议=B：可用于报告、仅审核是否入库）。  
> 重要约束：  
> - **Fatal 禁止生成**（容差 0.01 万元）。  
> - 报告生成时冻结 report_version，provenance 必须记录（archive / suggestion）。  
> - 管理员仅审核“是否入库（更新历史归档）”，不审核“本次报告是否可用”。  

---

## 0. CODEX 执行方式建议（强烈推荐）

### 推荐：每个 PR/阶段开一个**新任务（New task）**
原因：避免对话过长导致上下文污染、指令被覆盖、漏交付。  
每个任务开头都贴：本文件中该阶段的“提示词 + 验收清单”。

### 若你坚持“继续原任务对话（Continue）”
也可以，但务必在提示词开头强调：  
- “仅做本 PR 范围内变更，禁止顺手改别的模块”  
- “输出必须包含：变更文件清单、迁移脚本、测试用例、新增命令、回滚说明”

---

## 1. 本地验收基线（你拉到本地后统一这么验）

> 下面命令模板请按你们仓库实际脚本名称替换（例如 pnpm / npm / yarn）。

### 1.1 运行环境（建议）
- Node.js 20 LTS
- PostgreSQL 14+（或 Docker）
- 推荐：Docker Compose 提供本地 PG（避免污染你机器）

### 1.2 必备脚本（仓库需提供）
- `db:migrate`：执行迁移
- `db:rollback`：回滚最近一次迁移（至少支持开发环境）
- `test`：单测
- `lint`：静态检查
- `dev`：本地启动

### 1.3 Docker Compose（验收建议）
- 统一使用 `.env.local`（不提交）存储连接串，例如：
  - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/govbudget`

### 1.4 样例数据
一期至少需要能跑通 1 份样例 Excel：
- 单位口径：`002002-上海市普陀区民政局-人代会报表制作.xlsx`

---

## 2. 通用交付规范（每个 PR 必须满足）

CODEX 输出必须包含以下内容（缺一不可）：
1) **变更文件清单**（新增/修改/删除）
2) **数据库迁移**（含 Up/Down 或可回滚机制说明）
3) **新增/更新的测试用例**（至少单测；涉及 PDF/渲染的提供回归脚本）
4) **本地验收命令**（你复制即可跑）
5) **错误处理与返回码**：失败必须返回清晰错误（400/403/409/500 等）
6) **安全约束**：禁止动态拼 SQL；所有字段映射与查询必须走服务端白名单

---

## 3. 阶段化开发与验收

> 注：以下按 PR-01…PR-09 分解。你可以按此顺序推进。  
> 每个阶段给出：CODEX 提示词（可直接复制） + 验收检查点（DoD） + 你本地验收步骤。

---

# PR-01：PG Schema + 迁移体系 + 最小鉴权骨架

## CODEX 提示词（建议 New task）
你正在一个全新任务中实现 PR-01。

目标：为“预决算报告智能生成系统（预算一期）”建立 PostgreSQL 数据库 schema 与迁移体系，并提供最小鉴权/权限模型骨架（不做完整 UI）。

约束：
- 数据库必须为 PostgreSQL。
- 迁移必须可回滚（至少开发环境）。
- 表设计必须覆盖：组织（部门/单位）、用户与角色、上传/解析证据链、预算 facts、草稿、校验、报告版本、历史归档、纠错建议、审计日志。

交付：
1) 迁移脚本（Up/Down）与迁移运行命令（db:migrate/db:rollback）。
2) 最小的数据访问层（Repository/DAO）示例：读取部门树聚合、读取单位列表分页。
3) 单测：至少验证迁移后关键表存在、关键索引存在、约束生效（unique / foreign keys）。
4) README（或 docs）新增：本地启动 PG、执行迁移、运行测试的命令。

表建议（必须至少包含）：
- org_department, org_unit
- users, roles, user_roles
- base_info_version
- history_actuals, history_import_batch
- upload_job
- parsed_cells
- facts_budget
- report_draft, report_version
- validation_issues
- manual_inputs
- line_items_reason
- correction_suggestion
- audit_log

请输出：变更文件清单 + 迁移文件内容路径 + 本地验收命令。

## 验收检查点（DoD）
- [ ] `db:migrate` 可在空库成功执行
- [ ] `db:rollback` 能回滚最近一次迁移（至少开发环境）
- [ ] 关键 UNIQUE 约束生效（例如 `org_unit(code)`、`base_info_version(unit_id, year, version_no)`、`correction_suggestion(id)` 等）
- [ ] 外键关系正确（unit → department、draft → unit、version → draft/upload 等）
- [ ] 有最小查询样例：部门树聚合、单位分页
- [ ] 单测通过：`npm test` / `pnpm test`
- [ ] 文档：提供 docker compose 或 PG 连接方式说明

## 你本地验收步骤
1) 启动 PG（docker compose up -d）
2) 创建空库（如未自动创建）
3) 执行迁移：`pnpm db:migrate`
4) 运行单测：`pnpm test`
5) 回滚一次：`pnpm db:rollback`（确认无报错）

---

# PR-02：Excel 上传与解析入库（upload_job + parsed_cells + facts_budget + draft）

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-02。

目标：实现“上传单个 Excel（区平台导出）→ 创建 upload_job → 解析 sheets/cells → 写入 parsed_cells（证据链）→ 抽取 facts_budget（按白名单映射）→ 生成 report_draft”。

范围：
- 支持至少 1 份样例（单位口径）完整跑通。
- 解析必须保存证据定位（sheet_name、cell_address、anchor、raw_value、normalized_value）。
- facts_budget 字段抽取必须通过服务端白名单映射（禁止动态配置执行 SQL）。
- 报告草稿 report_draft 可只存关键字段引用与状态（先不生成 PDF）。

交付：
1) API：
   - POST /api/uploads (multipart)
   - POST /api/uploads/{id}/parse
   - GET /api/drafts/{id}
2) 解析模块：可扩展到部门口径（先把结构预留好）。
3) 测试：对样例 Excel 的“关键字段抽取”断言（至少 10 个字段），并断言 parsed_cells 有 evidence。
4) 错误处理：上传格式错误、缺 sheet、解析失败需返回清晰 400/422。

请输出：文件清单 + API 示例 curl + 本地验收命令。

## 验收检查点（DoD）
- [ ] 能上传单个 Excel 并生成 upload_job
- [ ] parse 后能写入 parsed_cells（含 sheet/cell/anchor）
- [ ] parse 后能写入 facts_budget（按映射表抽取）
- [ ] parse 后能生成 report_draft（关联 unit/year/template_version）
- [ ] 单测：对样例 Excel 至少 10 个字段断言通过
- [ ] 错误场景（缺 sheet、错误格式）有明确 4xx

## 你本地验收步骤
1) `pnpm dev`
2) curl 上传样例 Excel → 得到 upload_id
3) curl 调 parse → 得到 draft_id
4) GET draft 查看结构
5) 跑单测：`pnpm test`

---

# PR-03：校验引擎（容差 0.01 万元 + Fatal gating + 证据定位）

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-03。

目标：实现预算一期的校验引擎：
- 表内/表间勾稽校验（容差 0.01 万元）
- 分级：Fatal / Warning / Suggest
- evidence：必须定位到 sheet/cell/anchor（至少定位到来源 cells）
- Fatal>0 时：生成报告 API 必须返回 400（禁止生成）

交付：
1) API：POST /api/drafts/{id}/validate → 返回 validation_issues 并写库
2) 至少实现 6 条规则（含 2 条 Fatal）：
   - 收支总表：收入总计 vs 支出总计
   - 财政拨款收支总表：拨款收入 vs 拨款支出
   - 合计 = 明细之和（任取 1-2 张表）
   - 必填占位符缺失（可模拟）
   - 文本/数字一致性提示（Warning）
3) 单测：
   - 容差边界 0.009/0.011 万元
   - Fatal gating：Fatal>0 时 generate 返回 400

请输出：规则列表、rule_id 约定、测试用例、验收命令。

## 验收检查点（DoD）
- [ ] validate API 可用并落库 validation_issues
- [ ] 容差边界测试通过
- [ ] Fatal gating 生效（generate 400）
- [ ] 每条 issue 具备证据定位字段（sheet/cell/anchor）
- [ ] 规则可配置口子预留（不要求一期做后台 UI）

---

# PR-04：逐条列示原因填报（line_items_reason）+ 整节预览文本生成

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-04。

目标：实现“财政拨款支出主要内容”逐条列示的编辑与校验基础：
- 存储结构：line_items_reason（多条，排序，绑定 draft_id）
- 支持批量更新原因
- “原因必填阈值”规则（例如变动>=10% 或 0→非0 必填）
- 提供整节预览文本（仅用于预览，不做最终排版）

交付：
1) API：
   - GET /api/drafts/{id}/line-items
   - PATCH /api/drafts/{id}/line-items (bulk)
2) 校验联动：validate 时若必填原因缺失 → Fatal（按配置）
3) 单测：必填/不必填场景覆盖

## 验收检查点（DoD）
- [ ] 可批量写入原因并持久化
- [ ] validate 联动：缺失原因触发 Fatal
- [ ] 预览文本 API/函数可生成（至少 3 条拼接）
- [ ] 单测覆盖阈值边界

---

# PR-05：管理端基础（部门树 + 单位列表）+ 状态徽标聚合 + 可交付的 UI 效果图

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-05。

目标：实现后台维护端的核心查询与**最小可用 UI**（用于原型定版与后续开发对齐）：
- 左侧：部门树（含单位数、待办数聚合）
- 中间：单位列表（分页 + 搜索 + 快速筛选）
- 右侧：单位详情（基础信息版本状态 + 历史归档状态 + 纠错建议概览）

UI 交互与体验（必须考虑“部门约 60+、单位约 300+”的可用性）：
- 顶部全局搜索：支持按单位名称/代码模糊搜索，输入即过滤（debounce）
- 快速筛选（至少 2 个）：
  1) 缺历史归档（history_actuals 缺失）
  2) 有待审纠错建议（pending_suggestions > 0）
- 树节点支持展开/折叠；对长列表建议做虚拟滚动或分页加载（允许先用分页 + 懒加载）
- 列表列建议固定：单位名称、单位代码、归档状态徽标、待审建议数徽标、基础信息缺失徽标、最后更新时间

状态徽标字段（至少包含）：
- 历史归档：缺失/已入库/已锁定（lock）
- 待审纠错建议数量（pending_count）
- 基础信息是否缺失（functions/org/glossary 是否有有效版本）
-（可选）最近一次 draft/report_version 状态（仅展示，不做完整流程）

交付：
1) API：
   - GET /api/admin/departments?year=
   - GET /api/admin/units?department_id=&q=&filter=&page=
   - GET /api/admin/units/{unit_id}
   - （为 UI 徽标聚合所需，可新增）GET /api/admin/units/{unit_id}/badges?year=
2) 最小 UI（强制交付，不要只做 API）：
   - /admin 路由页：部门树 + 单位列表 + 详情三栏布局（与冻结 IA 一致）
   - UI 可使用 Mock 数据兜底：当后端未就绪时，仍可通过 fixtures 展示页面结构（但最终必须能接真实 API）
3) “效果图”交付（强制）：
   - 提供一条命令生成 3 张 PNG 截图（用于你们内部评审定版）：
     - admin-overview.png（默认视图：部门树+列表+空详情）
     - admin-unit-detail.png（选中某单位：详情含徽标/版本状态）
     - admin-filter-pending.png（启用“有待审纠错建议”筛选后的列表）
   - 截图可用 Playwright（推荐）或等价方案；截图文件输出到 `artifacts/ui/` 目录。
4) 单测（至少 2 类）：
   - API：聚合统计正确、分页正确（含边界：空部门、最后一页）
   - UI：截图脚本生成文件存在且文件大小>0（可用 Node 脚本断言；无需像素对比）

请输出：变更文件清单 + API 示例 curl + 截图命令 + 本地验收命令。

## 验收检查点（DoD）
- [ ] 部门树返回聚合统计（单位数/待办数）
- [ ] 单位列表支持分页与搜索（模糊匹配）
- [ ] 快速筛选至少支持：缺历史归档 / 有待审建议
- [ ] 单位详情页能展示：基础信息版本状态、归档状态、待审建议数（即使先用 mock）
- [ ] 提供 `pnpm ui:screenshot`（或等价）命令，能生成 3 张 PNG 到 `artifacts/ui/`
- [ ] 单测覆盖聚合与分页；并覆盖“截图文件生成”断言

## 你本地验收步骤
1) `docker compose up -d`（启动 PG）
2) `pnpm i`
3) `pnpm db:migrate`
4) （如有）`pnpm db:seed`（写入用于演示的部门/单位/徽标数据）
5) 启动：`pnpm dev`
6) 访问：`http://localhost:xxxx/admin`（确认三栏布局、筛选与搜索可用）
7) 生成效果图：`pnpm ui:screenshot`（检查 `artifacts/ui/` 下 3 张 PNG）
8) 运行单测：`pnpm test`

---

# PR-06：历史决算归档（上年执行数来源）导入 + 锁定

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-06。

目标：建立“历史决算归档库（history_actuals）”：
- 供预算报告引用“上年执行数/决算数”
- 一期优先支持 Excel 导入（PDF 解析留到二期）
- 支持导入批次 history_import_batch、状态、错误明细
- 支持锁定（lock）防止随意改动

交付：
1) API：
   - POST /api/admin/history/import (multipart excel)
   - POST /api/admin/history/batch/{batch_id}/lock
   - GET  /api/history/lookup?unit_id=&year=&keys=...（供填报端取数）
2) 校验：导入时做基本一致性校验（可仅做结构校验+必填字段）
3) 单测：导入后 lookup 能正确取数；锁定后拒绝直接修改（409/403）

## 验收检查点（DoD）
- [ ] Excel 导入创建 batch 并写入 history_actuals
- [ ] lookup 可返回上年执行数（至少 10 个键）
- [ ] lock 生效（锁定后不可直接覆盖归档）
- [ ] 单测覆盖导入/lookup/lock

---

# PR-07：纠错建议（B）——建议值用于报告 + 入库审核队列

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-07。

目标：实现纠错建议 B 模式（已冻结）：
- 单位提交“建议值”，草稿/报告用建议值（立即生效于本次 draft）
- 管理端仅审核是否写入 history_actuals（入库生效），不影响本次报告导出
- report_version 需要记录 provenance（archive/suggestion + suggestion_status）

交付：
1) 填报端 API：
   - POST /api/drafts/{draft_id}/suggestions（提交建议值：key、old_value、suggest_value、reason、attachments 可选）
   - GET  /api/drafts/{draft_id}/suggestions
2) 管理端队列 API：
   - GET  /api/admin/suggestions?status=pending&year=&department_id=
   - POST /api/admin/suggestions/{id}/approve（写入 history_actuals）
   - POST /api/admin/suggestions/{id}/reject
3) 规则：
   - approve 后更新 history_actuals；reject 不更新
   - 不回溯修改已生成的 report_version
4) 单测：
   - suggestion 生效：draft 取数优先级（suggestion > archive）
   - approve 更新归档；reject 不更新
   - report_version 冻结 provenance

## 验收检查点（DoD）
- [ ] 单位提交建议值后，draft 取数优先使用建议值
- [ ] 管理端待审队列可按部门筛选与分页
- [ ] approve 将建议写入历史归档（入库生效）
- [ ] reject 不改变历史归档
- [ ] report_version 记录 provenance，且不会被 approve 回溯修改
- [ ] 单测覆盖优先级与入库行为

---

# PR-08：PDF 像素级渲染 + 填充后 Excel 导出 + 黄金样回归

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-08。

目标：实现导出能力：
- 生成 PDF（像素级一致）
- 导出填充后 Excel
- 引入黄金样回归测试（同模板+同输入 → 输出稳定）

交付：
1) API：
   - POST /api/drafts/{id}/generate（Fatal>0 返回 400）
   - GET  /api/report_versions/{id}/download/pdf
   - GET  /api/report_versions/{id}/download/excel
2) PDF 渲染：
   - 方案必须保证字体/字号/分页稳定（嵌入字体或服务端固定字体）
3) 测试：
   - golden：PDF hash 或像素 diff（允许阈值）
   - 生成后 report_version 冻结（绑定模板版本、draft 快照哈希）

## 验收检查点（DoD）
- [ ] Fatal gating：Fatal>0 禁止 generate
- [ ] PDF 可下载且版式符合模板要求（抽样比对）
- [ ] Excel 可下载且含生成水印/哈希/时间（推荐）
- [ ] golden 回归脚本可跑通（CI 可用）

---

# PR-09：二期预留口子（不实现决算）

## CODEX 提示词（New task）
你正在一个全新任务中实现 PR-09。

目标：仅做“二期决算”预留口子：
- 数据模型扩展：stage（BUDGET/FINAL）、决算表码预留
- API 预留（/final/*）仅返回 501 或 feature flag 关闭
- 文档说明二期范围

## 验收检查点（DoD）
- [ ] schema 支持 stage 字段或等效机制
- [ ] 预留 API 不影响一期功能
- [ ] 文档明确二期再实现

---

## 4. 你本地“拉代码验收”标准操作流程（建议固定）

1) 拉取最新代码
2) `docker compose up -d`（启动 PG）
3) `pnpm i`
4) `pnpm db:migrate`
5) `pnpm test`
6) 按 PR 的 curl/脚本跑一遍核心流程（upload → parse → validate → generate）
7) 验收通过后打 tag（例如 `v1.0-pr07-pass`）

---

## 5. 常见验收失败点（提前规避）

- 迁移不可回滚（开发环境调试非常痛苦）
- 解析只抽 facts 不存 evidence（后续无法解释“为什么是这个数”）
- 动态 SQL 拼接（安全红线）
- 缺少容差边界测试（0.009/0.011）
- report_version 未冻结 provenance（后续入库审核会污染历史版本）

---

## 6. 你可以直接复制给 CODEX 的“总控提示词”（每个 PR 头部可复用）

你在 CODEX 云端为本仓库实现 **[填写 PR 编号]**。请遵守：
- PostgreSQL 为唯一数据库；
- 禁止动态 SQL 拼接，所有查询与字段映射必须白名单；
- 必须新增/更新测试用例；
- 输出必须包含：变更文件清单、验收命令、测试命令、回滚说明；
- 仅做本 PR 范围内变更，不要顺手重构其它模块；
- 如果发现需求不明确，先提出最少量澄清，并给出默认实现（不要阻塞）。

