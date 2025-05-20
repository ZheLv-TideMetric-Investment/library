import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fetch from 'node-fetch';

interface ResourceParams {
  cik: string;
}

export class SecServer {
  private server: McpServer;

  constructor(config: { name: string; version: string }) {
    this.server = new McpServer(config);
    this.setupResources();
    this.setupTools();
  }

  private setupResources(): void {
    // 添加获取公司提交历史的资源
    this.server.resource(
      'company-submissions',
      new ResourceTemplate('sec://submissions/{cik}', { list: undefined }),
      async (uri, variables) => {
        const cik = variables.cik as string;
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`);
          const data = await response.json();
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(data, null, 2),
            }],
          };
        } catch (error) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error fetching submissions: ${error instanceof Error ? error.message : String(error)}`,
            }],
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
          const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`);
          const data = await response.json();
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(data, null, 2),
            }],
          };
        } catch (error) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error fetching company facts: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );
  }

  private setupTools(): void {
    // 添加获取特定概念的 XBRL 数据的工具
    this.server.tool(
      'get-company-concept',
      {
        cik: z.string(),
        taxonomy: z.string(),
        tag: z.string(),
      },
      async ({ cik, taxonomy, tag }) => {
        try {
          const paddedCik = cik.padStart(10, '0');
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/companyconcept/CIK${paddedCik}/${taxonomy}/${tag}.json`
          );
          const data = await response.json();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(data, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error fetching company concept: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );

    // 添加获取 XBRL frames 数据的工具
    this.server.tool(
      'get-xbrl-frames',
      {
        taxonomy: z.string(),
        tag: z.string(),
        unit: z.string(),
        period: z.string(),
      },
      async ({ taxonomy, tag, unit, period }) => {
        try {
          const response = await fetch(
            `https://data.sec.gov/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`
          );
          const data = await response.json();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(data, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error fetching XBRL frames: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );
  }

  getMcpServer(): McpServer {
    return this.server;
  }
} 