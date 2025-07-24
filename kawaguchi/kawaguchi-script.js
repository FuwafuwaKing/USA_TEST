// public/script.js (更新版)

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const storyContainer = document.getElementById('story-container');
    const submitBtn = document.getElementById('submit-btn');
    const loader = document.getElementById('loader'); // ★重要: loaderを再度追加
    const errorMessage = document.getElementById('error-message'); // ★重要: errorMessageを再度追加
    const cameraPreview = document.getElementById('camera-preview');
    // ★修正1: captureCanvasの取得が間違っています。これを修正します。
    const captureCanvas = document.getElementById('capture-canvas');
    const emotionStatus = document.getElementById('emotion-status'); // ★重要: emotionStatusを再度追加
    const transcriptText = document.getElementById('transcript-text');
    const transcriptStatus = document.getElementById('transcript-status');
    const startBtn = document.getElementById('start-btn');
    const startBtnContainer = document.getElementById('start-btn-container');

    // --- 状態管理 ---
    let messageHistory = [];
    let emotionUpdateInterval = null;
    let finalTranscript = '';
    let interimTranscript = '';
    const serverUrl = `http://${window.location.host}`;
    const wsUrl = `ws://${window.location.host}`;
    
    let emotionHistoryLog = [];
    
    let initialStory = "";

    // --- WebSocketの初期化 ---
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
    
    startBtn.addEventListener('click', async () => {
        startBtnContainer.style.display = 'none';
        await initializeStoryAndAudio(); // initializeStory() と初期オーディオ再生が含まれる
        initializeMedia(); // カメラとマイクの初期化
    });

    async function initializeStoryAndAudio() {
        // ★修正2: initializeStory() の内容を直接ここに記述、または関数を呼び出す
        initialStory = "あなたは古い洋館に足を踏み入れた。軋む床、壁に飾られた不気味な肖像画...。廊下の突き当たりには、古びた木製の扉が一つだけある。なぜか、その扉が気になる。";
        const systemPrompt = `あなたはプロのホラー作家です。ユーザーの反応や感情を物語に巧みに取り入れ、恐ろしく、かつ一貫性のある物語を生成してください。\n- ユーザーの感情が「恐怖」や「驚き」なら、さらに恐怖を煽る展開にしてください。\n- ユーザーの感情が「喜び」や「無表情」なら、それを不気味な要素として「なぜこの状況で笑っているんだ...？」のように物語に反映させてください。\n- 物語は簡潔に、数文で完結させてください。`;
        messageHistory = [ { role: "system", content: systemPrompt }, { role: "assistant", content: initialStory } ];
        storyContainer.textContent = initialStory;

        try {
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const response = await fetch(`${serverUrl}/synthesize-speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: initialStory }),
            });

            if (!response.ok) {
                // HTTPステータスコードがOKでない場合、サーバーからのエラーレスポンスを詳しくログに出す
                const errorText = await response.text();
                console.error('Initial story audio generation failed with response:', response.status, errorText);
                throw new Error('Initial story audio generation failed.');
            }
            const data = await response.json();
            if (data.audioBase64) {
                await playAudio(data.audioBase64);
            }
        } catch (error) {
            console.error("Failed to play initial story audio:", error);
            displayError("初期ストーリーの音声再生に失敗しました。ブラウザのコンソールを確認してください。");
        }
    }

    async function initializeMedia() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: true, noiseSuppression: true } });
            cameraPreview.srcObject = stream;
            cameraPreview.onloadedmetadata = () => {
                // emotionStatus がDOMに存在することを確認してからsetIntervalを設定
                if (emotionStatus) {
                    emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
                }
            };

            await audioContext.audioWorklet.addModule('audio-worklet-processor.js');

            const streamSource = audioContext.createMediaStreamSource(stream);
            
            const audioWorkletNode = new AudioWorkletNode(
                audioContext,
                'audio-worklet-stream-processor'
            );

            audioWorkletNode.port.onmessage = (event) => {
                const inputData = new Float32Array(event.data);
                const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmData = floatTo16BitPCM(downsampledData);
                if (ws.readyState === WebSocket.OPEN) { ws.send(pcmData); }
            };

            streamSource.connect(audioWorkletNode);
            audioWorkletNode.connect(audioContext.destination);

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

    // ★追加: updateEmotionPreview 関数 (欠落していたものを復元)
    async function updateEmotionPreview() {
        const imageBase64 = captureFrameAsBase64();
        if (!imageBase64) return;

        try {
            const response = await fetch(`${serverUrl}/analyze-emotion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            });
            if (!response.ok) {
                 // エラーレスポンスをログに出力
                 const errorText = await response.text();
                 console.error('Emotion analysis failed with response:', response.status, errorText);
                 return; // エラー時はサイレントに失敗
            }

            const data = await response.json();
            const currentEmotion = data.emotion;
            
            if (emotionStatus) { // emotionStatusが存在することを確認
                emotionStatus.textContent = currentEmotion; // UIを更新
            }
            emotionHistoryLog.push(currentEmotion); // 履歴に追加

        } catch (error) {
            console.error("Emotion preview update failed:", error);
        }
    }

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
                    emotionHistory: emotionHistoryLog,
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                console.error('Story generation failed with response:', response.status, errData); // エラーレスポンスを詳しくログに出す
                throw new Error(errData.error || '物語の生成に失敗しました。');
            }

            const data = await response.json();
            messageHistory = data.updatedHistory;
            appendMessageToStory(data.newStoryPart, 'assistant-response');
            
            if (data.audioBase64) {
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }
                await playAudio(data.audioBase64);
            }

            finalTranscript = '';
            interimTranscript = '';
            transcriptText.textContent = '';
            emotionHistoryLog = [];

        } catch (error) {
            console.error("物語生成エラー:", error);
            displayError(error.message);
        } finally {
            setLoading(false);
            emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
        }
    });

    /**
     * Base64形式の音声データをデコードして再生する関数
     * @param {string} base64String - Base64エンコードされた音声データ
     */
    async function playAudio(base64String) {
        try {
            // Base64からバイナリデータへ変換
            const binaryString = window.atob(base64String);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const arrayBuffer = bytes.buffer;

            // Web Audio APIでバイナリデータをオーディオバッファにデコード
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // デコードした音声を再生
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start(0); // すぐに再生を開始
        } catch (error) {
            console.error('音声の再生に失敗しました:', error);
            displayError('音声再生中にエラーが発生しました。ブラウザのコンソールを確認してください。');
        }
    }

    // --- ヘルパー関数 ---
    function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
        if (outputSampleRate === inputSampleRate) { return buffer; }
        const sampleRateRatio = inputSampleRate / outputSampleRate;
        const newLength = Math.round(buffer.length / sampleRateRatio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                accum += buffer[i];
                count++;
            }
            result[offsetResult] = accum / count;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    function floatTo16BitPCM(input) {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return output;
    }

    function captureFrameAsBase64() {
        if (!cameraPreview.srcObject) return null;
        const context = captureCanvas.getContext('2d');
        if (!context) { // context が null の場合があるためチェック
            console.error("Failed to get 2D context from captureCanvas.");
            return null;
        }
        captureCanvas.width = cameraPreview.videoWidth;
        captureCanvas.height = cameraPreview.videoHeight;
        context.translate(captureCanvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(cameraPreview, 0, 0, captureCanvas.width, captureCanvas.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
        return captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    }

    function setLoading(isLoading) {
        const loader = document.getElementById('loader');
        const errorMessage = document.getElementById('error-message');

        if (loader) {
            loader.style.display = isLoading ? 'block' : 'none';
        }
        submitBtn.disabled = isLoading;
        if (errorMessage) {
            errorMessage.textContent = '';
        }
    }

    function displayError(message) {
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
    }

    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        p.className = className;
        storyContainer.appendChild(p);
        storyContainer.scrollTop = storyContainer.scrollHeight;
    }
});