#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from 'dotenv';
import './robot.js';

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
const PORT = process.env.PORT || 4000;

// Express app for SSE and HTTP endpoints
const app = express();
app.use(cors());
app.use(express.json());

// Store SSE transports
const transports = new Map<string, SSEServerTransport>();

/* ============================================================
 * 核心工具函数
 * ========================================================== */

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

// CIK 标准化和 Ticker 映射函数
async function resolveCik(tickerOrCik: string): Promise<string | null> {
  // 如果已经是 CIK 格式，直接返回
  if (/^\d{1,10}$/.test(tickerOrCik)) {
    return tickerOrCik.padStart(10, '0');
  }

  // TODO: 实现 ticker 到 CIK 的映射
  // 现在简单返回 null，需要时可以实现
  return null;
}

// 字段映射函数：将 XBRL 标签映射为简化键名
const FIELD_MAPPING = {
  // 利润表
  'RevenueFromContractWithCustomerExcludingAssessedTax': 'revenue',
  'CostOfRevenue': 'costOfRevenue', 
  'GrossProfit': 'grossProfit',
  'OperatingExpenses': 'operatingExpenses',
  'OperatingIncomeLoss': 'operatingIncome',
  'NetIncomeLoss': 'netIncome',
  'EarningsPerShareBasic': 'epsBasic',
  'EarningsPerShareDiluted': 'epsDiluted',
  
  // 资产负债表
  'Assets': 'totalAssets',
  'CurrentAssets': 'currentAssets',
  'Liabilities': 'totalLiabilities',
  'CurrentLiabilities': 'currentLiabilities',
  'StockholdersEquity': 'shareholdersEquity',
  'CashAndCashEquivalentsAtCarryingValue': 'cash',
  
  // 现金流量表
  'OperatingCashFlow': 'operatingCashFlow',
  'CapitalExpenditures': 'capitalExpenditures',
};

// 财务指标计算函数
function calculateMetrics(data: any) {
  const metrics: any = {};
  
  // 毛利率
  if (data.revenue && data.costOfRevenue) {
    metrics.grossMargin = ((data.revenue - data.costOfRevenue) / data.revenue) * 100;
  }
  
  // 净利率
  if (data.netIncome && data.revenue) {
    metrics.netMargin = (data.netIncome / data.revenue) * 100;
  }
  
  // ROE (净资产收益率)
  if (data.netIncome && data.shareholdersEquity) {
    metrics.roe = (data.netIncome / data.shareholdersEquity) * 100;
  }
  
  // ROA (总资产回报率)
  if (data.netIncome && data.totalAssets) {
    metrics.roa = (data.netIncome / data.totalAssets) * 100;
  }
  
  // 流动比率
  if (data.currentAssets && data.currentLiabilities) {
    metrics.currentRatio = data.currentAssets / data.currentLiabilities;
  }
  
  // 负债权益比
  if (data.totalLiabilities && data.shareholdersEquity) {
    metrics.debtToEquity = data.totalLiabilities / data.shareholdersEquity;
  }
  
  return metrics;
}

