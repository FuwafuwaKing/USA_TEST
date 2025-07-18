// public/script.js (修正版)

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM要素の取得 ---
    const storyContainer = document.getElementById('story-container');
    const userTextInput = document.getElementById('user-text');
    const submitBtn = document.getElementById('submit-btn');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('error-message');
    const cameraPreview = document.getElementById('camera-preview');
    const captureCanvas = document.getElementById('capture-canvas');
    const emotionStatus = document.getElementById('emotion-status');

    // --- 状態管理 ---
    let messageHistory = [];
    let emotionUpdateInterval = null;
    const serverUrl = 'http://localhost:3000'; // サーバーのURLを定数化

    /**
     * 初期化処理
     */
    function initialize() {
        initializeStory();
        initializeCamera();
    }

    /**
     * 物語の初期設定
     */
    function initializeStory() {
        const initialStory = "あなたは古い洋館に足を踏み入れた。軋む床、壁に飾られた不気味な肖像画...。廊下の突き当たりには、古びた木製の扉が一つだけある。なぜか、その扉が気になる。";
        const systemPrompt = `あなたはプロのホラー作家です。ユーザーの反応や感情を物語に巧みに取り入れ、恐ろしく、かつ一貫性のある物語を生成してください。
        - ユーザーの感情が「恐怖」や「驚き」なら、さらに恐怖を煽る展開にしてください。
        - ユーザーの感情が「喜び」や「無表情」なら、それを不気味な要素として「なぜこの状況で笑っているんだ...？」のように物語に反映させてください。
        - 物語は簡潔に、数文で完結させてください。`;

        messageHistory = [
            { role: "system", content: systemPrompt },
            { role: "assistant", content: initialStory }
        ];
        storyContainer.textContent = initialStory;
    }

    /**
     * カメラの起動と定期的な感情分析の開始
     */
    async function initializeCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            cameraPreview.srcObject = stream;
            cameraPreview.onloadedmetadata = () => {
                // 5秒ごとに感情をプレビュー更新
                emotionUpdateInterval = setInterval(updateEmotionPreview, 5000);
                updateEmotionPreview(); // 初回実行
            };
        } catch (err) {
            console.error("カメラへのアクセスに失敗しました:", err);
            displayError("カメラを起動できませんでした。ブラウザの権限を確認してください。");
            emotionStatus.textContent = "カメラOFF";
        }
    }

    /**
     * カメラフレームをキャプチャしてBase64文字列を返す
     * @returns {string | null} Base64エンコードされた画像データ（接頭辞なし）
     */
    function captureFrameAsBase64() {
        if (!cameraPreview.srcObject) return null;
        const context = captureCanvas.getContext('2d');
        captureCanvas.width = cameraPreview.videoWidth;
        captureCanvas.height = cameraPreview.videoHeight;
        // プレビューは鏡写しなので、キャプチャ時に反転を戻す
        context.translate(captureCanvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(cameraPreview, 0, 0, captureCanvas.width, captureCanvas.height);
        // 元に戻す
        context.setTransform(1, 0, 0, 1, 0, 0);
        
        // 'data:image/jpeg;base64,' の部分を除去して返す
        return captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    }
    
    /**
     * 感情プレビューを更新する
     */
    async function updateEmotionPreview() {
        const imageBase64 = captureFrameAsBase64();
        if (!imageBase64) return;

        try {
            // ★修正点：完全なURLを指定
            const response = await fetch(`${serverUrl}/analyze-emotion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64 }),
            });
            if (!response.ok) throw new Error('サーバーからの応答が不正です。');

            const data = await response.json();
            emotionStatus.textContent = data.emotion || 'エラー';
        } catch (error) {
            console.error("感情プレビュー更新エラー:", error);
            emotionStatus.textContent = "分析失敗";
        }
    }

    /**
     * 送信ボタンのクリックイベントハンドラ
     */
    submitBtn.addEventListener('click', async () => {
        const userText = userTextInput.value;
        if (!userText) {
            displayError("テキストを入力してください。");
            return;
        }

        const imageBase64 = captureFrameAsBase64();
        if (!imageBase64) {
            displayError("カメラが動作していません。");
            return;
        }

        // 定期更新を一時停止
        clearInterval(emotionUpdateInterval);
        setLoading(true);

        try {
            // ユーザーのプロンプトを画面に表示
            appendMessageToStory(`あなた: 「${userText}」`, 'user-prompt');

            // ★修正点：完全なURLを指定
            const response = await fetch(`${serverUrl}/generate-story`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userText, imageBase64, messageHistory }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || '物語の生成に失敗しました。');
            }

            const data = await response.json();
            
            // 状態を更新
            messageHistory = data.updatedHistory;
            
            // 新しい物語部分を画面に表示
            appendMessageToStory(data.newStoryPart, 'assistant-response');
            userTextInput.value = '';

        } catch (error) {
            console.error("物語生成エラー:", error);
            displayError(error.message);
        } finally {
            setLoading(false);
            // 定期更新を再開
            emotionUpdateInterval = setInterval(updateEmotionPreview, 5000);
        }
    });

    /**
     * UIのローディング状態を切り替える
     * @param {boolean} isLoading 
     */
    function setLoading(isLoading) {
        loader.style.display = isLoading ? 'block' : 'none';
        submitBtn.disabled = isLoading;
        userTextInput.disabled = isLoading;
        errorMessage.textContent = '';
    }

    /**
     * エラーメッセージを表示する
     * @param {string} message 
     */
    function displayError(message) {
        errorMessage.textContent = message;
    }
    
    /**
     * 物語コンテナにメッセージを追加する
     * @param {string} text - 表示するテキスト
     * @param {string} className - 付与するCSSクラス名
     */
    function appendMessageToStory(text, className) {
        const p = document.createElement('p');
        p.textContent = text;
        p.className = className;
        storyContainer.appendChild(p);
        // 自動で一番下までスクロール
        storyContainer.scrollTop = storyContainer.scrollHeight;
    }

    // --- 初期化処理を実行 ---
    initialize();
});