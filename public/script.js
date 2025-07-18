// public/script.js (更新版)

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 (変更なし) ---
    const storyContainer = document.getElementById('story-container');
    const submitBtn = document.getElementById('submit-btn');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('error-message');
    const cameraPreview = document.getElementById('camera-preview');
    const captureCanvas = document.getElementById('capture-canvas');
    const emotionStatus = document.getElementById('emotion-status');
    const transcriptText = document.getElementById('transcript-text');
    const transcriptStatus = document.getElementById('transcript-status');

    // --- 状態管理 ---
    let messageHistory = [];
    let emotionUpdateInterval = null;
    let finalTranscript = '';
    let interimTranscript = '';
    const serverUrl = `http://${window.location.host}`;
    const wsUrl = `ws://${window.location.host}`;
    let audioContext;
    
    // ★修正点1: 感情の履歴を保存する配列を追加
    let emotionHistoryLog = [];
    
    // --- WebSocketの初期化 (変更なし) ---
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log("WebSocket接続が確立しました。");
    ws.onerror = (error) => console.error("WebSocketエラー:", error);
    ws.onclose = () => console.log("WebSocket接続が切れました。");
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
            if (msg.isFinal) { finalTranscript += msg.text + ' '; interimTranscript = ''; } 
            else { interimTranscript = msg.text; }
            transcriptText.textContent = finalTranscript + interimTranscript;
        }
    };
    
    initialize();
    function initialize() {
        initializeStory();
        initializeMedia();
    }

    async function initializeMedia() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } });
            cameraPreview.srcObject = stream;
            cameraPreview.onloadedmetadata = () => {
                emotionUpdateInterval = setInterval(updateEmotionPreview, 1000); // 1秒ごとに感情認識を実行
            };
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const streamSource = audioContext.createMediaStreamSource(stream);
            const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
            scriptNode.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmData = floatTo16BitPCM(downsampledData);
                if (ws.readyState === WebSocket.OPEN) { ws.send(pcmData); }
            };
            streamSource.connect(scriptNode);
            scriptNode.connect(audioContext.destination);
            if (audioContext.state === 'suspended') {
                transcriptStatus.textContent = '🎤 ページをクリックしてマイクを有効化してください。';
                const resumeAudio = () => {
                    audioContext.resume().then(() => {
                        console.log('AudioContextが再開され、文字起こしを開始します。');
                        transcriptStatus.textContent = '✅ マイク認識中... 話しかけてください。';
                        document.body.removeEventListener('click', resumeAudio);
                    });
                };
                document.body.addEventListener('click', resumeAudio);
            } else { transcriptStatus.textContent = '✅ マイク認識中... 話しかけてください。'; }
        } catch (err) { console.error("メディアデバイスへのアクセスに失敗:", err); displayError("カメラまたはマイクを起動できませんでした。ブラウザの権限を確認してください。"); }
    }

    // ★修正点2: 感情認識と履歴保存のロジックを実装
    async function updateEmotionPreview() {
        const imageBase64 = captureFrameAsBase64();
        if (!imageBase64) return;

        try {
            const response = await fetch(`${serverUrl}/analyze-emotion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            });
            if (!response.ok) return; // エラー時はサイレントに失敗

            const data = await response.json();
            const currentEmotion = data.emotion;
            
            emotionStatus.textContent = currentEmotion; // UIを更新
            emotionHistoryLog.push(currentEmotion); // 履歴に追加

        } catch (error) {
            // プレビュー更新時のエラーはコンソールに出力するのみ
            console.error("Emotion preview update failed:", error);
        }
    }

    // ★修正点3: 物語生成時に感情履歴を送信し、その後リセット
    submitBtn.addEventListener('click', async () => {
        const userText = finalTranscript + interimTranscript;
        if (!userText.trim()) { displayError("文字起こしされたテキストがありません。"); return; }
        
        if (emotionUpdateInterval) clearInterval(emotionUpdateInterval);
        setLoading(true);

        try {
            appendMessageToStory(`あなた: 「${userText}」`, 'user-prompt');

            const response = await fetch(`${serverUrl}/generate-story`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userText: userText,
                    messageHistory: messageHistory,
                    emotionHistory: emotionHistoryLog, // 感情履歴をペイロードに含める
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || '物語の生成に失敗しました。');
            }

            const data = await response.json();
            messageHistory = data.updatedHistory;
            appendMessageToStory(data.newStoryPart, 'assistant-response');
            
            // 次の入力のために各種状態をリセット
            finalTranscript = '';
            interimTranscript = '';
            transcriptText.textContent = '';
            emotionHistoryLog = []; // ★感情履歴をリセット

        } catch (error) {
            console.error("物語生成エラー:", error);
            displayError(error.message);
        } finally {
            setLoading(false);
            emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
        }
    });

    // --- ヘルパー関数 (変更なし) ---
    function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) { if (outputSampleRate === inputSampleRate) { return buffer; } const sampleRateRatio = inputSampleRate / outputSampleRate; const newLength = Math.round(buffer.length / sampleRateRatio); const result = new Float32Array(newLength); let offsetResult = 0; let offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
    function floatTo16BitPCM(input) { const output = new Int16Array(input.length); for (let i = 0; i < input.length; i++) { const s = Math.max(-1, Math.min(1, input[i])); output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; } return output; }
    function captureFrameAsBase64() { if (!cameraPreview.srcObject) return null; const context = captureCanvas.getContext('2d'); captureCanvas.width = cameraPreview.videoWidth; captureCanvas.height = cameraPreview.videoHeight; context.translate(captureCanvas.width, 0); context.scale(-1, 1); context.drawImage(cameraPreview, 0, 0, captureCanvas.width, captureCanvas.height); context.setTransform(1, 0, 0, 1, 0, 0); return captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1]; }
    function setLoading(isLoading) { loader.style.display = isLoading ? 'block' : 'none'; submitBtn.disabled = isLoading; errorMessage.textContent = ''; }
    function displayError(message) { errorMessage.textContent = message; }
    function appendMessageToStory(text, className) { const p = document.createElement('p'); p.textContent = text; p.className = className; storyContainer.appendChild(p); storyContainer.scrollTop = storyContainer.scrollHeight; }
    function initializeStory() { const initialStory = "あなたは古い洋館に足を踏み入れた。軋む床、壁に飾られた不気味な肖像画...。廊下の突き当たりには、古びた木製の扉が一つだけある。なぜか、その扉が気になる。"; const systemPrompt = `あなたはプロのホラー作家です。ユーザーの反応や感情を物語に巧みに取り入れ、恐ろしく、かつ一貫性のある物語を生成してください。\n- ユーザーの感情が「恐怖」や「驚き」なら、さらに恐怖を煽る展開にしてください。\n- ユーザーの感情が「喜び」や「無表情」なら、それを不気味な要素として「なぜこの状況で笑っているんだ...？」のように物語に反映させてください。\n- 物語は簡潔に、数文で完結させてください。`; messageHistory = [ { role: "system", content: systemPrompt }, { role: "assistant", content: initialStory } ]; storyContainer.textContent = initialStory; }
});