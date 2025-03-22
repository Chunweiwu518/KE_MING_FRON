import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

// 文本格式化函數
const formatText = (text: string): string => {
  // 如果文本包含 [SOURCES] 標記，則不進行格式化
  if (text.includes('[SOURCES]')) {
    return text;
  }

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
  createdAt: string
  messages: Message[]
}

interface VectorStoreStats {
  total_chunks: number
  unique_files: number
  files: string[]
  is_empty: boolean
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatHistories, setChatHistories] = useState<ChatHistory[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [vectorStoreStats, setVectorStoreStats] = useState<VectorStoreStats>({
    total_chunks: 0,
    unique_files: 0,
    files: [],
    is_empty: true
  })
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 載入歷史對話
  useEffect(() => {
    fetchChatHistories()
  }, [])

  // 滾動到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 在適當的時機加載統計信息
  useEffect(() => {
    loadVectorStoreStats();
    
    // 每30秒更新一次知識庫統計
    const vectorStoreInterval = setInterval(() => {
      loadVectorStoreStats();
    }, 30000);
    
    return () => {
      clearInterval(vectorStoreInterval);
    };
  }, []);

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
      if (response.data && response.data.messages) {
        setMessages(response.data.messages)
        setCurrentChatId(chatId)
        setError(null)
      } else {
        setError('對話歷史格式不正確')
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
      setError('載入對話歷史失敗')
    } finally {
      setIsLoading(false)
    }
  }

  // 新對話按鈕
  const startNewChat = async () => {
    console.log('開始新對話，重置狀態');
    
    try {
      // 如果當前有對話且有消息，則更新該對話的內容
      if (currentChatId && messages.length > 0) {
        await axios.put(`${API_URL}/api/history/${currentChatId}`, {
          messages: messages,
          title: messages[0].content.slice(0, 30) + '...'
        });
      }

      // 創建新的對話歷史
      const response = await axios.post(`${API_URL}/api/history`, {
        messages: [],
        title: '新對話'
      });
      
      console.log('新對話創建成功:', response.data.id);
      setCurrentChatId(response.data.id);
      setMessages([]);
      setError(null);
      
      // 只在創建新對話成功後更新歷史列表
      const historyResponse = await axios.get(`${API_URL}/api/history`);
      const sortedHistories = historyResponse.data.sort((a: ChatHistory, b: ChatHistory) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setChatHistories(sortedHistories);
    } catch (error) {
      console.error('創建新對話失敗:', error);
      setError('創建新對話失敗');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    const currentInput = input.trim()
    setInput('')
    setIsLoading(true)
    setError(null)

    const newMessage: Message = {
      role: 'user',
      content: currentInput
    }

    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      sources: []
    }

    const updatedMessages = [...messages, newMessage, assistantMessage]
    setMessages(updatedMessages)

    try {
      // 如果沒有當前對話ID，創建一個新的
      if (!currentChatId) {
        const historyResponse = await axios.post(`${API_URL}/api/history`, {
          messages: [newMessage],
          title: currentInput.slice(0, 30) + '...'
        });
        setCurrentChatId(historyResponse.data.id);
        await fetchChatHistories();
      } else {
        // 更新現有對話
        await axios.put(`${API_URL}/api/history/${currentChatId}`, {
          messages: updatedMessages,
          title: messages[0]?.content.slice(0, 30) + '...' || '新對話'
        });
      }

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

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('無法獲取響應流')
      }

      let tempResponse = ''
      let sources: Source[] = []
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break
        
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        
        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue
          
          const data = line.slice(5)
          
          if (data.startsWith('[SOURCES]') && data.endsWith('[/SOURCES]')) {
            try {
              const sourcesJson = data.slice(9, -10)
              sources = JSON.parse(sourcesJson)
            } catch (error) {
              console.error('解析來源信息時出錯:', error)
            }
            continue
          }
          
          else if (data.startsWith('[ERROR]') && data.endsWith('[/ERROR]')) {
            const errorMsg = data.replace('[ERROR]', '').replace('[/ERROR]', '')
            setError(`聊天請求失敗: ${errorMsg}`)
            break
          }
          
          else if (data === '[DONE]') {
            setMessages(prev => {
              const updatedMessages = [...prev]
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
              return updatedMessages
            })
            break
          }
          
          else {
            if (!data.includes('[SOURCES]') && !data.includes('[ERROR]') && data !== '[DONE]') {
              tempResponse += data
              setMessages(prev => {
                const updatedMessages = [...prev]
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
            }
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

  // 添加側邊欄收合切換函數
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  // 添加拖拽處理函數
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
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

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
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
                    onClick={() => {
                      console.log('載入對話歷史:', chat.id);
                      loadChatHistory(chat.id);
                    }}
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

          {/* 系統資訊 */}
          <div className="p-4 border-t border-gray-200">
            <h2 className="text-sm font-medium mb-2 text-gray-700">系統資訊</h2>
            <div className="text-xs text-gray-600 space-y-1">
              <p>模型版本：GPT-4-1106-preview</p>
              <p>知識庫大小：{vectorStoreStats.total_chunks} 塊</p>
              <p>系統版本：v1.0.0</p>
              <p>更新時間：{new Date().toLocaleDateString()}</p>
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
                <div className="text-5xl mb-4">💬</div>
                <h2 className="text-xl font-semibold mb-2 text-gray-800">歡迎使用 RAG 聊天助手</h2>
                <p className="mb-4 text-gray-600">您可以開始提問，AI 助手會根據知識庫內容為您解答</p>
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
              if (messages.length === 0) return null;
              const lastMessage = messages[messages.length - 1];
              if (
                lastMessage.role !== 'assistant' || 
                !lastMessage.sources || 
                !Array.isArray(lastMessage.sources) || 
                lastMessage.sources.length === 0
              ) {
                return null;
              }
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
                            {source.content}
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
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex gap-2 items-center">
            <button
              type="button"
              onClick={startNewChat}
              className="flex-shrink-0 py-3 px-4 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-medium transition-colors"
            >
              開始新對話
            </button>
            <div className="relative flex-1">
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