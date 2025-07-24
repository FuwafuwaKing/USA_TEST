// public/script.js (完全版 - ヘルパー関数補完済み)

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const storyContainer = document.getElementById('story-container');
    const submitBtn = document.getElementById('submit-btn');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('error-message');
    const cameraPreview = document.getElementById('camera-preview');
    const captureCanvas = document.getElementById('capture-canvas');
    const emotionStatus = document.getElementById('emotion-status');
    const transcriptText = document.getElementById('transcript-text');
    const transcriptStatus = document.getElementById('transcript-status');
    const soundEffectPlayer = document.getElementById('sound-effect-player');
    const fearScoreDisplay = document.getElementById('fear-score');
    const endSessionBtn = document.getElementById('end-session-btn');
    const ttsPlayer = document.getElementById('tts-player');

    console.log('DOM要素のロード完了。soundEffectPlayer:', soundEffectPlayer, 'fearScoreDisplay:', fearScoreDisplay, 'ttsPlayer:', ttsPlayer);

    // --- 状態管理 ---
    let messageHistory = [];
    let emotionUpdateInterval = null;
    let finalTranscript = '';
    let interimTranscript = '';
    const serverUrl = `http://${window.location.host}`;
    const wsUrl = `ws://${window.location.host}`;
    
    let emotionHistoryLog = [];
    let accelerometerData = [];
    
    let sessionData = {
        sessionId: null,
        sessionTitle: "無題の物語",
        fearScores: [],
        conversation: []
    };

    let isAudioPlaying = false; // 音声再生中フラグ

    // --- WebSocketの初期化 ---
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log("WebSocket接続が確立しました。");
    ws.onerror = (error) => console.error("WebSocketエラー:", error);
    ws.onclose = () => console.log("WebSocket接続が切れました。");
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
            if (msg.isFinal) { 
                finalTranscript += msg.text + ' '; 
                interimTranscript = ''; 
            } else { 
                interimTranscript = msg.text; 
            }
            transcriptText.textContent = finalTranscript + interimTranscript;
        }
    };
    
    // --- 加速度センサーデータハンドラー ---
    function handleDeviceMotion(event) {
        const { x, y, z } = event.accelerationIncludingGravity;
        accelerometerData.push({ x, y, z, timestamp: Date.now() });
    }

    // --- ゲーム開始時の初期化 ---
    initializeGameSession();
    initializeMedia();

    async function initializeGameSession() {
        console.log("ゲームセッションの初期化を開始します。");
        try {
            const response = await fetch(`${serverUrl}/start-session`);
            const data = await response.json();
            sessionData.sessionId = data.sessionId;
            console.log('新しいセッションIDを取得しました:', sessionData.sessionId);

            const initialStoryText = "あなたは古い洋館に足を踏み入れた。軋む床、壁に飾られた不気味な肖像画...。廊下の突き当たりには、古びた木製の扉が一つだけある。なぜか、その扉が気になる。";
            const systemPrompt = `あなたはプロのホラー作家です。ユーザーの反応や感情を物語に巧みに取り入れ、恐ろしく、かつ一貫性のある物語を生成してください。\n- ユーザーの感情が「恐怖」や「驚き」なら、さらに恐怖を煽る展開にしてください。\n- ユーザーの感情が「喜び」や「無表情」なら、それを不気味な要素として「なぜこの状況で笑っているんだ...？」のように物語に反映させてください。\n- 物語は簡潔に、数文で完結させてください。**必ずJSON形式で応答してください。**`;
            
            messageHistory = [ 
                { role: "system", content: systemPrompt }, 
                { role: "assistant", content: initialStoryText } 
            ];
            storyContainer.textContent = initialStoryText;

            sessionData.conversation.push({speaker: 'AI', text: initialStoryText, fearScore: 0});
            sessionData.fearScores.push(0);
            updateFearScoreDisplay(0);

            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('AudioContextをresumeしました。');
            }

            const responseAudio = await fetch(`${serverUrl}/synthesize-speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: initialStoryText }),
            });

            if (!responseAudio.ok) {
                const errorText = await responseAudio.text();
                console.error('Initial story audio generation failed with response:', responseAudio.status, errorText);
                throw new Error('Initial story audio generation failed.');
            }
            const dataAudio = await responseAudio.json();
            if (dataAudio.audioBase64) {
                console.log('初期ストーリー音声のBase64データを受信しました。');
                await playAudio(dataAudio.audioBase64); // TTSプレイヤーで再生
            }
            startAccelerometerTracking();
        } catch (error) {
            console.error("ゲーム初期化失敗:", error);
            displayError("ゲームの開始に失敗しました。ブラウザのコンソールを確認してください。");
        }
    }


    // 終了ボタンのイベントリスナー
    endSessionBtn.addEventListener('click', async () => {
        if (isAudioPlaying) {
            displayError("音声再生中はセッションを終了できません。");
            return;
        }
        await endSession();
    });

    /**
     * セッションを終了し、プレビュー画面へ遷移する関数
     */
    async function endSession() {
        console.log('セッション終了処理を開始します。');
        if (emotionUpdateInterval) clearInterval(emotionUpdateInterval);
        setLoading(true);
        displayError('セッションを終了し、結果を保存しています...');

        try {
            // セッションタイトルを生成
            const titleResponse = await fetch(`${serverUrl}/generate-session-title`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation: sessionData.conversation })
            });
            if (titleResponse.ok) {
                const titleData = await titleResponse.json();
                sessionData.sessionTitle = titleData.title;
                console.log('セッションタイトルを生成しました:', sessionData.sessionTitle);
            } else {
                console.warn('セッションタイトルの生成に失敗しました:', await titleResponse.text());
                sessionData.sessionTitle = "無題の物語"; // フォールバック
            }

            // 現在のセッションデータをサーバーに保存するAPIを叩く
            await fetch(`${serverUrl}/save-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(sessionData)
            });
            console.log('セッションデータがサーバーに保存されました。', sessionData.sessionId);

            // プレビュー画面へリダイレクト
            window.location.href = `/preview.html?sessionId=${sessionData.sessionId}`;
        } catch (error) {
            console.error('セッションデータの保存に失敗しました:', error);
            displayError('セッションの保存中にエラーが発生しました。');
            setLoading(false);
        }
    }


    /**
     * カメラとマイクのメディアストリームを初期化し、処理を開始する関数
     */
    async function initializeMedia() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            displayError("お使いのブラウザはメディアデバイスをサポートしていません。");
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: { echoCancellation: true, noiseSuppression: true } 
            });
            cameraPreview.srcObject = stream;
            cameraPreview.onloadedmetadata = () => {
                if (emotionStatus) {
                    emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
                    console.log('感情分析インターバルを開始しました。');
                }
            };

            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceMotionEvent.requestPermission();
                    if (permissionState === 'granted') {
                        window.addEventListener('devicemotion', handleDeviceMotion);
                        console.log('加速度センサーのパーミッションが許可されました。');
                    } else {
                        console.warn('加速度センサーのパーミッションが拒否されました。恐怖度推定は機能しません。');
                    }
                } catch (error) {
                    console.error('加速度センサーのパーミッション要求に失敗しました:', error);
                }
            } else {
                window.addEventListener('devicemotion', handleDeviceMotion);
                console.log('加速度センサーをリスニング開始しました (パーミッションAPI不要)。');
            }


            console.log('AudioWorkletモジュールをロード中: /audio-worklet-processor.js');
            await audioContext.audioWorklet.addModule('/audio-worklet-processor.js');
            console.log('AudioWorkletモジュールのロードに成功しました。');

            const streamSource = audioContext.createMediaStreamSource(stream);
            
            const audioWorkletNode = new AudioWorkletNode(
                audioContext,
                'audio-worklet-stream-processor'
            );
            console.log('AudioWorkletNodeを作成しました。');

            audioWorkletNode.port.onmessage = (event) => {
                const inputData = new Float32Array(event.data);
                const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmData = floatTo16BitPCM(downsampledData);
                if (ws.readyState === WebSocket.OPEN) { 
                    ws.send(pcmData); 
                }
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
            } else { 
                transcriptStatus.textContent = '✅ マイク認識中... 話しかけてください。'; 
            }
        } catch (err) { 
            console.error("メディアデバイスへのアクセスに失敗:", err); 
            displayError("カメラまたはマイクを起動できませんでした。ブラウザの権限を確認してください。"); 
        }
    }

    /**
     * カメラからフレームをキャプチャし、感情分析のためにサーバーに送信する関数
     */
    async function updateEmotionPreview() {
        const imageBase64 = captureFrameAsBase64();
        if (!imageBase64) {
            return;
        }

        try {
            const response = await fetch(`${serverUrl}/analyze-emotion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Emotion analysis failed with response:', response.status, errorText);
                return;
            }

            const data = await response.json();
            const currentEmotion = data.emotion;
            
            if (emotionStatus) {
                emotionStatus.textContent = currentEmotion;
            }
            emotionHistoryLog.push(currentEmotion);
        } catch (error) {
            console.error("Emotion preview update failed:", error);
        }
    }

    // --- 加速度センサーデータの収集開始/停止 ---
    function startAccelerometerTracking() {
        accelerometerData = [];
        console.log('加速度センサーデータの収集を開始しました。');
    }

    function stopAccelerometerTracking() {
        console.log('加速度センサーデータの収集を一時停止しました（スナップショット取得）。');
    }

    /**
     * 収集された加速度センサーデータから分散を計算する関数
     */
    function calculateAccelerometerVariance(dataBuffer) {
        if (!dataBuffer || dataBuffer.length < 2) {
            console.log('加速度センサーデータが不足しているため、分散を計算できません。');
            return null;
        }

        const magnitudes = dataBuffer.map(data => 
            Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z)
        );

        const mean = magnitudes.reduce((sum, val) => sum + val, 0) / magnitudes.length;

        const variance = magnitudes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (magnitudes.length - 1);
        
        console.log(`加速度マグニチュードの分散: ${variance.toFixed(4)} (データ点数: ${magnitudes.length})`);
        return variance;
    }


    // --- 送信ボタンのイベントリスナー ---
    submitBtn.addEventListener('click', async () => {
        if (isAudioPlaying) {
            displayError("音声再生中は次の生成を開始できません。");
            return;
        }

        const userText = finalTranscript + interimTranscript;
        if (!userText.trim()) { 
            displayError("文字起こしされたテキストがありません。"); 
            return; 
        }
        
        if (emotionUpdateInterval) clearInterval(emotionUpdateInterval);
        setLoading(true);
        console.log('物語生成リクエストを送信中...');

        stopAccelerometerTracking();
        const currentAccelerometerVariance = calculateAccelerometerVariance(accelerometerData);

        try {
            appendMessageToStory(`あなた: 「${userText}」`, 'user-prompt');
            sessionData.conversation.push({speaker: 'ユーザー', text: userText});

            const response = await fetch(`${serverUrl}/generate-story`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sessionData.sessionId,
                    userText: userText,
                    messageHistory: messageHistory,
                    emotionHistory: emotionHistoryLog,
                    accelerometerVariance: currentAccelerometerVariance,
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                console.error('Story generation failed with response:', response.status, errData);
                throw new Error(errData.error || '物語の生成に失敗しました。');
            }

            const data = await response.json();
            const { newStoryPart, audioBase64, soundEffect, isLastPart, updatedHistory, fearScore } = data;
            
            messageHistory = updatedHistory;
            appendMessageToStory(newStoryPart, 'assistant-response');
            
            sessionData.conversation.push({speaker: 'AI', text: newStoryPart, fearScore: fearScore});
            sessionData.fearScores.push(fearScore);
            updateFearScoreDisplay(fearScore);

            console.log('サーバーから受け取った効果音:', soundEffect);
            if (soundEffect && soundEffect !== 'none' && soundEffectPlayer) {
                const soundPath = `/${soundEffect}`;
                soundEffectPlayer.src = soundPath; 
                console.log('効果音プレイヤーのsrcを設定:', soundPath);
                
                try {
                    await soundEffectPlayer.load();
                    await soundEffectPlayer.play();
                    console.log(`効果音を再生: ${soundEffect}`);
                } catch (playError) {
                    console.error('効果音の再生に失敗しました:', playError);
                }
            } else if (soundEffect === 'none') {
                console.log('効果音は指定されていません (none)。');
            } else {
                console.log('効果音プレイヤーが利用できないか、効果音が指定されていません。');
            }

            if (audioBase64) {
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                    console.log('AudioContextをresumeしました (物語音声用)。');
                }
                console.log('物語音声を再生中...');
                await playAudio(audioBase64); // TTSプレイヤーで再生
            }

            finalTranscript = '';
            interimTranscript = '';
            transcriptText.textContent = '';
            emotionHistoryLog = [];
            startAccelerometerTracking();

            if (isLastPart) {
                displayError('物語が完結しました。セッションを終了します。');
                await waitForAudioToFinish();
                await endSession();
            }

        } catch (error) {
            console.error("物語生成エラー:", error);
            displayError(error.message);
        } finally {
            if (!isLastPart) { 
                setLoading(false); 
                emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
            }
        }
    });

    /**
     * Base64形式の音声データをTTSプレイヤーでデコードして再生する関数
     */
    async function playAudio(base64String) {
        isAudioPlaying = true;
        setLoading(true); // TTS再生中は強制的にローディング状態にする
        submitBtn.disabled = true;
        endSessionBtn.disabled = true;

        return new Promise((resolve, reject) => {
            ttsPlayer.src = `data:audio/mp3;base64,${base64String}`;
            ttsPlayer.load();

            ttsPlayer.onended = () => {
                isAudioPlaying = false;
                setLoading(false); // 再生終了でローディング解除
                submitBtn.disabled = false;
                endSessionBtn.disabled = false;
                console.log('TTS音声再生が完了しました。');
                resolve();
            };

            ttsPlayer.onerror = (e) => {
                isAudioPlaying = false;
                setLoading(false); // エラーでもローディング解除
                submitBtn.disabled = false;
                endSessionBtn.disabled = false;
                console.error('TTS音声の再生エラー:', e);
                reject(new Error('音声再生中にエラーが発生しました。'));
            };

            ttsPlayer.play().catch(e => {
                isAudioPlaying = false;
                setLoading(false); // エラーでもローディング解除
                submitBtn.disabled = false;
                endSessionBtn.disabled = false;
                console.error('TTS音声のplay()呼び出しエラー:', e);
                reject(new Error('音声再生を開始できませんでした。ブラウザの自動再生ポリシーを確認してください。'));
            });
        });
    }

    // 音声再生完了を待つヘルパー関数
    function waitForAudioToFinish() {
        return new Promise(resolve => {
            if (!isAudioPlaying) {
                resolve();
                return;
            }
            const checkInterval = setInterval(() => {
                if (!isAudioPlaying) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
    }


    // --- ヘルパー関数群（省略されていた部分を補完） ---

    /**
     * 音声バッファをダウンサンプリングする関数
     * @param {Float32Array} buffer - 元の音声データ
     * @param {number} inputSampleRate - 入力サンプリングレート
     * @param {number} outputSampleRate - 出力サンプリングレート
     * @returns {Float32Array} ダウンサンプリングされた音声データ
     */
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

    /**
     * Float32Arrayの音声データを16ビットPCM形式に変換する関数
     * @param {Float32Array} input - Float32Array形式の音声データ
     * @returns {Int16Array} 16ビットPCM形式の音声データ
     */
    function floatTo16BitPCM(input) {
        // ここが欠落していました
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return output;
    }

    /**
     * カメラの現在のフレームをBase64エンコードされたJPEG画像としてキャプチャする関数
     */
    function captureFrameAsBase64() {
        if (!cameraPreview.srcObject) return null;
        const context = captureCanvas.getContext('2d');
        if (!context) {
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
        const currentLoader = document.getElementById('loader');
        const currentErrorMessage = document.getElementById('error-message');

        if (currentLoader) {
            currentLoader.style.display = isLoading ? 'block' : 'none';
        }
        submitBtn.disabled = isLoading || isAudioPlaying; // TTS再生中も無効
        endSessionBtn.disabled = isLoading || isAudioPlaying; // TTS再生中も無効
        if (currentErrorMessage) {
            currentErrorMessage.textContent = '';
        }
    }

    function displayError(message) {
        const currentErrorMessage = document.getElementById('error-message');
        if (currentErrorMessage) {
            currentErrorMessage.textContent = message;
        }
    }

    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        p.className = className;
        storyContainer.appendChild(p);
        storyContainer.scrollTop = storyContainer.scrollHeight;
    }

    function updateFearScoreDisplay(score) {
        if (fearScoreDisplay) {
            fearScoreDisplay.textContent = score !== null ? score : 'N/A';
            fearScoreDisplay.style.color = `hsl(0, 100%, ${50 + score / 200 * 50}%)`;
        }
    }
});