// 获取公司财务数据的核心函数
async function getCompanyFinancials(
  tickerOrCik: string,
  options: {
    period?: string;
    statements?: string;
    metrics?: boolean;
    fields?: string;
  } = {}
) {
  const { period = 'latest', statements = 'all', metrics = false, fields } = options;
  
  // 1. 解析 CIK
  let cik = await resolveCik(tickerOrCik);
  if (!cik) {
    // 如果 ticker 映射失败，尝试作为 CIK 处理
    cik = tickerOrCik.padStart(10, '0');
  }
  
  // 2. 获取公司财务数据
  const factsData = await makeSecRequest<any>(`/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!factsData) {
    throw new Error('无法获取公司财务数据');
  }
  
  // 3. 处理数据并映射字段
  const processedData: any = {
    cik,
    ticker: tickerOrCik,
    period,
    statements: {},
  };
  
  // 从 us-gaap 中提取数据
  const usGaap = factsData.facts['us-gaap'] || {};
  const mappedData: any = {};
  
  for (const [xbrlTag, friendlyName] of Object.entries(FIELD_MAPPING)) {
    const concept = usGaap[xbrlTag];
    if (concept && concept.units) {
      // 获取 USD 单位的最新数据
      const usdData = concept.units['USD'];
      if (usdData && usdData.length > 0) {
        // 按日期排序，取最新
        const latest = usdData.sort((a: any, b: any) => b.end.localeCompare(a.end))[0];
        mappedData[friendlyName] = latest.val;
      }
    }
  }
  
  // 4. 按表分类
  if (statements === 'all' || statements.includes('income')) {
    processedData.statements.income = {
      revenue: mappedData.revenue,
      costOfRevenue: mappedData.costOfRevenue,
      grossProfit: mappedData.grossProfit,
      operatingExpenses: mappedData.operatingExpenses,
      operatingIncome: mappedData.operatingIncome,
      netIncome: mappedData.netIncome,
      epsBasic: mappedData.epsBasic,
      epsDiluted: mappedData.epsDiluted,
    };
  }
  
  if (statements === 'all' || statements.includes('balance')) {
    processedData.statements.balance = {
      totalAssets: mappedData.totalAssets,
      currentAssets: mappedData.currentAssets,
      cash: mappedData.cash,
      totalLiabilities: mappedData.totalLiabilities,
      currentLiabilities: mappedData.currentLiabilities,
      shareholdersEquity: mappedData.shareholdersEquity,
    };
  }
  
  if (statements === 'all' || statements.includes('cashflow')) {
    processedData.statements.cashflow = {
      operatingCashFlow: mappedData.operatingCashFlow,
      capitalExpenditures: mappedData.capitalExpenditures,
    };
  }
  
  // 5. 计算指标
  if (metrics) {
    processedData.metrics = calculateMetrics(mappedData);
  }
  
  // 6. 字段过滤
  if (fields) {
    const requestedFields = fields.split(',').map(f => f.trim());
    const filteredData: any = {};
    for (const field of requestedFields) {
      if (processedData[field] !== undefined) {
        filteredData[field] = processedData[field];
      }
    }
    return filteredData;
  }
  
  return processedData;
}

/* ============================================================
 * MCP Server 设置
 * ========================================================== */

// 创建 MCP server
const createServer = () => {
  const server = new Server(
    {
      name: 'sec-friendly-api',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 定义工具
  const tools: Tool[] = [
    {
      name: 'get-company-financials',
      description: '获取公司财务三表数据，支持最新或历史期间，可选择特定报表和计算指标',
      inputSchema: {
        type: 'object',
        required: ['company'],
        properties: {
          company: {
            type: 'string',
            description: '公司股票代码（如 AAPL）或 CIK 编号（如 0000320193）',
          },
          period: {
            type: 'string',
            description: '报告期：latest（默认）/ YYYY / YYYY-Q1 等',
            default: 'latest',
          },
          statements: {
            type: 'string',
            description: '要返回的报表：all（默认）/ income / balance / cashflow，可用逗号分隔多个',
            default: 'all',
          },
          metrics: {
            type: 'boolean',
            description: '是否计算并返回财务指标（毛利率、ROE等）',
            default: false,
          },
          fields: {
            type: 'string',
            description: '逗号分隔的字段名列表，用于精简返回数据',
          },
        },
      },
    },
    {
      name: 'get-company-metrics',
      description: '获取公司财务指标（ROE、ROA、毛利率等）',
      inputSchema: {
        type: 'object',
        required: ['company'],
        properties: {
          company: {
            type: 'string',
            description: '公司股票代码（如 AAPL）或 CIK 编号',
          },
          period: {
            type: 'string',
            description: '报告期：latest（默认）/ YYYY / YYYY-Q1 等',
            default: 'latest',
          },
          metrics: {
            type: 'string',
            description: '指定要计算的指标，逗号分隔：grossMargin,netMargin,roe,roa,currentRatio,debtToEquity',
          },
        },
      },
    },
    {
      name: 'compare-financials',
      description: '多公司财务三表对比分析',
      inputSchema: {
        type: 'object',
        required: ['companies'],
        properties: {
          companies: {
            type: 'string',
            description: '公司列表，逗号分隔（如：AAPL,MSFT,GOOG）',
          },
          period: {
            type: 'string',
            description: '报告期：latest（默认）/ YYYY / YYYY-Q1 等',
            default: 'latest',
          },
          statements: {
            type: 'string',
            description: '要对比的报表：all / income / balance / cashflow',
            default: 'income',
          },
          metrics: {
            type: 'boolean',
            description: '是否包含财务指标对比',
            default: true,
          },
        },
      },
    },
    {
      name: 'compare-metrics',
      description: '多公司关键财务指标对比',
      inputSchema: {
        type: 'object',
        required: ['companies'],
        properties: {
          companies: {
            type: 'string',
            description: '公司列表，逗号分隔（如：AAPL,MSFT,GOOG）',
          },
          period: {
            type: 'string',
            description: '报告期：latest（默认）/ YYYY / YYYY-Q1 等',
            default: 'latest',
          },
          metrics: {
            type: 'string',
            description: '要对比的指标，逗号分隔：roe,netMargin等。留空则显示全部常用指标',
          },
        },
      },
    },
  ];

  // 设置工具列表处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools,
    };
  });

  // 设置工具调用处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'get-company-financials': {
          const { company, period, statements, metrics, fields } = args as any;
          const result = await getCompanyFinancials(company, {
            period,
            statements,
            metrics,
            fields,
          });
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'get-company-metrics': {
          const { company, period, metrics: requestedMetrics } = args as any;
          const financialData = await getCompanyFinancials(company, {
            period,
            metrics: true,
          });
          
          let result = financialData.metrics;
          
          // 如果指定了特定指标，只返回那些
          if (requestedMetrics) {
            const requestedList = requestedMetrics.split(',').map((m: string) => m.trim());
            result = {};
            for (const metric of requestedList) {
              if (financialData.metrics[metric] !== undefined) {
                result[metric] = financialData.metrics[metric];
              }
            }
          }
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  company,
                  period,
                  metrics: result,
                }, null, 2),
              },
            ],
          };
        }

        case 'compare-financials': {
          const { companies, period, statements, metrics } = args as any;
          const companyList = companies.split(',').map((c: string) => c.trim());
          
          // 并行获取所有公司数据
          const companyData = await Promise.all(
            companyList.map(async (company: string) => {
              try {
                const data = await getCompanyFinancials(company, {
                  period,
                  statements,
                  metrics,
                });
                return { company, ...data };
              } catch (error) {
                return {
                  company,
                  error: error instanceof Error ? error.message : '获取数据失败',
                };
              }
            })
          );
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  period,
                  comparison: companyData,
                }, null, 2),
              },
            ],
          };
        }

        case 'compare-metrics': {
          const { companies, period, metrics: requestedMetrics } = args as any;
          const companyList = companies.split(',').map((c: string) => c.trim());
          
          // 并行获取所有公司指标
          const metricsData = await Promise.all(
            companyList.map(async (company: string) => {
              try {
                const data = await getCompanyFinancials(company, {
                  period,
                  metrics: true,
                });
                
                let companyMetrics = data.metrics;
                
                // 如果指定了特定指标，只返回那些
                if (requestedMetrics) {
                  const requestedList = requestedMetrics.split(',').map((m: string) => m.trim());
                  companyMetrics = {};
                  for (const metric of requestedList) {
                    if (data.metrics[metric] !== undefined) {
                      companyMetrics[metric] = data.metrics[metric];
                    }
                  }
                }
                
                return { company, ...companyMetrics };
              } catch (error) {
                return {
                  company,
                  error: error instanceof Error ? error.message : '获取数据失败',
                };
              }
            })
          );
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  period,
                  metrics: requestedMetrics ? requestedMetrics.split(',').map((m: string) => m.trim()) : '全部指标',
                  comparison: metricsData,
                }, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
};

/* ============================================================
 * Express Server 和 SSE 端点
 * ========================================================== */

// Handle SSE connection
app.get('/sse', async (req, res) => {
  try {
    console.log('New SSE connection');
    
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
  res.status(200).json({ 
    status: 'ok', 
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    transports: transports.size
  });
});


app.listen(PORT, () => {
  console.log(`SEC Friendly API MCP Server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});



