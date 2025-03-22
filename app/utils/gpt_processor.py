import os
import base64
from openai import OpenAI
from typing import List
from langchain_core.documents import Document
from dotenv import load_dotenv
import fitz  # PyMuPDF
import json
import datetime
from pdf2image import convert_from_path
import io

load_dotenv()

class GPTDocumentProcessor:
    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        # 檔案大小限制調低 (以位元組為單位，約10MB)
        self.size_limit = 10 * 1024 * 1024
        # 頁數限制，超過此頁數一律使用分塊處理
        self.page_limit = 15
    
    def should_split(self):
        """判斷是否應該分割處理PDF"""
        # 檢查檔案物理大小 - 降低閾值到 5MB
        file_size = os.path.getsize(self.pdf_path)
        if file_size > 5 * 1024 * 1024:  # 5MB
            print(f"檔案大小超過 5MB ({file_size/1024/1024:.2f}MB)，將進行分塊處理")
            return True
            
        # 檢查頁數 - 降低閾值到 8 頁
        try:
            pdf = fitz.open(self.pdf_path)
            page_count = len(pdf)
            
            # 檢查文字內容估計的 tokens
            total_text = ""
            for page in pdf:
                total_text += page.get_text()
            
            # 簡單估算 tokens 數量 (粗略計算，每 4 個字符約為 1 個 token)
            estimated_tokens = len(total_text) / 4
            pdf.close()
            
            # 如果估計的 tokens 超過 50,000，或頁數超過 8 頁，則分塊處理
            if estimated_tokens > 50000:
                print(f"預估 tokens 超過 50,000 (約 {estimated_tokens:.0f})，將進行分塊處理")
                return True
            
            if page_count > 8:
                print(f"頁數超過 8 頁 (共 {page_count} 頁)，將進行分塊處理")
                return True
            
            return False
        except Exception as e:
            print(f"檢查PDF時出錯: {str(e)}")
            # 如果無法檢查，保守處理，認為應該分割
            return True
    
    def split_pdf(self, max_pages_per_chunk=10):
        """將大型PDF分割成較小的塊，每塊最多10頁"""
        pdf = fitz.open(self.pdf_path)
        total_pages = len(pdf)
        
        print(f"PDF 實際頁數: {total_pages}")
        
        chunks = []
        
        # 確定需要分成多少塊
        num_chunks = (total_pages + max_pages_per_chunk - 1) // max_pages_per_chunk
        
        for i in range(num_chunks):
            start_page = i * max_pages_per_chunk
            end_page = min((i + 1) * max_pages_per_chunk, total_pages)
            
            # 確保頁碼不超出範圍
            if start_page >= total_pages:
                print(f"跳過超出範圍的塊: {start_page+1}-{end_page}，PDF只有 {total_pages} 頁")
                continue
            
            # 創建新的PDF文件對象
            new_pdf = fitz.open()
            
            # 複製頁面到新的PDF
            for page_num in range(start_page, end_page):
                new_pdf.insert_pdf(pdf, from_page=page_num, to_page=page_num)
            
            # 將新PDF轉換為位元組流
            pdf_bytes = new_pdf.write()
            chunks.append({
                "start_page": start_page,
                "end_page": end_page - 1,
                "content": pdf_bytes
            })
            
            new_pdf.close()
        
        pdf.close()
        return chunks
    
    def process_chunk(self, chunk):
        """處理單個PDF塊"""
        try:
            # 使用時間戳創建唯一的臨時文件名
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            # 將臨時文件名簡化為單頁形式
            temp_pdf_path = f"temp_page_{chunk['start_page']+1}_{timestamp}.pdf"
            
            with open(temp_pdf_path, "wb") as f:
                f.write(chunk["content"])
            
            try:
                # 上傳臨時PDF文件
                with open(temp_pdf_path, "rb") as f:
                    response = self.client.files.create(
                        file=f,
                        purpose="assistants"
                    )
                    file_id = response.id
                
                # 特別處理可能有問題的頁面區域（第85頁以後）
                special_handling = chunk['start_page'] >= 85
                
                # 修改提示詞以適應單頁處理，減少對頁碼的強調
                text = f"""【任務說明】
您收到的是產品目錄的一個頁面。請提取此頁面上所有的產品信息。

請從頁面中提取所有產品的以下信息：
1. 產品型號
2. 產品名稱
3. 產品尺寸
4. 裝箱數量
5. 建議售價

針對每個產品，請使用以下格式提取：

### [產品型號]
- **產品名稱**: [名稱]
- **產品描述**: [描述，如有]
- **尺寸規格**: [尺寸]
- **裝箱數量**: [數量]
- **建議售價**: [價格]

【提取技巧】
* 產品型號通常在左上角或頁面頂部黑色背景中的白色文字
* 產品尺寸、裝箱數量和建議售價通常在產品圖片下方
* 一頁中可能包含多個產品，請分別提取每個產品的信息
* 如果頁面上沒有產品信息，請直接說明「此頁沒有產品信息」
* 只需關注當前頁面的產品信息

【請注意】
* 請不要討論其他頁面的存在與否，只關注您看到的內容
* 不需要在回應中包含頁碼提示，直接提取產品信息即可
* 請始終使用繁體中文純文本格式輸出結果，不要使用JSON或其他程式碼格式
* 即使發現表格或結構化數據，也請以純文本方式輸出，使用「-」或「•」作為項目符號
"""
                
                # 針對85頁以後可能有問題的頁面添加額外的提示
                if special_handling:
                    text += """
【特別注意】
本頁可能包含：
- 電器產品（如電風扇、空氣清淨機等）
- Kolinem品牌的產品
- 型號類似於KFC-MN系列、KEM-MN系列的產品

請特別留意：
1. 頁面頂部的黑色標題欄
2. 產品圖片
3. 圖片下方的尺寸和規格信息
"""
                
                # 提供一些已知產品格式的例子但簡化
                text += """
【參考示例】
一個產品信息的典型格式如下：
商品尺寸: 22.7x45.8x4.5cm
裝箱數: 20*2=40
建議售價: $300
"""
                
                response = self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "system",
                            "content": "您是一位專業的產品目錄分析專家。您的任務是從提供的PDF頁面中提取產品信息。只關注您能看到的內容，無需考慮頁碼或其他頁面。"
                        },
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "file",
                                    "file": {
                                        "file_id": file_id
                                    }
                                },
                                {
                                    "type": "text",
                                    "text": text
                                }
                            ]
                        }
                    ]
                )
                
                # 獲取回應內容
                response_content = response.choices[0].message.content
                
                # 後處理回應，檢查並移除提及其他頁面或頁碼的內容
                if "不在" in response_content and "檔案" in response_content and "頁" in response_content:
                    lines = response_content.split('\n')
                    filtered_lines = []
                    skip_next_lines = False
                    
                    for line in lines:
                        # 如果行提到其他頁面不存在，跳過這行和下面幾行
                        if ("不在" in line and "頁" in line) or \
                           ("找不到" in line and "頁" in line) or \
                           ("無法" in line and "頁" in line) or \
                           ("只有" in line and "頁" in line):
                            skip_next_lines = True
                            continue
                            
                        # 如果是空行，重置跳過標記
                        if not line.strip() and skip_next_lines:
                            skip_next_lines = False
                            
                        # 如果不需要跳過，添加這行
                        if not skip_next_lines:
                            filtered_lines.append(line)
                    
                    response_content = '\n'.join(filtered_lines)
                    
                    # 如果過濾後內容為空或太短，使用默認回應
                    if len(response_content.strip()) < 50:
                        response_content = "此頁沒有產品信息。"
                
                # 處理完成後刪除上傳的文件
                try:
                    self.client.files.delete(file_id)
                except Exception as e:
                    print(f"刪除API上傳文件時出錯: {str(e)}")
                
                # 保留臨時文件，並記錄
                print(f"保留臨時文件供檢查: {temp_pdf_path}")
                
                return response_content
            
            finally:
                # 不再刪除臨時文件
                pass
            
        except Exception as e:
            print(f"處理第{chunk['start_page']+1}頁時出錯: {str(e)}")
            return f"處理第{chunk['start_page']+1}頁時出錯: {str(e)}"
    
    def process(self, use_vision_api=False, page_by_page=True):
        """處理 PDF 文件，可選擇使用 Vision API 或普通處理"""
        try:
            if use_vision_api:
                print(f"使用 Vision API 處理: {self.pdf_path}")
                return process_pdf_with_openai(self.pdf_path, page_by_page=page_by_page)
            
            # 原有的處理邏輯
            # 先檢查並打印 PDF 實際頁數
            pdf = fitz.open(self.pdf_path)
            total_pages = len(pdf)
            pdf.close()
            print(f"PDF 文件 {os.path.basename(self.pdf_path)} 實際頁數: {total_pages}")
            
            # 不再使用should_split判斷，直接採用分割處理方式
            print(f"開始分割處理: {self.pdf_path}")
            # 每頁單獨處理，將分塊大小設定為1頁
            chunks = self.split_pdf(max_pages_per_chunk=1)
            results = []
            
            for i, chunk in enumerate(chunks):
                print(f"處理第 {i+1}/{len(chunks)} 頁 (頁面 {chunk['start_page']+1})...")
                chunk_result = self.process_chunk(chunk)
                
                # 檢查是否為"頁面不存在"的回應
                if "只有" in chunk_result and "頁" in chunk_result and ("沒有" in chunk_result or "不存在" in chunk_result):
                    print(f"警告: 跳過不存在的頁面 {chunk['start_page']+1}")
                    continue
                
                results.append(chunk_result)
                
                # 打印前150個字符預覽
                preview = chunk_result[:150] + "..." if len(chunk_result) > 150 else chunk_result
                print(f"頁面 {chunk['start_page']+1} 處理結果預覽: {preview}")
                
                # 增加日誌以診斷頁面處理問題
                if chunk['start_page'] >= 80:  # 從81頁開始可能有問題
                    print(f"頁面 {chunk['start_page']+1} 詳細處理結果長度: {len(chunk_result)} 字符")
                    if len(chunk_result) < 200:  # 如果結果很短
                        print(f"頁面 {chunk['start_page']+1} 完整結果: {chunk_result}")
            
            # 合併所有結果
            content = "\n\n".join(results)
            
            # 將文本內容加入 Document
            doc = Document(
                page_content=content,
                metadata={
                    "source": self.pdf_path,
                    "filename": os.path.basename(self.pdf_path),
                    "extraction_method": "gpt4o"
                }
            )
            
            return [doc]
            
        except Exception as e:
            print(f"GPT-4o 處理時出錯: {str(e)}")
            raise

    def process_file(self, file_id):
        """處理單個文件ID"""
        try:
            # 使用提示詞處理整個PDF
            text = """請詳細分析這份PDF文件，並按以下格式提取產品信息:

### [產品型號]
- **產品名稱**: [名稱]
- **產品描述**: [描述]
- **尺寸規格**: [尺寸]
- **裝箱數量**: [數量]
- **建議售價**: [價格]

如果PDF中有多個產品，請按上述格式分別列出每個產品。
如果某些信息在PDF中未提供，請標註為"未提供"。
同時注意辨識產品圖片中可能包含的信息。

請確保所有輸出都是繁體中文純文本格式，不要使用JSON或其他程式碼格式。
即使發現表格或結構化數據，也請以純文本方式輸出，使用「-」或「•」作為項目符號。"""

            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system", 
                        "content": "您是一位專業的產品目錄分析專家。您的任務是從提供的PDF中提取產品信息。請始終以繁體中文純文本格式輸出結果，不要使用JSON或其他程式碼格式。"
                    },
                    {
                        "role": "user", 
                        "content": [
                            {
                                "type": "file",
                                "file": {"file_id": file_id}
                            },
                            {
                                "type": "text",
                                "text": text
                            }
                        ]
                    }
                ]
            )
            
            # 處理完成後刪除上傳的文件
            try:
                self.client.files.delete(file_id)
            except Exception as e:
                print(f"刪除檔案ID {file_id} 時出錯: {str(e)}")
            
            content = response.choices[0].message.content
            return content
            
        except Exception as e:
            print(f"處理檔案ID {file_id} 時出錯: {str(e)}")
            return f"處理檔案時出錯: {str(e)}"

