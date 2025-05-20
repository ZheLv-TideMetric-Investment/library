import { config } from 'dotenv';
import { ServerManager } from './server-manager.js';
import { SecServer } from './servers/sec-server.js';

// 加载环境变量
config();

// 验证必要的环境变量
const requiredEnvVars = ['SEC_API_MAIL', 'SEC_API_COMPANY'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

async function main() {
  const serverManager = new ServerManager();

  // 创建 SEC API 服务器
  const secServer = new SecServer({
    name: 'SEC API Server',
    version: '1.0.0',
    mail: process.env.SEC_API_MAIL!,
    companyName: process.env.SEC_API_COMPANY!,
  });

  // 将 SEC 服务器的 MCP 实例添加到管理器
  const secMcpServer = secServer.getMcpServer();
  serverManager.setServer('sec', secMcpServer);

  // 启动所有服务器
  await serverManager.startServer('sec');
  console.log('SEC API Server started successfully');
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Port: ${process.env.PORT || 3000}`);

  // 处理进程退出
  process.on('SIGINT', async () => {
    console.log('Shutting down servers...');
    await serverManager.stopServer('sec');
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Error starting servers:', error);
  process.exit(1);
});
