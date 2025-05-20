import express, { Request, Response } from 'express';
import cors from 'cors';
import { ServerManager } from './servers/server-manager.js';

/**
 * HTTP 服务器
 * 
 * 提供 SSE 端点用于实时事件推送
 */
export class HttpServer {
  private app: express.Application;
  private server: express.Application;
  private port: number;
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager, port: number = 3000) {
    this.port = port;
    this.app = express();
    this.serverManager = serverManager;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // SSE 端点
    this.app.get('/events', (req: Request, res: Response) => {
      const secServer = this.serverManager.getSecServer();
      if (!secServer) {
        res.status(503).json({ error: 'SEC API MCP 服务器未启动' });
        return;
      }

      // 设置 SSE 头部
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 发送初始连接消息
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      // 监听资源更新事件
      const resourceUpdateHandler = (event: any) => {
        res.write(`data: ${JSON.stringify({ type: 'resource-update', ...event })}\n\n`);
      };

      // 监听工具调用事件
      const toolCallHandler = (event: any) => {
        res.write(`data: ${JSON.stringify({ type: 'tool-call', ...event })}\n\n`);
      };

      // 监听错误事件
      const errorHandler = (event: any) => {
        res.write(`data: ${JSON.stringify({ type: 'error', ...event })}\n\n`);
      };

      // 添加事件监听器
      secServer.on('resource-update', resourceUpdateHandler);
      secServer.on('tool-call', toolCallHandler);
      secServer.on('error', errorHandler);

      // 客户端断开连接时清理事件监听器
      req.on('close', () => {
        secServer.removeListener('resource-update', resourceUpdateHandler);
        secServer.removeListener('tool-call', toolCallHandler);
        secServer.removeListener('error', errorHandler);
      });
    });

    // 健康检查端点
    this.app.get('/health', (req: Request, res: Response) => {
      const secServer = this.serverManager.getSecServer();
      res.json({
        status: secServer ? 'ok' : 'error',
        message: secServer ? 'SEC API MCP 服务器运行中' : 'SEC API MCP 服务器未启动',
      });
    });
  }

  /**
   * 启动 HTTP 服务器
   */
  start(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`HTTP 服务器已启动，监听端口 ${this.port}`);
    });
  }

  /**
   * 关闭 HTTP 服务器
   */
  async shutdown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }
  }
} 