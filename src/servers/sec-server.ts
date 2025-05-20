import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fetch from 'node-fetch';
import { EventEmitter } from 'events';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * SEC API MCP 服务器
 *
 * 这个服务器提供了访问 SEC EDGAR 数据库的接口，包括：
 * 1. 公司提交历史查询
 * 2. 公司 XBRL 数据查询
 * 3. 特定概念的 XBRL 数据查询
 * 4. XBRL frames 数据查询
 *
 * 所有 API 调用都需要遵循 SEC 的访问限制：
 * - 每个 IP 每秒最多 10 个请求
 * - 需要设置 User-Agent 头部
 * - 需要设置 mail 头部（用于联系）
 */

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<
      string,
      {
        type: string;
        description: string;
      }
    >;
    required: string[];
  };
}

interface ToolConfig {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  handler: (params: any) => Promise<any>;
}

export class SecServer extends EventEmitter {
  private server: McpServer;
  private readonly mail: string;
  private readonly companyName: string;
  private transports: Map<string, StdioServerTransport> = new Map();
  private isRunning: boolean = false;

  // 工具配置
  private readonly tools: ToolConfig[] = [
    {
      name: 'get-submissions',
      description:
        '获取公司的提交历史记录。返回至少一年的提交记录或最近1000条记录（以较多者为准）。',
      inputSchema: {
        type: 'object',
        properties: {
          cik: {
            type: 'string',
            description: '公司 CIK 编号（10位数字）',
          },
          recent: {
            type: 'boolean',
            description: '是否只获取最近的记录（至少一年或1000条记录）',
          },
        },
        required: ['cik'],
      },
      handler: async ({ cik, recent = true }) => {
        const paddedCik = cik.padStart(10, '0');
        const response = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
          headers: this.getHeaders(),
        });
        const data = await response.json();
        this.emit('tool-call', { type: 'submissions', cik, data });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      },
    },
    {
      name: 'get-company-concept',
      description:
        '获取公司特定概念的 XBRL 数据。返回单个公司（CIK）和概念（分类标准和标签）的所有 XBRL 披露数据。',
      inputSchema: {
        type: 'object',
        properties: {
          cik: {
            type: 'string',
            description: '公司 CIK 编号（10位数字）',
          },
          taxonomy: {
            type: 'string',
            description: '分类标准（如 us-gaap, ifrs-full, dei, srt）',
          },
          tag: {
            type: 'string',
            description: 'XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）',
          },
        },
        required: ['cik', 'taxonomy', 'tag'],
      },
      handler: async ({ cik, taxonomy, tag }) => {
        const paddedCik = cik.padStart(10, '0');
        const response = await fetch(
          `https://data.sec.gov/api/xbrl/companyconcept/CIK${paddedCik}/${taxonomy}/${tag}.json`,
          { headers: this.getHeaders() }
        );
        const data = await response.json();
        this.emit('tool-call', { type: 'company-concept', cik, taxonomy, tag, data });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      },
    },
    {
      name: 'get-company-facts',
      description: '获取公司的所有标准化财务数据。返回单个 API 调用中公司的所有概念数据。',
      inputSchema: {
        type: 'object',
        properties: {
          cik: {
            type: 'string',
            description: '公司 CIK 编号（10位数字）',
          },
        },
        required: ['cik'],
      },
      handler: async ({ cik }) => {
        const paddedCik = cik.padStart(10, '0');
        const response = await fetch(
          `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
          { headers: this.getHeaders() }
        );
        const data = await response.json();
        this.emit('tool-call', { type: 'company-facts', cik, data });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      },
    },
    {
      name: 'get-xbrl-frames',
      description:
        '获取特定概念和时期的 XBRL frames 数据。返回每个报告实体最近提交的最符合请求日历期间的一个事实。',
      inputSchema: {
        type: 'object',
        properties: {
          taxonomy: {
            type: 'string',
            description: '分类标准（如 us-gaap, ifrs-full, dei, srt）',
          },
          tag: {
            type: 'string',
            description: 'XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）',
          },
          unit: {
            type: 'string',
            description:
              '单位（如 USD, USD-per-shares, pure）。注意：如果单位包含分子和分母，用"-per-"分隔',
          },
          period: {
            type: 'string',
            description:
              '期间格式：CY####（年度数据，持续365天±30天），CY####Q#（季度数据，持续91天±30天），CY####Q#I（瞬时数据）',
          },
        },
        required: ['taxonomy', 'tag', 'unit', 'period'],
      },
      handler: async ({ taxonomy, tag, unit, period }) => {
        const response = await fetch(
          `https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`,
          { headers: this.getHeaders() }
        );
        const data = await response.json();
        this.emit('tool-call', { type: 'xbrl-frames', taxonomy, tag, unit, period, data });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      },
    },
  ];

  constructor(config: { name: string; version: string; mail: string; companyName?: string }) {
    super();
    this.server = new McpServer({
      ...config,
      capabilities: {
        tools: true,
        resources: true,
        logging: true,
      },
    });
    this.mail = config.mail;
    this.companyName = config.companyName || 'Financial Research Bot';
    this.setupResources();
    this.setupTools();
  }

  /**
   * 获取 SEC API 请求头
   */
  private getHeaders(): Record<string, string> {
    return {
      'User-Agent': `${this.companyName} (${this.mail})`,
      'Accept-Encoding': 'gzip, deflate, br',
      mail: this.mail,
    };
  }

  /**
   * 设置资源路由
   */
  private setupResources(): void {
    // 添加获取公司提交历史的资源
    this.server.resource(
      'company-submissions',
      new ResourceTemplate('sec://submissions/{cik}', { list: undefined }),
      async (uri, variables) => {
        const cik = variables.cik as string;
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, {
            headers: this.getHeaders(),
          });
          const data = await response.json();
          this.emit('resource-update', { type: 'submissions', cik, data });
          return {
            contents: [{ uri: uri.href, text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          this.emit('error', {
            type: 'submissions',
            cik,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            contents: [
              {
                uri: uri.href,
                text: `Error fetching submissions: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // 添加获取公司 XBRL 数据的资源
    this.server.resource(
      'company-facts',
      new ResourceTemplate('sec://xbrl/facts/{cik}', { list: undefined }),
      async (uri, variables) => {
        const cik = variables.cik as string;
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
            { headers: this.getHeaders() }
          );
          const data = await response.json();
          this.emit('resource-update', { type: 'facts', cik, data });
          return {
            contents: [{ uri: uri.href, text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          this.emit('error', {
            type: 'facts',
            cik,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            contents: [
              {
                uri: uri.href,
                text: `Error fetching company facts: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * 设置工具函数
   */
  private setupTools(): void {
    for (const tool of this.tools) {
      this.server.tool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async params => {
          try {
            return await tool.handler(params);
          } catch (error) {
            this.emit('error', {
              type: tool.name,
              ...params,
              error: error instanceof Error ? error.message : String(error),
            });
            return {
              content: [
                {
                  type: 'text',
                  text: `Error in ${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
    }
  }

  /**
   * 获取 MCP 服务器实例
   */
  getMcpServer(): McpServer {
    return this.server;
  }

  /**
   * 获取工具列表
   */
  public getTools(): Tool[] {
    return this.tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }
}