def process_pdf_with_gpt(
    pdf_path: str, 
    use_vision_api: bool = True, 
    page_by_page: bool = True,
    batch_size: int = 10,
    max_pages: int = 0
) -> List[Document]:
    """使用 GPT 處理 PDF 文件
    
    Args:
        pdf_path: PDF 文件路徑
        use_vision_api: 是否使用 Vision API 處理
        page_by_page: 是否逐頁處理（僅在 use_vision_api=True 時有效）
        batch_size: 每批處理的頁數（僅在 page_by_page=False 時有效）
        max_pages: 最大處理頁數
    
    Returns:
        處理後的文檔列表
    """
    processor = GPTDocumentProcessor(pdf_path)
    
    if use_vision_api:
        # 使用 Vision API 處理
        return process_pdf_with_openai(pdf_path, max_pages=max_pages, page_by_page=page_by_page, batch_size=batch_size)
    else:
        # 使用標準處理方式
        return processor.process()

def process_pdf_with_openai(pdf_path, max_pages=0, page_by_page=True, batch_size=10):
    """使用OpenAI Vision API分析PDF內容
    
    Args:
        pdf_path: PDF文件路徑
        max_pages: 最大處理頁數，0表示處理所有頁面
        page_by_page: 是否逐頁處理
        batch_size: 批次處理大小（一次處理的頁數）
    """
    # 將PDF轉換為圖像
    print(f"轉換PDF: {pdf_path}")
    try:
        images = convert_from_path(pdf_path)
        print(f"成功轉換 {len(images)} 頁")
    except Exception as e:
        print(f"PDF轉換錯誤: {e}")
        return []
    
    # 處理所有頁面或限制頁數
    if max_pages <= 0:
        print(f"設置為處理所有 {len(images)} 頁")
    else:
        images = images[:max_pages]
        print(f"限制處理前 {len(images)} 頁")
    
    results = []
    
    # 逐頁處理模式
    if page_by_page:
        print(f"使用逐頁處理模式，共 {len(images)} 頁")
        for page_num, image in enumerate(images, 1):
            print(f"處理第 {page_num} 頁...")
            
            # 準備消息內容
            messages = [
                {
                    "role": "system",
                    "content": "您是一個專業的PDF文件分析助手。請分析以下PDF頁面的內容，提取所有可見文字，表格和重要資訊。請始終以繁體中文純文本格式輸出，不要使用JSON或其他標記語言格式。對於表格內容，請使用簡單的文本表示法，如「-」或「•」作為項目符號。"
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"這是PDF文件的第 {page_num} 頁。請幫我提取該頁面所有可見的文字內容，並且組織成結構化的格式。如果有表格，請嘗試保留其結構，但必須用純文本方式表示，不要使用JSON或其他程式碼格式。請確保所有輸出都是繁體中文。"
                        }
                    ]
                }
            ]
            
            # 將圖像編碼為base64
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            # 添加到消息中
            messages[1]["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{base64_image}",
                    "detail": "high"
                }
            })
            
            # 準備請求
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            
            # 發送請求到OpenAI API
            print(f"正在發送第 {page_num} 頁到OpenAI API...")
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                max_tokens=3000
            )
            
            # 獲取結果
            text_content = response.choices[0].message.content
            
            # 計算使用的tokens
            total_tokens = response.usage.total_tokens
            print(f"第 {page_num} 頁處理完成！使用了 {total_tokens} tokens")
            
            # 創建Document對象
            doc = Document(
                page_content=f"---\n### 第{page_num}頁\n\n{text_content}",
                metadata={
                    "source": pdf_path,
                    "filename": os.path.basename(pdf_path),
                    "extraction_method": "gpt4o-vision",
                    "page_number": page_num
                }
            )
            
            results.append(doc)
    
    # 批次處理模式
    else:
        print(f"使用批次處理模式，批次大小: {batch_size} 頁")
        
        # 將頁面分成批次
        for batch_start in range(0, len(images), batch_size):
            batch_end = min(batch_start + batch_size, len(images))
            batch_images = images[batch_start:batch_end]
            
            print(f"處理批次: 第 {batch_start + 1} 頁到第 {batch_end} 頁...")
            
            # 準備消息內容
            messages = [
                {
                    "role": "system",
                    "content": "您是一個專業的PDF文件分析助手。請分析以下PDF頁面的內容，提取所有可見文字，表格和重要資訊。請始終以繁體中文純文本格式輸出，不要使用JSON或其他標記語言格式。對於表格內容，請使用簡單的文本表示法，如「-」或「•」作為項目符號。"
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"這是一個PDF文件的第 {batch_start + 1} 頁到第 {batch_end} 頁。請幫我提取這些頁面所有可見的文字內容，並且組織成結構化的格式。如果有表格，請嘗試保留其結構，但必須用純文本方式表示，不要使用JSON或其他程式碼格式。請確保所有輸出都是繁體中文。"
                        }
                    ]
                }
            ]
            
            # 添加每一頁的圖像
            for i, image in enumerate(batch_images):
                # 將圖像編碼為base64
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
                
                # 添加到消息中
                messages[1]["content"].append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{base64_image}",
                        "detail": "high"
                    }
                })
                
                # 加入分隔文字（如果不是最後一頁）
                if i < len(batch_images) - 1:
                    messages[1]["content"].append({
                        "type": "text",
                        "text": f"==== 第 {batch_start + i + 1} 頁結束，第 {batch_start + i + 2} 頁開始 ===="
                    })
            
            # 準備請求
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            
            # 發送請求到OpenAI API
            print(f"正在發送批次到OpenAI API...")
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                max_tokens=4000
            )
            
            # 獲取結果
            text_content = response.choices[0].message.content
            
            # 計算使用的tokens
            total_tokens = response.usage.total_tokens
            print(f"批次處理完成！使用了 {total_tokens} tokens")
            
            # 創建Document對象
            doc = Document(
                page_content=f"---\n### 第{batch_start + 1}頁至第{batch_end}頁\n\n{text_content}",
                metadata={
                    "source": pdf_path,
                    "filename": os.path.basename(pdf_path),
                    "extraction_method": "gpt4o-vision-batch",
                    "page_range": f"{batch_start + 1}-{batch_end}",
                    "batch_size": batch_size
                }
            )
            
            results.append(doc)
    
    return results