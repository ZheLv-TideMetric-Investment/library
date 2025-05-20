import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fetch from 'node-fetch';
import { EventEmitter } from 'events';

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

export class SecServer extends EventEmitter {
  private server: McpServer;
  private readonly mail: string;
  private readonly companyName: string;

  constructor(config: { name: string; version: string; mail: string; companyName?: string }) {
    super();
    this.server = new McpServer(config);
    this.mail = config.mail;
    this.companyName = config.companyName || 'Financial Research Bot';
    this.setupResources();
    this.setupTools();
  }

  /**
   * 获取 SEC API 请求头
   * @returns 包含必要头部的对象
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
   *
   * 资源路由用于处理 GET 请求，返回特定资源的数据
   * 格式：sec://{resource-type}/{cik}
   */
  private setupResources(): void {
    // 添加获取公司提交历史的资源
    // URI 格式：sec://submissions/{cik}
    // 示例：sec://submissions/0000320193 (Apple Inc.)
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
          this.emit('resource-update', {
            type: 'submissions',
            cik,
            data,
          });
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify(data, null, 2),
              },
            ],
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
    // URI 格式：sec://xbrl/facts/{cik}
    // 示例：sec://xbrl/facts/0000320193 (Apple Inc.)
    this.server.resource(
      'company-facts',
      new ResourceTemplate('sec://xbrl/facts/{cik}', { list: undefined }),
      async (uri, variables) => {
        const cik = variables.cik as string;
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
            {
              headers: this.getHeaders(),
            }
          );
          const data = await response.json();
          this.emit('resource-update', {
            type: 'facts',
            cik,
            data,
          });
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify(data, null, 2),
              },
            ],
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
   *
   * 工具函数用于处理特定的数据查询请求，可以接受多个参数
   */
  private setupTools(): void {
    // 添加获取特定概念的 XBRL 数据的工具
    // 参数：
    // - cik: 公司 CIK 编号（10位数字）
    // - taxonomy: 分类标准（如 us-gaap）
    // - tag: XBRL 标签（如 AccountsPayableCurrent）
    this.server.tool(
      'get-company-concept',
      {
        cik: z.string().describe('公司 CIK 编号（10位数字）'),
        taxonomy: z.string().describe('分类标准（如 us-gaap）'),
        tag: z.string().describe('XBRL 标签（如 AccountsPayableCurrent）'),
      },
      async ({ cik, taxonomy, tag }) => {
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/companyconcept/CIK${paddedCik}/${taxonomy}/${tag}.json`,
            {
              headers: this.getHeaders(),
            }
          );
          const data = await response.json();
          this.emit('tool-call', {
            type: 'company-concept',
            cik,
            taxonomy,
            tag,
            data,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          this.emit('error', {
            type: 'company-concept',
            cik,
            taxonomy,
            tag,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching company concept: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // 添加获取 XBRL frames 数据的工具
    // 参数：
    // - taxonomy: 分类标准（如 us-gaap）
    // - tag: XBRL 标签（如 AccountsPayableCurrent）
    // - unit: 单位（如 USD）
    // - period: 期间（如 CY2023Q1I）
    this.server.tool(
      'get-xbrl-frames',
      {
        taxonomy: z.string().describe('分类标准（如 us-gaap）'),
        tag: z.string().describe('XBRL 标签（如 AccountsPayableCurrent）'),
        unit: z.string().describe('单位（如 USD）'),
        period: z.string().describe('期间（如 CY2023Q1I）'),
      },
      async ({ taxonomy, tag, unit, period }) => {
        try {
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`,
            {
              headers: this.getHeaders(),
            }
          );
          const data = await response.json();
          this.emit('tool-call', {
            type: 'xbrl-frames',
            taxonomy,
            tag,
            unit,
            period,
            data,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          this.emit('error', {
            type: 'xbrl-frames',
            taxonomy,
            tag,
            unit,
            period,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching XBRL frames: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * 获取 MCP 服务器实例
   * @returns McpServer 实例
   */
  getMcpServer(): McpServer {
    return this.server;
  }
}
