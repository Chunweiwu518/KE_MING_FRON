import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

// 定義擴展的 Input 屬性類型
interface ExtendedInputHTMLAttributes extends React.InputHTMLAttributes<HTMLInputElement> {
  webkitdirectory?: string;
  directory?: string;
}

// 文本格式化函數
const formatText = (text: string): string => {
  // 替換產品規格的格式
  let formattedText = text
    // 保留換行符
    .replace(/\n/g, '<br/>')
    // 替換標準的分隔符為HTML換行和列表項
    .replace(/-\s?\*\*([^*]+)\*\*:\s?/g, '<li><strong>$1</strong>: ')
    .replace(/\*\*([^*]+)\*\*:/g, '<strong>$1</strong>:')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 處理冒號後面的內容
    .replace(/(\d+)x(\d+)/g, '$1×$2')
    // 確保適當的列表包裹
    .replace(/<li>/g, '<li class="mb-2 list-disc ml-4">')
    // 讓產品標題更明顯
    .replace(/(HK-\d+的產品資料如下：)/g, '<div class="text-lg font-medium my-2">$1</div>')

  // 檢查是否有列表項，如果有則添加ul標籤
  if (formattedText.includes('<li>')) {
    formattedText = formattedText.replace(/<li>(.+?)(?=<li>|$)/g, '<ul><li>$1</ul>')
    // 修復嵌套的ul標籤
    formattedText = formattedText.replace(/<\/ul><ul>/g, '')
  }

  return formattedText
}

// 添加用於格式化來源內容的函數
const formatSourceContent = (content: string): string => {
  if (!content) return '';
  
  try {
    // 移除 [SOURCES] 和 [/SOURCES] 標記
    let cleanedContent = content;
    if (content.includes('[SOURCES]') && content.includes('[/SOURCES]')) {
      cleanedContent = content
        .replace('[SOURCES]', '')
        .replace('[/SOURCES]', '')
        .trim();
    }

    // 檢查是否為JSON字符串並嘗試解析
    try {
      const parsed = JSON.parse(cleanedContent);
      if (Array.isArray(parsed)) {
        // 如果是數組，取第一個元素的內容
        return parsed[0]?.content || '';
      } else if (parsed.content) {
        // 如果是對象且有content屬性
        return parsed.content;
      }
    } catch (e) {
      // JSON 解析失敗，繼續處理
    }
    
    // 嘗試解碼Unicode轉義序列
    const decodedContent = cleanedContent.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => 
      String.fromCharCode(parseInt(hex, 16))
    );
    
    // 如果內容以引號開始和結束，去除引號
    let finalContent = decodedContent;
    if ((finalContent.startsWith('"') && finalContent.endsWith('"')) || 
        (finalContent.startsWith("'") && finalContent.endsWith("'"))) {
      finalContent = finalContent.substring(1, finalContent.length - 1);
    }
    
    // 移除雙反斜槓和特殊格式
    finalContent = finalContent
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\t/g, '\t');
    
    return finalContent;
  } catch (error) {
    console.error('格式化來源內容時出錯:', error);
    return content; // 發生錯誤時返回原始內容
  }
}

// 根據文本內容返回適當的CSS類
const getMessageStyle = (content: string, role: 'user' | 'assistant'): string => {
  if (role === 'user') {
    return 'bg-purple-600 text-white'
  }
  
  // 如果是產品資訊，增加更好的排版樣式
  if (content.includes('產品資料如下') || content.includes('商品名稱')) {
    return 'bg-gray-100 text-gray-800 product-info'
  }
  
  return 'bg-gray-100 text-gray-800'
}

interface FileInfo {
  name: string;
  display_name?: string;
  size?: number;
  lastModified?: number;
  uploadTime?: string;
  webkitRelativePath?: string;
  type?: string;
  status?: 'uploading' | 'success' | 'error' | string;
  errorMessage?: string;
  progress?: number;
}

