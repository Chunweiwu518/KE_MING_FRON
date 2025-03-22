import os
import re
import json
from typing import Any, Dict, List, Optional

# ======== 添加 langchain debug 與 verbose 補丁 ========
# 這是一個修復方案，解決"module 'langchain' has no attribute 'debug'"和'verbose'錯誤
import sys
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

# 如果 langchain 模組中沒有 verbose 屬性，添加默認值
if not hasattr(langchain_module, 'verbose'):
    # 添加 verbose 屬性並設為 False
    setattr(langchain_module, 'verbose', False)
    print("全局：已添加模擬的 langchain.verbose 屬性以避免錯誤")
# ======== 補丁結束 ========

from app.utils.vector_store import get_vector_store
from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.documents import Document
from openai import OpenAI


class RAGEngine:
    def __init__(self):
        self.vector_store = get_vector_store()
        self.llm = ChatOpenAI(
            model_name=os.getenv("CHAT_MODEL_NAME", "gpt-4o-mini"),
            temperature=0.7,
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            # 移除 verbose 參數，避免序列化問題
        )
        self.qa_prompt = PromptTemplate(
            template="""你是一個有幫助的AI助手。使用以下上下文來回答問題。
            
            上下文: {context}
            
            問題: {question}
            
            如果你找不到答案，請直接說不知道，不要試圖捏造答案。回答時，只需要基於上下文提供有用的回應，不需要添加額外的解釋。
            """,
            input_variables=["context", "question"],
        )
        
        # 新增產品相關問題的專用提示
        self.product_qa_prompt = PromptTemplate(
            template="""你是一個產品信息專家。請使用以下上下文回答關於產品的問題。
            
            上下文: {context}
            
            問題: {question}
            
            請盡可能詳細地回答產品相關問題，包括產品名稱、描述、價格、類別和規格等信息。
            如果找不到特定信息，請明確指出哪些信息是可用的，哪些信息不可用。
            """,
            input_variables=["context", "question"],
        )

    def setup_retrieval_qa(self, is_product_query=False):
        """
        注意：此方法已棄用，因為在新版的langchain中可能存在兼容性問題。
        請使用process_query方法代替。
        """
        # 向控制台輸出警告
        print("警告: setup_retrieval_qa方法已棄用，請使用process_query")
        
        # 返回None表示此方法不再有效
        return None

    async def query(
        self, question: str, history: List[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        注意：此方法已棄用，因為在新版的langchain中可能存在兼容性問題。
        請使用process_query方法代替。
        """
        # 向控制台輸出警告
        print("警告: query方法已棄用，請使用process_query")
        
        # 直接調用process_query處理查詢
        return self.process_query(question, history)
    
    def is_product_query(self, query: str) -> bool:
        """判斷是否是產品相關查詢"""
        # 檢查是否包含產品ID模式 (如HK-2189, TL-4523等)
        product_id_pattern = r'[A-Z]{2}-\d{4}'
        if re.search(product_id_pattern, query):
            return True
            
        # 檢查是否包含產品相關關鍵詞
        product_keywords = ["產品", "商品", "規格", "價格", "類別", "工作燈", "頭燈"]
        for keyword in product_keywords:
            if keyword in query:
                return True
                
        return False
        
    def get_product_by_id(self, product_id: str):
        """根據產品ID直接檢索相關文檔"""
        # 使用metadata過濾方式優先查詢
        try:
            # 嘗試使用metadata過濾
            docs = self.vector_store.get(
                where={"product_id": product_id}
            )
            if docs and len(docs) > 0:
                # 確保返回的是Document對象
                if not all(hasattr(doc, 'page_content') for doc in docs):
                    # 如果不是Document對象，轉換它們
                    docs = [
                        Document(page_content=doc if isinstance(doc, str) else str(doc),
                                 metadata={"source": "product_data", "product_id": product_id})
                        for doc in docs
                    ]
                return docs
        except Exception as e:
            print(f"使用metadata過濾查詢產品ID時出錯: {str(e)}")
        
        # 如果metadata過濾失敗，使用文本搜索
        docs = self.vector_store.similarity_search(product_id, k=3)
        
        # 確保返回的是Document對象
        if not all(hasattr(doc, 'page_content') for doc in docs):
            # 如果不是Document對象，轉換它們
            docs = [
                Document(page_content=doc if isinstance(doc, str) else str(doc),
                         metadata={"source": "similarity_search", "product_id": product_id})
                for doc in docs
            ]
        
        return docs

    def generate_product_prompt(self, context, query):
        """生成針對產品查詢的提示模板"""
        prompt = f"""
        以下是產品目錄中的資訊：
        {context}
        
        用戶問題: {query}
        
        你是一個專業的產品顧問。根據以上產品目錄資訊，請回應用戶的問題。
        
        如果用戶詢問產品列表或種類，請遵循以下指南：
        1. 將產品按主要類別分組（如工作燈、手電筒、充電器等）
        2. 提供每個類別下大約有多少種產品
        3. 每個類別僅列出2-3個代表性產品作為例子
        4. 告知用戶可以詢問特定類別獲取更多詳情
        
        如果用戶詢問特定產品型號，請提供完整詳細資訊。
        
        保持回答簡潔有用，字數控制在150字以內。避免使用"根據提供的資訊"等引導語。
        """
        return prompt

    def process_query(self, query, history=None):
        try:
            # 確保向量存儲已初始化
            if not self.vector_store:
                print("重新初始化向量存儲...")
                self.vector_store = get_vector_store()
                if not self.vector_store:
                    return {
                        "answer": "我沒有找到任何相關信息，可能是因為尚未上傳任何文件。",
                        "sources": [],
                    }

            # 使用向量搜索找出相關內容
            sources = []
            context = ""
            try:
                # 嘗試使用 similarity_search_with_score
                results = self.vector_store.similarity_search_with_score(
                    query,
                    k=5  # 增加檢索數量以獲取更多上下文
                )
                
                # 整理搜索結果
                for doc, score in results:
                    # 從內容中提取頁碼信息
                    page_info = ""
                    if "(第" in doc.page_content:
                        # 從內容中提取頁碼
                        page_matches = re.findall(r'第(\d+)頁', doc.page_content)
                        if page_matches:
                            page_info = f"(第 {page_matches[0]} 頁)"
                    
                    source = {
                        "content": doc.page_content,
                        "metadata": doc.metadata,
                        "score": score,
                        "page_info": page_info
                    }
                    sources.append(source)
                    context += doc.page_content + "\n\n"
            except Exception as search_error:
                # 如果 similarity_search_with_score 失敗，嘗試使用 similarity_search
                print(f"similarity_search_with_score 失敗，嘗試使用替代方法: {str(search_error)}")
                try:
                    # 使用不帶得分的搜索方法
                    docs = self.vector_store.similarity_search(
                        query,
                        k=5
                    )
                    
                    # 整理搜索結果
                    for doc in docs:
                        # 從內容中提取頁碼信息
                        page_info = ""
                        if "(第" in doc.page_content:
                            # 從內容中提取頁碼
                            page_matches = re.findall(r'第(\d+)頁', doc.page_content)
                            if page_matches:
                                page_info = f"(第 {page_matches[0]} 頁)"
                        
                        source = {
                            "content": doc.page_content,
                            "metadata": doc.metadata,
                            "score": 0.0,  # 由於沒有得分，設為默認值
                            "page_info": page_info
                        }
                        sources.append(source)
                        context += doc.page_content + "\n\n"
                except Exception as e:
                    print(f"所有搜索方法均失敗: {str(e)}")
                    return {
                        "answer": "抱歉，在搜索相關資訊時遇到技術問題。",
                        "sources": []
                    }

            # 如果找到相關內容，使用 GPT 生成回答
            if sources:
                # 生成產品查詢專用提示
                prompt = self.generate_product_prompt(context, query)
                
                # 使用 ChatModel 
                response = self.llm.invoke(prompt)
                
                # 從 AIMessage 對象中提取純文本內容
                answer = response.content if hasattr(response, 'content') else str(response)
                
                return {
                    "answer": answer,
                    "sources": sources
                }
            else:
                return {
                    "answer": "抱歉，我找不到相關資訊。",
                    "sources": []
                }
            
        except Exception as e:
            print(f"處理查詢時出錯: {str(e)}")
            traceback_str = __import__('traceback').format_exc()
            print(f"詳細錯誤信息: {traceback_str}")
            return {
                "answer": "處理查詢時發生錯誤。",
                "sources": []
            }

    def is_product_list_query(self, query):
        """判斷是否是產品列表查詢"""
        product_list_keywords = [
            "有哪些產品", "產品列表", "所有產品", 
            "產品種類", "產品型號", "提供什麼產品",
            "銷售什麼", "賣什麼", "產品目錄"
        ]
        
        for keyword in product_list_keywords:
            if keyword in query:
                return True
        
        return False

    def generate_response(self, query, docs, is_product_query=False):
        """根據查詢和文檔生成回答與來源"""
        try:
            # 如果沒有找到相關文檔
            if not docs or len(docs) == 0:
                return (
                    "我沒有找到與您問題相關的信息。請嘗試上傳更多相關文檔或重新表述您的問題。",
                    [],
                )

            # 準備上下文
            context_parts = []
            for doc in docs:
                # 檢查 doc 是否為 Document 對象或字符串
                if hasattr(doc, 'page_content'):
                    # 是 Document 對象
                    context_parts.append(doc.page_content)
                elif isinstance(doc, str):
                    # 是字符串
                    context_parts.append(doc)
                else:
                    # 其他類型
                    context_parts.append(str(doc))
            
            context = "\n\n".join(context_parts)

            # 使用直接方式生成回答，避免使用可能不兼容的鏈式調用
            if is_product_query:
                # 使用 generate_product_response 方法處理產品查詢
                answer = self.generate_product_response(context, query)
            else:
                # 使用一般提示模板
                prompt = self.qa_prompt.format(context=context, question=query)
                response = self.llm.invoke(prompt)
                answer = response.content if hasattr(response, 'content') else str(response)

            # 處理來源
            sources = []
            for doc in docs:
                if hasattr(doc, 'metadata'):
                    source_info = {
                        "content": doc.page_content,
                        "source": doc.metadata.get("source", ""),
                        "images": {}
                    }
                    
                    # 解析圖片信息
                    images_str = doc.metadata.get("images", "{}")
                    try:
                        images_dict = json.loads(images_str)
                        for key, value in images_dict.items():
                            path, page = value.split("|")
                            source_info["images"][key] = {
                                "path": path,
                                "page": int(page)
                            }
                    except json.JSONDecodeError:
                        print(f"解析圖片信息時出錯: {images_str}")
                    
                    sources.append(source_info)
            
            return answer, sources

        except Exception as e:
            print(f"生成回答時出錯: {str(e)}")
            traceback_str = __import__('traceback').format_exc()
            print(f"詳細錯誤信息: {traceback_str}")
            return (
                "處理您的問題時發生了技術問題，請稍後再試。",
                []
            )

    def generate_product_response(self, context, query):
        """生成產品摘要或推薦的回應"""
        
        gpt_params = {
            'model': os.getenv("CHAT_MODEL_NAME", "gpt-4o-mini"),
            'temperature': 0.6,
            'top_p': 0.7,
            'frequency_penalty': 0.3,
        }
        
        prompt = f"""
        以下是產品目錄中的資訊：
        {context}
        
        用戶問題: {query}
        """
        
        messages = [
            {
                "role": "system",
                "content": """你是專業的產品顧問。請遵循以下規則：
                1. 如果用戶詢問產品列表，按類別分組概述產品，每類僅舉2-3例
                2. 提供每類產品的大致數量
                3. 保持回答簡潔，避免冗長列表
                4. 告知用戶可以詢問特定類別獲取更多詳情
                5. 如果用戶詢問特定產品型號，則提供詳細資訊""",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ]
        
        gpt_params.update({'messages': messages})
        
        # 調用 OpenAI
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(**gpt_params)
        
        return response.choices[0].message.content
