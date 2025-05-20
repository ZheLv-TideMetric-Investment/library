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

// 定义枚举值
const TAXONOMY_ENUM = ['us-gaap', 'ifrs-full', 'dei', 'srt'] as const;
const CORE_TAG_ENUM = [
  /* ──收入/成本──────────────────── */
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'CostOfRevenue',
  'GrossProfit',
  /* ──费用 & 利润────────────────── */
  'OperatingExpenses',
  'ResearchAndDevelopmentExpense',
  'SellingGeneralAndAdministrativeExpense',
  'OperatingIncomeLoss',
  'IncomeBeforeTax',
  'NetIncomeLoss',
  /* ──现金流────────────────────── */
  'OperatingCashFlow',
  'CapitalExpenditures',
  'PaymentsForRepurchaseOfCommonStock',
  'PaymentsOfDividends',
  /* ──资产负债表────────────────── */
  'Assets',
  'CurrentAssets',
  'NoncurrentAssets',
  'Liabilities',
  'CurrentLiabilities',
  'NoncurrentLiabilities',
  'StockholdersEquity',
  'RetainedEarningsAccumulatedDeficit',
  /* ──每股 & 股东回报──────────── */
  'EarningsPerShareBasic',
  'EarningsPerShareDiluted',
  /* ──其他常用──────────────────── */
  'CashAndCashEquivalentsAtCarryingValue',
  'AccountsReceivableNetCurrent',
  'InventoryNet',
  'PropertyPlantAndEquipmentNet',
  'Goodwill',
  'IntangibleAssetsNetExcludingGoodwill',
  'LongTermDebt',
  'InterestExpense',
  'IncomeTaxExpenseBenefit',
] as const;

/** ISO-4217 + shares + pure + per-share 组合 */
const UNIT_ENUM = [
  /* 主要货币（可自行扩展全部 ISO-4217） */
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CAD',
  'AUD',
  'CHF',
  'HKD',
  'KRW',
  'INR',
  'SEK',
  'NOK',
  'DKK',
  'RUB',
  'BRL',
  'MXN',
  'ZAR',
  'SGD',
  'NZD',
  /* 数量与百分比 */
  'shares',
  'pure',
  /* 每股指标（最常用三种；如需更多请组合生成） */
  'USD-per-shares',
  'EUR-per-shares',
  'CNY-per-shares',
] as const;

/** SEC API 响应数据类型定义 */
interface SecSubmissionResponse {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  filings: {
    recent: Array<{
      accessionNumber: string;
      filingDate: string;
      reportDate: string;
      acceptanceDateTime: string;
      act: string;
      form: string;
      fileNumber: string;
      filmNumber: string;
      items: string;
      size: number;
      isXBRL: number;
      isInlineXBRL: number;
      primaryDocument: string;
      primaryDocDescription: string;
    }>;
    files: Array<{
      name: string;
      filingCount: number;
      filingFrom: string;
      filingTo: string;
    }>;
  };
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
      /** 公司 CIK，十位数字（前导零可省略）；SEC 要求长度 ≤ 10 */
      cik: z
        .string()
        .regex(/^\d{1,10}$/, 'CIK 必须为 1-10 位数字')
        .describe('公司 CIK 编号（10 位数字，如 0000320193）'),

      /** 非自定义 taxonomy（SEC 仅聚合官方标准值） */
      taxonomy: z.enum(TAXONOMY_ENUM).describe(`分类标准，可选值: ${TAXONOMY_ENUM.join(' | ')}`),

      /** Tag ― 核心财务元素；如需查询自定义 Tag，请改用 strings */
      tag: z
        .enum(CORE_TAG_ENUM)
        .describe('XBRL 标签（核心财报元素；完整列表参见 GAAP/IFRS Taxonomy）'),

      /** 披露单位；支持 ISO-4217 货币、shares、pure 及 <ccy>-per-shares */
      units: z
        .string()
        .optional()
        .describe(`单位，可选值示例: ${UNIT_ENUM.slice(0, 10).join(' | ')}…`),

      /** 开始日期（YYYY-MM-DD），可选；必须 ≤ endDate */
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
        .optional(),

