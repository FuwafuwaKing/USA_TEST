// public/script.js (完全版)

// Web Audio API の AudioContext を初期化
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
    const startBtn = document.getElementById('start-btn');
    const startBtnContainer = document.getElementById('start-btn-container');
    const soundEffectPlayer = document.getElementById('sound-effect-player'); // ★追加: 効果音再生用のHTML Audio要素

    // --- 状態管理 ---
    let messageHistory = []; // GPTとの会話履歴
    let emotionUpdateInterval = null; // 感情更新の間隔タイマー
    let finalTranscript = ''; // 確定された文字起こしテキスト
    let interimTranscript = ''; // 一時的な文字起こしテキスト
    const serverUrl = `http://${window.location.host}`; // サーバーのURL
    const wsUrl = `ws://${window.location.host}`; // WebSocketのURL
    
    let emotionHistoryLog = []; // 感情履歴ログ

    // --- WebSocketの初期化 ---
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log("WebSocket接続が確立しました。");
    ws.onerror = (error) => console.error("WebSocketエラー:", error);
    ws.onclose = () => console.log("WebSocket接続が切れました。");
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'transcript') {
            // 文字起こし結果を更新
            if (msg.isFinal) { 
                finalTranscript += msg.text + ' '; 
                interimTranscript = ''; 
            } else { 
                interimTranscript = msg.text; 
            }
            transcriptText.textContent = finalTranscript + interimTranscript;
        }
    };
    
    // --- 開始ボタンのイベントリスナー ---
    startBtn.addEventListener('click', async () => {
        startBtnContainer.style.display = 'none'; // 開始ボタンを非表示にする
        await initializeStoryAndAudio(); // 初期ストーリーと音声の再生
        initializeMedia(); // カメラとマイクの初期化
    });

    /**
     * 初期ストーリーのテキスト表示と音声再生を処理する関数
     */
    async function initializeStoryAndAudio() {
        const initialStoryText = "あなたは古い洋館に足を踏み入れた。軋む床、壁に飾られた不気味な肖像画...。廊下の突き当たりには、古びた木製の扉が一つだけある。なぜか、その扉が気になる。";
        const systemPrompt = `あなたはプロのホラー作家です。ユーザーの反応や感情を物語に巧みに取り入れ、恐ろしく、かつ一貫性のある物語を生成してください。\n- ユーザーの感情が「恐怖」や「驚き」なら、さらに恐怖を煽る展開にしてください。\n- ユーザーの感情が「喜び」や「無表情」なら、それを不気味な要素として「なぜこの状況で笑っているんだ...？」のように物語に反映させてください。\n- 物語は簡潔に、数文で完結させてください。**必ずJSON形式で応答してください。**`;
        
        // メッセージ履歴の初期化 (システムプロンプトと初期ストーリー)
        messageHistory = [ 
            { role: "system", content: systemPrompt }, 
            { role: "assistant", content: initialStoryText } 
        ];
        storyContainer.textContent = initialStoryText; // ストーリーをUIに表示

        try {
            // AudioContextが中断されている場合、再開する
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // 初期ストーリーの音声をサーバーから取得
            const response = await fetch(`${serverUrl}/synthesize-speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: initialStoryText }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Initial story audio generation failed with response:', response.status, errorText);
                throw new Error('Initial story audio generation failed.');
            }
            const data = await response.json();
            if (data.audioBase64) {
                await playAudio(data.audioBase64); // 音声を再生
            }
        } catch (error) {
            console.error("Failed to play initial story audio:", error);
            displayError("初期ストーリーの音声再生に失敗しました。ブラウザのコンソールを確認してください。");
        }
    }

    /**
     * カメラとマイクのメディアストリームを初期化し、処理を開始する関数
     */
    async function initializeMedia() {
        try {
            // カメラとマイクのアクセス許可を求める
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: { echoCancellation: true, noiseSuppression: true } 
            });
            cameraPreview.srcObject = stream; // カメラ映像をプレビュー要素に表示
            cameraPreview.onloadedmetadata = () => {
                // 映像ロード後に感情更新の間隔タイマーを設定
                if (emotionStatus) {
                    emotionUpdateInterval = setInterval(updateEmotionPreview, 1000);
                }
            };

            // AudioWorkletProcessorをロード
            // Workletスクリプトがpublicディレクトリ直下にある場合
            await audioContext.audioWorklet.addModule('/audio-worklet-processor.js');

            // マイクからの音声ストリームをAudioContextに接続
            const streamSource = audioContext.createMediaStreamSource(stream);
            
            // AudioWorkletNodeを作成し、カスタムオーディオ処理を行う
            const audioWorkletNode = new AudioWorkletNode(
                audioContext,
                'audio-worklet-stream-processor' // audio-worklet-processor.js 内で定義された名前
            );

            // AudioWorkletNodeからメッセージ（処理された音声データ）を受け取る
            audioWorkletNode.port.onmessage = (event) => {
                const inputData = new Float32Array(event.data);
                // サンプリングレートをダウンサンプリング（Google Speech-to-Textの要件に合わせる）
                const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                // 16ビットPCM形式に変換
                const pcmData = floatTo16BitPCM(downsampledData);
                // WebSocket経由でサーバーに送信
                if (ws.readyState === WebSocket.OPEN) { 
                    ws.send(pcmData); 
                }
            };

            // オーディオグラフの接続
            streamSource.connect(audioWorkletNode);
            audioWorkletNode.connect(audioContext.destination); // (オプション) 処理された音声を再生したい場合

            // AudioContextが中断されている場合の処理（ユーザー操作で再開を促す）
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
        const imageBase64 = captureFrameAsBase64(); // カメラフレームをBase64画像として取得
        if (!imageBase64) return; // 画像が取得できなければ処理を中断

        try {
            // サーバーの感情分析エンドポイントに画像を送信
            const response = await fetch(`${serverUrl}/analyze-emotion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Emotion analysis failed with response:', response.status, errorText);
                return; // エラー時はサイレントに失敗
            }

            const data = await response.json();
            const currentEmotion = data.emotion; // サーバーからの感情結果
            
            if (emotionStatus) {
                emotionStatus.textContent = currentEmotion; // UIを更新
            }
            emotionHistoryLog.push(currentEmotion); // 感情履歴に追加
        } catch (error) {
            console.error("Emotion preview update failed:", error);
        }
    }

    // --- 送信ボタンのイベントリスナー ---
    submitBtn.addEventListener('click', async () => {
        const userText = finalTranscript + interimTranscript;
        if (!userText.trim()) { 
            displayError("文字起こしされたテキストがありません。"); 
            return; 
        }
        
        // 感情更新の間隔タイマーを一時停止し、ローディング表示
        if (emotionUpdateInterval) clearInterval(emotionUpdateInterval);
        setLoading(true);

        try {
            appendMessageToStory(`あなた: 「${userText}」`, 'user-prompt'); // ユーザーの入力をUIに追加

            // 物語生成リクエストをサーバーに送信
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
                console.error('Story generation failed with response:', response.status, errData);
                throw new Error(errData.error || '物語の生成に失敗しました。');
            }

            const data = await response.json();
            const { newStoryPart, audioBase64, soundEffect, isLastPart, updatedHistory } = data; 
            
            messageHistory = updatedHistory; // 更新された会話履歴を保存
            appendMessageToStory(newStoryPart, 'assistant-response'); // 新しい物語のパートをUIに追加
            
            // ★効果音の再生ロジック
            if (soundEffect && soundEffect !== 'none' && soundEffectPlayer) {
                // `soundEffect` は 'SoundEffects/filename.mp3' の形式で来る想定
                // サーバーの静的ファイル設定に合わせ、`/` を付けてルートからのパスとする
                soundEffectPlayer.src = `/${soundEffect}`; 
                await soundEffectPlayer.load(); // 音声をロード
                await soundEffectPlayer.play(); // 音声を再生
                console.log(`効果音を再生: ${soundEffect}`);
            }

            // 生成された音声データを再生
            if (audioBase64) {
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }
                await playAudio(audioBase64);
            }

            // UIと状態をリセット
            finalTranscript = '';
            interimTranscript = '';
            transcriptText.textContent = '';
            emotionHistoryLog = [];

        } catch (error) {
            console.error("物語生成エラー:", error);
            displayError(error.message);
        } finally {
            setLoading(false); // ローディング表示を解除
            emotionUpdateInterval = setInterval(updateEmotionPreview, 1000); // 感情更新タイマーを再開
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
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; // 16ビット符号付き整数に変換
        }
        return output;
    }

    /**
     * カメラの現在のフレームをBase64エンコードされたJPEG画像としてキャプチャする関数
     * @returns {string|null} Base64エンコードされた画像データ（接頭辞なし）、またはnull
     */
    function captureFrameAsBase64() {
        if (!cameraPreview.srcObject) return null;
        const context = captureCanvas.getContext('2d');
        if (!context) {
            console.error("Failed to get 2D context from captureCanvas.");
            return null;
        }
        // キャンバスのサイズを映像に合わせる
        captureCanvas.width = cameraPreview.videoWidth;
        captureCanvas.height = cameraPreview.videoHeight;
        
        // 映像を左右反転させて描画 (セルフィービューのため)
        context.translate(captureCanvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(cameraPreview, 0, 0, captureCanvas.width, captureCanvas.height);
        context.setTransform(1, 0, 0, 1, 0, 0); // 変換をリセット
        
        // JPEG形式でBase64エンコードし、データURIの接頭辞を除去して返す
        return captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    }

    /**
     * ローディング表示を切り替える関数
     * @param {boolean} isLoading - ローディング状態か否か
     */
    function setLoading(isLoading) {
        // loaderとerrorMessage要素はDOMContentLoaded内で取得済みだが、念のため再取得
        const currentLoader = document.getElementById('loader');
        const currentErrorMessage = document.getElementById('error-message');

        if (currentLoader) {
            currentLoader.style.display = isLoading ? 'block' : 'none';
        }
        submitBtn.disabled = isLoading; // ボタンを無効化/有効化
        if (currentErrorMessage) {
            currentErrorMessage.textContent = ''; // エラーメッセージをクリア
        }
    }

    /**
     * エラーメッセージをUIに表示する関数
     * @param {string} message - 表示するエラーメッセージ
     */
    function displayError(message) {
        const currentErrorMessage = document.getElementById('error-message');
        if (currentErrorMessage) {
            currentErrorMessage.textContent = message;
        }
    }

    /**
     * ストーリーコンテナに新しいメッセージを追加する関数
     * @param {string} text - 追加するテキスト
     * @param {string} className - 追加する要素に付与するCSSクラス名
     */
    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        p.className = className;
        storyContainer.appendChild(p);
        // スクロールを最下部に移動
        storyContainer.scrollTop = storyContainer.scrollHeight;
    }
});