import os
import shutil

# ======== 添加 langchain debug 補丁 ========
# 這是一個修復方案，解決"module 'langchain' has no attribute 'debug'"錯誤
import importlib
import logging

# 檢查 langchain 模組
langchain_module = importlib.import_module('langchain')
# 如果 langchain 模組中沒有 debug 屬性，添加一個空的 debug 函數
if not hasattr(langchain_module, 'debug'):
    def dummy_debug(*args, **kwargs):
        logging.debug("Called dummy langchain.debug")
        return None
    
    # 將模擬的 debug 函數添加到 langchain 模組
    setattr(langchain_module, 'debug', dummy_debug)
    print("全局：已添加模擬的 langchain.debug 函數以避免錯誤")
# ======== 補丁結束 ========

from app.routers import chat, history, upload
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 創建並設置必要的目錄
def setup_directories():
    # 設置靜態文件目錄
    static_dir = os.path.join(os.getcwd(), "static", "images", "products")
    os.makedirs(static_dir, exist_ok=True)
    os.chmod(static_dir, 0o777)
    
    # 設置向量存儲目錄 - 使用應用根目錄下的持久化目錄
    render_data_dir = os.path.join(os.getcwd(), ".render", "data")
    vector_store_dir = os.path.join(render_data_dir, "chroma_new")
    
    # 確保目錄層次結構存在
    os.makedirs(render_data_dir, exist_ok=True)
    os.makedirs(vector_store_dir, exist_ok=True)
    
    # 設置目錄權限
    try:
        os.chmod(render_data_dir, 0o777)
        os.chmod(vector_store_dir, 0o777)
    except Exception as e:
        print(f"設置向量存儲目錄權限時出錯: {str(e)}")
    
    # 設置上傳目錄
    upload_dir = os.path.join(os.getcwd(), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    os.chmod(upload_dir, 0o777)

# 初始化目錄
setup_directories()

app = FastAPI(title="RAG API")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊路由
app.include_router(chat.router)
app.include_router(upload.router)
app.include_router(history.router)

# 檢查是否需要重置數據庫
if os.path.exists("RESET_DB"):
    print("檢測到知識庫重置信號，正在重置...")
    
    # 清空知識庫目錄
    render_data_dir = os.path.join(os.getcwd(), ".render", "data")
    for db_dir in ["chroma_new", "chroma_db", "vector_db"]:
        db_path = os.path.join(render_data_dir, db_dir)
        if os.path.exists(db_path):
            try:
                shutil.rmtree(db_path, ignore_errors=True)
                print(f"已刪除向量庫目錄: {db_path}")
                os.makedirs(db_path, exist_ok=True)
                os.chmod(db_path, 0o777)
            except Exception as e:
                print(f"無法重置目錄 {db_path}: {str(e)}")
    
    # 刪除信號文件
    os.remove("RESET_DB")
    print("知識庫重置完成")

app.mount("/images", StaticFiles(directory="static/images"), name="images")

@app.get("/")
async def root():
    return {"message": "歡迎使用RAG API"}


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    
    # 從環境變數獲取 port,預設為 8080
    port = int(os.getenv("PORT", 8080))
    
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
