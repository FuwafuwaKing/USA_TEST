// server.js (更新版)

const http = require('http');
const express = require('express');
const dotenv = require('dotenv');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');
const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();
const speechClient = new speech.SpeechClient();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- WebSocket接続の処理 (変更なし) ---
wss.on('connection', (ws) => {
  console.log('クライアントがWebSocketで接続しました。');
  let isConnectionAlive = true;
  const recognizeStream = speechClient
    .streamingRecognize({
      config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'ja-JP', enableAutomaticPunctuation: true },
      interimResults: true,
    })
    .on('error', (err) => { console.error('Speech API Error:', err); isConnectionAlive = false; })
    .on('data', (data) => {
      const result = data.results[0];
      if (isConnectionAlive && result && result.alternatives[0]) {
        ws.send(JSON.stringify({ type: 'transcript', isFinal: result.isFinal, text: result.alternatives[0].transcript }));
      }
    });
  ws.on('message', (message) => { if (isConnectionAlive) { recognizeStream.write(message); } });
  ws.on('close', () => { console.log('クライアントとのWebSocket接続が切れました。'); isConnectionAlive = false; recognizeStream.destroy(); });
});

// --- ヘルパー関数: 感情分析 (変更なし) ---
async function detectEmotion(imageBase64) {
  try {
    const request = { image: { content: Buffer.from(imageBase64, 'base64') }, features: [{ type: 'FACE_DETECTION', maxResults: 1 }] };
    const [result] = await visionClient.annotateImage(request);
    const faceAnnotations = result.faceAnnotations;
    if (!faceAnnotations || faceAnnotations.length === 0) return "表情不明";
    const emotions = { joy: faceAnnotations[0].joyLikelihood, sorrow: faceAnnotations[0].sorrowLikelihood, anger: faceAnnotations[0].angerLikelihood, surprise: faceAnnotations[0].surpriseLikelihood };
    const likelihoods = ['VERY_LIKELY', 'LIKELY', 'POSSIBLE'];
    for (const likelihood of likelihoods) {
      for (const [emotion, value] of Object.entries(emotions)) {
        if (value === likelihood) {
          const emotionMap = { joy: '喜び', sorrow: '悲しみ', anger: '怒り', surprise: '驚き' };
          return emotionMap[emotion] || '不明';
        }
      }
    }
    return "無表情";
  } catch (error) { console.error('Google Vision API Error:', error); throw new Error('感情の分析に失敗しました。'); }
}

// --- APIエンドポイント ---

// ★修正点1: リアルタイム感情認識用のエンドポイントを復活
app.post('/analyze-emotion', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: '画像データがありません。' });
  }
  try {
    const emotion = await detectEmotion(imageBase64);
    res.json({ emotion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ★修正点2: 物語生成エンドポイントを感情履歴に対応させる
app.post('/generate-story', async (req, res) => {
  // `emotionHistory`を受け取るように変更
  const { userText, messageHistory, emotionHistory } = req.body;

  if (!userText || !messageHistory || !emotionHistory) {
    return res.status(400).json({ error: '必要なデータが不足しています。' });
  }

  try {
    // 感情履歴を要約する
    let emotionSummary = '感情の変化なし';
    if (emotionHistory.length > 0) {
      // 連続する同じ感情を一つにまとめる
      const uniqueEmotions = emotionHistory.filter((emotion, index) => emotion !== emotionHistory[index - 1]);
      emotionSummary = uniqueEmotions.join(' → ');
    }

    // AIへの指示（プロンプト）を更新
    const userMessage = `ユーザーの反応: 「${userText}」\nその間の感情の推移: 「${emotionSummary}」`;
    
    const updatedHistory = [...messageHistory, { role: "user", content: userMessage }];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: updatedHistory,
      max_tokens: 250,
      temperature: 0.8,
    });

    const newStoryPart = completion.choices[0].message.content;
    const finalHistory = [...updatedHistory, { role: "assistant", content: newStoryPart }];
    res.json({ newStoryPart, updatedHistory: finalHistory });

  } catch (error) {
    console.error('Story Generation Error:', error);
    res.status(500).json({ error: '物語の生成に失敗しました。' });
  }
});

// --- サーバーの起動 ---
server.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました`);
});