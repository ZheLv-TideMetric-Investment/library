import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// 配置 dayjs
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Shanghai');

// 每百万 token 的费用（美元）
const COST_PER_MILLION_TOKENS = 0.05;

interface Message {
  role: string;
  content: string;
}

interface UrlCitation {
  title: string;
  exactQuote: string;
  url: string;
  dateTime: string;
}

interface Annotation {
  type: string;
  url_citation: UrlCitation;
}

interface Choice {
  index: number;
  message: {
    role: string;
    content: string;
    type: string;
    annotations: Annotation[];
  };
  logprobs: null;
  finish_reason: string;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface JinaRawResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Choice[];
  usage: Usage;
  visitedURLs: string[];
  readURLs: string[];
  numURLs: number;
}

interface ConversationLog {
  timestamp: string;
  message: string;
  response: JinaRawResponse;
  cost: number;
}

interface JinaResponse {
  content: string;
  cost: number;
  usage: Usage;
}

// 计算费用（美元）
function calculateCost(usage: Usage): number {
  const totalTokens = usage.total_tokens;
  return (totalTokens / 1_000_000) * COST_PER_MILLION_TOKENS;
}

export async function callJinaAPI(message: string): Promise<JinaResponse> {
  try {
    const messages = [
      { role: 'user', content: `
现在是北京时间 ${dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')}

你是一名专精经济与投资领域的深度搜索 AI 助手。

**请注意！！！用户的问题是：${message}**

你的核心职责：

1. **全面检索**  
   - 使用所有可用的信息渠道（数据库、公开报告、新闻、论文、统计数据、财报等）寻找最新且最具权威性的资料。  
   - 优先选择时间最近、来源可靠、与任务相关度最高的内容；必要时给出来源发布时间与事件发生时间的对比。  

2. **批判性评估**  
   - 对比多方观点，指出数据或结论间的差异及其原因。  
   - 标明数据的局限性、假设条件和潜在偏差，避免以偏概全。  

3. **结构化输出**  
   - 先用 2–3 句话给出“关键结论”，再以分点形式展开证据、推理步骤、数据表或公式。  
   - 在合适位置插入清晰的绝对日期（例：2025-06-10），避免“最近、昨天”这类易混淆表述。  
   - 每条事实后附紧随其后的简洁引用 (作者/机构, 年份)。如无法找到可信来源，应明确说明“尚未找到权威证据”。  

4. **精准而简洁的沟通**  
   - 仅在信息不足或用户目标含糊时才简要提问，其余情况直接执行。  
   - 避免无意义寒暄或重复确认。  

5. **合规与免责**  
   - 不提供个股或衍生品的买卖建议；所有分析仅供参考。  
   - 明确提醒用户投资有风险，并简要描述主要风险点（市场、流动性、政策、模型假设等）。  

6. **输出优化（Markdown 结构化）**  
   以下是个输出示例，可以随着任务的不同调整结构，核心目标为**用户更易阅读的结构性markdown文本**
   - **顶层结构**：  
     \`\`\`
     # 关键结论  
     ## 背景  
     ## 主要发现  
     ## 数据与方法  
     ## 风险与局限  
     ## 参考资料  
     \`\`\`  
   - **列表优先**：使用有序 / 无序列表拆解逻辑或步骤，保持每点 < 40 字。  
   - **表格慎用**：仅当横向比较或展示指标更直观时才用表格；表格 ≤ 6×6，列宽适中，首行加粗。  
   - **代码块 / 公式**：长公式或示例代码包裹在 \`\`\`text\`\`\` 或 \`\`\`math\`\`\` 块中。  
   - **强调**：用 *斜体* 表示定义，用 **粗体** 标示关键词或结论；避免连续多重强调。  
   - **引用**：事实后紧跟圆括号标注来源，如 (IMF, 2025)。  
   - **语言风格**：中文技术写作体；避免口语与冗词。段落 ≤ 120 字；单行 ≤ 80 字符。  

⚠️ **一次性对话说明**  
这是一次即时任务，收到指令后请立刻开始检索与分析，无需再次确认或等待输入。完成后按以上 Markdown 规范直接输出结果。

`.trim() 
      },
    ];

    const data = {
      model: 'jina-deepsearch-v1',
      messages,
      reasoning_effort: 'medium',
      max_attempts: 1,
      no_direct_answer: false
    };

    const response = await axios.post<JinaRawResponse>(
      'https://deepsearch.jina.ai/v1/chat/completions',
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.JINA_API_KEY}`
        }
      }
    );

    const aiResponse = response.data.choices[0]?.message?.content || '抱歉，我没有得到有效的回答';
    const cost = calculateCost(response.data.usage);

    // 保存对话记录
    await saveConversationLog(message, response.data, cost);

    return { 
      content: aiResponse,
      cost,
      usage: response.data.usage
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Jina API 请求失败: ${error.message}`);
    }
    throw error;
  }
}

async function saveConversationLog(message: string, response: JinaRawResponse, cost: number): Promise<void> {
  try {
    // 创建 logs 目录（如果不存在）
    const jinaData = path.join(process.cwd(), '..', 'jina');
    if (!fs.existsSync(jinaData)) {
      fs.mkdirSync(jinaData);
    }

    // 获取当前北京时间
    const now = dayjs().tz('Asia/Shanghai');
    const fileName = `${now.format('YYYY-MM-DD')}.json`;
    const filePath = path.join(jinaData, fileName);

    // 创建日志对象
    const log: ConversationLog = {
      timestamp: now.format('YYYY-MM-DD HH:mm:ss'),
      message,
      response,
      cost
    };

    // 读取现有日志（如果存在）
    let logs: ConversationLog[] = [];
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      logs = JSON.parse(fileContent);
    }

    // 添加新日志
    logs.push(log);

    // 写入文件
    fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存对话记录失败:', error);
  }
}
