# 预决算报告智能生成系统（PR-01）

本仓库仅实现 PR-01：PostgreSQL Schema + 迁移体系 + 最小鉴权骨架。

## 环境准备

- Node.js 20+
- PostgreSQL 14+（或 Docker）

## 本地启动 PostgreSQL（Docker）

```bash
docker compose up -d
```

## 配置

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

## 安装依赖

```bash
npm install
```

## 迁移

```bash
npm run db:migrate
```

回滚最近一次迁移：

```bash
npm run db:rollback
```

查看迁移状态：

```bash
npm run db:status
```

## 启动服务

```bash
npm run dev
```

## 测试

```bash
npm test
```

### 黄金样回归

```bash
pnpm golden:update
pnpm golden:check
```

黄金样输出目录：`artifacts/golden/`。

## API 最小骨架

- `GET /api/health`：公开健康检查
- `POST /api/auth/login`：登录（返回 JWT）
- `GET /api/auth/me`：需要登录
- `GET /api/admin/_demo/departments`：需 `admin`/`maintainer`
- `GET /api/admin/_demo/units`：需 `admin`/`maintainer`
- `GET /api/admin/departments?year=`：管理端部门树与聚合统计
- `GET /api/admin/units?department_id=&q=&filter=&page=&pageSize=&year=`：管理端单位列表
- `GET /api/admin/units/:unitId?year=`：管理端单位详情
- `GET /api/admin/units/:unitId/badges?year=`：管理端单位徽标聚合
- `POST /api/drafts/:id/generate`：生成报告版本（Fatal 禁止生成）
- `GET /api/report_versions/:id/download/pdf`：下载 PDF
- `GET /api/report_versions/:id/download/excel`：下载 Excel
- `GET /api/final/health`：二期决算预留接口（始终 501）

## PR-09（二期预留口子）

当前仅实现一期预算逻辑；二期决算相关能力（解析、校验、导出、预算-决算对比）暂未实现。为二期预留以下口子：

- 数据模型新增 `stage` 字段（`BUDGET`/`FINAL`），预算数据默认 `BUDGET`，历史决算归档默认 `FINAL`。
- 决算表码与解析映射仅保留空的常量定义（见 `src/services/finalMapping.js`），不实现决算解析逻辑。
- 新增 `/api/final/*` 路由，默认返回 `501 NOT_IMPLEMENTED`。可通过 `FINAL_ENABLED=false` 进行 feature flag 关闭控制，但即使启用也仍返回 501，等待二期实现。

## 管理端 UI（PR-05）

- `/admin`：管理端部门树 + 单位列表 + 详情三栏布局
- `/demo/ui`：工作台演示页（客户输入界面）

开发模式启动 UI：

```bash
npm run ui:dev
```

生成管理端截图：

```bash
npm run ui:screenshot
```

## 错误处理约定

所有错误返回 JSON：

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable message"
}
```

- 未登录：`401 UNAUTHORIZED`
- 权限不足：`403 FORBIDDEN`
- 参数错误：`400 VALIDATION_ERROR`

## 安全与查询约束

- 所有 SQL 通过参数化执行。
- 排序字段通过服务端白名单映射（见 `src/repositories/orgRepository.js`）。
- 禁止动态拼接表名/字段名/where 片段。