interface Source {
  content: string
  metadata: {
    source: string
    page?: number
  }
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

interface ChatHistory {
  id: string
  title: string
  messages: Message[]
  createdAt: string
}

const API_URL = import.meta.env.VITE_API_URL

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<FileInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [vectorStoreStats, setVectorStoreStats] = useState({
    total_chunks: 0,
    unique_files: 0,
    files: [],
    is_empty: true
  })
  // 未使用的狀態變數 - 暫時註釋
  // const [showAddChat, setShowAddChat] = useState(false)
  // const [newChatName, setNewChatName] = useState("")
  const [uploading, setUploading] = useState(false)
  const [totalUploadProgress, setTotalUploadProgress] = useState(0)
  const [showUploadSuccess, setShowUploadSuccess] = useState<boolean>(false)

  // 載入歷史對話
  useEffect(() => {
    fetchChatHistories()
    // 添加獲取已上傳檔案的調用
    fetchUploadedFiles()
  }, [])

  // 滾動到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 獲取已上傳的檔案列表
  const fetchUploadedFiles = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/files`)
      setFiles(response.data)
      console.log('已獲取上傳檔案列表:', response.data.length)
    } catch (error) {
      console.error('獲取上傳檔案列表失敗:', error)
    }
  }

  const fetchChatHistories = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/history`)
      // 按創建時間排序，最新的在前面
      const sortedHistories = response.data.sort((a: ChatHistory, b: ChatHistory) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setChatHistories(sortedHistories)
    } catch (error) {
      console.error('Failed to fetch chat histories:', error)
    }
  }

  const loadChatHistory = async (chatId: string) => {
    try {
      setIsLoading(true)
      const response = await axios.get(`${API_URL}/api/history/${chatId}`)
      setMessages(response.data.messages)
      setCurrentChatId(chatId)
    } catch (error) {
      console.error('Failed to load chat history:', error)
      setError('載入對話歷史失敗')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    // 保存當前的輸入內容，因為之後會清空輸入框
    const currentInput = input.trim()
    
    // 防止提交時重複處理
    setInput('')
    setIsLoading(true)
    setError(null)

    // 創建用戶消息
    const newMessage: Message = {
      role: 'user',
      content: currentInput
    }

    // 創建一個初始的助手消息
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      sources: []
    }

    // 檢查是否需要創建新對話
    const isNewChat = !currentChatId

    // 將用戶消息和初始的空助手消息加入到聊天記錄
    setMessages(prev => [...prev, newMessage, assistantMessage])

    try {
      // 使用 fetch API 發起 POST 請求
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: currentInput,
          history: messages
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 表示我們處理過這個對話的請求，避免重複保存
      let conversationProcessed = false;

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('無法獲取響應流')
      }

      // 創建一個暫存的助手回應和來源
      let tempResponse = ''
      let sources: Source[] = []
      
      // 創建文本解碼器
      const decoder = new TextDecoder()

      // 處理流式數據
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        // 將二進制數據解碼為文本
        const text = decoder.decode(value, { stream: true })
        
        // 處理SSE格式的數據行
        const lines = text.split('\n\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          
          const data = line.substring(6) // 去掉 "data: " 前綴
          
          // 檢測特殊標記
          if (data.startsWith('[SOURCES]') && data.endsWith('[/SOURCES]')) {
            // 解析來源數據
            const sourcesData = data.replace('[SOURCES]', '').replace('[/SOURCES]', '')
            try {
              sources = JSON.parse(sourcesData)
            } catch (e) {
              console.error('解析來源數據失敗:', e)
            }
          } 
          // 檢測錯誤信息
          else if (data.startsWith('[ERROR]') && data.endsWith('[/ERROR]')) {
            const errorMsg = data.replace('[ERROR]', '').replace('[/ERROR]', '')
            setError(`聊天請求失敗: ${errorMsg}`)
            break
          }
          // 檢測結束標記
          else if (data === '[DONE]') {
            // 更新最終的助手消息，包括來源
            setMessages(prev => {
              const updatedMessages = [...prev]
              // 尋找並更新最新的助手消息
              for (let i = updatedMessages.length - 1; i >= 0; i--) {
                if (updatedMessages[i].role === 'assistant') {
                  updatedMessages[i] = {
                    ...updatedMessages[i],
                    content: tempResponse,
                    sources: sources
                  }
                  break
                }
              }
              
              // 只有在這是新對話且尚未處理過時，才保存歷史
              if (isNewChat && !conversationProcessed && updatedMessages.length >= 2) {
                // 標記為已處理
                conversationProcessed = true;
                console.log('流處理完成，準備保存對話歷史');
                
                // 使用setTimeout確保當前狀態更新完畢後再保存歷史
                setTimeout(() => {
                  // 再次檢查沒有currentChatId才創建新對話
                  if (!currentChatId) {
                    saveOrUpdateChatHistory(
                      updatedMessages, 
                      currentInput.slice(0, 20) + "..."
                    );
                  }
                }, 100);
              }
              
              return updatedMessages
            })
            break
          } 
          // 一般情況：處理正常的字符
          else {
            tempResponse += data
            // 更新助手消息的內容
            setMessages(prev => {
              const updatedMessages = [...prev]
              // 尋找並更新最新的助手消息
              for (let i = updatedMessages.length - 1; i >= 0; i--) {
                if (updatedMessages[i].role === 'assistant') {
                  updatedMessages[i] = {
                    ...updatedMessages[i],
                    content: tempResponse
                  }
                  break
                }
              }
              return updatedMessages
            })

            // 增加一個小延遲再滾動，確保DOM已更新
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            }, 10);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      if (axios.isAxiosError(error)) {
        setError(`聊天請求失敗: ${error.response?.data?.detail || error.message}`)
      } else {
        setError('發送訊息時發生未知錯誤')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsLoading(true);
    setUploading(true);
    setTotalUploadProgress(0);
    let uploadSuccess = false;
    
    // 清除之前的錯誤
    setError(null);
    
    // 處理每個選擇的文件
    const selectedFiles = Array.from(e.target.files);
    
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      // 更新總體進度指示器 - 顯示當前處理的檔案索引
      setTotalUploadProgress(Math.round(((i) / selectedFiles.length) * 100));
      
      // 生成臨時ID以便追蹤上傳狀態
      const tempFileId = Math.random().toString(36).substring(2, 10);
      
      // 添加到文件列表(帶上傳狀態)
      setFiles(prev => [...prev, {
        name: tempFileId,
        display_name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 0 // 初始進度為0
      }]);
      
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        // 添加處理選項
        formData.append('use_openai_ocr', 'true');  // 是否使用OpenAI Vision
        formData.append('page_by_page', 'true');    // 逐頁處理
        formData.append('batch_size', '10');        // 批次大小
        
        // 顯示上傳進度
        console.log(`開始上傳文件: ${file.name} (${i+1}/${selectedFiles.length})`);
        
        // 使用 axios 進度追蹤功能
        const response = await axios.post(`${API_URL}/api/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const filePercentCompleted = progressEvent.total 
              ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
              : 0;
              
            // 更新檔案進度
            setFiles(prev => prev.map(f => {
              if (f.name === tempFileId) {
                return {
                  ...f,
                  progress: filePercentCompleted
                };
              }
              return f;
            }));
            
            // 更新全局進度 - 結合當前檔案進度和整體進度
            const overallProgress = Math.round(
              ((i + (progressEvent.loaded / (progressEvent.total || 1))) / selectedFiles.length) * 100
            );
            setTotalUploadProgress(overallProgress);
          }
        });
        
        // 更新上傳成功的狀態
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            const processedFile = {
              ...f,
              status: 'success',
              progress: 100
            };
            // 延遲移除上傳狀態標記
            setTimeout(() => {
              setFiles(curr => curr.map(cf => {
                if (cf.name === tempFileId) {
                  const { status, progress, ...rest } = cf;
                  return rest;
                }
                return cf;
              }));
            }, 2000);
            return processedFile;
          }
          return f;
        }));
        
        uploadSuccess = true;
        console.log(`文件 ${file.name} 上傳成功:`, response.data);
        
        // 每個文件上傳成功後立即刷新知識庫統計
        await loadVectorStoreStats();
      } catch (error) {
        console.error(`文件 ${file.name} 上傳失敗:`, error);
        
        // 更新文件狀態為錯誤
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            return {
              ...f,
              status: 'error',
              progress: 0,
              errorMessage: '上傳失敗'
            };
          }
          return f;
        }));
        
        setError(`文件 ${file.name} 上傳失敗`);
      }
    }
    
    // 最後設置總體進度為100%
    setTotalUploadProgress(100);
    
    // 如果至少有一個文件上傳成功，則重新獲取文件列表
    if (uploadSuccess) {
      await fetchUploadedFiles();
      
      // 顯示上傳成功提示
      setShowUploadSuccess(true);
      setTimeout(() => {
        setShowUploadSuccess(false);
      }, 3000);
    }
    
    // 稍微延遲關閉上傳狀態，讓用戶可以看到100%的進度
    setTimeout(() => {
      setIsLoading(false);
      setUploading(false);
    }, 500);
    
    // 如果沒有錯誤提示，清除錯誤狀態
    if (!files.some(f => f.status === 'error')) {
      setError(null);
    }
  }

  // 新增：刪除對話歷史
  const deleteHistory = async (chatId: string) => {
    try {
      await axios.delete(`${API_URL}/api/history/${chatId}`)
      await fetchChatHistories()
      if (currentChatId === chatId) {
        setMessages([])
        setCurrentChatId(null)
      }
    } catch (error) {
      console.error('Delete history error:', error)
      setError('刪除對話歷史失敗')
    }
  }

  // 修改 clearVectorStore 函數確保能徹底清空
  const clearVectorStore = async () => {
    if (!confirm('確定要清空知識庫嗎？此操作將刪除所有已學習的知識，且無法恢復。')) {
      return
    }
    
    setIsLoading(true)
    setError('正在清空知識庫...')
    
    try {
      await axios.delete(`${API_URL}/api/vector-store/clear`)
      // 清空後重新獲取檔案列表
      await fetchUploadedFiles()
      setError(null)
      await loadVectorStoreStats()
    } catch (error) {
      console.error('Clear vector store error:', error)
      if (axios.isAxiosError(error)) {
        setError(`清空知識庫失敗: ${error.response?.data?.detail || error.message}`)
      } else {
        setError('清空知識庫時發生未知錯誤')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // 處理資料夾上傳
  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = e.target.files
    if (!uploadFiles || uploadFiles.length === 0) return

    setIsLoading(true)
    setUploading(true)
    setTotalUploadProgress(0)
    setError('正在處理資料夾中的文件...')

    let uploadedCount = 0
    let failedCount = 0
    let uploadSuccess = false
    
    // 過濾支持的檔案類型
    const supportedFiles = Array.from(uploadFiles).filter(file => {
      const fileExt = file.name.toLowerCase().split('.').pop()
      return ['txt', 'pdf', 'docx'].includes(fileExt || '')
    })
    
    if (supportedFiles.length === 0) {
      setError('沒有找到支持的文件類型 (PDF, TXT, DOCX)')
      setIsLoading(false)
      setUploading(false)
      return
    }

    // 處理所有文件
    for (let i = 0; i < supportedFiles.length; i++) {
      const file = supportedFiles[i]
      
      // 更新總體進度指示器
      setTotalUploadProgress(Math.round(((i) / supportedFiles.length) * 100));
      
      // 添加一個臨時文件項，狀態為上傳中
      const tempFileId = `folder_${Date.now()}_${i}`; // 創建一個臨時ID
      const tempFile: FileInfo = { 
        name: tempFileId,
        display_name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 0
      };
      
      setFiles(prev => [...prev, tempFile]);
      
      try {
        const individualFormData = new FormData()
        individualFormData.append('file', file)
        
        console.log(`開始上傳資料夾文件: ${file.name} (${i+1}/${supportedFiles.length})`)
        
        // 使用 axios 進度追蹤功能
        await axios.post(`${API_URL}/api/upload`, individualFormData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const filePercentCompleted = progressEvent.total 
              ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
              : 0;
              
            // 更新檔案進度
            setFiles(prev => prev.map(f => {
              if (f.name === tempFileId) {
                return {
                  ...f,
                  progress: filePercentCompleted
                };
              }
              return f;
            }));
            
            // 更新全局進度 - 結合當前檔案進度和整體進度
            const overallProgress = Math.round(
              ((i + (progressEvent.loaded / (progressEvent.total || 1))) / supportedFiles.length) * 100
            );
            setTotalUploadProgress(overallProgress);
          }
        })
        
        // 更新為成功狀態
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            const successFile = {
              ...f,
              status: 'success',
              progress: 100
            };
            
            // 延遲移除狀態標記
            setTimeout(() => {
              setFiles(curr => curr.map(cf => {
                if (cf.name === tempFileId) {
                  const { status, progress, ...rest } = cf;
                  return rest;
                }
                return cf;
              }));
            }, 2000);
            
            return successFile;
          }
          return f;
        }));
        
        uploadedCount++
        uploadSuccess = true
      } catch (error) {
        console.error(`上傳文件失敗: ${file.name}`, error)
        
        // 更新文件狀態為錯誤
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            return {
              ...f,
              status: 'error',
              progress: 0,
              errorMessage: '上傳失敗'
            };
          }
          return f;
        }));
        
        failedCount++
      }
    }
    
    // 設置最終進度為100%
    setTotalUploadProgress(100)

    // 如果至少有一個文件上傳成功，則重新獲取文件列表
    if (uploadSuccess) {
      await fetchUploadedFiles()
      
      // 顯示上傳成功提示
      setShowUploadSuccess(true);
      setTimeout(() => {
        setShowUploadSuccess(false);
      }, 3000);
    }
    
    // 稍微延遲關閉上傳狀態，讓用戶可以看到100%的進度
    setTimeout(() => {
      setIsLoading(false)
      setUploading(false)
    }, 500)
    
    if (failedCount > 0) {
      setError(`${uploadedCount} 個文件上傳成功，${failedCount} 個文件失敗`)
    } else if (uploadedCount === 0) {
      setError('沒有找到支持的文件類型 (PDF, TXT, DOCX)')
    } else {
      setError(null)
    }
    
    // 重置 input 控件，允許再次選擇相同文件
    if (folderInputRef.current) {
      folderInputRef.current.value = ''
    }
  }

  // 添加側邊欄收合切換函數
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  // 添加拖拽處理函數
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length === 0) return
    
    setIsLoading(true)
    setUploading(true)
    setTotalUploadProgress(0)
    setError('正在處理文件...')
    let uploadSuccess = false
    
    // 過濾支持的檔案類型
    const supportedFiles = Array.from(droppedFiles).filter(file => {
      const fileExt = file.name.toLowerCase().split('.').pop()
      return ['txt', 'pdf', 'docx'].includes(fileExt || '')
    })
    
    if (supportedFiles.length === 0) {
      setError('沒有找到支持的文件類型 (PDF, TXT, DOCX)')
      setIsLoading(false)
      setUploading(false)
      return
    }
    
    for(let i = 0; i < supportedFiles.length; i++) {
      const file = supportedFiles[i]
      
      // 更新總體進度指示器
      setTotalUploadProgress(Math.round(((i) / supportedFiles.length) * 100));
      
      // 檢查檔案類型已在上面的過濾中完成
      console.log(`開始處理拖放文件: ${file.name} (${i+1}/${supportedFiles.length})`)
      
      // 添加一個臨時文件項，狀態為上傳中
      const tempFileId = `drop_${Date.now()}_${i}`; // 創建一個臨時ID
      const tempFile: FileInfo = { 
        name: tempFileId,
        display_name: file.name,
        size: file.size,
        status: 'uploading',
        progress: 0
      };
      
      setFiles(prev => [...prev, tempFile]);
      
      const dropFormData = new FormData()
      dropFormData.append('file', file)
      
      try {
        await axios.post(`${API_URL}/api/upload`, dropFormData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const filePercentCompleted = progressEvent.total 
              ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
              : 0;
              
            // 更新檔案進度
            setFiles(prev => prev.map(f => {
              if (f.name === tempFileId) {
                return {
                  ...f,
                  progress: filePercentCompleted
                };
              }
              return f;
            }));
            
            // 更新全局進度 - 結合當前檔案進度和整體進度
            const overallProgress = Math.round(
              ((i + (progressEvent.loaded / (progressEvent.total || 1))) / supportedFiles.length) * 100
            );
            setTotalUploadProgress(overallProgress);
          }
        })
        
        // 更新為成功狀態
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            const successFile = {
              ...f,
              status: 'success',
              progress: 100
            };
            
            // 延遲移除狀態標記
            setTimeout(() => {
              setFiles(curr => curr.map(cf => {
                if (cf.name === tempFileId) {
                  const { status, progress, ...rest } = cf;
                  return rest;
                }
                return cf;
              }));
            }, 2000);
            
            return successFile;
          }
          return f;
        }));
        
        uploadSuccess = true
      } catch (error) {
        console.error('文件上傳失敗:', error)
        
        // 更新文件狀態為錯誤
        setFiles(prev => prev.map(f => {
          if (f.name === tempFileId) {
            return {
              ...f,
              status: 'error',
              progress: 0,
              errorMessage: '上傳失敗'
            };
          }
          return f;
        }));
        
        setError(`文件 ${file.name} 上傳失敗`)
      }
    }
    
    // 設置最終進度為100%
    setTotalUploadProgress(100)
    
    // 如果至少有一個文件上傳成功，則重新獲取文件列表
    if (uploadSuccess) {
      await fetchUploadedFiles()
      
      // 顯示上傳成功提示
      setShowUploadSuccess(true);
      setTimeout(() => {
        setShowUploadSuccess(false);
      }, 3000);
    }
    
    // 稍微延遲關閉上傳狀態，讓用戶可以看到100%的進度
    setTimeout(() => {
      setIsLoading(false)
      setUploading(false)
    }, 500)
    
    // 如果沒有錯誤提示，清除錯誤狀態
    if (!files.some(f => f.status === 'error')) {
      setError(null)
    }
  }

  // 添加加載統計信息的函數
  const loadVectorStoreStats = async () => {
    try {
      console.log('正在獲取知識庫統計信息...');
      const response = await axios.get(`${API_URL}/api/vector-store/stats`);
      console.log('獲取到知識庫統計信息:', response.data);
      setVectorStoreStats(response.data);
    } catch (error) {
      console.error('獲取知識庫統計失敗:', error);
    }
  }

  // 在適當的時機加載統計信息
  useEffect(() => {
    loadVectorStoreStats();
    
    // 每30秒自動更新一次知識庫統計
    const intervalId = setInterval(() => {
      loadVectorStoreStats();
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, [files]); // 當文件列表變化時重新加載

  // 新增/更新對話歷史
  const saveOrUpdateChatHistory = async (messages: Message[], title?: string) => {
    try {
      // 如果當前已經有對話ID，且非新對話，則跳過保存
      if (currentChatId) {
        console.log('已有對話ID，跳過創建新歷史:', currentChatId);
        return null;
      } else {
        console.log('創建新對話歷史');
        return await createNewChatHistory(messages, title);
      }
    } catch (error) {
      console.error('保存對話歷史失敗:', error);
      return null;
    }
  };

  // 創建新的對話歷史
  const createNewChatHistory = async (messages: Message[], title?: string) => {
    try {
      console.log('開始創建新對話歷史, 訊息數量:', messages.length);
      const historyResponse = await axios.post(`${API_URL}/api/history`, {
        messages: messages,
        title: title
      });
      console.log('對話歷史創建成功, ID:', historyResponse.data.id);
      setCurrentChatId(historyResponse.data.id);
      await fetchChatHistories(); // 重新獲取對話列表
      return historyResponse.data;
    } catch (error) {
      console.error('創建對話歷史失敗:', error);
      return null;
    }
  };

  // 新對話按鈕
  const startNewChat = () => {
    console.log('開始新對話，重置狀態');
    setMessages([]);
    setCurrentChatId(null);
    setError(null);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* 上傳成功提示 */}
      {showUploadSuccess && (
        <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50 shadow-md flex items-center">
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>上傳成功！</span>
        </div>
      )}
      
      {/* 側邊欄 */}
      <div 
        className={`fixed inset-y-0 left-0 bg-gray-50 border-r border-gray-200 transition-all duration-300 z-10 ${
          sidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full'
        } overflow-hidden`}
      >
        <div className="flex flex-col h-full min-w-64">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-gray-800">RAG 聊天助手</h1>
              <button onClick={toggleSidebar} className="text-gray-500 hover:text-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 文件上傳區域 */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-sm font-medium mb-2 text-gray-700">上傳文件</h2>
            <div className="flex flex-col space-y-2">
              <label className="flex flex-col items-center justify-center px-4 py-2 text-sm text-blue-500 bg-white rounded-lg border border-blue-500 hover:bg-blue-50 cursor-pointer transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <span className="mt-1 text-sm">選擇檔案</span>
                <input type="file" className="hidden" accept=".txt,.pdf,.docx" multiple onChange={handleFileUpload} disabled={isLoading} />
              </label>
              
              <label className="flex flex-col items-center justify-center px-4 py-2 text-sm text-blue-500 bg-white rounded-lg border border-blue-500 hover:bg-blue-50 cursor-pointer transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="mt-1 text-sm">選擇資料夾</span>
                <input 
                  type="file" 
                  ref={folderInputRef}
                  webkitdirectory="true" 
                  directory="true"
                  multiple 
                  className="hidden" 
                  onChange={handleFolderUpload} 
                  disabled={isLoading} 
                  {...{} as ExtendedInputHTMLAttributes}
                />
              </label>
              
              <div className="mt-4">
                <button
                  onClick={clearVectorStore}
                  className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                >
                  清空知識庫
                </button>
              </div>
            </div>
          </div>

          {/* 對話歷史列表 */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-sm font-medium mb-2 text-gray-700">對話歷史</h2>
            <div className="space-y-1">
              {chatHistories.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center justify-between p-2 rounded hover:bg-gray-200 transition-colors ${
                    currentChatId === chat.id ? 'bg-gray-200' : ''
                  }`}
                >
                  <button
                    onClick={() => loadChatHistory(chat.id)}
                    className="flex-1 text-left"
                  >
                    <div className="truncate text-sm text-gray-800">{chat.title}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(chat.createdAt).toLocaleString()}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteHistory(chat.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 ml-2 p-1 text-gray-400 hover:text-red-400 transition-opacity"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 新對話按鈕 */}
          <div className="p-4 border-t border-gray-200">
            <button
              onClick={startNewChat}
              className="w-full py-2 px-4 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-medium transition-colors"
            >
              開始新對話
            </button>
          </div>

          {/* 知識庫狀態顯示 */}
          <div className="p-4 border-t border-gray-200">
            <h2 className="text-sm font-medium mb-2 text-gray-700">知識庫狀態</h2>
            <div className="text-xs text-gray-600">
              <p>文件數量: {vectorStoreStats.unique_files}</p>
              <p>文本塊數: {vectorStoreStats.total_chunks}</p>
              <p>狀態: {vectorStoreStats.is_empty ? '🔴 空' : '🟢 有資料'}</p>
              
              {/* 添加刷新按鈕 */}
              <button 
                onClick={loadVectorStoreStats}
                className="mt-2 text-xs text-blue-500 hover:text-blue-700 flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                刷新知識庫狀態
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* 主內容區 */}
      <div className={`flex flex-col w-full transition-all duration-300 ${sidebarOpen ? 'md:pl-64' : ''}`}>
        {/* 頂部導航欄 */}
        <div className="bg-white p-4 border-b border-gray-200">
          <div className="flex items-center">
            <button onClick={toggleSidebar} className="text-gray-700 focus:outline-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="ml-4 text-lg font-medium text-gray-800">RAG 知識庫問答</h1>
            
            {/* 全局上傳進度指示器 */}
            {uploading && (
              <div className="ml-auto flex items-center">
                <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden mr-2">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                    style={{ width: `${totalUploadProgress}%` }}
                  ></div>
                </div>
                <span className="text-sm text-gray-500">{totalUploadProgress}%</span>
              </div>
            )}
          </div>
        </div>
        
        {/* 錯誤提示 */}
        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* 聊天主體區 */}
        <div 
          className="flex-1 overflow-y-auto"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* 當沒有消息時顯示提示 */}
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center p-8 rounded-lg max-w-md">
                <div className="text-5xl mb-4">📄</div>
                <h2 className="text-xl font-semibold mb-2 text-gray-800">歡迎使用 RAG 聊天助手</h2>
                <p className="mb-4 text-gray-600">您可以提問關於您上傳文件的內容，或者將文件拖拽到此處上傳</p>
                <p className="text-sm text-gray-500">支持 PDF、Word、TXT 等格式</p>
              </div>
            </div>
          )}

          {/* 消息列表 */}
          <div className="max-w-3xl mx-auto p-4 space-y-6">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-md ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
                    message.role === 'user' ? 'bg-purple-600' : 'bg-gray-600'
                  }`}>
                    {message.role === 'user' ? '我' : 'AI'}
                  </div>
                  <div className={`mx-2 px-4 py-2 rounded-lg ${
                    message.role === 'user' 
                      ? 'bg-purple-600 text-white' 
                      : getMessageStyle(message.content, message.role)
                  }`}>
                    {message.role === 'assistant' ? (
                      <div 
                        className="text-sm formatted-message"
                        dangerouslySetInnerHTML={{ 
                          __html: formatText(message.content) 
                        }}
                      />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 消息來源 */}
            {(() => {
              // 先檢查有沒有消息
              if (messages.length === 0) return null;
              
              // 獲取最後一條消息
              const lastMessage = messages[messages.length - 1];
              
              // 檢查是否是助手的消息，並且有來源
              if (
                lastMessage.role !== 'assistant' || 
                !lastMessage.sources || 
                !Array.isArray(lastMessage.sources) || 
                lastMessage.sources.length === 0
              ) {
                return null;
              }
              
              // 如果所有條件都滿足，顯示來源
              return (
                <div className="max-w-3xl mx-auto mt-2">
                  <details className="bg-gray-50 rounded-lg border border-gray-200">
                    <summary className="px-4 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100">
                      查看引用來源 ({lastMessage.sources.length})
                    </summary>
                    <div className="p-4 space-y-3">
                      {lastMessage.sources.map((source, sourceIndex) => (
                        <div key={sourceIndex} className="bg-white p-3 rounded-lg border border-gray-200 text-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-gray-700 font-medium">
                              文件：{source.metadata.source}
                            </span>
                            {source.metadata.page !== undefined && (
                              <span className="text-gray-500 text-xs">
                                第 {source.metadata.page} 頁
                              </span>
                            )}
                          </div>
                          <p className="text-gray-700 text-sm whitespace-pre-wrap">
                            {formatSourceContent(source.content)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              );
            })()}

            {/* 顯示加載動畫 */}
            {isLoading && (
              <div className="flex justify-center p-4">
                <div className="dot-flashing"></div>
              </div>
            )}
            
            {/* 用於滾動到底部的空元素 */}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 輸入區域 */}
        <div className="border-t border-gray-200 bg-white p-4">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="輸入問題..."
                className="w-full rounded-lg pl-4 pr-12 py-3 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-purple-500 disabled:text-gray-300"
                disabled={isLoading || !input.trim()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

      <style>
        {`
          .dot-flashing {
            position: relative;
            width: 10px;
            height: 10px;
            border-radius: 5px;
            background-color: #9880ff;
            animation: dot-flashing 1s infinite linear alternate;
            animation-delay: 0.5s;
          }
          .dot-flashing::before, .dot-flashing::after {
            content: '';
            display: inline-block;
            position: absolute;
            top: 0;
          }
          .dot-flashing::before {
            left: -15px;
            width: 10px;
            height: 10px;
            border-radius: 5px;
            background-color: #9880ff;
            animation: dot-flashing 1s infinite alternate;
            animation-delay: 0s;
          }
          .dot-flashing::after {
            left: 15px;
            width: 10px;
            height: 10px;
            border-radius: 5px;
            background-color: #9880ff;
            animation: dot-flashing 1s infinite alternate;
            animation-delay: 1s;
          }
          @keyframes dot-flashing {
            0% {
              background-color: #9880ff;
            }
            50%, 100% {
              background-color: rgba(152, 128, 255, 0.2);
            }
          }
          
          .product-info {
            line-height: 1.6;
            font-size: 0.9rem;
          }
          
          .product-info p {
            margin-bottom: 8px;
          }
          
          .formatted-message {
            line-height: 1.6;
            min-height: 20px;
          }
          
          .formatted-message ul {
            margin-top: 0.5rem;
            margin-bottom: 0.5rem;
          }
          
          .formatted-message strong {
            font-weight: 600;
          }
          
          .formatted-message div {
            margin-bottom: 0.5rem;
          }
          
          .formatted-message br {
            display: block;
            margin: 5px 0;
            content: "";
          }
          
          @keyframes blink {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          .formatted-message::after {
            content: '|';
            animation: blink 1s infinite;
            animation-timing-function: step-end;
            margin-left: 1px;
            color: #9880ff;
          }
        `}
      </style>
    </div>
  )
}

export default App