import os
import json

from app.utils.openai_client import get_embeddings_model
from app.utils.vector_store import get_vector_store
from app.utils.gpt_processor import process_pdf_with_gpt
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    Docx2txtLoader,
    PyPDFLoader,
    TextLoader,
    UnstructuredFileLoader,
)
from langchain_core.documents import Document

# 添加新的JSON產品數據加載器
class JSONProductLoader:
    """加載JSON格式的產品數據"""
    
    def __init__(self, file_path):
        self.file_path = file_path
    
    def load(self):
        """加載並處理JSON產品數據"""
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            documents = []
            
            # 處理產品資料
            if 'products' in data:
                for product in data['products']:
                    # 產品基本資訊轉字符串
                    product_info = f"產品ID: {product['id']}\n"
                    product_info += f"產品名稱: {product['name']}\n"
                    product_info += f"產品描述: {product['description']}\n"
                    product_info += f"價格: {product['price']}\n"
                    product_info += f"類別: {product['category']}\n"
                    
                    # 產品規格如果存在
                    if 'specifications' in product:
                        product_info += "產品規格:\n"
                        for spec_key, spec_value in product['specifications'].items():
                            product_info += f"- {spec_key}: {spec_value}\n"
                    
                    # 創建Document對象
                    doc = Document(
                        page_content=product_info,
                        metadata={
                            "source": self.file_path,
                            "filename": os.path.basename(self.file_path),
                            "product_id": product['id'],
                            "product_name": product['name'],
                            "product_category": product['category']
                        }
                    )
                    documents.append(doc)
            
            return documents
        except Exception as e:
            print(f"處理JSON產品數據時出錯: {str(e)}")
            raise


async def process_document(file_path: str, use_openai_ocr: bool = False, page_by_page: bool = True, batch_size: int = 10, max_pages: int = 0) -> bool:
    """處理上傳的文件，使用 GPT-4o 進行處理，並存儲到向量數據庫"""
    try:
        print(f"開始處理文件: {file_path}，使用OCR模式: {use_openai_ocr}，逐頁處理: {page_by_page}，批次大小: {batch_size}，最大頁數: {max_pages}")

        # 檢查是否為 PDF 文件
        file_ext = os.path.splitext(file_path)[1].lower()
        if file_ext != ".pdf":
            raise ValueError("只支持 PDF 文件格式")

        # 使用 GPT-4o 處理 PDF，可選擇是否使用 Vision API
        print("使用 GPT-4o 處理 PDF...")
        if use_openai_ocr:
            print("使用 OpenAI Vision API 處理 PDF 圖像...")
            documents = process_pdf_with_gpt(file_path, use_vision_api=True, page_by_page=page_by_page, batch_size=batch_size, max_pages=max_pages)
        else:
            print("使用標準 GPT-4o 處理 PDF...")
            documents = process_pdf_with_gpt(file_path)
        print(f"處理成功，獲取文檔內容")

        # 以下部分保持不變
        # 檢查獲取的文檔是否為空
        if not documents:
            print("沒有從文件中提取到任何內容，跳過向量存儲")
            return False

        # 獲取向量存儲
        vector_store = get_vector_store()
        if vector_store is None:
            print("無法獲取向量存儲，處理終止")
            return False

        # 從完整路徑中獲取文件名
        filename = os.path.basename(file_path)
        
        # 添加到向量存儲
        print(f"將文檔添加到向量存儲: {filename}")
        vector_store.add_documents(documents)
        print("文檔成功添加到向量存儲")
        
        return True
    except Exception as e:
        print(f"處理文件時出錯: {str(e)}")
        return False


async def remove_document(file_path: str) -> bool:
    """從向量數據庫中移除文件"""
    try:
        vector_store = get_vector_store()
        vector_store.delete(where={"source": file_path})
        return True
    except Exception as e:
        print(f"移除文件時出錯: {str(e)}")
        return False
