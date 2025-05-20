# SEC API MCP Server

基于 MCP (Model Context Protocol) 的 SEC EDGAR 数据库访问服务器，提供实时数据推送功能。

## 功能特点

- 基于 MCP TypeScript SDK 构建
- 支持 SEC EDGAR 数据库访问
- 提供 Server-Sent Events (SSE) 实时数据推送
- 支持 PM2 进程管理
- 完整的 TypeScript 类型支持

## 主要功能

1. 公司提交历史查询
   - URI 格式：`sec://submissions/{cik}`
   - 示例：`sec://submissions/0000320193` (Apple Inc.)

2. 公司 XBRL 数据查询
   - URI 格式：`sec://xbrl/facts/{cik}`
   - 示例：`sec://xbrl/facts/0000320193` (Apple Inc.)

3. 特定概念的 XBRL 数据查询
   - 工具名称：`get-company-concept`
   - 参数：`cik`, `taxonomy`, `tag`

4. XBRL frames 数据查询
   - 工具名称：`get-xbrl-frames`
   - 参数：`taxonomy`, `tag`, `unit`, `period`

## 环境要求

- Node.js >= 18
- TypeScript >= 5.0
- PM2 (用于生产环境)

## 安装

```bash
# 克隆仓库
git clone [repository-url]
cd sec-mcp-server

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置必要的环境变量
```

## 环境变量

在 `.env` 文件中配置以下环境变量：

```env
# SEC API 配置
SEC_API_MAIL=your-email@example.com
SEC_API_COMPANY=Your Company Name

# 服务器配置
PORT=4000
NODE_ENV=development
```

## 开发

```bash
# 启动开发服务器
npm run dev

# 运行测试客户端
npm run test
```

## 生产部署

使用 PM2 进行进程管理：

```bash
# 启动服务器
npm run pm2:start

# 查看日志
npm run pm2:logs

# 监控服务器状态
npm run pm2:monit

# 停止服务器
npm run pm2:stop

# 重启服务器
npm run pm2:restart

# 删除服务器
npm run pm2:delete
```

## API 端点

### SSE 端点

- URL: `http://localhost:4000/events`
- 方法: GET
- 事件类型:
  - `connected`: 连接成功
  - `resource-update`: 资源更新
  - `tool-call`: 工具调用
  - `error`: 错误信息

### 健康检查

- URL: `http://localhost:4000/health`
- 方法: GET
- 响应:
  ```json
  {
    "status": "ok",
    "message": "SEC API MCP 服务器运行中"
  }
  ```

## 测试客户端

测试客户端示例代码：

```typescript
import { EventSource } from 'eventsource';

const eventSource = new EventSource('http://localhost:4000/events');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('收到事件:', data);
};

eventSource.onerror = (error) => {
  console.error('SSE 连接错误:', error);
  eventSource.close();
};
```

## 项目结构

```
sec-mcp-server/
├── src/
│   ├── servers/
│   │   ├── sec-server.ts    # SEC API 服务器实现
│   │   └── server-manager.ts # 服务器管理器
│   ├── http-server.ts       # HTTP 服务器实现
│   ├── test-client.ts       # 测试客户端
│   └── index.ts             # 应用入口
├── logs/                    # PM2 日志目录
├── ecosystem.config.js      # PM2 配置
├── package.json
├── tsconfig.json
└── README.md
```

## 注意事项

1. SEC API 访问限制：
   - 每个 IP 每秒最多 10 个请求
   - 需要设置 User-Agent 头部
   - 需要设置 mail 头部（用于联系）

2. 错误处理：
   - 所有错误都会通过 SSE 连接发送
   - 错误信息包含类型、相关参数和错误详情

3. 性能考虑：
   - 使用 PM2 进行进程管理
   - 配置了内存限制和自动重启
   - 实现了错误重试机制

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request。