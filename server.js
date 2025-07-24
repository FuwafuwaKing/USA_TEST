// server.js (更新版 - セッションタイトル生成API追加)

const http = require('http');
const express = require('express');
const dotenv = require('dotenv');
const { WebSocketServer } = require('ws');
const OpenAI = require('openai');
const vision = require('@google-cloud/vision');
const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const { v4: uuidv4 } = require('uuid');

// --- Lowdb のインポートと設定 ---
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const file = 'sessions.json';
const adapter = new JSONFile(file);
const db = new Low(adapter, { sessions: [] }); // ここは前回修正済み

// データベースを読み込む関数
async function readDb() {
    await db.read();
    console.log('サーバー: データベースを初期化しました。既存のセッション数:', db.data.sessions.length);
}

// --- 環境変数の設定 ---
dotenv.config();

// --- 各APIクライアントの初期化 ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const visionClient = new vision.ImageAnnotatorClient();
const speechClient = new speech.SpeechClient();
const textToSpeechClient = new textToSpeech.TextToSpeechClient();

// --- 利用可能な効果音の定義 ---
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
];

// --- Expressアプリとサーバーのセットアップ ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = 3000;

app.use(express.json({ limit: '10mb' }));
// public ディレクトリを静的ファイルとして提供
// game.html が追加されたので、ルートアクセスでindex.htmlが提供されるように注意
app.use(express.static('public')); 


// --- WebSocket接続の処理 ---
wss.on('connection', (ws) => {
    console.log('サーバー: クライアントがWebSocketで接続しました。');
    let isConnectionAlive = true;
    const recognizeStream = speechClient
        .streamingRecognize({
            config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'ja-JP', enableAutomaticPunctuation: true },
            interimResults: true,
        })
        .on('error', (err) => { console.error('サーバー: Speech API Error:', err); isConnectionAlive = false; })
        .on('data', (data) => {
            const result = data.results[0];
            if (isConnectionAlive && result && result.alternatives[0]) {
                ws.send(JSON.stringify({ type: 'transcript', isFinal: result.isFinal, text: result.alternatives[0].transcript }));
            }
        });
    ws.on('message', (message) => { if (isConnectionAlive) { recognizeStream.write(message); } });
    ws.on('close', () => { console.log('サーバー: クライアントとのWebSocket接続が切れました。'); isConnectionAlive = false; recognizeStream.destroy(); });
});

// --- ヘルパー関数: 感情分析 ---
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
    } catch (error) { console.error('サーバー: Google Vision API Error:', error); throw new Error('感情の分析に失敗しました。'); }
}

async function synthesizeSpeech(text) {
    const request = {
        input: { text: text },
        voice: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-B' },
        audioConfig: { audioEncoding: 'MP3' },
    };
    
    try {
        const [response] = await textToSpeechClient.synthesizeSpeech(request);
        return response.audioContent.toString('base64');
    } catch (error) {
        console.error('サーバー: Text-to-Speech API Error:', error);
        throw new Error('音声の生成に失敗しました。');
    }
}

// --- APIエンドポイント ---

app.get('/start-session', async (req, res) => {
    const sessionId = uuidv4();
    const newSessionData = { sessionId, sessionTitle: "無題の物語", fearScores: [], conversation: [], timestamp: new Date().toISOString() };
    
    db.data.sessions.push(newSessionData);
    await db.write();
    
    console.log(`サーバー: 新しいセッションを開始しました: ${sessionId}`);
    res.json({ sessionId });
});

app.post('/save-session', async (req, res) => {
    const sessionData = req.body;
    if (sessionData && sessionData.sessionId) {
        await db.read();
        const index = db.data.sessions.findIndex(s => s.sessionId === sessionData.sessionId);
        if (index !== -1) {
            db.data.sessions[index] = sessionData;
            console.log(`サーバー: セッションデータ [${sessionData.sessionId}] を更新しました。`);
        } else {
            db.data.sessions.push(sessionData);
            console.log(`サーバー: 新しいセッションデータ [${sessionData.sessionId}] を追加しました。`);
        }
        await db.write();

        res.status(200).json({ message: 'Session saved successfully' });
    } else {
        console.warn('サーバー: 無効なセッションデータを受信しました:', sessionData);
        res.status(400).json({ error: 'Invalid session data' });
    }
});

