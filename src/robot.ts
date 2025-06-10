import express, { text } from 'express';
import { callBailianAPI } from './bailian.js';
import { callJinaAPI } from './jina.js';
import axios from 'axios';

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
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
  const body = req.body as RobotRequestBody;
  let text = '';
  try {
    if(body.text.content === '活着没') {
      text = '活着呢';
    } else {
      const result = await callBailianAPI(process.env.BAILIAN_APP_ID as string, body.text.content);
      text = result.output.text;
    }
  } catch (error) {
    text = error instanceof Error ? error.message : 'Unknown error';
  }
  // 发送结果到 sessionWebhook
  await axios.post(body.sessionWebhook, {
    msgtype: 'markdown',
    markdown: {
      title: 'tide ulrta',
      text: `${text}`,
    }
  });
  res.status(200).json({ received: body, bailianResponse: text });
});

// 添加 Jina AI 接口
app.post('/jina', async (req, res) => {
  const token = req.headers.token;
  if (token?.toString().toLowerCase() !== 'tide') {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  const body = req.body as RobotRequestBody;
  let text = '';

  try {
    const result = await callJinaAPI(body.text.content);
    text = result.content;
  } catch (error) {
    text = error instanceof Error ? error.message : '调用 Jina AI 时发生错误';
  }

  // 发送结果到 sessionWebhook
  await axios.post(body.sessionWebhook, {
    msgtype: 'markdown',
    markdown: {
      title: 'tide jina',
      text: `${text}`,
    }
  });

  res.status(200).json({ received: body, jinaResponse: text });
});

const PORT = process.env.ROBOT_PORT || 4001;
app.listen(PORT, () => {
  console.log(`Robot API listening on port ${PORT}, open http://localhost:${PORT}/robot`);
});
