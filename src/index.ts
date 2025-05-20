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
    const secUrl = `${SEC_API_BASE}${url}`;
    console.log('SEC URL:', secUrl);
    const response = await fetch(secUrl, { headers });
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
interface SecRecentFilingsColumnar {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

interface SecSubmissionResponse {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  insiderTransactionForOwnerExists: number;
  insiderTransactionForIssuerExists: number;
  filings: {
    recent: SecRecentFilingsColumnar;
    files: Array<{
      name: string;
      filingCount: number;
      filingFrom: string;
      filingTo: string;
    }>;
  };
}

/** 工具函数：将列式数据转换为行式数据 */
function pivotRecent(recent: SecRecentFilingsColumnar) {
  const len = recent.accessionNumber.length;
  const rows = Array.from({ length: len }, (_, i) => ({
    accessionNumber: recent.accessionNumber[i],
    filingDate: recent.filingDate[i],
    reportDate: recent.reportDate[i],
    acceptanceDateTime: recent.acceptanceDateTime[i],
    act: recent.act[i],
    form: recent.form[i],
    fileNumber: recent.fileNumber[i],
    filmNumber: recent.filmNumber[i],
    items: recent.items[i],
    size: recent.size[i],
    isXBRL: !!recent.isXBRL[i],
    isInlineXBRL: !!recent.isInlineXBRL[i],
    primaryDocument: recent.primaryDocument[i],
    primaryDocDescription: recent.primaryDocDescription[i],
  }));
  return rows;
}

// Create MCP server with SEC capabilities
const createServer = () => {
  const server = new McpServer({
    name: 'sec-server',
    version: '1.0.0',
    description: `EDGAR Application Programming Interfaces (APIs)
NOTE—This page provides information on how developers may use application programming interfaces (APIs) to access EDGAR submissions by company and extracted XBRL data. For information on how EDGAR filers may use APIs to check EDGAR system status, manage users, submit EDGAR filings, and check the status of submitted filings, see How Do I Understand EDGAR Application Programming Interfaces, How Do I Create and Manage Filer and User API Tokens, Overview of EDGAR APIs, and the API Development Toolkit.

"data.sec.gov" was created to host RESTful data APIs delivering JSON-formatted data to external customers and to web pages on SEC.gov. These APIs do not require any authentication or API keys to access.

Currently included in the APIs are the submissions history by filer and the XBRL data from financial statements (forms 10-Q, 10-K,8-K, 20-F, 40-F, 6-K, and their variants).

The JSON structures are updated throughout the day, in real time, as submissions are disseminated.

In addition, a bulk ZIP file is available to download all the JSON structures for an API. This ZIP file is updated and republished nightly at approximately 3:00 a.m. ET.

data.sec.gov/submissions/
Each entity’s current filing history is available at the following URL:

https://data.sec.gov/submissions/CIK##########.json
Where the ########## is the entity’s 10-digit central index key (CIK), including leading zeros.

This JSON data structure contains metadata such as current name, former name, and stock exchanges and ticker symbols of publicly-traded companies. The object’s property path contains at least one year’s of filing or to 1,000 (whichever is more) of the most recent filings in a compact columnar data array. If the entity has additional filings, files will contain an array of additional JSON files and the date range for the filings each one contains.

XBRL Data APIs
XBRL (eXtensible Business Markup Language) is an XML-based format for reporting financial statements used by the SEC and financial regulatory agencies across the world. XBRL, in a separate XML file or more recently embedded in quarterly and annual HTML reports as inline XBRL, was first required by the SEC in 2009. XBRL facts must be associated for a standard US-GAAP or IFRS taxonomy. Companies can also extend standard taxonomies with their own custom taxonomies.

The following XBRL APIs aggregate facts from across submissions that

Use a non-custom taxonomy (e.g. us-gaap, ifrs-full, dei, or srt)
Apply to the entire filing entity
This ensures that facts have a consistent context and meaning across companies and between filings and are comparable between companies and across time.

data.sec.gov/api/xbrl/companyconcept/
The company-concept API returns all the XBRL disclosures from a single company (CIK) and concept (a taxonomy and tag) into a single JSON file, with a separate array of facts for each units on measure that the company has chosen to disclose (e.g. net profits reported in U.S. dollars and in Canadian dollars).

https://data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/AccountsPayableCurrent.json
data.sec.gov/api/xbrl/companyfacts/
This API returns all the company concepts data for a company into a single API call:

https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
data.sec.gov/api/xbrl/frames/
The xbrl/frames API aggregates one fact for each reporting entity that is last filed that most closely fits the calendrical period requested. This API supports for annual, quarterly and instantaneous data:

https://data.sec.gov/api/xbrl/frames/us-gaap/AccountsPayableCurrent/USD/CY2019Q1I.json
Where the units of measure specified in the XBRL contains a numerator and a denominator, these are separated by “-per-” such as “USD-per-shares”. Note that the default unit in XBRL is “pure”.

The period format is CY#### for annual data (duration 365 days +/- 30 days), CY####Q# for quarterly data (duration 91 days +/- 30 days), and CY####Q#I for instantaneous data. Because company financial calendars can start and end on any month or day and even change in length from quarter to quarter to according to the day of the week, the frame data is assembled by the dates that best align with a calendar quarter or year. Data users should be mindful different reporting start and end dates for facts contained in a frame.

Cross Origin Resource Scripting (CORS)
data.sec.gov does not support Cross Origin Resource Scripting (CORS). Automated access must comply with SEC.gov’s Privacy and Security Policy, as described in the Developer FAQs.

Bulk Data
The most efficient means to fetch large amounts of API data is the bulk archive ZIP files, which are recompiled nightly.

The companyfacts.zip file contains all the data from the XBRL Frame API and the XBRL Company Facts API
           https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip

The submission.zip file contains the public EDGAR filing history for all filers from the Submissions API
           https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip 

Update Schedule
The APIs are updated in real-time as filings are disseminated. The submissions API is updated with a typical processing delay of less than a second; the xbrl APIs are updated with a typical processing delay of under a minute. However these processing delays may be longer during peak filing times.

We Want to Hear From You!
Send your recommendations regarding how we are implementing our APIs to webmaster@sec.gov.

Please note we cannot provide technical support for developing or debugging scripted downloading processes.

Programmatic API Access
See the Developer FAQs on how to comply with the SEC's website Privacy and Security Policy.`,
    capabilities: {
      tools: {},
      resources: {},
    },
  });

  /* ============================================================
   *  get-company-concept
   * ========================================================== */
  server.tool(
    'get-company-concept',
    '获取公司特定概念的 XBRL 数据（可按单位、期间过滤，并支持只取最新）。',
    {
      /** 公司 CIK（1-10 位数字） */
      cik: z
        .string()
        .regex(/^\d{1,10}$/, 'CIK 必须为 1-10 位数字')
        .describe('公司 CIK 编号（如 0000320193）'),

      /** 分类标准 */
      taxonomy: z.enum(TAXONOMY_ENUM).describe('可选值: ' + TAXONOMY_ENUM.join(' | ')),

      /** XBRL 标签；如需查询枚举之外的自定义标签，请改用字符串 */
      tag: z.string().describe('核心财务元素标签，可能的值：' + CORE_TAG_ENUM.join(' | ')),

      /** 单位（ISO-4217 / shares / pure / XXX-per-shares） */
      units: z
        .string()
        .optional()
        .describe('若指定，则仅返回该单位，可选值：' + UNIT_ENUM.join(' | ')),

      /** 开始日期（YYYY-MM-DD） */
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      /** 结束日期（YYYY-MM-DD） */
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      /** 是否只返回最新一条（默认 false） */
      latestOnly: z.boolean().optional(),
    },
    async ({ cik, taxonomy, tag, units, startDate, endDate, latestOnly = false }) => {
      /* ---------- 1 | 组装 URL ---------- */
      let url = `/api/xbrl/companyconcept/CIK${cik.padStart(10, '0')}/${taxonomy}/${tag}.json`;
      if (units) url += `?unit=${units}`;

      const raw = await makeSecRequest<any>(url);
      if (!raw) {
        return { content: [{ type: 'text', text: '⚠️ 无法获取该概念数据' }] };
      }

      /* ---------- 2 | 期间过滤 & latestOnly ---------- */
      const filteredUnits: Record<string, any[]> = {};
      for (const [unit, facts] of Object.entries<any>(raw.units ?? {})) {
        let arr = facts as any[];

        // 日期范围
        if (startDate || endDate) {
          arr = arr.filter(
            f => (!startDate || f.end >= startDate) && (!endDate || f.end <= endDate)
          );
        }

        // 只取最新
        if (latestOnly && arr.length) {
          // facts 已按日期倒序；若不确定可再排序
          arr.sort((a, b) => b.end.localeCompare(a.end));
          arr = [arr[0]];
        }

        if (arr.length) filteredUnits[unit] = arr;
      }

      const payload = { ...raw, units: filteredUnits };

      /* ---------- 3 | 限制体积 ---------- */
      const json = JSON.stringify(payload, null, 2);
      if (json.length > 50_000) {
        return {
          content: [
            {
              type: 'text',
              text:
                `⚠️ 结果仍有 ${(json.length / 1024).toFixed(1)} KB。\n` +
                `请缩小日期区间或开启 latestOnly=true`,
            },
          ],
        };
      }

      /* ---------- 4 | 返回 ---------- */
      return { content: [{ type: 'text', text: json }] };
    }
  );

  /* ------------------------------------------------------------------
   *  get-xbrl-frames  ·  瘦身版
   * ----------------------------------------------------------------*/
  server.tool(
    'get-xbrl-frames',
    '获取特定概念在指定历法期间的 XBRL frame 数据；' +
      '可按公司过滤、限制返回数量，并支持简洁模式。',
    {
      taxonomy: z.enum(TAXONOMY_ENUM).describe(`分类标准: ${TAXONOMY_ENUM.join(' | ')}`),

      tag: z.string().describe('XBRL 标签（如 Revenues；区分大小写）'),

      unit: z.string().describe(`计量单位，例如: ${UNIT_ENUM.slice(0, 10).join(' | ')}…`),

      year: z
        .string()
        .regex(/^(19|20)\d{2}$/)
        .describe('年份'),

      quarter: z.enum(['1', '2', '3', '4']).describe('季度'),

      /** true=瞬时(CY####Q#I)，false=期间(CY####Q#) */
      instant: z.boolean().optional(),

      /** 只取这些 CIK（逗号分隔） */
      ciks: z
        .string()
        .regex(/^(\d{1,10})(,\d{1,10})*$/)
        .optional(),

      /** 返回前 N 条（1-100） */
      topN: z.number().int().min(1).max(100).optional(),

      /** 简洁模式：仅四列 */
      brief: z.boolean().optional(),
    },

    async p => {
      const {
        taxonomy,
        tag,
        unit,
        year,
        quarter,
        instant = true,
        ciks,
        topN = 20,
        brief = false,
      } = p;

      /* 1｜拼 URL (.json + encode) */
      const safeTag = encodeURIComponent(tag);
      const frameCode = `CY${year}Q${quarter}${instant ? 'I' : ''}`;
      const url = `/api/xbrl/frames/${taxonomy}/${safeTag}/${unit}/${frameCode}.json`;

      const raw = await makeSecRequest<any>(url);
      if (!raw) {
        return {
          content: [{ type: 'text', text: '⚠️ 未找到 frames 数据（可能无该概念或 unit）' }],
        };
      }

      /* 2｜过滤 + 排序 + 截断 */
      let facts = raw.data as any[];

      // 只保留指定 CIK
      if (ciks) {
        const set = new Set(ciks.split(',').map(x => x.padStart(10, '0')));
        facts = facts.filter(f => set.has(f.cik));
      }

      // 按 val 降序取 topN
      facts.sort((a, b) => (b.val ?? 0) - (a.val ?? 0));
      facts = facts.slice(0, topN);

      // 简洁化
      if (brief) {
        facts = facts.map(f => ({
          cik: f.cik,
          name: f.entityName,
          val: f.val,
          end: f.end,
        }));
      }

      const payload = {
        taxonomy,
        tag,
        unit,
        frameCode,
        returned: facts.length,
        available: raw.data.length,
        facts,
      };

      /* 3｜体积守门 */
      const json = JSON.stringify(payload, null, 2);
      if (json.length > 50_000) {
        return {
          content: [
            {
              type: 'text',
              text:
                `⚠️ 返回体积 ${(json.length / 1024).toFixed(1)} KB，仍过大。\n` +
                `请减少 topN、启用 brief=true，或指定 ciks 进一步收敛。`,
            },
          ],
        };
      }

      /* 4｜OK 返给调用者 */
      return { content: [{ type: 'text', text: json }] };
    }
  );

  server.tool(
    'get-company-facts',
    '精确获取公司财务概念，可按 tag / taxonomy / 期间过滤',
    {
      cik: z.string().regex(/^\d{1,10}$/),

      /** 允许多选 Tag，用逗号分隔 */
      tags: z.string().describe('想要的 XBRL 标签，多个用逗号分隔。留空=全部'),

      /** taxonomy 过滤，可选 */
      taxonomy: z.enum(TAXONOMY_ENUM).optional().describe('限定分类标准（us-gaap 等）'),

      /** 单位过滤，可选；SEC 支持 "?unit=USD" 服务器端过滤 */
      unit: z.enum(UNIT_ENUM).optional(),

      /** 期间过滤（闭区间） */
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      end: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),

      /** 只要 latest（一行一概念） */
      latestOnly: z.boolean().optional(),
    },
    async ({ cik, tags, taxonomy, unit, start, end, latestOnly }) => {
      const url =
        `/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json` + (unit ? `?unit=${unit}` : '');
      const data = await makeSecRequest<any>(url);
      if (!data) return { content: [{ type: 'text', text: '请求失败' }] };

      // 1) taxonomy 过滤
      const books = taxonomy ? { [taxonomy]: data.facts[taxonomy] } : data.facts;

      // 2) tag 过滤
      const tagSet = tags ? new Set(tags.split(',').map(t => t.trim())) : null;

      // 3) 裁剪并聚合
      const out: Record<string, any> = {};
      for (const [tax, conceptDict] of Object.entries(books)) {
        for (const [tag, body] of Object.entries(conceptDict as Record<string, any>)) {
          if (tagSet && !tagSet.has(tag)) continue;
          const series = body.units;

          // 4) 遍历 unit → array of facts
          for (const [u, facts] of Object.entries<any>(series)) {
            // 5) 期间过滤 + latestOnly
            const filtered = facts
              .filter((f: any) => (!start || f.end >= start) && (!end || f.end <= end))
              .sort((a: any, b: any) => b.end.localeCompare(a.end)); // latest first

            if (!filtered.length) continue;

            out[tag] ??= {};
            out[tag][u] = latestOnly ? filtered[0] : filtered;
          }
        }
      }

      const json = JSON.stringify(out);
      if (json.length > 50_000) {
        // 构建树形结构（只展示第一层）
        const tags = Object.keys(out);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `☹️ 结果过大（${(json.length / 1024).toFixed(1)} KB），请选择要查看的标签：`,
                  tags,
                  suggestions: [
                    '请指定具体的 tags 参数，例如：tags=RevenueFromContractWithCustomerExcludingAssessedTax,NetIncomeLoss',
                    '使用 latestOnly=true 只获取最新数据',
                    '缩小日期范围：start=2023-01-01&end=2023-12-31',
                    '指定单位：unit=USD',
                  ],
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
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

        // 确保 filings 和 recent 存在
        if (!data.filings?.recent) {
          console.error('Invalid response structure:', data);
          return {
            content: [
              {
                type: 'text',
                text: '获取公司提交历史失败：响应数据结构无效',
              },
            ],
          };
        }

        // 将列式数据转换为行式数据
        const recentRows = pivotRecent(data.filings.recent);

        // 排序（SEC 默认已按时间倒序，但保险起见再排一次）
        recentRows.sort((a, b) => b.filingDate.localeCompare(a.filingDate));

        // 处理分页
        const total = recentRows.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const pagedSubmissions = recentRows.slice(start, end);

        // 构建分页后的响应
        const response = {
          cik: data.cik,
          entityType: data.entityType,
          sic: data.sic,
          sicDescription: data.sicDescription,
          name: data.name,
          tickers: data.tickers,
          exchanges: data.exchanges,
          insiderTransactionForOwnerExists: data.insiderTransactionForOwnerExists,
          insiderTransactionForIssuerExists: data.insiderTransactionForIssuerExists,
          filings: {
            recent: pagedSubmissions,
            files: data.filings.files || [],
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
  /* company-submissions resource (新版) */
  server.resource(
    'company-submissions',
    new ResourceTemplate('sec://submissions/{cik}{/file}', { list: undefined }),
    async (uri, params, query) => {
      const cik = String(params.cik).padStart(10, '0');
      const file = params.file as string | undefined;

      /* ──1｜获取根 JSON────────────────── */
      const root = await makeSecRequest<any>(`/submissions/CIK${cik}.json`);
      if (!root) return { contents: [{ uri: uri.href, text: '未找到提交记录' }] };

      /* ──2｜目录请求────────────── */
      if (!file) {
        const listing = [
          ...root.filings.files.map((f: any) => ({ type: 'file', name: f.name })),
          { type: 'recent', name: 'recent' },
        ];
        return {
          contents: [
            { uri: uri.href, blob: JSON.stringify(listing), mimeType: 'application/json' },
          ],
        };
      }

      /* ──3｜recent (分页 + 行式)─── */
      if (file === 'recent') {
        const { page = 1, pageSize = 20 } = query as any;
        const rows = pivotRecent(root.filings.recent);
        const start = (page - 1) * pageSize;
        const slice = rows.slice(start, start + pageSize);

        return {
          contents: [
            {
              uri: uri.href,
              blob: JSON.stringify({ page, pageSize, total: rows.length, rows: slice }),
              mimeType: 'application/json',
            },
          ],
        };
      }

      /* ──4｜年度文件：透传 SEC JSON─ */
      const data = await makeSecRequest<any>(`/submissions/${file}`);
      if (!data) return { contents: [{ uri: uri.href, text: '未找到文件' }] };
      return {
        contents: [{ uri: uri.href, blob: JSON.stringify(data), mimeType: 'application/json' }],
      };
    }
  );
  /* company-facts resource (瘦身) */
  server.resource(
    'company-facts',
    new ResourceTemplate('sec://xbrl/facts/{cik}{/taxonomy}{/tag}', { list: undefined }),
    async (uri, params, query) => {
      const cik = String(params.cik).padStart(10, '0');
      const taxonomy = params.taxonomy as string | undefined;
      const tag = params.tag as string | undefined;

      const full = await makeSecRequest<any>(`/api/xbrl/companyfacts/CIK${cik}.json`);
      if (!full) return { contents: [{ uri: uri.href, text: '未找到财务数据' }] };

      /* ──目录：列出全部 taxonomy/tag── */
      if (!taxonomy || !tag) {
        const idx: any[] = [];
        for (const [tax, obj] of Object.entries<any>(full.facts)) {
          for (const t of Object.keys(obj)) idx.push({ taxonomy: tax, tag: t });
        }
        return {
          contents: [{ uri: uri.href, blob: JSON.stringify(idx), mimeType: 'application/json' }],
        };
      }

      /* ──具体概念── */
      const unit = (query as any).unit as string | undefined;
      const latestOnly = (query as any).latestOnly === 'true';

      const concept = full.facts[taxonomy]?.[tag];
      if (!concept) return { contents: [{ uri: uri.href, text: '无此概念' }] };

      let units = concept.units ?? {};
      if (unit) units = { [unit]: units[unit] ?? [] };

      // 裁剪
      if (latestOnly) {
        for (const k of Object.keys(units)) {
          units[k] = units[k].sort((a: any, b: any) => b.end.localeCompare(a.end)).slice(0, 1);
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            blob: JSON.stringify({ cik, taxonomy, tag, units }),
            mimeType: 'application/json',
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
