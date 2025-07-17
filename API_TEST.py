import openai
import os
from dotenv import load_dotenv

# .env ファイルから環境変数を読み込む
load_dotenv()

# 環境変数からOpenAI APIキーを取得
# 環境変数名が .env ファイルと一致していることを確認してください
openai.api_key = os.getenv("OPENAI_API_KEY")

# APIキーが正しく読み込まれたか確認（オプション）
if openai.api_key is None:
    print("Error: OPENAI_API_KEY environment variable not found. Please check your .env file.")
else:
    print("OpenAI API Key loaded successfully.")
    # ここにOpenAI APIを使用するコードを記述
    # 例: response = openai.chat.completions.create(...)

# --- チャットボットとの対話 ---

def chat_with_gpt(prompt_text):
    try:
        response = openai.chat.completions.create(
            model="gpt-4o",  # または "gpt-4o", "gpt-4o-mini" など、利用可能なモデルを選択
            messages=[
                {"role": "system", "content": "あなたは親切なAIアシスタントです。"},
                {"role": "user", "content": prompt_text}
            ]
        )
        # 応答からメッセージの内容を抽出
        return response.choices[0].message.content

    except openai.APIError as e:
        print(f"OpenAI APIエラーが発生しました: {e}")
        return None
    except Exception as e:
        print(f"予期せぬエラーが発生しました: {e}")
        return None

# --- 使用例 ---
if __name__ == "__main__":
    print("ChatGPTとの対話を開始します。'終了' と入力すると終了します。")

    while True:
        user_input = input("あなた: ")
        if user_input.lower() == '終了':
            print("対話を終了します。")
            break

        if openai.api_key is None or openai.api_key == "あなたのOpenAI APIキーをここに貼り付けてください":
            print("エラー: APIキーが設定されていません。コード内の 'あなたのOpenAI APIキーをここに貼り付けてください' を置き換えるか、環境変数を設定してください。")
            break

        response_text = chat_with_gpt(user_input)
        if response_text:
            print(f"ChatGPT: {response_text}")