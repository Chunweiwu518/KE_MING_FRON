import os
import time

from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings  # 使用最新的包

# 確保載入環境變數
load_dotenv()


def get_openai_client():
    """獲取OpenAI客戶端實例"""
    from openai import OpenAI

    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_embeddings_model():
    """獲取 OpenAI 嵌入模型"""
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        raise ValueError("找不到 OPENAI_API_KEY 環境變數")

    print(
        f"使用嵌入模型: {os.getenv('EMBEDDING_MODEL_NAME', 'text-embedding-3-small')}"
    )

    # 添加重試和延遲機制
    try:
        return OpenAIEmbeddings(
            model=os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small"),
            openai_api_key=api_key,
            request_timeout=60,  # 增加超時時間
        )
    except Exception as e:
        print(f"創建嵌入模型時出錯: {str(e)}")
        time.sleep(2)  # 延遲嘗試
        # 再次嘗試
        return OpenAIEmbeddings(
            model=os.getenv("EMBEDDING_MODEL_NAME", "text-embedding-3-small"),
            openai_api_key=api_key,
            request_timeout=60,
        )
