import React, { useState, useEffect, useRef } from 'react';
import { Clock, Check, Plus, Trash2, Download, Play, RotateCcw, Camera, Loader2, Square, Calendar, ClipboardList, Edit2, Sun, Moon, X, Save, Key, ChevronDown, ChevronUp } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';

interface SubEvent {
  id: string;
  name: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  skipped?: boolean;
}

interface ScheduleEvent {
  id: string;
  name: string;
  expectedTime: string;
  actualStartTime: string | null;
  actualEndTime: string | null;
  subEvents?: SubEvent[];
  currentSubEventIndex?: number;
}

const DEFAULT_TEMPLATE: ScheduleEvent[] = [
  { 
    id: 't1', 
    name: '聯合開幕表演 (一、二、三年級及幼兒園)', 
    expectedTime: '08:00', 
    actualStartTime: null, 
    actualEndTime: null,
    currentSubEventIndex: 0,
    subEvents: [
      { id: 't1-1', name: '一年級孔爺爺藏寶箱舞蹈表演', actualStartTime: null, actualEndTime: null },
      { id: 't1-2', name: '大橋幼兒園律動表演', actualStartTime: null, actualEndTime: null },
      { id: 't1-3', name: '二年級健康操表演', actualStartTime: null, actualEndTime: null },
      { id: 't1-4', name: '三年級大會舞表演', actualStartTime: null, actualEndTime: null }
    ]
  },
  { 
    id: 't2', 
    name: '開幕典禮', 
    expectedTime: '08:30', 
    actualStartTime: null, 
    actualEndTime: null,
    currentSubEventIndex: 0,
    subEvents: [
      { id: 't2-1', name: '運動員進場', actualStartTime: null, actualEndTime: null },
      { id: 't2-2', name: '家長會及志工團進場', actualStartTime: null, actualEndTime: null },
      { id: 't2-3', name: '會旗進場', actualStartTime: null, actualEndTime: null },
      { id: 't2-4', name: '介紹來賓', actualStartTime: null, actualEndTime: null },
      { id: 't2-5', name: '表揚資深服務人員', actualStartTime: null, actualEndTime: null },
      { id: 't2-6', name: '運動員宣誓', actualStartTime: null, actualEndTime: null },
      { id: 't2-7', name: '全員退場', actualStartTime: null, actualEndTime: null }
    ]
  },
  { id: 't3', name: '陸上行舟—繩采飛揚 (家長會、志工團及教師)', expectedTime: '09:20', actualStartTime: null, actualEndTime: null },
  { id: 't4', name: '三、四、五、六年級 60 公尺決賽', expectedTime: '09:30', actualStartTime: null, actualEndTime: null },
  { id: 't5', name: '三、四、五、六年級 100 公尺決賽', expectedTime: '09:40', actualStartTime: null, actualEndTime: null },
  { id: 't6', name: '一年級+幼兒園：40公尺分組賽跑；二年級+特教班：60公尺分組賽跑', expectedTime: '09:50', actualStartTime: null, actualEndTime: null },
  { id: 't7', name: '三年級趣味競賽：萬里長傳', expectedTime: '10:00', actualStartTime: null, actualEndTime: null },
  { id: 't8', name: '四年級趣味競賽：投擲高手；幼兒園趣味競賽：螞蟻搬豆', expectedTime: '10:20', actualStartTime: null, actualEndTime: null },
  { id: 't9', name: '五年級趣味競賽：彗星撞地球', expectedTime: '10:40', actualStartTime: null, actualEndTime: null },
  { id: 't10', name: '一年級趣味競賽：樂冒冒；特教班趣味競賽：樂冒冒', expectedTime: '11:00', actualStartTime: null, actualEndTime: null },
  { id: 't11', name: '二年級趣味競賽：筋筋計較', expectedTime: '11:20', actualStartTime: null, actualEndTime: null },
  { id: 't12', name: '六年級趣味競賽：持之以恆', expectedTime: '11:40', actualStartTime: null, actualEndTime: null },
  { id: 't13', name: '午間用餐休息 (低年級學生 12:40 放學)', expectedTime: '12:00', actualStartTime: null, actualEndTime: null },
  { id: 't14', name: '三年級大隊接力 (計時決賽)', expectedTime: '13:30', actualStartTime: null, actualEndTime: null },
  { id: 't15', name: '四年級大隊接力 (計時決賽)', expectedTime: '14:10', actualStartTime: null, actualEndTime: null },
  { id: 't16', name: '五年級大隊接力 (計時決賽)', expectedTime: '14:40', actualStartTime: null, actualEndTime: null },
  { id: 't17', name: '六年級大隊接力 (計時決賽)', expectedTime: '15:10', actualStartTime: null, actualEndTime: null },
  { id: 't18', name: '頒發田徑總錦標獎項', expectedTime: '15:40', actualStartTime: null, actualEndTime: null }
];

