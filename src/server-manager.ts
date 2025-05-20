import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export interface ServerConfig {
  name: string;
  version: string;
  [key: string]: unknown;
}

export class ServerManager {
  private servers: Map<string, McpServer> = new Map();
  private transports: Map<string, StdioServerTransport> = new Map();

  async createServer(id: string, config: ServerConfig): Promise<McpServer> {
    if (this.servers.has(id)) {
      throw new Error(`Server with id ${id} already exists`);
    }

    const server = new McpServer(config);
    this.servers.set(id, server);
    return server;
  }

  setServer(id: string, server: McpServer): void {
    if (this.servers.has(id)) {
      throw new Error(`Server with id ${id} already exists`);
    }
    this.servers.set(id, server);
  }

  async startServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    const transport = new StdioServerTransport();
    this.transports.set(id, transport);
    await server.connect(transport);
  }

  async stopServer(id: string): Promise<void> {
    const transport = this.transports.get(id);
    if (transport) {
      transport.close();
      this.transports.delete(id);
    }
    this.servers.delete(id);
  }

  getServer(id: string): McpServer | undefined {
    return this.servers.get(id);
  }

  getAllServers(): string[] {
    return Array.from(this.servers.keys());
  }
} 