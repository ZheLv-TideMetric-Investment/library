import { EventSource } from 'eventsource';
import fetch from 'node-fetch';

/**
 * 工具类型定义
 */
interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
  };
}

/**
 * 延迟函数
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 重试函数
 */
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

/**
 * 检查工具注册
 */
async function checkTools(): Promise<void> {
  try {
    const response = await fetch('http://localhost:4000/tools');
    if (!response.ok) {
      throw new Error(`获取工具列表失败: ${response.statusText}`);
    }
    const tools = await response.json() as Tool[];
    console.log('\n已注册的工具列表:');
    tools.forEach((tool) => {
      console.log(`\n工具名称: ${tool.name}`);
      console.log(`描述: ${tool.description}`);
      console.log('输入参数:');
      console.log(JSON.stringify(tool.inputSchema, null, 2));
    });
  } catch (error) {
    console.error('检查工具注册失败:', error);
    throw error;
  }
}

/**
 * 测试客户端
 * 
 * 用于测试 SEC API MCP 服务器的功能
 */
async function main() {
  // 等待服务器启动
  console.log('等待服务器启动...');
  await delay(5000);

  // 检查工具注册
  await retry(checkTools);

  // 使用重试机制连接 SSE
  await retry(async () => {
    const eventSource = new EventSource('http://localhost:4000/events');

    // 监听连接事件
    eventSource.onopen = () => {
      console.log('\n已连接到 SSE 服务器');
    };

    // 监听消息事件
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'connected':
          console.log('服务器连接成功');
          break;
        case 'resource-update':
          console.log('资源更新:', {
            type: data.type,
            cik: data.cik,
            dataSize: JSON.stringify(data.data).length,
          });
          break;
        case 'tool-call':
          console.log('工具调用:', {
            type: data.type,
            ...data,
            dataSize: JSON.stringify(data.data).length,
          });
          break;
        case 'error':
          console.error('错误:', data);
          break;
        default:
          console.log('未知事件类型:', data);
      }
    };

    // 监听错误事件
    eventSource.onerror = (error) => {
      console.error('SSE 连接错误:', error);
      eventSource.close();
      throw error; // 触发重试
    };

    // 等待一段时间后关闭连接
    setTimeout(() => {
      console.log('\n测试完成，关闭连接');
      eventSource.close();
      process.exit(0);
    }, 30000); // 30 秒后关闭
  });
}

main().catch(error => {
  console.error('测试失败:', error);
  process.exit(1);
});
