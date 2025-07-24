// public/history-script.js (更新版 - タイトル表示対応)

document.addEventListener('DOMContentLoaded', async () => {
    const sessionList = document.getElementById('session-list');
    const noSessionsMessage = document.getElementById('no-sessions-message');
    const errorDisplay = document.getElementById('error-display');
    const serverUrl = `http://${window.location.host}`;

    function displayError(message) {
        errorDisplay.textContent = `エラー: ${message}`;
        errorDisplay.style.display = 'block';
        noSessionsMessage.style.display = 'none';
    }

    try {
        const response = await fetch(`${serverUrl}/all-sessions`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`サーバーからの応答エラー (${response.status}): ${errorText || '不明なエラー'}`);
        }
        const sessions = await response.json();
        console.log('全セッションリスト取得成功:', sessions);

        if (sessions.length === 0) {
            noSessionsMessage.style.display = 'block';
            return;
        }

        errorDisplay.style.display = 'none';

        sessions.forEach(session => {
            const li = document.createElement('li');
            const sessionLink = document.createElement('a');
            sessionLink.href = `/preview.html?sessionId=${session.sessionId}`;
            // ★変更: sessionTitle を表示、もしなければIDを表示
            sessionLink.textContent = session.sessionTitle || `無題の物語 (ID: ${session.sessionId})`; 

            const sessionInfo = document.createElement('div');
            sessionInfo.className = 'session-info';
            sessionInfo.innerHTML = `
                <span>開始日時: ${new Date(session.timestamp).toLocaleString()}</span>
                <span>会話ターン数: ${session.conversationLength > 0 ? session.conversationLength - 1 : 0}</span>
                <span>恐怖度スコア数: ${session.fearScoresCount}</span>
                <span style="font-size:0.8em; color:#888;">ID: ${session.sessionId}</span> `;

            li.appendChild(sessionLink);
            li.appendChild(sessionInfo);
            sessionList.appendChild(li);
        });

    } catch (error) {
        console.error('全セッションデータのロード中にエラーが発生しました:', error);
        displayError(`セッションデータのロードに失敗しました。詳細: ${error.message}`);
    }
});