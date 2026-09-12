import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Plus,
  Minus,
  Settings,
  Flame,
  Award,
  Clock,
  History,
  Trash2,
  Info,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Sparkles,
  X
} from "lucide-react";

// Types
type WorkoutMode = "idle" | "prepare" | "work" | "rest" | "completed";

interface WorkoutPreset {
  name: string;
  workDuration: number; // in seconds
  restDuration: number; // in seconds
  totalSets: number;
  description: string;
}

interface WorkoutLog {
  id: string;
  date: string;
  presetName: string;
  setsCompleted: number;
  totalSets: number;
  totalDuration: number; // in seconds
}

const PRESETS: WorkoutPreset[] = [
  {
    name: "高强度间歇 (HIIT)",
    workDuration: 30,
    restDuration: 15,
    totalSets: 8,
    description: "高效燃脂，全力冲刺 30 秒，休息 15 秒，循环 8 组"
  },
  {
    name: "经典 Tabata",
    workDuration: 20,
    restDuration: 10,
    totalSets: 8,
    description: "极致心肺挑战，全力 20 秒，休息 10 秒，经典高能训练"
  },
  {
    name: "力量训练间隔",
    workDuration: 45,
    restDuration: 45,
    totalSets: 5,
    description: "45 秒专注发力负重，45 秒充分拉伸复原，循环 5 组"
  },
  {
    name: "温和核心唤醒",
    workDuration: 40,
    restDuration: 20,
    totalSets: 4,
    description: "晨间拉伸或核心唤醒，中低强度持续激活，循环 4 组"
  }
];

