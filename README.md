# SEC Friendly API - 人性化的 SEC 财务数据接口

一个基于 Model Context Protocol (MCP) 的人性化 SEC EDGAR 财务数据 API 服务，提供简化的财务三表数据获取、多公司对比分析和财务指标计算功能。

## ✨ 主要特性

### 🔧 人性化 API 设计
- **简化数据获取**：按「最新一次」或「年度/季度」为单位，返回完整财务三表
- **内置指标计算**：自动计算常见指标（毛利率、净利率、ROE、ROA、流动比率等）
- **多公司对比**：支持一次请求同时获取多家公司数据并并排比较
- **统一参数与返回格式**：统一 ticker 或 CIK 输入，标准化输出字段名称

### 🛠️ 核心工具

1. **get-company-financials** - 获取公司财务三表数据
   - 支持最新或历史期间数据
   - 可选择特定报表（利润表、资产负债表、现金流量表）
   - 可计算财务指标

2. **get-company-metrics** - 获取公司财务指标
   - ROE、ROA、毛利率、净利率
   - 流动比率、负债权益比等

3. **compare-financials** - 多公司财务三表对比
   - 并行获取多家公司数据
   - 统一格式对比展示

4. **compare-metrics** - 多公司关键财务指标对比
   - 批量指标计算和对比
   - 支持自定义指标选择

## 🚀 快速开始

### 环境要求
- Node.js >= 18.0.0
- 有效的 SEC API 访问权限

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd sec-friendly-api

# 安装依赖
npm install

# 构建项目
npm run build
```

### 环境配置

创建 `.env` 文件并配置必要的环境变量：

```env
# SEC API Configuration
SEC_API_MAIL=your-email@company.com
SEC_API_COMPANY=Your Company Name
PORT=4000
```

**注意**：SEC API 要求提供有效的 User-Agent 信息，包括公司名称和联系邮箱。

### 运行模式

#### 1. SSE 模式（推荐，用于生产）

```bash
# 直接启动
npm start

# 使用 PM2 进程管理器
npm run pm2:start

# PM2 相关命令
npm run pm2:stop      # 停止服务
npm run pm2:restart   # 重启服务
npm run pm2:logs      # 查看日志
npm run pm2:monit     # 监控界面
npm run pm2:delete    # 删除进程
```

#### 2. Stdio 模式（用于调试和 inspector）

```bash
# 启动 stdio 模式
npm run start:stdio

# 开发模式（带重新编译）
npm run dev:stdio

# 使用 MCP Inspector 测试
npm run inspect
```

### 健康检查

SSE 模式启动后，可以访问：
- 健康检查：http://localhost:4000/health
- SSE 端点：http://localhost:4000/sse

## 🔧 在客户端中使用

### Claude Desktop 配置

SSE 模式配置（推荐）：

```json
{
  "mcpServers": {
    "sec-friendly-api": {
      "url": "http://localhost:4000/sse"
    }
  }
}
```

Stdio 模式配置：

```json
{
  "mcpServers": {
    "sec-friendly-api": {
      "command": "node",
      "args": ["/path/to/sec-friendly-api/dist/index.js", "--stdio"],
      "env": {
        "SEC_API_MAIL": "your-email@company.com",
        "SEC_API_COMPANY": "Your Company Name"
      }
    }
  }
}
```

### VS Code 配置

在 VS Code 中，将以下配置添加到用户设置的 `mcp.json` 文件中：

```json
{
  "servers": {
    "sec-friendly-api": {
      "command": "node",
      "args": ["/path/to/sec-friendly-api/dist/index.js", "--stdio"],
      "env": {
        "SEC_API_MAIL": "your-email@company.com",
        "SEC_API_COMPANY": "Your Company Name"
      }
    }
  }
}
```

## 🧪 测试工具

### MCP Inspector

使用官方 inspector 工具测试 MCP 服务器：

```bash
# 启动 inspector（会自动读取 mcp.json 配置）
npm run inspect

# 或者手动启动
npx @modelcontextprotocol/inspector --config mcp.json --server sec-friendly-api
```

Inspector 提供了一个 Web 界面来测试所有 MCP 工具和查看服务器状态。

## 📖 使用示例

### 获取苹果公司最新财务数据

```json
{
  "tool": "get-company-financials",
  "arguments": {
    "company": "0000320193",
    "period": "latest",
    "statements": "all",
    "metrics": true
  }
}
```

### 对比多家科技公司的关键指标

```json
{
  "tool": "compare-metrics",
  "arguments": {
    "companies": "0000320193,0000789019,0001652044",
    "period": "latest",
    "metrics": "roe,netMargin,grossMargin"
  }
}
```

### 获取特定公司的利润表数据

```json
{
  "tool": "get-company-financials",
  "arguments": {
    "company": "0000320193",
    "period": "2023",
    "statements": "income",
    "fields": "statements"
  }
}
```

## 📊 数据字段映射

该 API 将 SEC EDGAR XBRL 复杂的字段名映射为更友好的名称：

### 利润表（Income Statement）
- `revenue` - 营业收入
- `costOfRevenue` - 营业成本
- `grossProfit` - 毛利润
- `operatingIncome` - 营业利润
- `netIncome` - 净利润
- `epsBasic` - 基本每股收益
- `epsDiluted` - 稀释每股收益

### 资产负债表（Balance Sheet）
- `totalAssets` - 总资产
- `currentAssets` - 流动资产
- `cash` - 现金及现金等价物
- `totalLiabilities` - 总负债
- `currentLiabilities` - 流动负债
- `shareholdersEquity` - 股东权益

### 现金流量表（Cash Flow）
- `operatingCashFlow` - 经营活动现金流
- `capitalExpenditures` - 资本支出

### 财务指标（Calculated Metrics）
- `grossMargin` - 毛利率 (%)
- `netMargin` - 净利率 (%)
- `roe` - 净资产收益率 (%)
- `roa` - 总资产回报率 (%)
- `currentRatio` - 流动比率
- `debtToEquity` - 负债权益比

## 🔧 技术架构

- **MCP Server**：基于最新的 Model Context Protocol SDK (v1.7.0)
- **Transport**：支持 SSE 和 stdio 传输协议
- **数据源**：SEC EDGAR API (data.sec.gov)
- **语言**：TypeScript + Node.js
- **框架**：Express.js
- **进程管理**：PM2 支持

## 📁 项目结构

```
sec-friendly-api/
├── src/
│   └── index.ts          # 主应用文件
├── dist/                 # 编译输出
├── scripts/
│   └── start.sh         # PM2 启动脚本
├── logs/                # PM2 日志目录
├── mcp.json            # MCP Inspector 配置
├── .env                # 环境变量配置
└── README.md           # 项目文档
```

## 📝 API 设计原则

1. **直观命名**：以公司和对比为核心的 API 设计
2. **默认最新**：若未指定期间，默认返回最新报告期数据
3. **按需可选**：通过参数控制返回内容的详细程度
4. **轻量高效**：默认返回关键字段，可通过参数精细控制
5. **兼容底层**：内部调用 SEC 官方 API，确保数据准确性

## 🛠️ 开发模式

```bash
# 监听文件变化并重新编译
npm run watch

# 开发模式启动（SSE）
npm run dev

# 开发模式启动（stdio）
npm run dev:stdio
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改善这个项目！

## 📄 许可证

MIT License

## 📞 支持

如有问题或建议，请通过 Issue 联系我们。

---

**注意**：本项目遵循 SEC.gov 的隐私和安全政策。请确保合理使用 API，避免过于频繁的请求。