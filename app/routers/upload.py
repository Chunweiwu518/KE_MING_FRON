import glob
import os
import shutil
import time
import uuid
from typing import Dict, Optional, List, Any
from datetime import datetime

from app.rag.document import process_document, remove_document
from app.utils.vector_store import get_vector_store, reset_vector_store
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

router = APIRouter(prefix="/api", tags=["upload"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 保存上傳文件的映射關係
file_mappings: Dict[str, str] = {}  # 顯示名稱 -> 實際文件名


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...), 
    use_openai_ocr: bool = Form(True),
    page_by_page: bool = Form(True),  # 默認為逐頁處理
    batch_size: int = Form(10),  # 默認批次大小為10頁
    max_pages: int = Form(0)  # 默認不限制處理頁數
):
    """
    上傳 PDF 文件並使用 GPT-4o 進行處理
    
    Args:
        file: 上傳的PDF文件
        use_openai_ocr: 是否使用OpenAI Vision API處理PDF
        page_by_page: 是否逐頁處理PDF
        batch_size: 每批處理的頁數（僅在page_by_page=False時有效）
        max_pages: 最大處理頁數（設為0表示處理所有頁面）
    """
    try:
        # 驗證文件類型
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension != ".pdf":
            raise HTTPException(status_code=400, detail="只支持 PDF 文件，請上傳 PDF 格式的文件")

        # 創建上傳目錄
        upload_dir = os.path.join(os.getcwd(), "uploads")
        os.makedirs(upload_dir, exist_ok=True)

        # 生成唯一文件名
        new_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = os.path.join(upload_dir, new_filename)

        # 保存文件
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)

        # 保存文件映射關係
        file_mappings[file.filename] = new_filename

        # 處理文件並添加到向量數據庫
        print(f"開始處理文件: {file_path}")
        success = await process_document(
            file_path, 
            use_openai_ocr=use_openai_ocr, 
            page_by_page=page_by_page,
            batch_size=batch_size,
            max_pages=max_pages
        )

        if not success:
            # 如果處理失敗，清理文件
            os.remove(file_path)
            del file_mappings[file.filename]
            raise HTTPException(status_code=500, detail="文件處理失敗")

        print(f"文件處理完成: {file_path}")
        return {
            "status": "success",
            "filename": file.filename,
            "message": "文件已上傳並使用 GPT-4o 處理完成"
        }

    except Exception as e:
        print(f"上傳文件時出錯: {str(e)}")
        raise HTTPException(status_code=500, detail=f"上傳失敗: {str(e)}")


@router.delete("/files/{filename}")
async def delete_file(filename: str):
    """刪除文件"""
    try:
        # 首先檢查是否直接在uploads目錄中存在這個文件
        file_path = os.path.join(os.getcwd(), "uploads", filename)
        if os.path.exists(file_path):
            # 從向量數據庫中移除文件
            await remove_document(file_path)
            # 刪除實際文件
            os.remove(file_path)
            # 如果在映射中存在，也要移除
            for display_name, actual_name in list(file_mappings.items()):
                if actual_name == filename:
                    del file_mappings[display_name]
                    break
            return {"status": "success", "message": "文件已刪除"}
            
        # 如果不是直接的UUID文件名，再嘗試從映射中查找
        if filename in file_mappings:
            actual_filename = file_mappings[filename]
            file_path = os.path.join(os.getcwd(), "uploads", actual_filename)
            
            # 從向量數據庫中移除文件
            await remove_document(file_path)
            
            # 刪除實際文件
            if os.path.exists(file_path):
                os.remove(file_path)
                
            # 移除映射關係
            del file_mappings[filename]
            return {"status": "success", "message": "文件已刪除"}
        else:
            raise HTTPException(status_code=404, detail="找不到指定的文件")
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"刪除文件時出錯: {str(e)}")
        raise HTTPException(status_code=500, detail=f"刪除文件失敗: {str(e)}")


