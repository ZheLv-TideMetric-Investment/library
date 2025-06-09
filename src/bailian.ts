import axios from 'axios';
import { config } from 'dotenv';

// 加载环境变量
config();

// 百炼 API 配置
const API_KEY = process.env.BAILIAN_SK;

// 调用百炼 API 的函数
async function callBailianAPI(appId: string, userMessage: string) {
  const BAILIAN_API_URL = `https://dashscope.aliyuncs.com/api/v1/applications/${appId}/invoke`;
  try {
    const response = await axios.post(
      BAILIAN_API_URL,
      {
        prompt: userMessage,
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error calling Bailian API:', error);
    throw error;
  }
}

export { callBailianAPI }; 