import { SecServer } from './sec-server.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * 服务器管理器
 * 
 * 负责管理 SEC API MCP 服务器的生命周期
 */
export class ServerManager {
  private secServer: SecServer | null = null;
  private servers: Map<string, McpServer> = new Map();
  private transports: Map<string, StdioServerTransport> = new Map();

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
   * @param id 服务器 ID
   * @param server MCP 服务器实例
   */
  setServer(id: string, server: McpServer): void {
    if (this.servers.has(id)) {
      throw new Error(`服务器 ID ${id} 已存在`);
    }
    this.servers.set(id, server);
  }

  /**
   * 启动服务器
   * @param id 服务器 ID
   */
  async startServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`未找到服务器 ID ${id}`);
    }

    const transport = new StdioServerTransport();
    this.transports.set(id, transport);
    await server.connect(transport);
    console.log(`服务器 ${id} 已启动`);
  }

  /**
   * 停止服务器
   * @param id 服务器 ID
   */
  async stopServer(id: string): Promise<void> {
    const transport = this.transports.get(id);
    if (transport) {
      transport.close();
      this.transports.delete(id);
    }
    this.servers.delete(id);
    console.log(`服务器 ${id} 已停止`);
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
    for (const [id] of this.servers) {
      await this.stopServer(id);
    }
  }
} 