@router.delete("/files/clear")
async def clear_all_files():
    """清空所有文件"""
    try:
        # 清空向量數據庫
        vector_store = get_vector_store()
        vector_store.delete(where={})  # 刪除所有文檔

        # 刪除所有實際文件
        upload_dir = os.path.join(os.getcwd(), "uploads")
        for filename in os.listdir(upload_dir):
            file_path = os.path.join(upload_dir, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)

        # 清空文件映射
        file_mappings.clear()

        return {"status": "success", "message": "所有文件已清空"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"清空文件失敗: {str(e)}")


@router.delete("/vector-store/clear")
async def clear_vector_store():
    """徹底清空向量知識庫"""
    try:
        # 1. 關閉現有連接
        reset_vector_store()

        # 2. 清除文件
        render_data_dir = os.path.join(os.getcwd(), ".render", "data")
        vector_dir = os.path.join(render_data_dir, "chroma_new")
        if os.path.exists(vector_dir):
            # 確保所有文件句柄都已釋放
            time.sleep(1)

            try:
                # 直接使用 shutil.rmtree 清除整個目錄
                shutil.rmtree(vector_dir, ignore_errors=True)
                os.makedirs(vector_dir, exist_ok=True)
                os.chmod(vector_dir, 0o777)
                print("已清空向量庫目錄")
            except Exception as e:
                print(f"清除目錄時出錯: {str(e)}")
                # 如果直接刪除失敗，嘗試逐個刪除
                for root, dirs, files in os.walk(vector_dir, topdown=False):
                    for name in files:
                        try:
                            os.remove(os.path.join(root, name))
                        except Exception as e:
                            print(f"刪除文件失敗: {str(e)}")
                    for name in dirs:
                        try:
                            os.rmdir(os.path.join(root, name))
                        except Exception as e:
                            print(f"刪除目錄失敗: {str(e)}")

        # 確保創建目錄並設置權限
        os.makedirs(vector_dir, exist_ok=True)
        try:
            os.chmod(render_data_dir, 0o777)
            os.chmod(vector_dir, 0o777)
        except Exception as e:
            print(f"設置權限時出錯: {str(e)}")

        # 3. 清空文件映射
        file_mappings.clear()

        # 4. 強制重新初始化向量庫
        get_vector_store(force_new=True)

        return {
            "status": "success",
            "message": "向量知識庫已清空",
            "timestamp": time.time(),  # 添加時間戳以便前端判斷更新
        }
    except Exception as e:
        print(f"清空向量知識庫時出錯: {str(e)}")
        raise HTTPException(status_code=500, detail=f"清空向量知識庫失敗: {str(e)}")


@router.post("/upload/folder")
async def upload_folder(folder_path: str, use_openai_ocr: bool = True):
    """
    上傳本地資料夾中的所有支持的文件
    
    Args:
        folder_path: 本地資料夾路徑
        use_openai_ocr: 是否使用OpenAI Vision API處理PDF，預設為True
    """
    try:
        if not folder_path or not os.path.exists(folder_path):
            raise HTTPException(status_code=400, detail="請提供有效的資料夾路徑")

        # 支持的文件類型
        supported_extensions = [".txt", ".pdf", ".docx"]

        # 遞歸搜索所有支持的文件
        all_files = []
        for ext in supported_extensions:
            files = glob.glob(os.path.join(folder_path, f"**/*{ext}"), recursive=True)
            all_files.extend(files)

        if not all_files:
            raise HTTPException(status_code=400, detail="資料夾中沒有找到支持的文件")

        # 處理每個文件
        processed_files = []
        failed_files = []

        for file_path in all_files:
            try:
                # 複製文件到上傳目錄
                file_name = os.path.basename(file_path)
                new_filename = f"{uuid.uuid4()}{os.path.splitext(file_name)[1]}"
                dest_path = os.path.join(os.getcwd(), "uploads", new_filename)

                # 複製文件
                import shutil

                shutil.copy2(file_path, dest_path)

                # 保存文件映射
                file_mappings[file_name] = new_filename

                # 確定是否使用 OpenAI OCR
                current_use_openai_ocr = use_openai_ocr
                # 只對 PDF 文件使用 OpenAI OCR
                is_pdf = os.path.splitext(file_name)[1].lower() == ".pdf"
                if current_use_openai_ocr and not is_pdf:
                    current_use_openai_ocr = False

                # 處理文件
                success = await process_document(dest_path, use_openai_ocr=current_use_openai_ocr)

                if success:
                    processed_files.append(file_name)
                else:
                    failed_files.append(file_name)
                    # 清理失敗的文件
                    os.remove(dest_path)
                    del file_mappings[file_name]

            except Exception as e:
                print(f"處理文件 {file_path} 時出錯: {str(e)}")
                failed_files.append(file_name)

        return {
            "status": "success",
            "processed_files": processed_files,
            "failed_files": failed_files,
            "message": f"成功處理 {len(processed_files)} 個文件，失敗 {len(failed_files)} 個",
            "ocr_method": "OpenAI Vision" if use_openai_ocr else "傳統 OCR (僅 PDF)"
        }

    except Exception as e:
        print(f"處理資料夾時出錯: {str(e)}")
        raise HTTPException(status_code=500, detail=f"處理資料夾失敗: {str(e)}")


