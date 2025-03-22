import traceback
import re
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.rag.engine import RAGEngine
import asyncio

router = APIRouter(prefix="/api", tags=["chat"])
rag_engine = RAGEngine()


class ChatRequest(BaseModel):
    query: str
    history: Optional[List[Dict[str, str]]] = []


class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        query = request.query
        history = request.history

        if not query:
            raise HTTPException(status_code=400, detail="查詢不能為空")

        # 增加診斷日誌
        print(f"接收到查詢: {query}")

        response = rag_engine.process_query(query, history)

        # 調試輸出
        print(f"返回答案: {response.get('answer', 'No answer')}")
        print(f"返回來源數量: {len(response.get('sources', []))}")

        return response
    except Exception as e:
        # 捕獲並打印詳細錯誤信息
        error_msg = f"處理查詢時出錯: {str(e)}"
        traceback_str = traceback.format_exc()
        print(error_msg)
        print(traceback_str)

        # 返回更詳細的錯誤信息
        raise HTTPException(status_code=500, detail=error_msg)


def preprocess_text(text: str) -> str:
    """
    對文本進行預處理，添加格式化標記以確保更好的排版
    """
    # 如果是產品資訊，格式化產品信息的各部分
    if "產品資料如下" in text or "商品名稱" in text:
        # 保留標題格式
        text = re.sub(r'(HK-\d+的產品資料如下：)', r'\1\n', text)
        
        # 將產品屬性格式化，確保適當的換行和對齊
        text = re.sub(r'(-\s*\*\*[^*]+\*\*:)', r'\n\1', text)
        
        # 將數字x轉換為×，提升閱讀體驗
        text = re.sub(r'(\d+)x(\d+)', r'\1×\2', text)
    
    return text


@router.post("/chat/stream")
async def stream_chat(request: ChatRequest):
    try:
        query = request.query
        history = request.history

        if not query:
            raise HTTPException(status_code=400, detail="查詢不能為空")

        # 增加診斷日誌
        print(f"接收到流式查詢: {query}")

        # 定義異步生成器函數來逐字輸出回應
        async def generate_response():
            try:
                # 獲取完整回應
                response = rag_engine.process_query(query, history)
                answer = response.get("answer", "")
                sources = response.get("sources", [])
                
                # 預處理文本以改善排版，但保持完整的格式化標記
                processed_answer = preprocess_text(answer)
                
                # 恢復逐字輸出
                for char in processed_answer:
                    yield f"data: {char}\n\n"
                    await asyncio.sleep(0.02)  # 控制輸出速度，稍微加快一點
                
                # 最後發送完整的來源信息
                import json
                yield f"data: [SOURCES]{json.dumps(sources)}[/SOURCES]\n\n"
                
                # 發送結束標記
                yield "data: [DONE]\n\n"
                
            except Exception as e:
                error_msg = f"處理流式查詢時出錯: {str(e)}"
                print(error_msg)
                print(traceback.format_exc())
                yield f"data: [ERROR]{error_msg}[/ERROR]\n\n"

        return StreamingResponse(
            generate_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
            },
        )
    except Exception as e:
        error_msg = f"準備流式響應時出錯: {str(e)}"
        print(error_msg)
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=error_msg)
