import express from 'express';
import { callBailianAPI } from './bailian';

import { config } from 'dotenv';

// 加载环境变量
config();

const app = express();
app.use(express.json());

// 定义请求体的 TypeScript 类型
interface RobotRequestBody {
  conversationId: string;
  atUsers: Array<{ dingtalkId: string }>;
  chatbotUserId: string;
  msgId: string;
  senderNick: string;
  isAdmin: boolean;
  sessionWebhookExpiredTime: number;
  createAt: number;
  conversationType: string;
  senderId: string;
  conversationTitle: string;
  isInAtList: boolean;
  sessionWebhook: string;
  text: { content: string };
  robotCode: string;
  msgtype: string;
}

// POST /robot 接口，验证 token 并调用百炼 API
app.post('/robot', async (req, res) => {
  const token = req.headers.token;
  if (token?.toString().toLowerCase() !== 'tide') {
    return res.status(403).json({ error: 'Invalid token' });
  }
  const body = req.body as RobotRequestBody;
  try {
    const result = await callBailianAPI(process.env.BAILIAN_APP_ID as string, body.text.content);
    res.json({ received: body, bailianResponse: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to call Bailian API' });
  }
  return res.json({ received: body });
});

const PORT = process.env.ROBOT_PORT || 4001;
app.listen(PORT, () => {
  console.log(`Robot API listening on port ${PORT}, open http://localhost:${PORT}/robot`);
});
