import React, { useState, useEffect, useRef } from 'react';
import { Clock, Check, Plus, Trash2, Download, Play, RotateCcw, Camera, Loader2, Square, Calendar, ClipboardList, Edit2, Sun, Moon, X, Save, Key, ChevronDown, ChevronUp, Upload, FileUp, FileDown, GripVertical, FolderPlus, FastForward, MoreVertical, Type as TypeIcon } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { Reorder } from 'motion/react';

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

const DEFAULT_TEMPLATE: ScheduleEvent[] = [];

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
  const [eventName, setEventName] = useState(() => {
    const saved = localStorage.getItem('sportsDayEventName');
    return saved || '活動時間記錄器';
  });
  const [eventDate, setEventDate] = useState(() => {
    const saved = localStorage.getItem('sportsDayDate');
    return saved || '2026-03-21'; // Default to Saturday
  });
  const [isEventInfoExpanded, setIsEventInfoExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleInputRef = useRef<HTMLInputElement>(null);

  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('geminiApiKey') || '');
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  const [currentTime, setCurrentTime] = useState(new Date());

  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const wakeLockRef = useRef<any>(null);

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventName, setEditEventName] = useState('');
  const [editEventTime, setEditEventTime] = useState('');

  const [addingSubEventToId, setAddingSubEventToId] = useState<string | null>(null);
  const [newSubEventName, setNewSubEventName] = useState('');

  const [editingSubEventId, setEditingSubEventId] = useState<string | null>(null);
  const [editSubEventName, setEditSubEventName] = useState('');

  const [expandedEvents, setExpandedEvents] = useState<string[]>([]);

  const [isMergeMode, setIsMergeMode] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);

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

  const handleAddSubEvent = (eventId: string) => {
    if (!newSubEventName.trim()) return;
    setEvents(prev => prev.map(ev => {
      if (ev.id === eventId) {
        const subEvents = ev.subEvents || [];
        const isFirst = subEvents.length === 0;
        return {
          ...ev,
          currentSubEventIndex: ev.currentSubEventIndex ?? 0,
          subEvents: [
            ...subEvents,
            {
              id: `${ev.id}-${Date.now()}`,
              name: newSubEventName.trim(),
              actualStartTime: (isFirst && ev.actualStartTime) ? ev.actualStartTime : null,
              actualEndTime: null,
              skipped: false
            }
          ]
        };
      }
      return ev;
    }));
    setNewSubEventName('');
    setAddingSubEventToId(null);
  };

  const handleDeleteSubEvent = (eventId: string, subEventId: string) => {
    showConfirm('刪除子行程', '確定要刪除這個子行程嗎？', () => {
      setEvents(prev => prev.map(ev => {
        if (ev.id === eventId) {
          const newSubEvents = ev.subEvents?.filter(sub => sub.id !== subEventId) || [];
          let newIndex = ev.currentSubEventIndex ?? 0;
          if (newIndex >= newSubEvents.length) {
            newIndex = Math.max(0, newSubEvents.length - 1);
          }
          return {
            ...ev,
            subEvents: newSubEvents,
            currentSubEventIndex: newIndex
          };
        }
        return ev;
      }));
    });
  };

  const startEditSubEvent = (subEventId: string, name: string) => {
    setEditingSubEventId(subEventId);
    setEditSubEventName(name);
  };

  const saveEditSubEvent = (eventId: string, subEventId: string) => {
    if (!editSubEventName.trim()) return;
    setEvents(prev => prev.map(ev => {
      if (ev.id === eventId) {
        return {
          ...ev,
          subEvents: ev.subEvents?.map(sub => 
            sub.id === subEventId ? { ...sub, name: editSubEventName.trim() } : sub
          )
        };
      }
      return ev;
    }));
    setEditingSubEventId(null);
  };

  const handleReorderSubEvents = (eventId: string, newSubEvents: SubEvent[]) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id === eventId) {
        // Find the ID of the currently active sub-event
        const currentSubEventId = ev.subEvents?.[ev.currentSubEventIndex ?? 0]?.id;
        
        // Find its new index
        let newIndex = ev.currentSubEventIndex ?? 0;
        if (currentSubEventId) {
          const foundIndex = newSubEvents.findIndex(sub => sub.id === currentSubEventId);
          if (foundIndex !== -1) {
            newIndex = foundIndex;
          }
        }

        return {
          ...ev,
          subEvents: newSubEvents,
          currentSubEventIndex: newIndex
        };
      }
      return ev;
    }));
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

  useEffect(() => {
    localStorage.setItem('sportsDayEventName', eventName);
  }, [eventName]);

  const handleMergeEvents = () => {
    const folderName = window.prompt('請輸入合併後的行程（資料夾）名稱：', '新合併行程');
    if (!folderName) return;

    setEvents(prev => {
      // Get selected events in their current order
      const selectedEvents = prev.filter(ev => selectedEventIds.includes(ev.id));
      
      if (selectedEvents.length === 0) return prev;

      // The new merged event takes the expected time of the first selected event
      const firstEvent = selectedEvents[0];

      // Create subEvents from the selected events
      const newSubEvents: SubEvent[] = selectedEvents.flatMap(ev => {
        if (ev.subEvents && ev.subEvents.length > 0) {
          return ev.subEvents;
        }
        return [{
          id: ev.id,
          name: ev.name,
          actualStartTime: ev.actualStartTime,
          actualEndTime: ev.actualEndTime,
          skipped: false
        }];
      });

      // Create the new merged event
      const mergedEvent: ScheduleEvent = {
        id: `merged-${Date.now()}`,
        name: folderName,
        expectedTime: firstEvent.expectedTime,
        actualStartTime: firstEvent.actualStartTime,
        actualEndTime: null,
        subEvents: newSubEvents,
        currentSubEventIndex: 0
      };

      // Determine correct currentSubEventIndex based on actual times
      let lastCompletedIndex = -1;
      let hasStarted = false;
      for (let i = 0; i < newSubEvents.length; i++) {
        if (newSubEvents[i].actualStartTime) {
          hasStarted = true;
        }
        if (newSubEvents[i].actualEndTime) {
          lastCompletedIndex = i;
        }
      }
      
      if (hasStarted) {
        mergedEvent.currentSubEventIndex = Math.min(lastCompletedIndex + 1, newSubEvents.length - 1);
        mergedEvent.actualStartTime = newSubEvents[0].actualStartTime;
      }

      // Remove selected events and insert the merged event at the first event's position
      const result: ScheduleEvent[] = [];
      let inserted = false;
      for (const ev of prev) {
        if (selectedEventIds.includes(ev.id)) {
          if (!inserted) {
            result.push(mergedEvent);
            inserted = true;
          }
        } else {
          result.push(ev);
        }
      }

      return result;
    });

    setIsMergeMode(false);
    setSelectedEventIds([]);
  };

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

  const handleRecordTime = (id: string, type: 'start' | 'end' | 'next-sub' | 'jump-sub' | 'end-sub', targetIndex?: number) => {
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
          } else if (type === 'end-sub') {
            if (ev.subEvents && ev.currentSubEventIndex !== undefined) {
              const newSubEvents = [...ev.subEvents];
              const currentIndex = ev.currentSubEventIndex;
              newSubEvents[currentIndex] = { ...newSubEvents[currentIndex], actualEndTime: timeString };
              return { ...ev, subEvents: newSubEvents };
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

  const handleExportSchedule = () => {
    const exportData = {
      version: 1,
      type: "schedule_template",
      events: events.map(ev => ({
        ...ev,
        actualStartTime: null,
        actualEndTime: null,
        currentSubEventIndex: 0,
        subEvents: ev.subEvents?.map(sub => ({
          ...sub,
          actualStartTime: null,
          actualEndTime: null,
          skipped: false
        }))
      }))
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${eventName}行程樣板.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportSchedule = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (importedData.type === "schedule_template" && Array.isArray(importedData.events)) {
          showConfirm('匯入行程', '確定要匯入此行程樣板嗎？這將會覆蓋您目前所有的行程。', () => {
            setEvents(importedData.events);
            showAlert('匯入成功', '行程樣板已成功匯入！');
          });
        } else if (Array.isArray(importedData)) {
          // Fallback for raw array
          showConfirm('匯入行程', '確定要匯入此行程樣板嗎？這將會覆蓋您目前所有的行程。', () => {
            setEvents(importedData);
            showAlert('匯入成功', '行程樣板已成功匯入！');
          });
        } else {
          showAlert('匯入失敗', '檔案格式錯誤，請確認這是正確的行程樣板檔。');
        }
      } catch (error) {
        showAlert('匯入失敗', '解析檔案失敗，請確認檔案格式是否正確。');
      }
    };
    reader.readAsText(file);
    if (scheduleInputRef.current) {
      scheduleInputRef.current.value = '';
    }
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
      description: `${eventName} - 時段設定檔`,
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
                result[result.length - 1].name += `+${sub.name}`;
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
              const combinedName = remainingSubs.map(s => s.name).join('+');
              
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
    link.setAttribute('download', `${eventName}時段設定檔.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sortedEvents = [...events].sort((a, b) => a.expectedTime.localeCompare(b.expectedTime));
  const currentEventId = sortedEvents.find(ev => !ev.actualEndTime)?.id;

  const completedCount = events.filter(ev => ev.actualEndTime).length;
  const totalCount = events.length;
  const progressPercent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const getMergedName = (subEvents: any[], currentIndex: number) => {
    let combinedName = subEvents[currentIndex].name;
    for (let i = currentIndex - 1; i >= 0; i--) {
      combinedName = subEvents[i].name + '+' + combinedName;
      if (!subEvents[i].skipped) {
        break;
      }
    }
    return combinedName.replace(/年級/g, '');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      {/* Merge Mode Floating Action Bar */}
      {isMergeMode && selectedEventIds.length > 1 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4">
          <span className="font-medium whitespace-nowrap">已選取 {selectedEventIds.length} 項</span>
          <button
            onClick={handleMergeEvents}
            className="bg-white text-indigo-600 px-4 py-1.5 rounded-full text-sm font-bold hover:bg-indigo-50 transition-colors whitespace-nowrap"
          >
            合併為資料夾
          </button>
        </div>
      )}

      {/* Header */}
      <header className="bg-indigo-600 text-white shadow-md sticky top-0 z-20">
        <div className="max-w-3xl mx-auto p-3 sm:p-4 flex items-center justify-between gap-2">
          {/* Left: Title & Progress */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
            <h1 className="text-lg sm:text-xl font-bold hidden min-[400px]:block max-w-[150px] sm:max-w-[250px] truncate" title={eventName}>{eventName}</h1>
            <div className="bg-indigo-800/60 px-2 py-0.5 rounded text-sm font-mono font-medium border border-indigo-500/30" title="已完成 / 總行程">
              {completedCount}/{totalCount}
            </div>
          </div>

          {/* Right: Icon Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <button
              onClick={() => scheduleInputRef.current?.click()}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="匯入行程樣板"
            >
              <FileUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={handleExportSchedule}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="匯出行程樣板"
            >
              <FileDown className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={handleResetAllTimes}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="重設所有時間"
            >
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={`p-2 rounded-lg transition-colors shrink-0 ${showAddForm ? 'bg-indigo-100 text-indigo-800' : 'bg-indigo-500 hover:bg-indigo-400 text-white'}`}
              title={showAddForm ? '隱藏新增' : '新增行程'}
            >
              <Plus className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${showAddForm ? 'rotate-45' : ''}`} />
            </button>
            <button
              onClick={handleExportJSON}
              className="p-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg transition-colors shrink-0 text-white"
              title="匯出照片篩選檔 (JSON)"
            >
              <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            
            {/* More Options Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className={`p-2 rounded-lg transition-colors shrink-0 ${showMenu ? 'bg-indigo-800 text-white' : 'bg-indigo-500 hover:bg-indigo-400 text-white'}`}
                title="更多選項"
              >
                <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-20 text-slate-700">
                    <button
                      onClick={() => {
                        setIsMergeMode(!isMergeMode);
                        setSelectedEventIds([]);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm text-left"
                    >
                      <FolderPlus className={`w-4 h-4 ${isMergeMode ? 'text-amber-500' : 'text-indigo-500'}`} />
                      {isMergeMode ? '取消合併' : '合併行程'}
                    </button>
                    <div className="h-px bg-slate-100 my-1" />
                    <button
                      onClick={() => {
                        toggleWakeLock();
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm text-left"
                    >
                      {isWakeLockActive ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}
                      {isWakeLockActive ? "關閉螢幕常亮" : "開啟螢幕常亮"}
                    </button>
                    <button
                      onClick={() => {
                        setTempApiKey(geminiApiKey);
                        setShowApiKeyModal(true);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-sm text-left"
                    >
                      <Key className="w-4 h-4 text-slate-500" />
                      設定 API 金鑰
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Progress Bar Line */}
        <div className="w-full h-1 bg-indigo-800">
          <div className="h-full bg-emerald-400 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-6 mt-4">
        {/* Event Info Selection */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200">
          {isEventInfoExpanded ? (
            <div className="p-4 flex flex-col gap-4 bg-slate-50/50">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                  <Edit2 className="w-4 h-4 text-indigo-500" />
                  編輯活動資訊
                </h2>
                <button onClick={() => setIsEventInfoExpanded(false)} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors">
                  <ChevronUp className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <TypeIcon className="w-5 h-5 text-indigo-500 hidden sm:block" />
                  <label htmlFor="eventName" className="font-medium text-slate-700 whitespace-nowrap">活動名稱：</label>
                  <input
                    type="text"
                    id="eventName"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-full bg-white"
                    placeholder="請輸入活動名稱"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-indigo-500 hidden sm:block" />
                  <label htmlFor="eventDate" className="font-medium text-slate-700 whitespace-nowrap">活動日期：</label>
                  <input
                    type="date"
                    id="eventDate"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div
              className="p-3 sm:p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors group"
              onClick={() => setIsEventInfoExpanded(true)}
              title="點擊編輯活動資訊"
            >
              <div className="flex items-center gap-4 sm:gap-6 overflow-hidden">
                <div className="flex items-center gap-2 text-slate-700 truncate">
                  <TypeIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 shrink-0" />
                  <span className="font-medium truncate text-sm sm:text-base">{eventName}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600 shrink-0">
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500" />
                  <span className="text-sm sm:text-base">{eventDate}</span>
                </div>
              </div>
              <button className="p-1.5 text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 rounded-lg transition-colors shrink-0 flex items-center gap-1.5">
                <span className="text-xs font-medium hidden sm:block">編輯</span>
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}
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
                  accept=".json" 
                  className="hidden" 
                  ref={scheduleInputRef}
                  onChange={handleImportSchedule}
                />
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
                  isCurrent ? 'scale-[1.05] sm:scale-110 shadow-xl ring-4 ring-indigo-300/50 z-10 relative my-4 sm:my-6 bg-[#eafff5] border-emerald-200' : 'hover:scale-[1.02]'
                } ${
                  !isCurrent && ev.actualEndTime
                    ? 'bg-slate-50 border-slate-200 opacity-80'
                    : !isCurrent && ev.actualStartTime
                    ? 'bg-emerald-50 border-emerald-200'
                    : !isCurrent ? 'bg-white border-slate-200 shadow-sm' : ''
                }`}
              >
                {/* Top Row: Time, Name, Actions */}
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Time & Name */}
                  <div className="flex items-start gap-3 flex-1">
                    {isMergeMode && (
                      <div className="flex items-center h-10">
                        <input
                          type="checkbox"
                          checked={selectedEventIds.includes(ev.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEventIds(prev => [...prev, ev.id]);
                            } else {
                              setSelectedEventIds(prev => prev.filter(id => id !== ev.id));
                            }
                          }}
                          className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>
                    )}
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      <span className={`text-lg sm:text-xl font-mono font-bold px-2.5 py-1 rounded-lg ${isCurrent ? 'bg-white/80 text-slate-800 shadow-sm' : 'bg-slate-100 text-slate-700'}`}>
                        {ev.expectedTime}
                      </span>
                      <span className="text-[10px] sm:text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 shadow-sm" title="當下時間">
                        {currentTime.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <span className={`text-base sm:text-lg font-bold leading-snug pt-1 ${ev.actualEndTime ? 'text-slate-500 line-through font-medium' : isCurrent ? 'text-emerald-700' : ev.actualStartTime ? 'text-emerald-800 font-medium' : 'text-slate-900 font-medium'}`}>
                      {ev.name}
                    </span>
                  </div>

                  {/* Right: Actions (Add Sub, Edit, Delete) */}
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {!ev.actualEndTime && (
                      <button
                        onClick={() => setAddingSubEventToId(ev.id)}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="新增子行程"
                      >
                        <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    )}
                    {!(ev.actualStartTime && !ev.actualEndTime) && (
                      <>
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
                      </>
                    )}
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
                      開始行程
                    </button>
                  )}

                  {/* End Time */}
                  {ev.actualEndTime ? (
                    <div className="flex-1 flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-blue-200 shadow-sm">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span className="text-xs font-bold px-1.5 py-0.5 bg-blue-100 rounded">結束行程</span>
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
                      結束行程
                    </button>
                  )}
                </div>

                {/* Add Sub Event Form */}
                {addingSubEventToId === ev.id && (
                  <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-lg p-3 shadow-inner flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newSubEventName}
                      onChange={(e) => setNewSubEventName(e.target.value)}
                      placeholder="輸入子行程名稱..."
                      className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddSubEvent(ev.id);
                        if (e.key === 'Escape') {
                          setAddingSubEventToId(null);
                          setNewSubEventName('');
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAddSubEvent(ev.id)}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Save className="w-4 h-4" /> 新增
                      </button>
                      <button
                        onClick={() => {
                          setAddingSubEventToId(null);
                          setNewSubEventName('');
                        }}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <X className="w-4 h-4" /> 取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Upcoming Sub Events List (Before Event Starts) */}
                {ev.subEvents && ev.subEvents.length > 0 && !ev.actualStartTime && (
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 shadow-inner space-y-1.5">
                    <div className="text-xs text-slate-500 font-bold mb-2 uppercase tracking-wider">
                      子行程清單
                    </div>
                    <Reorder.Group axis="y" values={ev.subEvents} onReorder={(newOrder) => handleReorderSubEvents(ev.id, newOrder)} className="space-y-1.5">
                      {ev.subEvents.map((sub) => (
                        <Reorder.Item key={sub.id} value={sub} className="flex items-center justify-between gap-2 text-xs sm:text-sm px-2 py-1.5 rounded bg-white border border-slate-100 shadow-sm cursor-grab active:cursor-grabbing">
                          {editingSubEventId === sub.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                value={editSubEventName}
                                onChange={(e) => setEditSubEventName(e.target.value)}
                                className="flex-1 px-2 py-1 border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs sm:text-sm"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditSubEvent(ev.id, sub.id);
                                  if (e.key === 'Escape') setEditingSubEventId(null);
                                }}
                              />
                              <button onClick={() => saveEditSubEvent(ev.id, sub.id)} className="text-indigo-600 hover:text-indigo-700 p-1">
                                <Save className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setEditingSubEventId(null)} className="text-slate-400 hover:text-slate-600 p-1">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 text-slate-600 flex-1">
                                <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                <span className="flex-1">{sub.name}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => startEditSubEvent(sub.id, sub.name)}
                                  className="text-slate-400 hover:text-indigo-500 transition-colors p-1"
                                  title="編輯子行程"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => handleDeleteSubEvent(ev.id, sub.id)}
                                  className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                  title="刪除子行程"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </>
                          )}
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                  </div>
                )}

                {/* Sub Events UI */}
                {ev.subEvents && ev.subEvents.length > 0 && ev.actualStartTime && !ev.actualEndTime && ev.currentSubEventIndex !== undefined && (
                  <div className="mt-4 bg-indigo-50/80 border border-indigo-100 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="bg-indigo-200/80 text-indigo-900 px-3 py-1 rounded-lg text-base sm:text-lg font-bold shrink-0">
                        {ev.currentSubEventIndex + 1} / {ev.subEvents.length}
                      </span>
                      <span className="text-lg sm:text-xl text-indigo-900 font-bold">
                        目前演出：{ev.subEvents[ev.currentSubEventIndex].name}
                      </span>
                    </div>
                    
                    {ev.currentSubEventIndex < ev.subEvents.length - 1 ? (
                      <div className="space-y-3">
                        <button
                          onClick={() => handleRecordTime(ev.id, 'next-sub')}
                          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold transition-colors shadow-md text-sm sm:text-base"
                        >
                          <div className="flex items-center gap-0.5">
                            <Play className="w-4 h-4 sm:w-5 sm:h-5" />
                            <FastForward className="w-4 h-4 sm:w-5 sm:h-5" />
                          </div>
                          進入下一表演：{ev.subEvents[ev.currentSubEventIndex + 1].name}
                        </button>
                        <p className="text-[10px] sm:text-xs text-indigo-500/80 text-center font-medium">
                          💡 若行程太趕，可直接按上方「結束行程」，剩餘未按的表演將自動合併為同一個資料夾。
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {!ev.subEvents[ev.currentSubEventIndex]?.actualEndTime ? (
                          <button
                            onClick={() => handleRecordTime(ev.id, 'end-sub')}
                            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl font-bold transition-colors shadow-md text-sm sm:text-base"
                          >
                            <Square className="w-4 h-4 sm:w-5 sm:h-5" />
                            結束最後表演：{ev.subEvents[ev.currentSubEventIndex]?.name}
                          </button>
                        ) : (
                          <div className="text-sm text-indigo-600 text-center font-medium py-2 bg-indigo-100/50 rounded-lg">
                            所有表演已結束，請點擊上方的「結束行程」按鈕完成此時段。
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Sub Events List */}
                    <div className="mt-4 space-y-1.5">
                      <Reorder.Group axis="y" values={ev.subEvents} onReorder={(newOrder) => handleReorderSubEvents(ev.id, newOrder)} className="space-y-1.5">
                        {ev.subEvents.map((sub, idx) => {
                          const isCompleted = idx < ev.currentSubEventIndex!;
                          const isCurrentSub = idx === ev.currentSubEventIndex;
                          const isUpcoming = idx > ev.currentSubEventIndex!;
                          return (
                            <Reorder.Item 
                              key={sub.id} 
                              value={sub} 
                              dragListener={isUpcoming}
                              className={`flex items-center justify-between gap-2 text-xs sm:text-sm px-2 py-1.5 rounded ${isCurrentSub ? 'bg-indigo-100/50 text-indigo-900 font-bold' : isCompleted ? 'text-slate-400 border-b border-indigo-100/50 rounded-none' : 'text-slate-600 border-b border-indigo-100/50 rounded-none'} ${isUpcoming ? 'cursor-grab active:cursor-grabbing' : ''}`}
                            >
                              {editingSubEventId === sub.id ? (
                                <div className="flex-1 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editSubEventName}
                                    onChange={(e) => setEditSubEventName(e.target.value)}
                                    className="flex-1 px-2 py-1 border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs sm:text-sm"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEditSubEvent(ev.id, sub.id);
                                      if (e.key === 'Escape') setEditingSubEventId(null);
                                    }}
                                  />
                                  <button onClick={() => saveEditSubEvent(ev.id, sub.id)} className="text-indigo-600 hover:text-indigo-700 p-1">
                                    <Save className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setEditingSubEventId(null)} className="text-slate-400 hover:text-slate-600 p-1">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 flex-1">
                                    {isUpcoming && <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
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
                                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                    )}
                                    <span className={isCompleted ? (sub.skipped ? 'text-slate-400 flex-1' : 'line-through flex-1') : 'flex-1'}>
                                      {sub.name}
                                    </span>
                                    {isCompleted && sub.skipped && (
                                      <span className="text-[10px] text-slate-500 ml-1 border border-slate-200 px-1.5 py-0.5 rounded-md bg-slate-100/80 flex items-center gap-1 shadow-sm shrink-0 max-w-[120px] sm:max-w-[200px]">
                                        <div className="w-1 h-1 rounded-full bg-slate-400 shrink-0"></div>
                                        <span className="truncate" title={`已合併: ${getMergedName(ev.subEvents, idx)}`}>
                                          已合併({getMergedName(ev.subEvents, idx)})
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                  {isUpcoming && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleRecordTime(ev.id, 'jump-sub', idx)}
                                        className="text-[10px] sm:text-xs bg-white border border-slate-300 hover:bg-indigo-500 hover:text-white hover:border-indigo-500 text-slate-600 px-2 py-1 rounded transition-colors shadow-sm whitespace-nowrap"
                                      >
                                        直接跳到此項
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </Reorder.Item>
                          );
                        })}
                      </Reorder.Group>
                    </div>
                  </div>
                )}

                {/* Completed Sub Events UI */}
                {ev.subEvents && ev.subEvents.length > 0 && ev.actualEndTime && (
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
                            <div className="flex items-center gap-2 flex-1">
                              {sub.skipped ? (
                                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full border border-slate-300 flex items-center justify-center shrink-0" title="已合併">
                                  <div className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
                                </div>
                              ) : (
                                <Check className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                              )}
                              <span className={sub.skipped ? 'text-slate-400 flex-1' : 'line-through flex-1'}>
                                {sub.name}
                              </span>
                              {sub.skipped && (
                                <span className="text-[10px] text-slate-500 ml-1 border border-slate-200 px-1.5 py-0.5 rounded-md bg-slate-100/80 flex items-center gap-1 shadow-sm shrink-0 max-w-[120px] sm:max-w-[200px]">
                                  <div className="w-1 h-1 rounded-full bg-slate-400 shrink-0"></div>
                                  <span className="truncate" title={`已合併: ${getMergedName(ev.subEvents, idx)}`}>
                                    已合併({getMergedName(ev.subEvents, idx)})
                                  </span>
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
