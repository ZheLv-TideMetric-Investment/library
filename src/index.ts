import express from 'express';
import cors from 'cors';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { config } from 'dotenv';

// 加载环境变量
config();

// 验证必要的环境变量
const requiredEnvVars = ['SEC_API_MAIL', 'SEC_API_COMPANY'] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const SEC_API_BASE = 'https://data.sec.gov';
const USER_AGENT = `${process.env.SEC_API_COMPANY} ${process.env.SEC_API_MAIL}`;

const app = express();
app.use(cors());
app.use(express.json());

// Store SSE transports
const transports = new Map<string, SSEServerTransport>();

// Helper function for making SEC API requests
async function makeSecRequest<T>(url: string): Promise<T | null> {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'gzip, deflate',
    Host: 'data.sec.gov',
  };

  try {
    const response = await fetch(`${SEC_API_BASE}${url}`, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error('Error making SEC request:', error);
    return null;
  }
}

// Create MCP server with SEC capabilities
const createServer = () => {
  const server = new McpServer({
    name: 'sec-server',
    version: '1.0.0',
    capabilities: {
      tools: {},
      resources: {},
    },
  });

  // Add SEC API tools
  server.tool(
    'get-company-concept',
    '获取公司特定概念的 XBRL 数据。返回单个公司（CIK）和概念（分类标准和标签）的所有 XBRL 披露数据。',
    {
      cik: z.string().describe('公司 CIK 编号（10位数字，如 0000320193）'),
      taxonomy: z.string().describe('分类标准（如 us-gaap, ifrs-full, dei, srt）'),
      tag: z.string().describe('XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）'),
      units: z.string().optional().describe('单位（如 USD, USD-per-shares, pure）'),
      startDate: z.string().optional().describe('开始日期（YYYY-MM-DD）'),
      endDate: z.string().optional().describe('结束日期（YYYY-MM-DD）'),
    },
    async ({ cik, taxonomy, tag, units, startDate, endDate }) => {
      const url = `/api/xbrl/companyconcept/CIK${cik.padStart(10, '0')}/${taxonomy}/${tag}`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          content: [
            {
              type: 'text',
              text: '获取公司概念数据失败',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'get-xbrl-frames',
    '获取特定概念和时期的 XBRL frames 数据。返回每个报告实体最近提交的最符合请求日历期间的一个事实。',
    {
      taxonomy: z.string().describe('分类标准（如 us-gaap, ifrs-full, dei, srt）'),
      tag: z.string().describe('XBRL 标签（如 AccountsPayableCurrent, Assets, Revenue）'),
      unit: z.string().describe('单位（如 USD, USD-per-shares, pure）'),
      year: z.string().describe('年份（如 2023）'),
      quarter: z.string().describe('季度（1-4）'),
    },
    async ({ taxonomy, tag, unit, year, quarter }) => {
      const url = `/api/xbrl/frames/${taxonomy}/${tag}/${unit}/CY${year}Q${quarter}I`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          content: [
            {
              type: 'text',
              text: '获取 XBRL frames 数据失败',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'get-company-facts',
    '获取公司的所有标准化财务数据。返回单个 API 调用中公司的所有概念数据。',
    {
      cik: z.string().describe('公司 CIK 编号（10位数字，如 0000320193）'),
    },
    async ({ cik }) => {
      const url = `/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          content: [
            {
              type: 'text',
              text: '获取公司财务数据失败',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'get-company-submissions',
    '获取公司的提交历史记录。返回至少一年的提交记录或最近1000条记录（以较多者为准）。',
    {
      cik: z.string().describe('公司 CIK 编号（10位数字，如 0000320193）'),
      recent: z.boolean().optional().describe('是否只获取最近的记录（至少一年或1000条记录）'),
    },
    async ({ cik, recent = true }) => {
      const url = `/submissions/CIK${cik.padStart(10, '0')}.json`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          content: [
            {
              type: 'text',
              text: '获取公司提交历史失败',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // Add SEC API resources
  server.resource(
    'company-submissions',
    new ResourceTemplate('sec://submissions/{cik}', { list: undefined }),
    async (uri, params) => {
      const cik = String(params.cik);
      const url = `/submissions/CIK${cik.padStart(10, '0')}.json`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          contents: [
            {
              uri: uri.href,
              text: '获取公司提交历史失败',
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'company-facts',
    new ResourceTemplate('sec://xbrl/facts/{cik}', { list: undefined }),
    async (uri, params) => {
      const cik = String(params.cik);
      const url = `/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`;
      const data = await makeSecRequest(url);

      if (!data) {
        return {
          contents: [
            {
              uri: uri.href,
              text: '获取公司财务数据失败',
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  return server;
};

// Handle SSE connection
app.get('/sse', async (req, res) => {
  try {
    // Create SSE transport
    const transport = new SSEServerTransport('/messages', res);

    // Store transport
    transports.set(transport.sessionId, transport);

    // Clean up on close
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });

    // Create and connect MCP server
    const server = createServer();
    await server.connect(transport);
  } catch (error) {
    console.error('Error handling SSE connection:', error);
    res.status(500).send('Internal server error');
  }
});

// Handle messages from client
app.post('/messages', async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).send('No session ID provided');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(400).send('No transport found for sessionId');
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error handling message:', error);
    res.status(500).send('Internal server error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SEC MCP Server listening on port ${PORT}`);
});
