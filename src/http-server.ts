import express, { Request, Response } from 'express';
import cors from 'cors';
import { ServerManager } from './servers/server-manager.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

/**
 * HTTP 服务器
 * 
 * 提供 SSE 端点用于实时事件推送
 */
export class HttpServer {
  private app: express.Application;
  private serverManager: ServerManager;
  private port: number;
  private server: ReturnType<express.Application['listen']> | null = null;

  constructor(serverManager: ServerManager, port: number = 4000) {
    this.app = express();
    this.serverManager = serverManager;
    this.port = port;
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
        res.status(503).json({ error: 'SEC API MCP 服务器未运行' });
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
      secServer.on('resource-update', (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // 监听工具调用事件
      secServer.on('tool-call', (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // 监听错误事件
      secServer.on('error', (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // 处理客户端断开连接
      req.on('close', () => {
        secServer.removeAllListeners();
      });
    });

    // 健康检查端点
    this.app.get('/health', (req: Request, res: Response) => {
      const secServer = this.serverManager.getSecServer();
      if (!secServer) {
        res.status(503).json({ status: 'error', message: 'SEC API MCP 服务器未运行' });
        return;
      }
      res.json({ status: 'ok', message: 'SEC API MCP 服务器运行正常' });
    });

    // 工具列表端点
    this.app.get('/tools', (req: Request, res: Response) => {
      const secServer = this.serverManager.getSecServer();
      if (!secServer) {
        res.status(503).json({ error: 'SEC API MCP 服务器未运行' });
        return;
      }

      try {
        const tools = secServer.getTools();
        res.json(tools);
      } catch (error) {
        console.error('获取工具列表失败:', error);
        res.status(500).json({ error: '获取工具列表失败' });
      }
    });
  }

  /**
   * 启动 HTTP 服务器
   */
  public start(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`HTTP 服务器监听端口 ${this.port}`);
    });
  }

  /**
   * 关闭 HTTP 服务器
   */
  public close(): void {
    if (this.server) {
      this.server.close();
    }
  }
} 