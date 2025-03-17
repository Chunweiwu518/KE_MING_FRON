import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

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
  const [files, setFiles] = useState<File[]>([])
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

  // 載入歷史對話
  useEffect(() => {
    fetchChatHistories()
  }, [])

  // 滾動到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchChatHistories = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/history`)
      setChatHistories(response.data)
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

    const newMessage: Message = {
      role: 'user',
      content: input.trim()
    }

    setMessages(prev => [...prev, newMessage])
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      const response = await axios.post(`${API_URL}/api/chat`, {
        query: input.trim(),
        history: messages
      })

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data.answer,
        sources: response.data.sources
      }

      const updatedMessages = [...messages, newMessage, assistantMessage]
      setMessages(updatedMessages)

      // 保存對話
      if (!currentChatId) {
        const historyResponse = await axios.post(`${API_URL}/api/history`, {
          messages: updatedMessages,
          title: input.trim().slice(0, 20) + "..."
        })
        setCurrentChatId(historyResponse.data.id)
        await fetchChatHistories() // 重新獲取對話列表
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
    const uploadedFiles = e.target.files
    if (!uploadedFiles) return

    setIsLoading(true)
    setError('正在處理文件...')

    for(let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i]
      const formData = new FormData()
      formData.append('file', file)
      
      try {
        await axios.post(`${API_URL}/api/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        setFiles(prev => [...prev, { name: file.name }])
      } catch (error) {
        console.error('文件上傳失敗:', error)
        setError(`文件 ${file.name} 上傳失敗`)
      }
    }
    
    setIsLoading(false)
    setError(null)
  }

  const removeFile = async (index: number) => {
    const fileToRemove = files[index]
    try {
      await axios.delete(`${API_URL}/api/files/${fileToRemove.name}`)
      setFiles(prev => prev.filter((_, i) => i !== index))
    } catch (error) {
      console.error('Delete error:', error)
      if (axios.isAxiosError(error)) {
        setError(`刪除檔案失敗: ${error.response?.data?.detail || error.message}`)
      } else {
        setError('刪除檔案時發生未知錯誤')
      }
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
      setFiles([]) // 清空文件列表
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
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsLoading(true)
    setError('正在處理資料夾中的文件...')

    const formData = new FormData()
    let uploadedCount = 0
    let failedCount = 0

    // 處理所有文件
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      
      // 檢查副檔名
      const fileExt = file.name.toLowerCase().split('.').pop()
      if (!['txt', 'pdf', 'docx'].includes(fileExt || '')) continue
      
      try {
        const individualFormData = new FormData()
        individualFormData.append('file', file)
        
        await axios.post(`${API_URL}/api/upload`, individualFormData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        
        setFiles(prev => [...prev, { name: file.name }])
        uploadedCount++
      } catch (error) {
        console.error(`上傳文件失敗: ${file.name}`, error)
        failedCount++
      }
    }

    setIsLoading(false)
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
    setError('正在處理文件...')
    
    for(let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i]
      const formData = new FormData()
      formData.append('file', file)
      
      try {
        await axios.post(`${API_URL}/api/upload`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        })
        setFiles(prev => [...prev, { name: file.name }])
      } catch (error) {
        console.error('文件上傳失敗:', error)
        setError(`文件 ${file.name} 上傳失敗`)
      }
    }
    
    setIsLoading(false)
    setError(null)
  }

  // 添加加載統計信息的函數
  const loadVectorStoreStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/vector-store/stats`)
      setVectorStoreStats(response.data)
    } catch (error) {
      console.error('獲取知識庫統計失敗:', error)
    }
  }

  // 在適當的時機加載統計信息
  useEffect(() => {
    loadVectorStoreStats()
  }, [files]) // 當文件列表變化時重新加載

  return (
    <div className="flex h-screen bg-white">
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
                  directory=""
                  multiple 
                  className="hidden" 
                  onChange={handleFolderUpload} 
                  disabled={isLoading} 
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

          {/* 已上傳文件列表 */}
          {files.length > 0 && (
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-sm font-medium mb-2 text-gray-700">已上傳檔案</h2>
              <div className="max-h-40 overflow-y-auto">
                <div className="space-y-1">
                  {files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 rounded bg-gray-100 text-sm">
                      <span className="truncate flex-1 text-gray-800">{file.name}</span>
                      <button
                        onClick={() => removeFile(index)}
                        className="ml-2 text-gray-400 hover:text-red-400"
                        disabled={isLoading}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

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
              onClick={() => {
                setMessages([])
                setCurrentChatId(null)
              }}
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
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              </div>
            ))}

            {/* 消息來源 */}
            {messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].sources && messages[messages.length - 1].sources.length > 0 && (
              <div className="max-w-3xl mx-auto mt-2">
                <details className="bg-gray-50 rounded-lg border border-gray-200">
                  <summary className="px-4 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100">
                    查看引用來源 ({messages[messages.length - 1].sources.length})
                  </summary>
                  <div className="p-4 space-y-3">
                    {messages[messages.length - 1].sources.map((source, sourceIndex) => (
                      <div key={sourceIndex} className="bg-white p-3 rounded-lg border border-gray-200 text-sm">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-700 font-medium">
                            文件：{source.metadata.source}
                          </span>
                          {source.metadata.page && (
                            <span className="text-gray-500 text-xs">
                              第 {source.metadata.page} 頁
                            </span>
                          )}
                        </div>
                        <p className="text-gray-700 text-sm whitespace-pre-wrap">
                          {source.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

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

      <style jsx>{`
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
      `}</style>
    </div>
  )
}

export default App
