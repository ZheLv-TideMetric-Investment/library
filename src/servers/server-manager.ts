import { SecServer } from './sec-server.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * 服务器管理器
 * 
 * 负责管理 SEC API MCP 服务器的生命周期
 */
export class ServerManager {
  private secServer: SecServer | null = null;
  private servers: Map<string, McpServer> = new Map();

  /**
   * 创建 SEC API MCP 服务器实例
   * @param config 服务器配置
   * @returns SecServer 实例
   */
  createSecServer(config: { name: string; version: string; mail: string; companyName?: string }): SecServer {
    if (this.secServer) {
      throw new Error('SEC API MCP 服务器已经存在');
    }

    this.secServer = new SecServer(config);

    // 监听事件
    this.secServer.on('resource-update', (event) => {
      console.log(`[资源更新] ${event.type} - CIK: ${event.cik}`);
    });

    this.secServer.on('tool-call', (event) => {
      console.log(`[工具调用] ${event.type}`);
    });

    this.secServer.on('error', (event) => {
      console.error(`[错误] ${event.type} - ${event.error}`);
    });

    return this.secServer;
  }

  /**
   * 获取 SEC API MCP 服务器实例
   * @returns SecServer 实例或 null
   */
  getSecServer(): SecServer | null {
    return this.secServer;
  }

  /**
   * 设置服务器实例
   * @param name 服务器名称
   * @param server 服务器实例
   */
  setServer(name: string, server: McpServer): void {
    this.servers.set(name, server);
  }

  /**
   * 启动服务器
   * @param name 服务器名称
   */
  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`服务器 ${name} 不存在`);
    }
    // McpServer 不需要显式启动
  }

  /**
   * 停止服务器
   * @param name 服务器名称
   */
  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (server) {
      this.servers.delete(name);
    }
  }

  /**
   * 关闭所有服务器
   */
  async shutdown(): Promise<void> {
    if (this.secServer) {
      // 移除所有事件监听器
      this.secServer.removeAllListeners();
      this.secServer = null;
    }
    // 停止所有服务器
    for (const [name] of this.servers) {
      await this.stopServer(name);
    }
  }
} 