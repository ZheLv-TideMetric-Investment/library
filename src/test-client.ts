import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface ToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

// 添加延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 添加重试函数
async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 5,
  delayMs: number = 3000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`连接失败，${delayMs/1000}秒后重试... (剩余重试次数: ${retries})`);
    await delay(delayMs);
    return retry(fn, retries - 1, delayMs);
  }
}

async function testSecServer() {
  // 创建 MCP 客户端
  const client = new Client({
    name: 'SEC API Test Client',
    version: '1.0.0',
  });

  // 连接到服务器
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/index.ts'],
  });

  try {
    // 等待服务器启动
    console.log('等待服务器启动...');
    await delay(5000);

    // 使用重试机制连接服务器
    await retry(async () => {
      await client.connect(transport);
      console.log('Connected to SEC API Server');
    });

    // 测试获取公司提交历史
    console.log('\n测试获取公司提交历史:');
    const submissions = await client.readResource({
      uri: 'sec://submissions/0000320193', // Apple Inc. 的 CIK
    });
    console.log('公司提交历史:', submissions.contents[0].text);

    // 测试获取公司 XBRL 数据
    console.log('\n测试获取公司 XBRL 数据:');
    const facts = await client.readResource({
      uri: 'sec://xbrl/facts/0000320193',
    });
    console.log('公司 XBRL 数据:', facts.contents[0].text);

    // 测试获取特定概念的 XBRL 数据
    console.log('\n测试获取特定概念的 XBRL 数据:');
    const concept = (await client.callTool({
      name: 'get-company-concept',
      arguments: {
        cik: '0000320193',
        taxonomy: 'us-gaap',
        tag: 'AccountsPayableCurrent',
      },
    })) as ToolResponse;
    console.log('特定概念的 XBRL 数据:', concept.content[0].text);

    // 测试获取 XBRL frames 数据
    console.log('\n测试获取 XBRL frames 数据:');
    const frames = (await client.callTool({
      name: 'get-xbrl-frames',
      arguments: {
        taxonomy: 'us-gaap',
        tag: 'AccountsPayableCurrent',
        unit: 'USD',
        period: 'CY2023Q1I',
      },
    })) as ToolResponse;
    console.log('XBRL frames 数据:', frames.content[0].text);
  } catch (error) {
    console.error('测试过程中发生错误:', error);
  } finally {
    // 关闭连接
    transport.close();
  }
}

// 运行测试
testSecServer().catch(console.error);