export default function App() {
  // --- STATE ---
  const [workDuration, setWorkDuration] = useState<number>(45); // default work: 45s
  const [restDuration, setRestDuration] = useState<number>(30); // default rest: 30s
  const [totalSets, setTotalSets] = useState<number>(4);        // default sets: 4
  const [prepDuration] = useState<number>(5);                  // default prepare: 5s

  const [currentMode, setCurrentMode] = useState<WorkoutMode>("idle");
  const [currentSet, setCurrentSet] = useState<number>(1);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [phaseTotalDuration, setPhaseTotalDuration] = useState<number>(0);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const [sessionTotalTime, setSessionTotalTime] = useState<number>(0); // accumulated active seconds

  // Settings & Toggles
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [voiceControlEnabled, setVoiceControlEnabled] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>("自定义");
  const [activeTab, setActiveTab] = useState<"presets" | "custom" | "history">("presets");
  const showHistory = activeTab === "history";
  const setShowHistory = (val: boolean) => {
    setActiveTab(val ? "history" : "presets");
  };
  const [showVoiceGuide, setShowVoiceGuide] = useState<boolean>(false);

  // Recognition States
  const [recognitionStatus, setRecognitionStatus] = useState<"inactive" | "listening" | "error" | "unsupported">("inactive");
  const [lastRecognizedCommand, setLastRecognizedCommand] = useState<string>("");
  const [isSpeechBlockedInIFrame, setIsSpeechBlockedInIFrame] = useState<boolean>(false);

  // History Log
  const [historyLogs, setHistoryLogs] = useState<WorkoutLog[]>(() => {
    try {
      const saved = localStorage.getItem("workout_timer_logs");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // --- REFS FOR ACCURATE TIMER ---
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTickRef = useRef<number>(0);
  const speechActiveRef = useRef<boolean>(false);
  const lastCommandTimeRef = useRef<number>(0); // Refractory period tracker for voice control

  // Speech Recognition instance ref
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(false);

  // Audio Context Ref (for sound beeps)
  const audioContextRef = useRef<AudioContext | null>(null);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem("workout_timer_logs", JSON.stringify(historyLogs));
  }, [historyLogs]);

  // Check if speech is blocked due to iframe constraints
  useEffect(() => {
    // Web Speech API is often blocked in sandboxed iframes unless explicitly granted
    try {
      const inIframe = window.self !== window.top;
      const isDismissed = localStorage.getItem("dismissed_sandbox_warning") === "true";
      setIsSpeechBlockedInIFrame(inIframe && !isDismissed);
    } catch (e) {
      const isDismissed = localStorage.getItem("dismissed_sandbox_warning") === "true";
      setIsSpeechBlockedInIFrame(!isDismissed);
    }
  }, []);

  // --- AUDIO SYNTHESIZER (Web Audio API) ---
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioContextRef.current = new AudioCtx();
      }
    }
  };

  const playBeep = (frequency: number, duration: number, type: "sine" | "square" | "triangle" = "sine") => {
    try {
      initAudioContext();
      const ctx = audioContextRef.current;
      if (!ctx) return;

      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);

      gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio Context Error: ", e);
    }
  };

  // --- TEXT TO SPEECH (TTS) ---
  const speak = (text: string) => {
    if (!voiceEnabled) return;
    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1.1; // iOS athletic dynamic pace
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      utterance.onstart = () => {
        speechActiveRef.current = true;
      };
      utterance.onend = () => {
        speechActiveRef.current = false;
      };
      utterance.onerror = () => {
        speechActiveRef.current = false;
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech Synthesis Error:", e);
    }
  };

  // --- SPEECH RECOGNITION (ASR) ---
  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecognitionStatus("unsupported");
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true; // CRITICAL: Receive real-time interim chunks for zero-latency commands
      rec.lang = "zh-CN";

      rec.onstart = () => {
        setRecognitionStatus("listening");
      };

      rec.onresult = (event: any) => {
        let combinedInterim = "";
        let combinedFinal = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            combinedFinal += text;
          } else {
            combinedInterim += text;
          }
        }

        const activeText = (combinedInterim || combinedFinal).trim().toLowerCase();
        if (activeText) {
          setLastRecognizedCommand(activeText);
          handleVoiceCommand(activeText);
        }
      };

      rec.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setRecognitionStatus("error");
          // If in iframe, we strongly suggest opening in a new tab
        }
      };

      rec.onend = () => {
        // Continuous restart to keep microphone listening active during physical workout
        if (shouldListenRef.current && voiceControlEnabled) {
          try {
            recognitionRef.current?.start();
          } catch (err) {
            // Already running
          }
        } else {
          setRecognitionStatus("inactive");
        }
      };

      recognitionRef.current = rec;
    } catch (err) {
      console.error("ASR setup failed:", err);
      setRecognitionStatus("unsupported");
    }
  };

  // Start speech engine based on status
  useEffect(() => {
    if (voiceControlEnabled) {
      shouldListenRef.current = true;
      if (!recognitionRef.current) {
        initSpeechRecognition();
      }

      if (recognitionRef.current && recognitionStatus !== "listening") {
        try {
          recognitionRef.current.start();
          speak("语音助理已就位，请说：开始、暂停、或者下一组");
        } catch (err) {
          console.warn("Failed to boot speech:", err);
        }
      }
    } else {
      shouldListenRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {}
      }
      setRecognitionStatus("inactive");
    }
  }, [voiceControlEnabled]);

  // Voice command processor with strict debouncing
  const handleVoiceCommand = (rawText: string) => {
    const cleanCmd = rawText.replace(/[。，？！.?! 、]/g, "").trim();
    if (!cleanCmd) return;

    const now = Date.now();
    // 1.2s refractory period to prevent trailing echo repeats
    if (now - lastCommandTimeRef.current < 1200) {
      return;
    }

    // Mapping patterns
    const isStart = /开始|走起|运动|计时|继续|跑|go|start|resume/i.test(cleanCmd);
    const isPause = /暂停|等一下|停|停止|pause|stop/i.test(cleanCmd);
    const isNext = /下一组|下一节|跳过|完成|搞定|next|skip|done/i.test(cleanCmd);
    const isReset = /重新开始|重置|取消|清空|restart|reset/i.test(cleanCmd);
    const isReady = /准备好了|我准备好了|准备|ready/i.test(cleanCmd);

    if (isStart) {
      lastCommandTimeRef.current = now;
      triggerStart();
      speak("开始");
    } else if (isPause) {
      lastCommandTimeRef.current = now;
      triggerPause();
      speak("已暂停");
    } else if (isNext) {
      lastCommandTimeRef.current = now;
      triggerSkip();
    } else if (isReset) {
      lastCommandTimeRef.current = now;
      triggerReset();
      speak("已重置");
    } else if (isReady) {
      lastCommandTimeRef.current = now;
      if (currentMode === "idle") {
        triggerStart();
        speak("准备倒计时");
      } else if (currentMode === "prepare") {
        startWorkoutPhase(1);
      }
    }
  };

  // Simulate command utility (for iframes & direct preview click testing)
  const simulateCommand = (cmdText: string) => {
    setLastRecognizedCommand(`(模拟) "${cmdText}"`);
    handleVoiceCommand(cmdText);
  };

  // --- CORE TIMER MANAGEMENT ---

  const clearActiveTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const triggerSkip = () => {
    if (currentMode === "idle") return;

    if (currentMode === "prepare") {
      speak("跳过准备，进入第一组");
      startWorkoutPhase(1);
    } else if (currentMode === "work") {
      speak(`第 ${currentSet} 组提前结束`);
      if (currentSet < totalSets) {
        startRestPhase(currentSet);
      } else {
        completeSession();
      }
    } else if (currentMode === "rest") {
      const nextS = currentSet + 1;
      speak(`跳过休息，进入第 ${nextS} 组`);
      startWorkoutPhase(nextS);
    }
  };

  const startWorkoutPhase = (setNum: number) => {
    clearActiveTimer();
    setCurrentMode("work");
    setCurrentSet(setNum);
    setTimeLeft(workDuration);
    setPhaseTotalDuration(workDuration);
    setIsTimerRunning(true);
    speak(`开始第 ${setNum} 组，运动 ${workDuration} 秒`);
    lastTickRef.current = Date.now();
  };

  const startRestPhase = (finishedSet: number) => {
    clearActiveTimer();
    setCurrentMode("rest");
    setCurrentSet(finishedSet);
    setTimeLeft(restDuration);
    setPhaseTotalDuration(restDuration);
    setIsTimerRunning(true);
    speak(`休息 ${restDuration} 秒`);
    lastTickRef.current = Date.now();
  };

  const startPreparePhase = () => {
    clearActiveTimer();
    setCurrentMode("prepare");
    setCurrentSet(1);
    setTimeLeft(prepDuration);
    setPhaseTotalDuration(prepDuration);
    setIsTimerRunning(true);
    speak(`准备，五秒倒计时`);
    lastTickRef.current = Date.now();
  };

  const completeSession = () => {
    clearActiveTimer();
    setCurrentMode("completed");
    setIsTimerRunning(false);
    speak(`锻炼完成！共完成 ${totalSets} 组，累计总时长 ${formatMinutesAndSeconds(sessionTotalTime)}。太棒了！`);

    // Log workout
    const log: WorkoutLog = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }),
      presetName: selectedPreset,
      setsCompleted: totalSets,
      totalSets: totalSets,
      totalDuration: sessionTotalTime
    };

    setHistoryLogs((prev) => [log, ...prev]);
  };

  const triggerStart = () => {
    initAudioContext();
    if (currentMode === "idle" || currentMode === "completed") {
      setSessionTotalTime(0);
      startPreparePhase();
    } else {
      setIsTimerRunning(true);
      lastTickRef.current = Date.now();
    }
  };

  const triggerPause = () => {
    setIsTimerRunning(false);
    clearActiveTimer();
  };

  const triggerReset = () => {
    clearActiveTimer();
    setCurrentMode("idle");
    setCurrentSet(1);
    setTimeLeft(0);
    setPhaseTotalDuration(0);
    setIsTimerRunning(false);
    setSessionTotalTime(0);
  };

  // Absolute drift-free system-elapsed timer loop
  useEffect(() => {
    if (!isTimerRunning) {
      clearActiveTimer();
      return;
    }

    lastTickRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsedMs = now - lastTickRef.current;

      if (elapsedMs >= 1000) {
        const secondsToSub = Math.floor(elapsedMs / 1000);
        lastTickRef.current = now - (elapsedMs % 1000);

        setSessionTotalTime((prev) => prev + secondsToSub);

        setTimeLeft((prevVal) => {
          const newVal = Math.max(0, prevVal - secondsToSub);

          // Audio triggers for critical countdown alert ticks
          if (newVal > 0 && newVal <= 3) {
            playBeep(880, 0.08, "sine");
            speak(newVal.toString());
          }

          if (newVal === 0) {
            playBeep(1440, 0.25, "sine"); // Double pitch cue for state change
            clearActiveTimer();

            setTimeout(() => {
              if (currentMode === "prepare") {
                startWorkoutPhase(1);
              } else if (currentMode === "work") {
                if (currentSet < totalSets) {
                  startRestPhase(currentSet);
                } else {
                  completeSession();
                }
              } else if (currentMode === "rest") {
                startWorkoutPhase(currentSet + 1);
              }
            }, 120);
          }

          return newVal;
        });
      }
    }, 100);

    return () => clearActiveTimer();
  }, [isTimerRunning, currentMode, currentSet, workDuration, restDuration, totalSets]);

  // Handle Preset Click
  const applyPreset = (preset: WorkoutPreset) => {
    if (isTimerRunning || currentMode !== "idle") {
      if (!confirm("这将会重置当前的计时进度。是否应用预设？")) return;
    }
    triggerReset();
    setWorkDuration(preset.workDuration);
    setRestDuration(preset.restDuration);
    setTotalSets(preset.totalSets);
    setSelectedPreset(preset.name);
  };

  // Value formatting utilities
  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const formatMinutesAndSeconds = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return sec === 0 ? `${min}分钟` : `${min}分${sec}秒`;
  };

  const handleCustomDurationChange = (type: "work" | "rest" | "sets", increment: boolean) => {
    setSelectedPreset("自定义");
    if (type === "work") {
      setWorkDuration((prev) => Math.max(5, prev + (increment ? 5 : -5)));
    } else if (type === "rest") {
      setRestDuration((prev) => Math.max(5, prev + (increment ? 5 : -5)));
    } else {
      setTotalSets((prev) => Math.max(1, prev + (increment ? 1 : -1)));
    }
  };

  const deleteLog = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistoryLogs((prev) => prev.filter((log) => log.id !== id));
  };

  const clearAllLogs = () => {
    if (confirm("确定要删除所有的锻炼历史记录吗？")) {
      setHistoryLogs([]);
    }
  };

  // Apple-grade Color/Style mappings based on state
  const getAppleThemeStyles = () => {
    switch (currentMode) {
      case "prepare":
        return {
          bg: "bg-[#007AFF]/5 text-[#007AFF] border-[#007AFF]/10",
          accentColor: "text-[#007AFF] bg-[#007AFF]/10",
          ringColor: "text-[#007AFF]",
          badgeColor: "bg-[#007AFF] text-white",
          labelText: "准备开始",
          trackColor: "stroke-[#007AFF]/10",
          themeTint: "#007AFF"
        };
      case "work":
        return {
          bg: "bg-[#FF9500]/5 text-[#FF9500] border-[#FF9500]/10",
          accentColor: "text-[#FF9500] bg-[#FF9500]/10",
          ringColor: "text-[#FF9500]",
          badgeColor: "bg-[#FF9500] text-white",
          labelText: "正在运动",
          trackColor: "stroke-[#FF9500]/10",
          themeTint: "#FF9500"
        };
      case "rest":
        return {
          bg: "bg-[#34C759]/5 text-[#34C759] border-[#34C759]/10",
          accentColor: "text-[#34C759] bg-[#34C759]/10",
          ringColor: "text-[#34C759]",
          badgeColor: "bg-[#34C759] text-white",
          labelText: "呼吸休息",
          trackColor: "stroke-[#34C759]/10",
          themeTint: "#34C759"
        };
      case "completed":
        return {
          bg: "bg-[#FF2D55]/5 text-[#FF2D55] border-[#FF2D55]/10",
          accentColor: "text-[#FF2D55] bg-[#FF2D55]/10",
          ringColor: "text-[#FF2D55]",
          badgeColor: "bg-[#FF2D55] text-white",
          labelText: "训练圆满完成",
          trackColor: "stroke-[#FF2D55]/10",
          themeTint: "#FF2D55"
        };
      default:
        return {
          bg: "bg-slate-50 text-slate-800 border-slate-100",
          accentColor: "text-slate-500 bg-slate-100",
          ringColor: "text-[#007AFF]",
          badgeColor: "bg-slate-600 text-white",
          labelText: "待机准备",
          trackColor: "stroke-slate-100",
          themeTint: "#007AFF"
        };
    }
  };

  const appleStyle = getAppleThemeStyles();
  const progressPercentage = phaseTotalDuration > 0 ? (timeLeft / phaseTotalDuration) * 100 : 0;
  
  // Clean mathematical stroke calculations
  const strokeRadius = 88;
  const strokeCircumference = 2 * Math.PI * strokeRadius;
  const strokeDashoffset = strokeCircumference * (1 - progressPercentage / 100);

  return (
    <div className="min-h-screen bg-[#F2F2F7] flex flex-col items-center justify-between font-sans text-[#1C1C1E] antialiased">
      
      {/* 1. iOS APP BAR */}
      <header className="w-full max-w-4xl px-5 pt-7 pb-4 flex items-center justify-between border-b border-[#E5E5EA]/70 bg-[#F2F2F7]">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-[12px] bg-[#007AFF] flex items-center justify-center text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)]">
            <Flame className="h-5.5 w-5.5" strokeWidth={2} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-[#8E8E93] tracking-widest uppercase block">FITNESS TIMER</span>
            <h1 className="text-xl font-extrabold text-[#1C1C1E] tracking-tight -mt-0.5" id="header-app-name">
              简约锻炼计时器
            </h1>
          </div>
        </div>

        {/* Dynamic iOS controls */}
        <div className="flex items-center gap-2">
          {/* Audio volume toggler */}
          <button
            onClick={() => {
              const newVal = !voiceEnabled;
              setVoiceEnabled(newVal);
              speak(newVal ? "语音开启" : "");
            }}
            className={`h-10 w-10 rounded-full flex items-center justify-center border transition-all duration-250 ${
              voiceEnabled
                ? "bg-white text-[#34C759] border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                : "bg-white/50 text-[#8E8E93] border-transparent"
            }`}
            title={voiceEnabled ? "禁用语音播报" : "开启语音播报"}
            id="tts-audio-switch"
          >
            {voiceEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          {/* iOS mic status controller */}
          <button
            onClick={() => setVoiceControlEnabled(!voiceControlEnabled)}
            className={`h-10 px-4 rounded-full flex items-center gap-2 border transition-all duration-250 ${
              voiceControlEnabled
                ? "bg-[#007AFF] text-white border-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.25)]"
                : "bg-white text-[#1C1C1E] border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            }`}
            id="asr-microphone-switch"
          >
            {voiceControlEnabled ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span className="text-xs font-bold tracking-tight">智能指令开</span>
              </>
            ) : (
              <>
                <Mic className="h-4.5 w-4.5 text-[#007AFF]" />
                <span className="text-xs font-semibold text-[#1C1C1E] tracking-tight">语音控制</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 2. IFRAME MICROPHONE ACCESS GUIDES & VOICE RECOGNITION LIVE TRANSLATOR */}
      <div className="w-full max-w-4xl px-5 mt-4">
        {/* If user is using sandboxed preview iframe, show helpful warning to open in tab */}
        {isSpeechBlockedInIFrame && (
          <div className="bg-white border border-[#FF9500]/20 rounded-[20px] p-4 shadow-[0_4px_16px_rgba(0,0,0,0.02)] mb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative pr-10 sm:pr-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#FF9500]/10 rounded-xl text-[#FF9500] shrink-0 mt-0.5">
                <Info className="h-4.5 w-4.5" />
              </div>
              <div className="text-xs text-[#2C2C2E] leading-relaxed">
                <strong className="text-[#FF9500] font-bold block mb-0.5">浏览器沙盒安全提示：</strong>
                锻炼APP处于预览框架中，麦克风录音权限可能会被浏览器限制。建议点击右侧按钮在新窗口独立运行，即可完美享受免提语音指令控制！
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-xl bg-[#007AFF] hover:bg-[#0072E3] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition-all shadow-[0_3px_8px_rgba(0,122,255,0.2)]"
                id="new-window-link"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>新窗口完美运行</span>
              </a>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem("dismissed_sandbox_warning", "true");
                  } catch (e) {}
                  setIsSpeechBlockedInIFrame(false);
                }}
                className="p-1.5 hover:bg-[#F2F2F7] rounded-lg text-[#8E8E93] hover:text-[#1C1C1E] transition-colors"
                title="不再提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Real-time Voice Translator Bubble resembling iOS Siri Dictation */}
        {voiceControlEnabled && (
          <div className="bg-white border border-[#E5E5EA] rounded-[22px] p-4 shadow-[0_4px_16px_rgba(0,0,0,0.03)] mb-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 items-center justify-center">
                  <span className="w-0.75 h-4 bg-[#007AFF] rounded-full animate-[pulse_1s_infinite_100ms]" />
                  <span className="w-0.75 h-6 bg-[#34C759] rounded-full animate-[pulse_1s_infinite_300ms]" />
                  <span className="w-0.75 h-5 bg-[#FF9500] rounded-full animate-[pulse_1s_infinite_200ms]" />
                  <span className="w-0.75 h-3 bg-[#FF2D55] rounded-full animate-[pulse_1s_infinite_400ms]" />
                </div>
                <span className="text-xs font-bold text-[#1C1C1E]">
                  Siri 式极速语音聆听中...
                </span>
              </div>
              <button
                onClick={() => setShowVoiceGuide(!showVoiceGuide)}
                className="text-[11px] font-bold text-[#007AFF] hover:underline"
              >
                {showVoiceGuide ? "收起口令指南" : "查看全部口令"}
              </button>
            </div>

            {/* Display parsed transcript dynamically */}
            <div className="bg-[#F2F2F7] rounded-[14px] p-3 flex items-center justify-between gap-3 border border-[#E5E5EA]/50">
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare className="h-3.5 w-3.5 text-[#8E8E93] shrink-0" />
                <span className="text-xs font-medium text-[#2C2C2E] truncate font-mono">
                  {lastRecognizedCommand ? (
                    <>
                      刚才听到: <strong className="text-[#007AFF] font-bold">&quot;{lastRecognizedCommand}&quot;</strong>
                    </>
                  ) : (
                    <span className="text-[#8E8E93] italic">随时说 “准备好了” 或 “开始” </span>
                  )}
                </span>
              </div>

              {/* Status flag */}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white text-[#8E8E93] border border-[#E5E5EA] shrink-0">
                {recognitionStatus === "listening" ? "在线" : "就绪"}
              </span>
            </div>

            {/* Direct voice simulation testing tray (Incredibly useful for test validations) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#F2F2F7]">
              <span className="text-[10px] font-bold text-[#8E8E93] mr-1">快捷测试：</span>
              <button
                onClick={() => simulateCommand("准备好了")}
                className="px-2 py-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1C1C1E] text-[10px] font-bold rounded-lg transition-colors border border-[#E5E5EA]"
              >
                模拟: &quot;准备好了&quot;
              </button>
              <button
                onClick={() => simulateCommand("开始")}
                className="px-2 py-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1C1C1E] text-[10px] font-bold rounded-lg transition-colors border border-[#E5E5EA]"
              >
                模拟: &quot;开始&quot;
              </button>
              <button
                onClick={() => simulateCommand("暂停")}
                className="px-2 py-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1C1C1E] text-[10px] font-bold rounded-lg transition-colors border border-[#E5E5EA]"
              >
                模拟: &quot;暂停&quot;
              </button>
              <button
                onClick={() => simulateCommand("下一组")}
                className="px-2 py-1 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1C1C1E] text-[10px] font-bold rounded-lg transition-colors border border-[#E5E5EA]"
              >
                模拟: &quot;下一组&quot;
              </button>
            </div>

            {/* Detailed Voice Commands Quick Guide */}
            {showVoiceGuide && (
              <div className="mt-1 bg-[#F2F2F7] rounded-[16px] p-3.5 border border-[#E5E5EA] text-xs">
                <div className="font-bold text-[#1C1C1E] mb-2 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-[#FFD60A] fill-[#FFD60A]" />
                  口令字典清单
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white p-2 rounded-xl border border-[#E5E5EA]">
                    <span className="font-bold text-[#FF9500] block mb-0.5">1. 状态准备</span>
                    <span className="text-[#8E8E93]">“准备好了” / “准备”</span>
                  </div>
                  <div className="bg-white p-2 rounded-xl border border-[#E5E5EA]">
                    <span className="font-bold text-[#34C759] block mb-0.5">2. 开启运行</span>
                    <span className="text-[#8E8E93]">“开始” / “走起” / “Go”</span>
                  </div>
                  <div className="bg-white p-2 rounded-xl border border-[#E5E5EA]">
                    <span className="font-bold text-[#FF3B30] block mb-0.5">3. 紧急挂起</span>
                    <span className="text-[#8E8E93]">“暂停” / “等一下” / “停”</span>
                  </div>
                  <div className="bg-white p-2 rounded-xl border border-[#E5E5EA]">
                    <span className="font-bold text-[#007AFF] block mb-0.5">4. 提前跨组</span>
                    <span className="text-[#8E8E93]">“下一组” / “搞定” / “跳过”</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. MAIN WORKOUT CONTAINER */}
      <main className="w-full max-w-4xl px-5 flex-1 flex flex-col lg:flex-row gap-6 items-center lg:items-stretch justify-center py-4">
        
        {/* LEFT COMPONENT: INTUITIVE CIRCULAR iOS TIMER STAGE */}
        <div className="flex-1 w-full flex flex-col justify-center items-center">
          <div className="w-full max-w-md bg-white border border-[#E5E5EA]/60 rounded-[32px] p-6 sm:p-8 flex flex-col items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.03)] relative overflow-hidden" id="apple-timer-card">
            
            {/* Soft Ambient Radial Background mapping */}
            <div
              className="absolute top-0 left-0 right-0 h-40 opacity-[0.06] transition-all duration-500 pointer-events-none"
              style={{ backgroundImage: `linear-gradient(to bottom, ${appleStyle.themeTint}, transparent)` }}
            />

            {/* Apple Styled Mini Header on card */}
            <div className="w-full flex justify-between items-center mb-6">
              <span className="text-[11px] font-bold text-[#8E8E93] tracking-wider uppercase">
                {selectedPreset}
              </span>
              
              <div className="flex gap-1.5">
                {currentMode !== "idle" && (
                  <span className={`text-[10px] font-bold tracking-tight px-2.5 py-1 rounded-full ${appleStyle.badgeColor} shadow-sm transition-all duration-300`}>
                    {appleStyle.labelText}
                  </span>
                )}
              </div>
            </div>

            {/* Active set visual info */}
            <div className="text-center mb-2">
              {currentMode === "idle" ? (
                <span className="text-xs font-semibold text-[#8E8E93] uppercase tracking-widest">
                  准备妥当，即可开始
                </span>
              ) : currentMode === "completed" ? (
                <div className="flex flex-col items-center gap-1">
                  <Award className="h-9 w-9 text-[#FF2D55] animate-bounce" />
                  <span className="text-sm font-extrabold text-[#FF2D55] tracking-tight">运动圆满搞定！</span>
                </div>
              ) : (
                <div className="text-xs font-bold text-[#8E8E93] uppercase tracking-widest">
                  第 <span className="text-3xl font-black text-[#1C1C1E] font-mono px-1.5 align-middle">{currentSet}</span> / {totalSets} 组
                </div>
              )}
            </div>

            {/* APPLE STYLE MINIMALIST CIRCLE INDICATOR */}
            <div className="relative my-4 flex items-center justify-center">
              <svg className="w-56 h-56 sm:w-64 sm:h-64 transform -rotate-90">
                {/* Thin, pristine tracking background ring */}
                <circle
                  cx="112"
                  cy="112"
                  r={strokeRadius}
                  className="stroke-[#E5E5EA] fill-transparent"
                  strokeWidth="4"
                  style={{ cx: "50%", cy: "50%" }}
                />
                
                {/* Responsive dynamic colored ring */}
                {currentMode !== "idle" && currentMode !== "completed" && (
                  <circle
                    cx="112"
                    cy="112"
                    r={strokeRadius}
                    className={`fill-transparent ${appleStyle.ringColor} transition-all duration-300`}
                    strokeWidth="6"
                    strokeDasharray={strokeCircumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{ cx: "50%", cy: "50%" }}
                  />
                )}
              </svg>

              {/* Large, beautiful display typography */}
              <div className="absolute flex flex-col items-center justify-center text-center">
                {currentMode === "idle" ? (
                  <div className="flex flex-col items-center">
                    <span className="text-5xl font-black text-[#1C1C1E] tracking-tighter">就绪</span>
                    <span className="text-[10px] text-[#8E8E93] mt-2 font-bold tracking-wider uppercase">READY TO GO</span>
                  </div>
                ) : currentMode === "completed" ? (
                  <div className="flex flex-col items-center px-4">
                    <span className="text-2xl font-black text-[#FF2D55]">完成</span>
                    <span className="text-[10px] text-[#8E8E93] mt-1 font-bold tracking-wider uppercase">COMPLETED</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {/* iOS Mono Digit display to avoid width jitter */}
                    <span className="text-6xl sm:text-7xl font-extrabold tracking-tighter text-[#1C1C1E] font-mono">
                      {timeLeft}
                    </span>
                    <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-widest mt-2">
                      {currentMode === "work" ? "SEC WORK" : currentMode === "rest" ? "SEC REST" : "SEC PREP"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Apple Stat Display Grid */}
            <div className="w-full grid grid-cols-2 gap-4 border-t border-[#F2F2F7] pt-4 mt-2">
              <div className="text-center">
                <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block mb-0.5">累计总用时</span>
                <span className="text-lg font-bold text-[#1C1C1E] font-mono" id="apple-total-duration">
                  {formatTime(sessionTotalTime)}
                </span>
              </div>
              <div className="text-center border-l border-[#F2F2F7]">
                <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block mb-0.5">计划总组数</span>
                <span className="text-lg font-bold text-[#1C1C1E]" id="apple-total-sets">
                  {totalSets} 组
                </span>
              </div>
            </div>

            {/* iOS SYMMETRIC ACTION CONTROL TRADITIONAL TRAY */}
            <div className="w-full flex items-center justify-center gap-4 mt-7">
              {/* Reset Stepper Button */}
              <button
                onClick={triggerReset}
                disabled={currentMode === "idle"}
                className={`h-12 w-12 rounded-full border flex items-center justify-center transition-all duration-200 ${
                  currentMode === "idle"
                    ? "bg-[#F2F2F7] text-[#D1D1D6] border-transparent cursor-not-allowed"
                    : "bg-white text-[#1C1C1E] border-[#E5E5EA] hover:bg-[#F2F2F7] active:scale-95 shadow-sm"
                }`}
                title="重新开始"
                id="apple-reset-btn"
              >
                <RotateCcw className="h-5 w-5" />
              </button>

              {/* iOS Large Action Button */}
              <button
                onClick={isTimerRunning ? triggerPause : triggerStart}
                className={`flex-1 max-w-[200px] h-14 rounded-full text-white font-extrabold flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 shadow-md ${
                  isTimerRunning
                    ? "bg-[#1C1C1E] hover:bg-[#2C2C2E] shadow-[0_4px_16px_rgba(28,28,30,0.15)]"
                    : "bg-[#007AFF] hover:bg-[#0072E3] shadow-[0_4px_16px_rgba(0,122,255,0.25)]"
                }`}
                id="apple-play-btn"
              >
                {isTimerRunning ? (
                  <>
                    <Pause className="h-4.5 w-4.5 fill-white" />
                    <span className="tracking-tight">暂停计时</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4.5 w-4.5 fill-white" />
                    <span className="tracking-tight">
                      {currentMode === "completed" ? "再次开启" : currentMode === "idle" ? "开始锻炼" : "继续"}
                    </span>
                  </>
                )}
              </button>

              {/* Skip Stepper Button */}
              <button
                onClick={triggerSkip}
                disabled={currentMode === "idle" || currentMode === "completed"}
                className={`h-12 w-12 rounded-full border flex items-center justify-center transition-all duration-200 ${
                  currentMode === "idle" || currentMode === "completed"
                    ? "bg-[#F2F2F7] text-[#D1D1D6] border-transparent cursor-not-allowed"
                    : "bg-white text-[#1C1C1E] border-[#E5E5EA] hover:bg-[#F2F2F7] active:scale-95 shadow-sm"
                }`}
                title="跳过本节"
                id="apple-skip-btn"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

          </div>
        </div>

        {/* RIGHT COMPONENT: iOS CONFIGURATION CARD & PRESETS */}
        <div className="flex-1 w-full max-w-md flex flex-col gap-5 justify-between">
          
          <div className="bg-white border border-[#E5E5EA]/60 rounded-[32px] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.03)] flex flex-col">
            
            {/* Apple Styled Segmented Tab Switcher */}
            <div className="bg-[#F2F2F7] p-1 rounded-xl flex items-center justify-between mb-5 relative">
              <button
                onClick={() => {
                  setShowHistory(false);
                  setActiveTab("presets");
                }}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  !showHistory && activeTab === "presets"
                    ? "bg-white text-[#1C1C1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                    : "text-[#8E8E93] hover:text-[#1C1C1E]"
                }`}
                id="apple-tab-presets"
              >
                内置训练
              </button>
              
              <button
                onClick={() => {
                  setShowHistory(false);
                  setActiveTab("custom");
                }}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                  !showHistory && activeTab === "custom"
                    ? "bg-white text-[#1C1C1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                    : "text-[#8E8E93] hover:text-[#1C1C1E]"
                }`}
                id="apple-tab-custom"
              >
                自定义
              </button>

              <button
                onClick={() => {
                  setShowHistory(true);
                  setActiveTab("history");
                }}
                className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
                  showHistory
                    ? "bg-white text-[#1C1C1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                    : "text-[#8E8E93] hover:text-[#1C1C1E]"
                }`}
                id="apple-tab-history"
              >
                <History className="h-3 w-3" />
                历史
              </button>
            </div>

            {/* TAB CONTENTS */}
            {!showHistory ? (
              activeTab === "presets" ? (
                /* iOS STYLE PRESETS CAROUSEL LIST */
                <div className="space-y-3" id="apple-presets-container">
                  <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block">
                    点击直接载入经典配置：
                  </span>
                  <div className="space-y-2.5 max-h-[310px] overflow-y-auto pr-1">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => applyPreset(preset)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between group ${
                          selectedPreset === preset.name
                            ? "bg-[#007AFF]/5 border-[#007AFF]/25 shadow-sm"
                            : "bg-white border-[#E5E5EA]/70 hover:bg-[#F2F2F7]"
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-bold text-sm text-[#1C1C1E] group-hover:text-[#007AFF] transition-colors">
                            {preset.name}
                          </div>
                          <div className="text-[11px] text-[#8E8E93] mt-1 leading-normal line-clamp-1">
                            {preset.description}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[10px] font-bold bg-[#F2F2F7] text-[#1C1C1E] px-2 py-0.5 rounded-md">
                              动作: {preset.workDuration}s
                            </span>
                            <span className="text-[10px] font-bold bg-[#F2F2F7] text-[#1C1C1E] px-2 py-0.5 rounded-md">
                              休息: {preset.restDuration}s
                            </span>
                            <span className="text-[10px] font-bold bg-[#007AFF]/10 text-[#007AFF] px-2 py-0.5 rounded-md">
                              循环: {preset.totalSets}组
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-4.5 w-4.5 text-[#C7C7CC] group-hover:text-[#007AFF] transition-all" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* iOS CUSTOM FORM WORKOUT STEPPERS */
                <div className="space-y-4" id="apple-steppers-container">
                  {/* WORK TIMER SECTION */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block">TRAINING</span>
                        <label className="text-xs font-bold text-[#1C1C1E]">单组运动时间</label>
                      </div>
                      <span className="text-base font-extrabold text-[#007AFF] font-mono">{workDuration}秒</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("work", false)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min="5"
                        max="300"
                        step="5"
                        value={workDuration}
                        onChange={(e) => {
                          setSelectedPreset("自定义");
                          setWorkDuration(parseInt(e.target.value));
                        }}
                        className="flex-1 h-1 bg-[#007AFF]/20 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("work", true)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* REST TIMER SECTION */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block">RECOVERY</span>
                        <label className="text-xs font-bold text-[#1C1C1E]">每组休息时间</label>
                      </div>
                      <span className="text-base font-extrabold text-[#34C759] font-mono">{restDuration}秒</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("rest", false)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min="5"
                        max="300"
                        step="5"
                        value={restDuration}
                        onChange={(e) => {
                          setSelectedPreset("自定义");
                          setRestDuration(parseInt(e.target.value));
                        }}
                        className="flex-1 h-1 bg-[#34C759]/20 rounded-lg appearance-none cursor-pointer accent-[#34C759]"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("rest", true)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* REPETITION SETS SECTION */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block">INTERVAL SETS</span>
                        <label className="text-xs font-bold text-[#1C1C1E]">计划总循环组数</label>
                      </div>
                      <span className="text-base font-extrabold text-[#FF9500] font-mono">{totalSets}组</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("sets", false)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min="1"
                        max="30"
                        step="1"
                        value={totalSets}
                        onChange={(e) => {
                          setSelectedPreset("自定义");
                          setTotalSets(parseInt(e.target.value));
                        }}
                        className="flex-1 h-1 bg-[#FF9500]/20 rounded-lg appearance-none cursor-pointer accent-[#FF9500]"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("sets", true)}
                        className="h-10 w-10 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#1C1C1E] hover:bg-[#F2F2F7] active:scale-90 shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* HISTORY ARCHIVES DISPLAY LIST */
              <div className="space-y-3 max-h-[330px] overflow-y-auto pr-1" id="apple-history-container">
                {historyLogs.length === 0 ? (
                  <div className="text-center py-12 flex flex-col items-center justify-center text-[#8E8E93]">
                    <History className="h-11 w-11 text-[#D1D1D6] stroke-1 mb-2" />
                    <p className="text-xs font-semibold">暂无任何锻炼日志</p>
                    <p className="text-[10px] text-[#AEAEB2] mt-1">今天就开始属于你的第一次挑战吧！</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider">
                        自律轨迹
                      </span>
                      <button
                        onClick={clearAllLogs}
                        className="text-xs text-[#FF3B30] hover:underline flex items-center gap-1 font-bold"
                        id="apple-clear-logs"
                      >
                        <Trash2 className="h-3 w-3 animate-pulse" />
                        清空记录
                      </button>
                    </div>
                    <div className="space-y-2">
                      {historyLogs.map((log) => (
                        <div
                          key={log.id}
                          className="bg-[#F2F2F7]/40 border border-[#E5E5EA]/50 rounded-xl p-3 flex items-center justify-between gap-3 hover:bg-[#F2F2F7]/80 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-xs text-[#1C1C1E] truncate">{log.presetName}</span>
                              <span className="text-[9px] font-bold bg-[#FF2D55]/10 text-[#FF2D55] px-1.5 py-0.5 rounded-full">
                                {log.setsCompleted}组完成
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-[#8E8E93] mt-1 font-mono">
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-3 w-3" />
                                {formatMinutesAndSeconds(log.totalDuration)}
                              </span>
                              <span>•</span>
                              <span>{log.date}</span>
                            </div>
                          </div>
                          
                          <button
                            onClick={(e) => deleteLog(log.id, e)}
                            className="h-8 w-8 rounded-full hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] text-[#AEAEB2] flex items-center justify-center transition-colors shrink-0"
                            title="删除单条"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* MOTIVATIONAL METRIC TRAY */}
          <div className="bg-[#1C1C1E] text-white rounded-[28px] p-4.5 shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex items-start gap-3.5">
            <div className="bg-white/10 p-2.5 rounded-xl text-[#007AFF] shrink-0 mt-0.5">
              <CheckCircle2 className="h-5.5 w-5.5 text-[#30B0C7]" />
            </div>
            <div>
              <h4 className="font-bold text-xs text-[#E5E5EA] tracking-tight">
                HIIT & 力量训练间歇小贴士
              </h4>
              <p className="text-[11px] text-[#AEAEB2] mt-1.5 leading-relaxed">
                研究表明：当保持高度的运动与休息循环节律时，心肺耐力激活最充分。双手被占领时，请不要害羞，直接说“下一组”或“暂停”来掌控您的每一次自律突破！
              </p>
            </div>
          </div>

        </div>
      </main>

      {/* 4. iOS COMPACT FOOTER */}
      <footer className="w-full text-center py-5 border-t border-[#E5E5EA]/60 text-[#8E8E93] text-[10px] font-bold tracking-wider uppercase bg-[#F2F2F7]">
        简约锻炼计时器 • 设计源自加州苹果美学 • 2026
      </footer>
    </div>
  );
}
