// server.js (更新版)

const http = require('http');
const express = require('express');
const dotenv = require('dotenv');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');
const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech'); //

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();
const speechClient = new speech.SpeechClient();
const textToSpeechClient = new textToSpeech.TextToSpeechClient(); //
const availableSoundEffects = [
    { name: '風鈴の音', file: 'SoundEffects/bell.mp3' },
    { name: '鳥のさえずり', file: 'SoundEffects/bird.mp3' },
    { name: '時計の針の音', file: 'SoundEffects/clock.mp3' },
    { name: 'カラスの鳴き声', file: 'SoundEffects/crow.mp3' },
    { name: 'ドアを叩く音', file: 'SoundEffects/doorKnock.mp3' },
    { name: 'ドアを開く音', file: 'SoundEffects/doorOpen.mp3' },
    { name: '引き戸を開く音', file: 'SoundEffects/doorSlide.mp3' },
    { name: '電気の音', file: 'SoundEffects/electric.mp3' },
    { name: '炎の音', file: 'SoundEffects/fire.mp3' },
    { name: '足音', file: 'SoundEffects/footstep.mp3' },
    { name: '波の音', file: 'SoundEffects/ocean.mp3' },
    { name: '鉛筆が転がる音', file: 'SoundEffects/pencil.mp3' },
    { name: '雷の音', file: 'SoundEffects/thunder.mp3' },
    { name: '水滴の音', file: 'SoundEffects/waterdrop.mp3' },
    { name: '風の音', file: 'SoundEffects/wind.mp3' },
    { name: '静かなノック音', file: 'SoundEffects/windowKnock.mp3' },
    { name: '効果音なし', file: 'none'}
];

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

async function synthesizeSpeech(text) {                                 //{
    const request = {
      input: { text: text },
      // 音声の選択 (ja-JP-Wavenet-Bは標準的な女性の声)
      voice: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-B' },
      audioConfig: { audioEncoding: 'MP3' },
    };
  
    try {
      const [response] = await textToSpeechClient.synthesizeSpeech(request);
      // オーディオコンテンツをBase64文字列に変換して返す
      return response.audioContent.toString('base64');
    } catch (error) {
      console.error('Text-to-Speech API Error:', error);
      throw new Error('音声の生成に失敗しました。');
    }
}                                                                       //}

// --- APIエンドポイント ---
app.post('/synthesize-speech', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'テキストが提供されていません。' });
    }
    try {
        const audioBase64 = await synthesizeSpeech(text);
        res.json({ audioBase64 });
    } catch (error) {
        console.error('Speech synthesis failed:', error);
        res.status(500).json({ error: '音声の生成に失敗しました。' });
    }
});

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
  const { userText, messageHistory, emotionHistory } = req.body; // messageHistory には system プロンプトが含まれている想定

  if (!userText || !messageHistory || !emotionHistory) {
    return res.status(400).json({ error: '必要なデータが不足しています。' });
  }

  try {
      let emotionSummary = '感情の変化なし';
      if (emotionHistory.length > 0) {
          const uniqueEmotions = emotionHistory.filter((emotion, index) => emotion !== emotionHistory[index - 1]);
          emotionSummary = uniqueEmotions.join(' → ');
      }

      // ★修正1: OpenAIに送るためのシステムプロンプトを再構築
      const soundEffectForPrompt = availableSoundEffects.map(effect => `${effect.name} (${effect.file})`).join(', ');
      const baseSystemPrompt = messageHistory[0].content; // 最初のシステムプロンプトの内容を取得

      const fullSystemPromptContent = `${baseSystemPrompt}
          利用可能な効果音リスト: ${soundEffectForPrompt}
          必ず以下のJSON形式だけで応答してください。
          {
          "story": "ここに物語の続きの文章（1～2文）を記述",
          "soundEffect": "物語の雰囲気に最も合う効果音を、提示されたリストの中から選び、その「ファイル名」だけを記述。例: 'SoundEffects/doorKnock.mp3'。なければ'none'とする。",
          "isLastPart": trueかfalseのboolean値。物語を完結させるべきと判断したらtrueにする。
          }`;

      const userMessage = { role: "user", content: `ユーザーの反応: 「${userText}」\nその間の感情の推移: 「${emotionSummary}」` };
      
      // ★修正2: messagesToSend の構築方法
      const messagesToSend = [
          { role: "system", content: fullSystemPromptContent }, // 更新されたシステムプロンプトを最初に置く
          ...messageHistory.slice(1), // 既存の履歴の最初の要素（古いシステムプロンプト）を除外し、残りを追加
          userMessage
      ];

      const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: messagesToSend, // 更新されたメッセージ履歴を渡す
          max_tokens: 250,
          temperature: 0.8,
          response_format: { type: 'json_object' },
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content);
      let { story, soundEffect, isLastPart } = aiResponse; 

      if (!story || story.trim() === '') {
          console.warn("OpenAI returned an empty story. Using a default message.");
          story = "すみません、物語を生成できませんでした。もう一度話しかけてください。";
      }

      const audioBase64 = await synthesizeSpeech(story);

      // ★修正3: finalHistory の構築方法。最新のシステムプロンプトを含めて返す
      const finalHistory = [...messageHistory, userMessage, { role: "assistant", content: story }];
      
      res.json({
          newStoryPart: story,
          audioBase64,
          soundEffect,
          isLastPart,
          updatedHistory: finalHistory
      });                                                     

  } catch (error) {
      console.error('Story Generation Error:', error);
      res.status(500).json({ error: '物語の生成に失敗しました。' });
  }
});

// --- サーバーの起動 ---
server.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました`);
});