app.get('/session-data/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    await db.read();
    const sessionData = db.data.sessions.find(s => s.sessionId === sessionId);
    
    if (sessionData) {
        console.log(`サーバー: セッションデータを提供します: ${sessionId}`);
        res.status(200).json(sessionData);
    } else {
        console.warn(`サーバー: セッションデータが見つかりません: ${sessionId}`);
        res.status(404).json({ error: 'Session not found' });
    }
});

app.get('/all-sessions', async (req, res) => {
    await db.read();
    const allSessions = db.data.sessions.map(data => ({
        sessionId: data.sessionId,
        sessionTitle: data.sessionTitle || "無題の物語", // ★変更: タイトルも返す
        timestamp: data.timestamp,
        fearScoresCount: data.fearScores ? data.fearScores.length : 0,
        conversationLength: data.conversation ? data.conversation.length : 0
    }));
    console.log(`サーバー: 全セッションリストを提供します (${allSessions.length}件)`);
    res.status(200).json(allSessions);
});

// ★追加: セッションタイトル生成API
app.post('/generate-session-title', async (req, res) => {
    const { conversation } = req.body;

    if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
        return res.status(400).json({ error: '会話履歴がありません。' });
    }

    try {
        // 直近の会話の一部を抜粋してGPTに渡す
        const recentConversation = conversation.slice(-5).map(entry => `${entry.speaker}: ${entry.text}`).join('\n');
        
        const promptMessages = [
            {
                role: "system",
                content: `あなたは物語のプロの編集者です。与えられた会話履歴に基づいて、そのホラー物語にふさわしい簡潔で魅力的なタイトルを日本語で生成してください。タイトルは20文字以内とし、JSON形式で返してください。例: {"title": "深淵からの囁き"}`
            },
            {
                role: "user",
                content: `以下の会話履歴にタイトルを付けてください:\n${recentConversation}`
            }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: promptMessages,
            max_tokens: 50,
            temperature: 0.7,
            response_format: { type: 'json_object' },
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        let title = aiResponse.title || "無題の物語"; // フォールバック
        // 20文字以内に制限
        title = title.substring(0, 20);

        console.log('サーバー: セッションタイトルを生成しました:', title);
        res.json({ title });

    } catch (error) {
        console.error('サーバー: セッションタイトル生成エラー:', error);
        res.status(500).json({ error: 'セッションタイトルの生成に失敗しました。', title: "無題の物語" });
    }
});


app.post('/synthesize-speech', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'テキストが提供されていません。' });
    }
    try {
        const audioBase64 = await synthesizeSpeech(text);
        res.json({ audioBase64 });
    } catch (error) {
        console.error('サーバー: Speech synthesis failed:', error);
        res.status(500).json({ error: '音声の生成に失敗しました。' });
    }
});

