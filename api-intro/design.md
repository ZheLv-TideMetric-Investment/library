## SEC EDGAR Human‑Friendly API Design Report (v0.1)

### 1. Introduction

提供一组面向最终用户（分析师、开发者、量化研究员）的 RESTful 风格接口，隐藏底层 SEC EDGAR API 的复杂性，能够方便地获取并对比公司财报数据，以及计算常用的财务指标。

### 2. 目标

* **简化数据获取**：按「最新一次」或「年度/季度」为单位，返回完整财务三表（资产负债表、利润表、现金流量表）。
* **内置指标计算**：自动计算常见指标（毛利率、净利率、ROE、ROA、流动比率等），无需二次开发。
* **多公司对比**：支持一次请求同时获取多家公司数据并并排比较。
* **统一参数与返回格式**：统一 `ticker`（或 `cik`）输入，标准化输出字段名称。

### 3. 设计原则

1. **直观命名**：资源路径以 `companies` 和 `compare` 为主干，动词最少，侧重资源。
2. **默认最新**：若未指定 `period`（或 `year` / `quarter`），默认返回最新报告期数据。
3. **按需可选**：通过查询参数开启/关闭指标计算、选择只要某一张表或某些指标。
4. **轻量高效**：默认只返回关键字段，可通过 `fields` 参数精细筛选。
5. **兼容底层**：内部依旧调用 SEC 官方 API，并缓存结果减少调用量。

### 4. 通用参数

| 参数           | 类型     | 默认       | 说明                                         |
| ------------ | ------ | -------- | ------------------------------------------ |
| `ticker`     | string | —        | 公司交易代码（如 `AAPL`），可与 `cik` 二选一              |
| `cik`        | string | —        | SEC CIK 编号（如 `0000320193`），可与 `ticker` 二选一 |
| `period`     | string | `latest` | 报告期：`latest` / `YYYY` / `YYYY-Q#`          |
| `statements` | string | `all`    | 要返回的表：`income`、`balance`、`cashflow`、`all`  |
| `metrics`    | bool   | `false`  | 是否自动计算并附带常用财务指标                            |
| `fields`     | string | —        | 逗号分隔的字段名列表，用于精简返回                          |

### 5. 核心端点设计及使用逻辑

#### 5.1 获取公司财务三表

```
GET /api/v1/companies/{ticker or cik}/financials
```

**Query**: `period`, `statements`, `metrics`, `fields`

**Backend 调用流程**：

1. **CIK 标准化**：若前端传入 `ticker`，内部先通过封装的股票代码映射服务或调用 `/submissions` API 获取对应 `cik`。
2. **获取提交历史**：调用 `GET https://data.sec.gov/submissions/CIK{cik}.json`，从其中 `filings.recent[0]` 读取最新报告的 `accessionNumber` 和 `reportDate`。
3. **获取 XBRL 财务数据**：调用 `GET https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`，在返回的 `facts["us-gaap"]` 中按 `period`（年度/季度）过滤并聚合以下科目：

   * 利润表：`RevenueFromContractWithCustomerExcludingAssessedTax`, `CostOfRevenue`, `GrossProfit`, `NetIncomeLoss`, …
   * 资产负债表：`Assets`, `Liabilities`, `StockholdersEquity`, …
   * 现金流量表：`OperatingCashFlow`, `CapitalExpenditures`, …
4. **字段映射与单位转换**：将 XBRL 单位（如 `USD`、`USD-per-shares`）中的数值提取为纯数字，并将原始标签映射为简化键名（如 `revenue`, `netIncome`）。
5. **指标计算（可选）**：若 `metrics=true`，基于提取的三表数据调用本地计算模块（毛利率、ROA、ROE 等）。
6. **数据组装**：按照设计返回格式，将 `ticker`, `cik`, `period`, `statements`、`metrics` 等字段组装成 JSON。

#### 5.2 获取公司财务指标

```
GET /api/v1/companies/{ticker or cik}/metrics
```

**Query**: `period`, `metrics`（逗号分隔指定哪些指标）

**Backend 调用流程**：
1-2. 同 5.1 步骤 1-4，获取对应期的三表数据。
3\. **选择指标**：根据 `metrics` 列表或默认指标集，从本地指标计算引擎中依次调用（如 `calculateROE(data)`, `calculateDebtToEquity(data)`）。
4\. **返回结果**：只返回 `ticker`, `period`, 和请求的指标键值对。

#### 5.3 多公司对比：财务三表

```
GET /api/v1/compare/financials
```

**Query**: `tickers=AAPL,MSFT,GOOG`, `period=latest`, `statements=income,balance`, `metrics=true`

**Backend 调用流程**：

