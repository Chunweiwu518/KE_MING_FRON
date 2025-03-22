from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["history"])


class Message(BaseModel):
    role: str
    content: str
    sources: Optional[List[Dict[str, Any]]] = None


class ChatHistory(BaseModel):
    id: str
    title: str
    messages: List[Message]
    createdAt: str


class CreateHistoryRequest(BaseModel):
    messages: List[Message]
    title: Optional[str] = None


# 暫時使用內存存儲，實際應用中應該使用數據庫
chat_histories: Dict[str, ChatHistory] = {}


@router.get("/history", response_model=List[ChatHistory])
async def get_all_histories():
    """獲取所有對話歷史"""
    try:
        return list(chat_histories.values())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"獲取歷史記錄失敗: {str(e)}")


@router.get("/history/{chat_id}", response_model=ChatHistory)
async def get_chat_history(chat_id: str):
    """獲取特定對話的詳細信息"""
    try:
        if chat_id not in chat_histories:
            raise HTTPException(status_code=404, detail="找不到指定的對話記錄")
        return chat_histories[chat_id]
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"獲取對話記錄失敗: {str(e)}")


@router.post("/history", response_model=ChatHistory)
async def create_chat_history(request: CreateHistoryRequest):
    """保存新的對話"""
    try:
        chat_id = str(uuid4())

        # 如果沒有提供標題，使用第一條消息的前20個字符
        title = request.title
        if not title and request.messages:
            first_message = request.messages[0].content.strip()
            if len(first_message) > 30:
                title = first_message[:30] + "..."
            else:
                title = first_message
        elif not title:
            title = f"對話 {datetime.now().strftime('%Y-%m-%d %H:%M')}"

        print(f"創建新對話記錄: ID={chat_id}, 標題={title}, 消息數量={len(request.messages)}")
        
        new_chat = ChatHistory(
            id=chat_id,
            title=title,
            messages=request.messages,
            createdAt=datetime.now().isoformat(),
        )

        chat_histories[chat_id] = new_chat
        print(f"對話記錄創建成功: {chat_id}")
        return new_chat
    except Exception as e:
        print(f"創建對話記錄失敗: {str(e)}")
        raise HTTPException(status_code=500, detail=f"創建對話記錄失敗: {str(e)}")


@router.delete("/history/{chat_id}")
async def delete_chat_history(chat_id: str):
    """刪除特定對話"""
    try:
        if chat_id not in chat_histories:
            raise HTTPException(status_code=404, detail="找不到指定的對話記錄")
        del chat_histories[chat_id]
        return {"status": "success", "message": "對話記錄已刪除"}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"刪除對話記錄失敗: {str(e)}")


@router.delete("/history/clear")
async def clear_history():
    """清空所有對話記錄"""
    try:
        chat_histories.clear()
        return {"status": "success", "message": "所有對話記錄已清空"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清空對話記錄失敗: {str(e)}")