app.post('/analyze-emotion', async (req, res) => {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
        return res.status(400).json({ error: '画像データがありません。' });
    }
    try {
        const emotion = await detectEmotion(imageBase64);
        res.json({ emotion });
    } catch (error) {
        console.error('サーバー: 感情分析エラー:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/generate-story', async (req, res) => {
    const { sessionId, userText, messageHistory, emotionHistory, accelerometerVariance } = req.body;

    if (!userText || !messageHistory || !emotionHistory || !sessionId) {
        console.error('サーバー: generate-story: 必要なデータが不足しています。');
        return res.status(400).json({ error: '必要なデータが不足しています。' });
    }

    await db.read();
    const currentSessionData = db.data.sessions.find(s => s.sessionId === sessionId);
    
    if (!currentSessionData) {
        console.warn(`サーバー: 不明なセッションIDを受信しました: ${sessionId}。`);
        return res.status(404).json({ error: 'Session not found.' });
    }

    try {
        let emotionSummary = '感情の変化なし';
        if (emotionHistory.length > 0) {
            const uniqueEmotions = emotionHistory.filter((emotion, index) => emotion !== emotionHistory[index - 1]);
            emotionSummary = uniqueEmotions.join(' → ');
        }
        console.log(`サーバー [${sessionId}]: 受信したユーザーテキスト:`, userText);
        console.log(`サーバー [${sessionId}]: 受信した感情履歴:`, emotionSummary);
        console.log(`サーバー [${sessionId}]: 受信した加速度分散:`, accelerometerVariance);

        const soundEffectForPrompt = availableSoundEffects.map(effect => `${effect.name} (${effect.file})`).join(', ');
        const baseSystemPrompt = messageHistory[0].content;

        const fullSystemPromptContent = `${baseSystemPrompt}
            利用可能な効果音リスト: ${soundEffectForPrompt}
            ユーザーの直前の発言までの感情の推移: ${emotionSummary}
            ユーザーの直前の発言までの加速度データの動きの分散（値が大きいほど活発な動き、nullの場合はデータなし）: ${accelerometerVariance !== null ? accelerometerVariance.toFixed(4) : 'データなし'}

            これらの情報に基づいて、ユーザーの恐怖度を0（全く恐怖なし）から100（極度の恐怖）の整数値で推定し、JSONの'fearScore'フィールドに含めてください。
            物語を完結させるべきと判断した場合は、JSONの'isLastPart'をtrueにしてください。

            必ず以下のJSON形式だけで応答してください。
            {
            "story": "ここに物語の続きの文章（1～2文）を記述",
            "soundEffect": "物語の雰囲気に最も合う効果音を、提示されたリストの中から選び、その「ファイル名」だけを記述。例: 'SoundEffects/doorKnock.mp3'。なければ'none'とする。",
            "isLastPart": trueかfalseのboolean値。物語を完結させるべきと判断したらtrueにする。
            "fearScore": 0から100の整数値（ユーザーの恐怖度推定）
            }`;
        console.log(`サーバー [${sessionId}]: OpenAIに送信するシステムプロンプトの抜粋:`, fullSystemPromptContent.substring(0, 200) + '...');

        const userMessage = { role: "user", content: `ユーザーの反応: 「${userText}」` };

        const messagesToSend = [
            { role: "system", content: fullSystemPromptContent },
            ...messageHistory.slice(1),
            userMessage
        ];
        console.log(`サーバー [${sessionId}]: OpenAIに送信するメッセージ履歴の長さ:`, messagesToSend.length);

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messagesToSend,
            max_tokens: 250,
            temperature: 0.8,
            response_format: { type: 'json_object' },
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        let { story, soundEffect, isLastPart, fearScore } = aiResponse;

        console.log(`サーバー [${sessionId}]: OpenAIから受信したレスポンス:`, JSON.stringify(aiResponse));
        console.log(`サーバー [${sessionId}]: OpenAIが選択した効果音:`, soundEffect);
        console.log(`サーバー [${sessionId}]: OpenAIが推定した恐怖度:`, fearScore);

        if (!story || story.trim() === '') {
            console.warn(`サーバー [${sessionId}]: OpenAI returned an empty story. Using a default message.`);
            story = "すみません、物語を生成できませんでした。もう一度話しかけてください。";
        }
        
        fearScore = typeof fearScore === 'number' ? Math.max(0, Math.min(100, Math.round(fearScore))) : 0;

        const audioBase64 = await synthesizeSpeech(story);
        console.log(`サーバー [${sessionId}]: 物語音声のBase64生成完了。`);

        const finalHistory = [...messageHistory, userMessage, { role: "assistant", content: story }];
        
        res.json({
            newStoryPart: story,
            audioBase64,
            soundEffect,
            isLastPart,
            fearScore,
            updatedHistory: finalHistory
        });

    } catch (error) {
        console.error(`サーバー [${sessionId}]: Story Generation Error:`, error);
        res.status(500).json({ error: '物語の生成に失敗しました。' });
    }
});

// --- サーバーの起動 ---
server.listen(port, async () => {
    await readDb();
    console.log(`サーバーが http://localhost:${port} で起動しました`);
});