export default function App() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => {
    const saved = localStorage.getItem('sportsDaySchedule');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((ev: any) => ({
          ...ev,
          actualStartTime: ev.actualStartTime !== undefined ? ev.actualStartTime : (ev.actualTime || null),
          actualEndTime: ev.actualEndTime || null,
          subEvents: ev.subEvents?.map((sub: any, idx: number) => ({
            ...sub,
            // Only completed sub-events can be skipped. This sanitizes old corrupted data.
            skipped: (idx < (ev.currentSubEventIndex || 0)) ? (sub.skipped || false) : false
          }))
        }));
      } catch (e) {
        console.error('Failed to parse schedule', e);
      }
    }
    return DEFAULT_TEMPLATE;
  });

  const [newEventName, setNewEventName] = useState('');
  const [newEventTime, setNewEventTime] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [eventDate, setEventDate] = useState(() => {
    const saved = localStorage.getItem('sportsDayDate');
    return saved || '2026-03-21'; // Default to Saturday
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('geminiApiKey') || '');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  const [currentTime, setCurrentTime] = useState(new Date());

  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const wakeLockRef = useRef<any>(null);

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventName, setEditEventName] = useState('');
  const [editEventTime, setEditEventTime] = useState('');

  const [expandedEvents, setExpandedEvents] = useState<string[]>([]);

  const toggleExpand = (id: string) => {
    setExpandedEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      showAlert('不支援', '您的瀏覽器不支援螢幕常亮功能。');
      return;
    }
    
    try {
      if (isWakeLockActive && wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setIsWakeLockActive(false);
      } else {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLockActive(true);
        wakeLockRef.current.addEventListener('release', () => {
          setIsWakeLockActive(false);
        });
      }
    } catch (err: any) {
      showAlert('錯誤', `無法切換螢幕常亮模式: ${err.message}`);
    }
  };

  const startEdit = (ev: ScheduleEvent) => {
    setEditingEventId(ev.id);
    setEditEventName(ev.name);
    setEditEventTime(ev.expectedTime);
  };

  const cancelEdit = () => {
    setEditingEventId(null);
    setEditEventName('');
    setEditEventTime('');
  };

  const saveEdit = (id: string) => {
    if (!editEventName.trim() || !editEventTime) return;
    setEvents(prev => prev.map(ev => 
      ev.id === id ? { ...ev, name: editEventName.trim(), expectedTime: editEventTime } : ev
    ));
    setEditingEventId(null);
  };

  const calculateTimeDiff = (expected: string, actual: string | null) => {
    if (!actual) return null;
    const [expH, expM] = expected.split(':').map(Number);
    const [actH, actM] = actual.split(':').map(Number);
    const diff = (actH * 60 + actM) - (expH * 60 + expM);
    
    if (diff === 0) return { text: '準時', color: 'text-slate-500', bg: 'bg-slate-100' };
    if (diff > 0) return { text: `延遲 ${diff} 分`, color: 'text-red-600', bg: 'bg-red-100' };
    return { text: `提早 ${Math.abs(diff)} 分`, color: 'text-emerald-600', bg: 'bg-emerald-100' };
  };

  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'alert',
    onConfirm: () => {},
  });

  const showAlert = (title: string, message: string) => {
    setModal({ isOpen: true, title, message, type: 'alert', onConfirm: () => {} });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModal({ isOpen: true, title, message, type: 'confirm', onConfirm });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!geminiApiKey) {
      showAlert('需要 API 金鑰', '請先點擊右上角「金鑰」圖示設定您的 Gemini API 金鑰，才能使用 AI 辨識功能。');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsExtracting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      
      const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      
      const base64Data = await base64EncodedDataPromise;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: { data: base64Data, mimeType: file.type }
          },
          { text: '請從這張圖片或文件中提取運動會的賽程表。返回一個 JSON 陣列，包含每個行程的預計時間 (expectedTime，格式為 HH:MM) 和活動名稱 (name)。' }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                expectedTime: { type: Type.STRING, description: '預計時間，格式為 HH:MM' },
                name: { type: Type.STRING, description: '活動名稱' }
              },
              required: ['expectedTime', 'name']
            }
          }
        }
      });

      const text = response.text;
      if (text) {
        const extractedEvents = JSON.parse(text);
        const newEvents = extractedEvents.map((ev: any) => ({
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          name: ev.name,
          expectedTime: ev.expectedTime,
          actualStartTime: null,
          actualEndTime: null
        }));
        
        setEvents(prev => {
          const combined = [...prev, ...newEvents];
          return combined;
        });
        showAlert('辨識成功', `成功辨識並匯入 ${newEvents.length} 筆行程！`);
      }
    } catch (error) {
      console.error('Extraction failed:', error);
      showAlert('辨識失敗', '請確認圖片是否清晰，或手動輸入。');
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    localStorage.setItem('sportsDaySchedule', JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem('sportsDayDate', eventDate);
  }, [eventDate]);

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim() || !newEventTime) return;

    const newEvent: ScheduleEvent = {
      id: Date.now().toString(),
      name: newEventName.trim(),
      expectedTime: newEventTime,
      actualStartTime: null,
      actualEndTime: null,
    };

    setEvents((prev) => [...prev, newEvent]);
    setNewEventName('');
    setNewEventTime('');
  };

  const handleRecordTime = (id: string, type: 'start' | 'end' | 'next-sub' | 'jump-sub', targetIndex?: number) => {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    setEvents((prev) => {
      // 如果是按下「開始」，先找出目前正在進行中（有開始但沒結束）的行程，把它結束掉
      let updatedEvents = [...prev];
      if (type === 'start') {
        updatedEvents = updatedEvents.map(ev => {
          if (ev.id !== id && ev.actualStartTime && !ev.actualEndTime) {
            return { ...ev, actualEndTime: timeString };
          }
          return ev;
        });
      }

      return updatedEvents.map((ev) => {
        if (ev.id === id) {
          if (type === 'start') {
            if (ev.subEvents && ev.subEvents.length > 0) {
              const newSubEvents = ev.subEvents.map((s, idx) => 
                idx === 0 
                  ? { ...s, actualStartTime: timeString, actualEndTime: null, skipped: false }
                  : { ...s, actualStartTime: null, actualEndTime: null, skipped: false }
              );
              return { ...ev, actualStartTime: timeString, actualEndTime: null, subEvents: newSubEvents, currentSubEventIndex: 0 };
            }
            return { ...ev, actualStartTime: timeString, actualEndTime: null };
          } else if (type === 'next-sub') {
            if (ev.subEvents && ev.currentSubEventIndex !== undefined && ev.currentSubEventIndex < ev.subEvents.length - 1) {
              const newSubEvents = [...ev.subEvents];
              const currentIndex = ev.currentSubEventIndex;
              newSubEvents[currentIndex] = { ...newSubEvents[currentIndex], actualEndTime: timeString };
              newSubEvents[currentIndex + 1] = { ...newSubEvents[currentIndex + 1], actualStartTime: timeString };
              return { ...ev, subEvents: newSubEvents, currentSubEventIndex: currentIndex + 1 };
            }
            return ev;
          } else if (type === 'jump-sub' && targetIndex !== undefined) {
            if (ev.subEvents && ev.currentSubEventIndex !== undefined && targetIndex > ev.currentSubEventIndex) {
              const newSubEvents = [...ev.subEvents];
              const currentIndex = ev.currentSubEventIndex;
              
              // 結束目前的子行程
              newSubEvents[currentIndex] = { ...newSubEvents[currentIndex], actualEndTime: timeString };
              
              // 將中間跳過的子行程時間設為相同（持續時間 0 秒），並標記為 skipped，這樣匯出時會與上一個資料夾合併
              for (let i = currentIndex + 1; i < targetIndex; i++) {
                newSubEvents[i] = { ...newSubEvents[i], actualStartTime: timeString, actualEndTime: timeString, skipped: true };
              }
              
              // 開始目標子行程
              newSubEvents[targetIndex] = { ...newSubEvents[targetIndex], actualStartTime: timeString };
              
              return { ...ev, subEvents: newSubEvents, currentSubEventIndex: targetIndex };
            }
            return ev;
          } else {
            const fallbackStartTime = ev.actualStartTime || `${ev.expectedTime}:00`;
            if (ev.subEvents && ev.currentSubEventIndex !== undefined) {
              const newSubEvents = [...ev.subEvents];
              const currentIndex = ev.currentSubEventIndex;
              newSubEvents[currentIndex] = { ...newSubEvents[currentIndex], actualEndTime: timeString };
              return { ...ev, actualStartTime: fallbackStartTime, actualEndTime: timeString, subEvents: newSubEvents };
            }
            return { ...ev, actualStartTime: fallbackStartTime, actualEndTime: timeString };
          }
        }
        return ev;
      });
    });

    if (type === 'end') {
      const currentSortedEvents = [...events].sort((a, b) => a.expectedTime.localeCompare(b.expectedTime));
      const currentIndex = currentSortedEvents.findIndex((ev) => ev.id === id);
      if (currentIndex !== -1 && currentIndex < currentSortedEvents.length - 1) {
        const nextEvent = currentSortedEvents[currentIndex + 1];
        setTimeout(() => {
          const nextElement = document.getElementById(`event-${nextEvent.id}`);
          if (nextElement) {
            nextElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
      }
    }
  };

  const handleResetTime = (id: string, type: 'start' | 'end') => {
    showConfirm('清除時間', `確定要清除這個實際${type === 'start' ? '開始' : '結束'}時間嗎？`, () => {
      setEvents((prev) =>
        prev.map((ev) => {
          if (ev.id === id) {
            if (type === 'start') {
              return { 
                ...ev, 
                actualStartTime: null, 
                subEvents: ev.subEvents?.map(s => ({ ...s, actualStartTime: null, actualEndTime: null, skipped: false })),
                currentSubEventIndex: 0
              };
            } else {
              return { 
                ...ev, 
                actualEndTime: null,
                subEvents: ev.subEvents?.map(s => ({ ...s, actualEndTime: null }))
              };
            }
          }
          return ev;
        })
      );
    });
  };

  const handleResetAllTimes = () => {
    showConfirm('重設所有時間', '確定要清除「所有」行程的記錄時間嗎？這不會刪除行程本身。', () => {
      setEvents((prev) => prev.map((ev) => ({ 
        ...ev, 
        actualStartTime: null, 
        actualEndTime: null,
        subEvents: ev.subEvents?.map(s => ({ ...s, actualStartTime: null, actualEndTime: null, skipped: false })),
        currentSubEventIndex: 0
      })));
    });
  };

  const handleDeleteEvent = (id: string) => {
    showConfirm('刪除行程', '確定要刪除這個行程嗎？', () => {
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
    });
  };

  const handleLoadTemplate = () => {
    showConfirm('載入2026大橋運動會', '確定要載入2026大橋運動會樣板嗎？這將會覆蓋您目前所有的行程與記錄。', () => {
      setEvents(DEFAULT_TEMPLATE);
      setEventDate('2026-03-21');
    });
  };

  const handleExportJSON = () => {
    // Helper function to format time to ISO string with the selected date
    const formatToISO = (timeString: string | null, expectedTime: string) => {
      if (!timeString) return null;
      
      // If it's the expected time (HH:MM format)
      if (timeString === expectedTime) {
        return `${eventDate}T${timeString}:00`;
      }
      
      // If it's an actual time (HH:MM:SS format)
      return `${eventDate}T${timeString}`;
    };

    const exportData = {
      version: 1,
      exportDate: new Date().toISOString(),
      description: "照片篩選器 - 時段設定檔",
      groups: sortedEvents.flatMap(ev => {
        if (ev.subEvents && ev.subEvents.length > 0) {
          const result = [];
          for (let i = 0; i < ev.subEvents.length; i++) {
            const sub = ev.subEvents[i];
            
            if (i < ev.currentSubEventIndex!) {
              let start = formatToISO(sub.actualStartTime, ev.expectedTime);
              let end = formatToISO(sub.actualEndTime, ev.expectedTime);
              
              if (!start) start = formatToISO(ev.expectedTime, ev.expectedTime);
              if (!end) {
                const startDate = new Date(start!);
                startDate.setMinutes(startDate.getMinutes() + 30);
                const endHours = String(startDate.getHours()).padStart(2, '0');
                const endMinutes = String(startDate.getMinutes()).padStart(2, '0');
                end = `${eventDate}T${endHours}:${endMinutes}:00`;
              }
              
              if (sub.skipped && result.length > 0) {
                result[result.length - 1].name += `_${sub.name}`;
                result[result.length - 1].end = end;
              } else {
                result.push({
                  name: `${String(i + 1).padStart(2, '0')}_${sub.name}`,
                  start: start,
                  end: end
                });
              }
            } else if (i === ev.currentSubEventIndex!) {
              const remainingSubs = ev.subEvents.slice(i);
              const combinedName = remainingSubs.map(s => s.name).join('_');
              
              let start = formatToISO(sub.actualStartTime, ev.expectedTime);
              let end = formatToISO(ev.actualEndTime || sub.actualEndTime, ev.expectedTime);
              
              if (!start) start = formatToISO(ev.expectedTime, ev.expectedTime);
              if (!end) {
                const startDate = new Date(start!);
                startDate.setMinutes(startDate.getMinutes() + 30);
                const endHours = String(startDate.getHours()).padStart(2, '0');
                const endMinutes = String(startDate.getMinutes()).padStart(2, '0');
                end = `${eventDate}T${endHours}:${endMinutes}:00`;
              }
              
              result.push({
                name: `${String(i + 1).padStart(2, '0')}_${combinedName}`,
                start: start,
                end: end
              });
              break;
            }
          }
          return result;
        }

        let start = formatToISO(ev.actualStartTime, ev.expectedTime);
        let end = formatToISO(ev.actualEndTime, ev.expectedTime);

        if (!start) {
          start = formatToISO(ev.expectedTime, ev.expectedTime);
        }
        if (!end) {
          const startDate = new Date(start!);
          startDate.setMinutes(startDate.getMinutes() + 30);
          
          const endHours = String(startDate.getHours()).padStart(2, '0');
          const endMinutes = String(startDate.getMinutes()).padStart(2, '0');
          end = `${eventDate}T${endHours}:${endMinutes}:00`;
        }

        return [{
          name: ev.name,
          start: start,
          end: end
        }];
      })
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', '運動會時段設定檔.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sortedEvents = [...events].sort((a, b) => a.expectedTime.localeCompare(b.expectedTime));
  const currentEventId = sortedEvents.find(ev => !ev.actualEndTime)?.id;

  const completedCount = events.filter(ev => ev.actualEndTime).length;
  const totalCount = events.length;
  const progressPercent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      {/* Header */}
      <header className="bg-indigo-600 text-white shadow-md sticky top-0 z-20">
        <div className="max-w-3xl mx-auto p-3 sm:p-4 flex items-center justify-between gap-2">
          {/* Left: Title & Progress */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
            <h1 className="text-lg sm:text-xl font-bold hidden min-[400px]:block">時間記錄器</h1>
            <div className="bg-indigo-800/60 px-2 py-0.5 rounded text-sm font-mono font-medium border border-indigo-500/30" title="已完成 / 總行程">
              {completedCount}/{totalCount}
            </div>
          </div>

          {/* Right: Icon Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <button
              onClick={() => {
                setTempApiKey(geminiApiKey);
                setShowApiKeyModal(true);
              }}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="設定 API 金鑰"
            >
              <Key className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={toggleWakeLock}
              className={`p-2 rounded-lg transition-colors shrink-0 ${isWakeLockActive ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-inner' : 'bg-indigo-500 hover:bg-indigo-400 text-indigo-50'}`}
              title={isWakeLockActive ? "關閉螢幕常亮" : "開啟螢幕常亮"}
            >
              {isWakeLockActive ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={`p-2 rounded-lg transition-colors shrink-0 ${showAddForm ? 'bg-indigo-100 text-indigo-800' : 'bg-indigo-500 hover:bg-indigo-400 text-white'}`}
              title={showAddForm ? '隱藏新增' : '新增行程'}
            >
              <Plus className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
            </button>
            <button
              onClick={handleLoadTemplate}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="載入樣板"
            >
              <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={handleResetAllTimes}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="重設時間"
            >
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={handleExportJSON}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="匯出 JSON"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
        
        {/* Progress Bar Line */}
        <div className="w-full h-1 bg-indigo-800">
          <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-6 mt-4">
        {/* Date Selection */}
        <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-3">
          <Calendar className="w-5 h-5 text-indigo-500" />
          <label htmlFor="eventDate" className="font-medium text-slate-700">運動會日期：</label>
          <input
            type="date"
            id="eventDate"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
          />
          <span className="text-sm text-slate-500 ml-2 hidden sm:inline">匯出 JSON 時會使用此日期</span>
        </section>

        {/* Add Event Form & AI Upload */}
        {showAddForm && (
          <section className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-800">
                <Plus className="w-5 h-5 text-indigo-500" />
                新增預計行程
              </h2>
              
              <div>
                <input 
                  type="file" 
                  accept="image/*,application/pdf" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExtracting}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      AI 辨識中...
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      拍照 / 上傳行程表自動辨識
                    </>
                  )}
                </button>
              </div>
            </div>

            <form onSubmit={handleAddEvent} className="flex flex-col sm:flex-row gap-3">
              <input
                type="time"
                value={newEventTime}
                onChange={(e) => setNewEventTime(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                required
              />
              <input
                type="text"
                placeholder="活動名稱 (例如: 大隊接力)"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                required
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
              >
                手動新增
              </button>
            </form>
          </section>
        )}

        {/* Schedule List */}
        <section className="space-y-3">
          {sortedEvents.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              目前沒有行程，請在上方新增。
            </div>
          ) : (
            sortedEvents.map((ev) => {
              const isCurrent = ev.id === currentEventId;
              
              if (editingEventId === ev.id) {
                return (
                  <div key={ev.id} className="flex flex-col sm:flex-row gap-3 p-4 rounded-xl border bg-indigo-50 border-indigo-200 shadow-sm relative z-10 my-2">
                    <input
                      type="time"
                      value={editEventTime}
                      onChange={(e) => setEditEventTime(e.target.value)}
                      className="px-3 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-full sm:w-auto"
                      required
                    />
                    <input
                      type="text"
                      value={editEventName}
                      onChange={(e) => setEditEventName(e.target.value)}
                      className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      required
                    />
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button onClick={() => saveEdit(ev.id)} className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                        <Save className="w-4 h-4" /> 儲存
                      </button>
                      <button onClick={cancelEdit} className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg font-medium transition-colors">
                        <X className="w-4 h-4" /> 取消
                      </button>
                    </div>
                  </div>
                );
              }

              return (
              <div
                key={ev.id}
                id={`event-${ev.id}`}
                className={`flex flex-col gap-3 sm:gap-4 p-4 rounded-xl border transition-all duration-300 ${
                  isCurrent ? 'scale-[1.05] sm:scale-110 shadow-xl ring-4 ring-indigo-400/50 z-10 relative my-4 sm:my-6' : 'hover:scale-[1.02]'
                } ${
                  ev.actualEndTime
                    ? 'bg-slate-50 border-slate-200 opacity-80'
                    : ev.actualStartTime
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                {/* Top Row: Time, Name, Actions */}
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Time & Name */}
                  <div className="flex items-start gap-3 flex-1">
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      <span className="text-lg sm:text-xl font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                        {ev.expectedTime}
                      </span>
                      <span className="text-[10px] sm:text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shadow-sm" title="當下時間">
                        {currentTime.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <span className={`text-base sm:text-lg font-medium leading-snug pt-1 ${ev.actualEndTime ? 'text-slate-500 line-through' : ev.actualStartTime ? 'text-emerald-800' : 'text-slate-900'}`}>
                      {ev.name}
                    </span>
                  </div>

                  {/* Right: Actions (Edit, Delete) */}
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <button
                      onClick={() => startEdit(ev)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="編輯行程"
                    >
                      <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteEvent(ev.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="刪除行程"
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                {/* Bottom Row: Action Buttons / Actual Times */}
                <div className="flex items-center gap-2 w-full mt-1 sm:mt-0">
                  {/* Start Time */}
                  {ev.actualStartTime ? (
                    <div className="flex-1 flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-emerald-200 shadow-sm">
                      <div className="flex items-center gap-2 text-emerald-700">
                        <span className="text-xs font-bold px-1.5 py-0.5 bg-emerald-100 rounded">開始</span>
                        <span className="font-mono font-bold text-sm sm:text-base">{ev.actualStartTime}</span>
                        {(() => {
                          const diff = calculateTimeDiff(ev.expectedTime, ev.actualStartTime);
                          if (!diff) return null;
                          return (
                            <span className={`text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded ${diff.bg} ${diff.color} hidden sm:inline-block`}>
                              {diff.text}
                            </span>
                          );
                        })()}
                      </div>
                      <button
                        onClick={() => handleResetTime(ev.id, 'start')}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="清除開始時間"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRecordTime(ev.id, 'start')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2.5 rounded-lg text-sm sm:text-base font-medium transition-colors shadow-sm"
                    >
                      <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                      開始
                    </button>
                  )}

                  {/* End Time */}
                  {ev.actualEndTime ? (
                    <div className="flex-1 flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-blue-200 shadow-sm">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span className="text-xs font-bold px-1.5 py-0.5 bg-blue-100 rounded">結束</span>
                        <span className="font-mono font-bold text-sm sm:text-base">{ev.actualEndTime}</span>
                      </div>
                      <button
                        onClick={() => handleResetTime(ev.id, 'end')}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="清除結束時間"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRecordTime(ev.id, 'end')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2.5 rounded-lg text-sm sm:text-base font-medium transition-colors shadow-sm"
                    >
                      <Square className="w-4 h-4 sm:w-5 sm:h-5" />
                      結束
                    </button>
                  )}
                </div>

                {/* Sub Events UI */}
                {ev.subEvents && ev.actualStartTime && !ev.actualEndTime && ev.currentSubEventIndex !== undefined && (
                  <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg p-3 shadow-inner">
                    <div className="text-sm text-indigo-800 font-bold mb-3 flex items-center gap-2">
                      <span className="bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded text-xs">
                        {ev.currentSubEventIndex + 1} / {ev.subEvents.length}
                      </span>
                      目前演出：{ev.subEvents[ev.currentSubEventIndex].name}
                    </div>
                    {ev.currentSubEventIndex < ev.subEvents.length - 1 ? (
                      <div className="space-y-2">
                        <button
                          onClick={() => handleRecordTime(ev.id, 'next-sub')}
                          className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-3 rounded-lg text-base font-bold transition-colors shadow-md"
                        >
                          <Play className="w-5 h-5" />
                          ⏭️ 進入下一表演：{ev.subEvents[ev.currentSubEventIndex + 1].name}
                        </button>
                        <p className="text-xs text-indigo-600/70 text-center font-medium">
                          💡 若行程太趕，可直接按上方「結束」，剩餘未按的表演將自動合併為同一個資料夾。
                        </p>
                      </div>
                    ) : (
                      <div className="text-sm text-indigo-600 text-center font-medium py-2 bg-indigo-100/50 rounded-lg">
                        這是最後一個表演，請點擊上方的「結束」按鈕完成此時段。
                      </div>
                    )}
                    
                    {/* Sub Events List */}
                    <div className="mt-4 space-y-1.5">
                      {ev.subEvents.map((sub, idx) => {
                        const isCompleted = idx < ev.currentSubEventIndex!;
                        const isCurrentSub = idx === ev.currentSubEventIndex;
                        const isUpcoming = idx > ev.currentSubEventIndex!;
                        return (
                          <div key={sub.id} className={`flex items-center justify-between gap-2 text-xs sm:text-sm px-2 py-1.5 rounded ${isCurrentSub ? 'bg-indigo-100 text-indigo-900 font-bold' : isCompleted ? 'text-slate-400' : 'text-slate-600'}`}>
                            <div className="flex items-center gap-2">
                              {isCompleted ? (
                                sub.skipped ? (
                                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full border border-slate-300 flex items-center justify-center shrink-0" title="已合併">
                                    <div className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
                                  </div>
                                ) : (
                                  <Check className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                                )
                              ) : isCurrentSub ? (
                                <Play className="w-3 h-3 sm:w-4 sm:h-4 text-indigo-600 shrink-0" />
                              ) : (
                                <div className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                              )}
                              <span className={isCompleted ? 'line-through' : ''}>
                                {sub.name}
                              </span>
                              {isCompleted && sub.skipped && (
                                <span className="text-[10px] text-slate-400 ml-1 border border-slate-200 px-1 rounded bg-slate-100">
                                  已合併 {sub.actualStartTime}
                                </span>
                              )}
                            </div>
                            {isUpcoming && (
                              <button
                                onClick={() => handleRecordTime(ev.id, 'jump-sub', idx)}
                                className="text-[10px] sm:text-xs bg-white border border-slate-300 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 text-slate-600 px-2 py-1 rounded transition-colors shadow-sm whitespace-nowrap"
                              >
                                直接跳到此項
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Completed Sub Events UI */}
                {ev.subEvents && ev.actualEndTime && (
                  <div className="mt-2">
                    <button
                      onClick={() => toggleExpand(ev.id)}
                      className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 py-1"
                    >
                      {expandedEvents.includes(ev.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {expandedEvents.includes(ev.id) ? '隱藏子行程' : '檢視子行程'}
                    </button>
                    {expandedEvents.includes(ev.id) && (
                      <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 shadow-inner space-y-1.5">
                        {ev.subEvents.map((sub, idx) => (
                          <div key={sub.id} className="flex items-center justify-between gap-2 text-xs sm:text-sm px-2 py-1.5 rounded text-slate-500">
                            <div className="flex items-center gap-2">
                              {sub.skipped ? (
                                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full border border-slate-300 flex items-center justify-center shrink-0" title="已合併">
                                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
                                </div>
                              ) : (
                                <Check className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                              )}
                              <span className="line-through">
                                {sub.name}
                              </span>
                              {sub.skipped && (
                                <span className="text-[10px] text-slate-400 ml-1 border border-slate-200 px-1 rounded bg-slate-100">
                                  已合併 {sub.actualStartTime}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})
          )}
        </section>
      </main>

      {/* Custom Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">{modal.title}</h3>
            <p className="text-slate-600 mb-6">{modal.message}</p>
            <div className="flex justify-end gap-3">
              {modal.type === 'confirm' && (
                <button
                  onClick={() => setModal({ ...modal, isOpen: false })}
                  className="px-4 py-2 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  取消
                </button>
              )}
              <button
                onClick={() => {
                  modal.onConfirm();
                  setModal({ ...modal, isOpen: false });
                }}
                className="px-4 py-2 rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-500" />
              設定 Gemini API 金鑰
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              請輸入您的 Gemini API 金鑰以啟用「拍照辨識行程表」功能。金鑰將只會安全地儲存在您的瀏覽器中。
            </p>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none mb-6 font-mono text-sm"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowApiKeyModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setGeminiApiKey(tempApiKey);
                  localStorage.setItem('geminiApiKey', tempApiKey);
                  setShowApiKeyModal(false);
                  showAlert('設定成功', 'API 金鑰已儲存！');
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
