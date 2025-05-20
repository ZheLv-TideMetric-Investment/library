# SEC MCP Server

这是一个基于 MCP（Model Context Protocol）的 SEC API 服务端项目，提供访问 SEC EDGAR 数据库的接口，包括公司提交历史查询、公司 XBRL 数据查询、特定概念的 XBRL 数据查询和 XBRL frames 数据查询。

## 功能特点

- 支持多种 SEC API 工具和资源
- 实时数据更新
- 详细的错误处理和日志记录
- 支持 SSE（Server-Sent Events）实时事件推送

## 安装步骤

1. 克隆项目：
   ```bash
   git clone <repository-url>
   cd sec-mcp-server
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置环境变量：
   - 创建 `.env` 文件，并添加以下内容：
     ```
     SEC_API_MAIL=your-email@example.com
     SEC_API_COMPANY=Your Company Name
     PORT=4000
     ```

4. 编译项目：
   ```bash
   npm run build
   ```

5. 启动服务：
   ```bash
   npm start
   ```

## 使用方法

### 1. 启动服务
服务默认监听 4000 端口，可通过环境变量 `PORT` 修改。

### 2. 访问 API 工具和资源
服务提供以下工具和资源：

#### 工具（Tools）
- **`get-company-concept`**  
  获取公司特定概念的 XBRL 数据。  
  参数：  
  - `cik`：公司 CIK 编号（10位数字，如 0000320193）  
  - `taxonomy`：分类标准（如 us-gaap, ifrs-full, dei, srt）  
  - `tag`：XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）  
  - `units`：单位（如 USD, USD-per-shares, pure）  
  - `startDate`：开始日期（YYYY-MM-DD）  
  - `endDate`：结束日期（YYYY-MM-DD）

- **`get-xbrl-frames`**  
  获取特定概念和时期的 XBRL frames 数据。  
  参数：  
  - `taxonomy`：分类标准（如 us-gaap, ifrs-full, dei, srt）  
  - `tag`：XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）  
  - `unit`：单位（如 USD, USD-per-shares, pure）  
  - `year`：年份（如 2023）  
  - `quarter`：季度（1-4）

- **`get-company-facts`**  
  获取公司的所有标准化财务数据。  
  参数：  
  - `cik`：公司 CIK 编号（10位数字，如 0000320193）

- **`get-company-submissions`**  
  获取公司的提交历史记录。  
  参数：  
  - `cik`：公司 CIK 编号（10位数字，如 0000320193）  
  - `recent`：是否只获取最近的记录（至少一年或1000条记录）

#### 资源（Resources）
- **`company-submissions`**  
  获取公司的提交历史记录。  
  参数：  
  - `cik`：公司 CIK 编号（10位数字，如 0000320193）

- **`company-facts`**  
  获取公司的所有标准化财务数据。  
  参数：  
  - `cik`：公司 CIK 编号（10位数字，如 0000320193）

### 3. 实时事件推送
服务支持 SSE（Server-Sent Events）实时事件推送，可通过 `/sse` 端点订阅事件。

## 环境变量配置
- `SEC_API_MAIL`：SEC API 联系邮箱
- `SEC_API_COMPANY`：SEC API 公司名称
- `PORT`：服务监听端口（默认 4000）

## 错误处理
所有 API 请求都会返回详细的错误信息，便于排查问题。

## 贡献指南
欢迎提交 Issue 和 Pull Request，共同改进项目。

## 许可证
MIT