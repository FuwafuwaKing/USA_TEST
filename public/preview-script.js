// public/preview-script.js (更新版 - タイトル表示対応)

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');
    const serverUrl = `http://${window.location.host}`;

    const sessionTitleDisplay = document.getElementById('session-title'); // ★変更
    const sessionIdDisplay = document.getElementById('session-id-display'); // ★追加
    const fearScoreChartCanvas = document.getElementById('fearScoreChart');
    const conversationDisplay = document.getElementById('conversation-display');

    if (!sessionId) {
        sessionTitleDisplay.textContent = 'エラー: セッションIDが見つかりません。';
        return;
    }

    sessionTitleDisplay.textContent = `セッションデータロード中...`;

    try {
        const response = await fetch(`${serverUrl}/session-data/${sessionId}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`セッションデータ取得失敗: ${response.status} - ${errorText}`);
        }
        const sessionData = await response.json();
        console.log('セッションデータ取得成功:', sessionData);

        sessionTitleDisplay.textContent = sessionData.sessionTitle || '無題の物語'; // ★タイトル表示
        sessionIdDisplay.textContent = `ID: ${sessionData.sessionId}`; // ★IDも表示

        // 恐怖度グラフの描画
        if (sessionData.fearScores && sessionData.fearScores.length > 0) {
            const labels = sessionData.fearScores.map((_, i) => `会話 ${i + 1}`);
            const data = sessionData.fearScores;

            new Chart(fearScoreChartCanvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '恐怖度スコア',
                        data: data,
                        borderColor: '#bb86fc',
                        backgroundColor: 'rgba(187, 134, 252, 0.2)',
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#bb86fc',
                        pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff',
                        pointHoverBorderColor: '#bb86fc',
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: '恐怖度推移',
                            color: '#e0e0e0'
                        },
                        legend: {
                            labels: {
                                color: '#e0e0e0'
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: '会話回数',
                                color: '#e0e0e0'
                            },
                            ticks: {
                                color: '#e0e0e0'
                            },
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: '恐怖度 (0-100)',
                                color: '#e0e0e0'
                            },
                            min: 0,
                            max: 100,
                            ticks: {
                                color: '#e0e0e0'
                            },
                            grid: {
                                color: 'rgba(255, 255, 255, 0.1)'
                            }
                        }
                    }
                }
            });
        } else {
            fearScoreChartCanvas.style.display = 'none';
            const noChartMessage = document.createElement('p');
            noChartMessage.textContent = 'このセッションには恐怖度データがありません。';
            conversationDisplay.before(noChartMessage);
        }

        // 会話履歴の表示
        if (sessionData.conversation && sessionData.conversation.length > 0) {
            sessionData.conversation.forEach(entry => {
                const p = document.createElement('p');
                // 初期ストーリーが会話ターン数1に含まれるため、AIの最初の会話は恐怖度を表示しない
                const fearText = (entry.speaker === 'AI' && entry.fearScore !== undefined && entry.fearScore !== null && entry.conversationTurn !== 0) 
                                 ? ` (恐怖度: ${entry.fearScore})` : '';
                p.textContent = `${entry.speaker}: ${entry.text}${fearText}`;
                p.className = entry.speaker === 'ユーザー' ? 'user-prompt' : 'assistant-response';
                conversationDisplay.appendChild(p);
            });
        } else {
            conversationDisplay.textContent = 'このセッションには会話履歴がありません。';
        }

    } catch (error) {
        console.error('セッションデータのロード中にエラーが発生しました:', error);
        sessionTitleDisplay.textContent = `エラー: データをロードできませんでした。`;
        conversationDisplay.textContent = `エラー: ${error.message}`;
    }
});