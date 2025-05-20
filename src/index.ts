import { ServerManager } from './server-manager.js';
import { SecServer } from './servers/sec-server.js';

async function main() {
  const serverManager = new ServerManager();

  // 创建 SEC API 服务器
  const secServer = new SecServer({
    name: 'SEC API Server',
    version: '1.0.0',
    mail: process.env.SEC_API_MAIL || 'your-email@example.com', // 从环境变量获取邮件地址
    companyName: process.env.SEC_API_COMPANY || 'Financial Research Bot',
  });

  // 将 SEC 服务器的 MCP 实例添加到管理器
  const secMcpServer = secServer.getMcpServer();
  serverManager.setServer('sec', secMcpServer);

  // 启动所有服务器
  await serverManager.startServer('sec');
  console.log('SEC API Server started successfully');

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