@router.get("/vector-store/stats")
async def get_vector_store_stats():
    """獲取向量知識庫統計信息和內容"""
    try:
        vector_store = get_vector_store()
        
        # 獲取所有文檔
        results = vector_store.get()
        
        if not results or not results['documents']:
            return {
                "status": "success",
                "message": "向量庫是空的",
                "total_chunks": 0,
                "unique_files": 0,
                "files": [],
                "chunks": [],
                "is_empty": True
            }
            
        # 獲取所有文檔內容和元數據
        documents = results['documents']
        metadatas = results['metadatas']
        
        # 整理文件統計
        file_stats = {}
        chunks_content = []
        
        for doc, meta in zip(documents, metadatas):
            filename = meta.get('filename', 'unknown')
            if filename not in file_stats:
                file_stats[filename] = 0
            file_stats[filename] += 1
            
            # 添加chunk內容
            chunks_content.append({
                "content": doc,
                "metadata": meta
            })
        
        return {
            "status": "success",
            "total_chunks": len(documents),
            "unique_files": len(file_stats),
            "files": file_stats,
            "chunks": chunks_content,
            "is_empty": False
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"獲取統計信息失敗: {str(e)}")


@router.post("/vector-store/hard-reset")
async def hard_reset_vector_store():
    """徹底重置向量庫（需要重啟服務）"""
    try:
        # 關閉當前所有連接
        reset_vector_store()

        # 寫入一個信號文件
        with open("RESET_DB", "w") as f:
            f.write(str(time.time()))

        # 返回需要重啟的提示
        return {
            "status": "success",
            "message": "已標記知識庫需要重置，請重啟服務以完成重置",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"重置標記失敗: {str(e)}")


