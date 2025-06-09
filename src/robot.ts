import express from 'express';

const app = express();

// GET /robot 接口，返回收到的请求参数
app.get('/robot', (req, res) => {
  res.json({ received: req.query });
});

const PORT = process.env.ROBOT_PORT || 4001;
app.listen(PORT, () => {
  console.log(`Robot API listening on port ${PORT}, open http://localhost:${PORT}/robot`);
});