      /** 结束日期（YYYY-MM-DD），可选；默认为最新 */
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
        .optional(),
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
    '获取特定概念和时期的 XBRL frames 数据。返回每个报告实体最近提交的、最符合请求日历期间的一个事实。',
    {
      taxonomy: z.enum(TAXONOMY_ENUM).describe(`分类标准，可选值: ${TAXONOMY_ENUM.join(' | ')}`),

      tag: z.enum(CORE_TAG_ENUM).describe('XBRL 标签（核心财报元素）'),

      unit: z.string().describe(`披露单位，可选值示例: ${UNIT_ENUM.slice(0, 10).join(' | ')}…`),

      /** 年份：1900 – 2100 */
      year: z
        .string()
        .regex(/^(19|20)\d{2}$/, '年份必须介于 1900-2100')
        .describe('年份（如 2024）'),

      /** 季度：1 – 4 */
      quarter: z.enum(['1', '2', '3', '4']).describe('季度（1-4）'),
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
    '获取公司的所有标准化财务数据（返回单个公司全部概念）。',
    {
      cik: z
        .string()
        .regex(/^\d{1,10}$/, 'CIK 必须为 1-10 位数字')
        .describe('公司 CIK 编号（10 位数字，如 0000320193）'),
    },
    async ({ cik }) => {
      try {
        // 验证 CIK 格式
        if (!cik || cik.length > 10) {
          return {
            content: [
              {
                type: 'text',
                text: '无效的 CIK 格式：CIK 必须为不超过10位的数字',
              },
            ],
          };
        }

        const paddedCik = cik.padStart(10, '0');
        const url = `/api/xbrl/companyfacts/CIK${paddedCik}.json`;
        const data = await makeSecRequest(url);

        if (!data) {
          return {
            content: [
              {
                type: 'text',
                text: '获取公司财务数据失败：未找到数据或请求失败',
              },
            ],
          };
        }

        // 限制返回数据大小
        const responseData = JSON.stringify(data, null, 2);
        if (responseData.length > 50000) {
          // 设置一个合理的上限
          return {
            content: [
              {
                type: 'text',
                text: '数据量过大，请使用更具体的查询条件',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: responseData,
            },
          ],
        };
      } catch (error) {
        console.error('获取公司财务数据时发生错误:', error);
        return {
          content: [
            {
              type: 'text',
              text: `获取公司财务数据失败：${error instanceof Error ? error.message : '未知错误'}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    'get-company-submissions',
    '获取公司的提交历史记录（最近 ≥1 年或 1000 条，以多者为准）。',
    {
      cik: z
        .string()
        .regex(/^\d{1,10}$/, 'CIK 必须为 1-10 位数字')
        .describe('公司 CIK 编号（10 位数字，如 0000320193）'),

      recent: z.boolean().optional().describe('是否仅获取最近记录；默认 true'),

      /** 分页参数 */
      page: z.number().min(1).optional().describe('页码，从 1 开始'),
      pageSize: z.number().min(1).max(100).optional().describe('每页记录数，默认 20，最大 100'),
    },
    async ({ cik, recent = true, page = 1, pageSize = 20 }) => {
      try {
        const paddedCik = cik.padStart(10, '0');
        const url = `/submissions/CIK${paddedCik}.json`;
        const data = await makeSecRequest<SecSubmissionResponse>(url);

        if (!data) {
          return {
            content: [
              {
                type: 'text',
                text: '获取公司提交历史失败：未找到数据或请求失败',
              },
            ],
          };
        }

        // 处理分页
        const submissions = data.filings?.recent || [];
        const total = submissions.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const pagedSubmissions = submissions.slice(start, end);

        // 构建分页后的响应
        const response = {
          cik: data.cik,
          entityType: data.entityType,
          sic: data.sic,
          sicDescription: data.sicDescription,
          name: data.name,
          tickers: data.tickers,
          exchanges: data.exchanges,
          filings: {
            recent: pagedSubmissions,
            files: data.filings?.files || [],
          },
          pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
          },
        };

        // 限制返回数据大小
        const responseData = JSON.stringify(response, null, 2);
        if (responseData.length > 50000) {
          return {
            content: [
              {
                type: 'text',
                text: '数据量过大，请使用分页参数或减小每页记录数',
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: responseData,
            },
          ],
        };
      } catch (error) {
        console.error('获取公司提交历史时发生错误:', error);
        return {
          content: [
            {
              type: 'text',
              text: `获取公司提交历史失败：${error instanceof Error ? error.message : '未知错误'}`,
            },
          ],
        };
      }
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
    // 设置 SSE 所需的 HTTP 头部
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 设置超时时间
    res.setTimeout(0); // 禁用超时
    
    // 发送初始连接成功消息
    res.write('event: connected\ndata: {"status": "connected"}\n\n');

    // Create SSE transport
    const transport = new SSEServerTransport('/messages', res);

    // Store transport
    transports.set(transport.sessionId, transport);

    // Clean up on close
    res.on('close', () => {
      console.log(`SSE connection closed for session ${transport.sessionId}`);
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