@router.post("/test/ocr")
async def test_ocr(file: UploadFile = File(...), page_num: int = 0):
    """
    測試 PaddleOCR 的中文識別功能
    
    上傳 PDF 文件並使用 PaddleOCR 對指定頁面進行 OCR 處理，但不將結果存入向量數據庫
    """
    try:
        # 驗證文件類型
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension != ".pdf":
            raise HTTPException(status_code=400, detail="只支持 PDF 文件，請上傳 PDF 格式的文件")
        
        # 創建臨時目錄用於測試
        temp_dir = os.path.join(os.getcwd(), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        
        # 生成臨時文件名
        temp_filename = f"temp_{uuid.uuid4()}.pdf"
        temp_file_path = os.path.join(temp_dir, temp_filename)
        
        try:
            # 保存文件
            contents = await file.read()
            with open(temp_file_path, "wb") as f:
                f.write(contents)
            
            # 導入所需模組
            from app.utils.paddle_ocr import PaddlePDFProcessor
            
            # 創建處理器
            processor = PaddlePDFProcessor(temp_file_path)
            
            # 讀取 PDF，檢查頁數
            import fitz
            pdf_document = fitz.open(temp_file_path)
            total_pages = len(pdf_document)
            
            if page_num < 0 or page_num >= total_pages:
                raise HTTPException(
                    status_code=400, 
                    detail=f"頁面編號無效。PDF 共有 {total_pages} 頁，頁碼必須在 0 至 {total_pages-1} 之間"
                )
            
            # 獲取指定頁面
            page = pdf_document[page_num]
            
            # 提取頁面圖像
            image = processor._extract_page_as_image(page)
            
            # 使用 PaddleOCR 進行 OCR 處理
            ocr_result = processor._ocr_with_paddle(image)
            
            # 關閉 PDF
            pdf_document.close()
            
            return {
                "status": "success",
                "filename": file.filename,
                "page": page_num + 1,  # 顯示給用戶的頁碼從 1 開始
                "total_pages": total_pages,
                "ocr_result": ocr_result,
                "ocr_method": "PaddleOCR",
                "message": "PaddleOCR 測試完成"
            }
            
        finally:
            # 清理臨時文件
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            
    except Exception as e:
        print(f"PaddleOCR 測試時出錯: {str(e)}")
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"OCR 測試失敗: {str(e)}")


@router.post("/test/gpt-ocr")
async def test_gpt_ocr(file: UploadFile = File(...)):
    """
    測試 GPT-4o 的 PDF 處理功能 (使用 Vision API)
    """
    try:
        # 驗證文件類型
        file_extension = os.path.splitext(file.filename)[1].lower()
        if file_extension != ".pdf":
            raise HTTPException(status_code=400, detail="只支持 PDF 文件，請上傳 PDF 格式的文件")
        
        # 創建臨時目錄用於測試
        temp_dir = os.path.join(os.getcwd(), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        
        # 生成臨時文件名
        temp_filename = f"temp_{uuid.uuid4()}.pdf"
        temp_file_path = os.path.join(temp_dir, temp_filename)
        
        try:
            # 保存文件
            contents = await file.read()
            with open(temp_file_path, "wb") as f:
                f.write(contents)
            
            # 導入所需模組
            from app.utils.gpt_processor import process_pdf_with_openai
            
            # 直接使用 Vision API 處理
            documents = process_pdf_with_openai(temp_file_path)
            
            return {
                "status": "success",
                "filename": file.filename,
                "content": documents[0].page_content if documents else "",
                "extraction_method": "gpt4o-vision",
                "message": "使用 Vision API 處理完成"
            }
            
        finally:
            # 清理臨時文件
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            
    except Exception as e:
        print(f"GPT-4o Vision API 處理時出錯: {str(e)}")
        import traceback
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"處理失敗: {str(e)}")


@router.get("/files", response_model=List[Dict[str, Any]])
async def get_uploaded_files():
    """獲取所有已上傳的檔案"""
    try:
        files = []
        for filename in os.listdir(UPLOAD_DIR):
            # 獲取檔案路徑並確保是檔案而非目錄
            file_path = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(file_path):
                # 獲取檔案資訊
                file_stats = os.stat(file_path)
                
                # 檢查文件是否在文件映射中
                display_name = filename
                for original_name, mapped_name in file_mappings.items():
                    if mapped_name == filename:
                        display_name = original_name
                        break
                
                files.append({
                    "name": filename,  # 使用UUID格式的實際文件名
                    "display_name": display_name,  # 原始顯示名稱
                    "size": file_stats.st_size,
                    "lastModified": file_stats.st_mtime * 1000,  # 轉換為毫秒時間戳
                    "uploadTime": datetime.fromtimestamp(file_stats.st_ctime).isoformat()
                })
        
        # 根據修改時間排序，最新的在前面
        files.sort(key=lambda x: x["lastModified"], reverse=True)
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"獲取檔案列表失敗: {str(e)}")