1. **并行获取**：对 `tickers` 列表并行执行 5.1 中的核心流程（步骤 1-4），批量获取每家公司的三表数据。
2. **批量指标计算**：若 `metrics=true`，并行调用指标计算模块。
3. **汇总列表**：将多家公司结果汇总到数组 `companies` 中，并附带相同 `period`。

#### 5.4 多公司对比：关键指标

```
GET /api/v1/compare/metrics
```

**Query**: `tickers=…`, `period=…`, `metrics=roe,netMargin`

**Backend 调用流程**：

1. **并行获取指标**：对每个 `ticker` 串行或并行调用 5.2 接口内部逻辑，返回指定期和指标列表。
2. **组织数据**：提取每家公司返回的指标键值，并组合为 `{ ticker, ...metrics }`。
3. **返回**：包含 `period`, `metrics`, 和 `values`（各公司指标数组）。

### 6. 错误处理

错误处理

* **400 Bad Request**：参数校验失败（如不合法的 `period` 值）。
* **404 Not Found**：未找到公司或报告期数据。
* **500 Internal Error**：后端调用 SEC 接口失败或缓存故障。

### 7. 认证与限流

* 客户端**无需**携带 SEC `User-Agent`，由服务端统一注入。
* 建议内部限流：**≤ 5 req/sec** per client。

### 8. 下一步

1. 调整字段列表：根据用户反馈，定制默认/可选字段。
2. 明确缓存策略：内存 vs Redis、TTL 大小、主动更新机制。
3. 开始编写示例代码与集成测试。

---

### 9. MCP 工具封装与对外服务

为了将上述 RESTful API 以 MCP 工具形式对外暴露，我们将：

1. **引入 MCP Server**：在 `McpServer` 实例中，依次注册每个核心端点为 `tool` 或 `resource`：

   * `/companies/{ticker}/financials` 对应 `get-company-financials` 工具；
   * `/companies/{ticker}/metrics` 对应 `get-company-metrics` 工具；
   * `/compare/financials` 对应 `compare-financials` 工具；
   * `/compare/metrics` 对应 `compare-metrics` 工具。
2. **定义 Zod 校验 schema**：为每个 MCP `tool` 定义输入参数的 `zod` schema，与 RESTful Query 参数保持一致。
3. **工具实现逻辑**：在每个 `tool` 的 handler 中复用上述后端调用流程（步骤 1-6 / 1-4 / 并行调用等），并将最终 JSON 通过 `content: [{ type: 'application/json', blob: JSON.stringify(...) }]` 返回给调用者。
4. **注册为 resource（可选）**：对多层级 URI（如 `/companies/{ticker}/documents`）可使用 `server.resource` 以文件系统风格组织。
5. **SSE 支持**：通过 `SSEServerTransport` 支持长连接推送，例如当监测某家公司财报更新时主动推送最新 `financials`。
6. **启动与健康检查**：在 `app.listen(PORT)` 后，确保 `/health` 端点返回 `{ status: 'ok' }`，并在 MCP Server 初始化时调用 `connect(transport)`。

```ts
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { HttpServerTransport } from '@modelcontextprotocol/sdk/server/http.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

// 创建 Express 应用
const app = express();
app.use(express.json());

// 初始化 MCP Server
const server = new McpServer({
  name: 'sec-friendly',
  version: '0.1.0',
  description: 'Human-friendly SEC API via MCP'
});

// 注册工具示例：获取公司三表并计算指标
server.tool(
  'get-company-financials',
  '获取公司三表并计算指标',
  {
    ticker: z.string().optional(),
    cik: z.string().optional(),
    period: z.string().default('latest'),
    statements: z.string().default('all'),
    metrics: z.boolean().default(false),
    fields: z.string().optional()
  },
  async params => {
    const data = await fetchFinancials(params); // 内部复用前述流程
    return { content: [{ type: 'application/json', blob: JSON.stringify(data) }] };
  }
);

// 其他 tools 注册略...

// 使用 HttpServerTransport 在 Express 上暴露 MCP API
const httpTransport = new HttpServerTransport({
  // 指定服务根 URL（客户端连接地址）
  url: `http://localhost:${process.env.PORT || 4000}/mcp`,  
  // 路径前缀
  path: '/mcp'
});
await server.connect(httpTransport);
app.use(httpTransport.router); // 将 MCP 路由挂载到 Express

// 可选：也可使用 SSE 长连接推送
app.get('/sse', (req, res) => {
  const sseTransport = new SSEServerTransport('/sse', res);
  server.connect(sseTransport);
});

// 健康检查
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// 启动服务
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SEC MCP Server listening on http://localhost:${PORT}`);
});
```

**下一步**：参考 SEC 官方文档与 MCP SDK 使用示例，完善各工具的错误处理、并发控制和缓存中间件。
