// server.js (修正版)

// 必要なライブラリをインポート
const express = require('express');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const vision = require('@google-cloud/vision');

// .envファイルから環境変数を読み込む
dotenv.config();

// --- クライアントの初期化 ---
// OpenAIクライアント
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Google Vision APIクライアント
const visionClient = new vision.ImageAnnotatorClient();

// --- Expressサーバーの設定 ---
const app = express();
const port = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));


// --- ヘルパー関数: 感情分析 ---
async function detectEmotion(imageBase64) {
  try {
    const request = {
      image: {
        content: Buffer.from(imageBase64, 'base64'),
      },
      features: [{ type: 'FACE_DETECTION', maxResults: 1 }],
    };

    // ★★★ ここが修正点 ★★★
    // faceDetectionからannotateImageメソッドに変更
    const [result] = await visionClient.annotateImage(request);
    // ★★★ 修正点ここまで ★★★
    
    const faceAnnotations = result.faceAnnotations;

    if (!faceAnnotations || faceAnnotations.length === 0) {
      return "表情不明";
    }

    const emotions = {
      joy: faceAnnotations[0].joyLikelihood,
      sorrow: faceAnnotations[0].sorrowLikelihood,
      anger: faceAnnotations[0].angerLikelihood,
      surprise: faceAnnotations[0].surpriseLikelihood,
    };

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
  } catch (error) {
    console.error('Google Vision API Error:', error);
    throw new Error('感情の分析に失敗しました。');
  }
}

// --- APIエンドポイント ---

// 1. 定期的な感情プレビュー用エンドポイント
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

// 2. 物語生成用エンドポイント
app.post('/generate-story', async (req, res) => {
  const { userText, imageBase64, messageHistory } = req.body;

  if (!userText || !imageBase64 || !messageHistory) {
    return res.status(400).json({ error: '必要なデータが不足しています。' });
  }

  try {
    const emotion = await detectEmotion(imageBase64);
    const userMessage = `ユーザーの反応: 「${userText}」\nユーザーの表情から読み取れた感情: 「${emotion}」`;
    const updatedHistory = [...messageHistory, { role: "user", content: userMessage }];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: updatedHistory,
      max_tokens: 200,
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
app.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました`);
});