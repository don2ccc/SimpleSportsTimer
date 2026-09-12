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
  const [sessionTotalTime, setSessionTotalTime] = useState<number>(0); // active seconds

  // Settings & Toggles
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
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
  const isSpeakingRef = useRef<boolean>(false);
  const lastCommandTimeRef = useRef<number>(0); // Refractory period tracker

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

      // Temporarily halt speech recognition on iOS/Safari so they don't block each other
      if (recognitionRef.current && voiceControlEnabled) {
        try {
          recognitionRef.current.abort(); // Clear current session
        } catch (e) {}
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1.1; // iOS athletic dynamic pace
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const resumeASR = () => {
        speechActiveRef.current = false;
        isSpeakingRef.current = false;
        // Delayed restart to avoid catching the trailing echo of TTS audio
        setTimeout(() => {
          if (shouldListenRef.current && voiceControlEnabled && !isSpeakingRef.current) {
            try {
              recognitionRef.current?.start();
            } catch (err) {
              // Already running
            }
          }
        }, 400);
      };

      utterance.onstart = () => {
        speechActiveRef.current = true;
        isSpeakingRef.current = true;
      };
      utterance.onend = () => {
        resumeASR();
      };
      utterance.onerror = () => {
        resumeASR();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech Synthesis Error:", e);
      isSpeakingRef.current = false;
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
      
      // Detection: iOS/Safari is historically unstable with "continuous = true"
      // Setting continuous to false on mobile simulates continuous via our onend auto-restart loop!
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      rec.continuous = !isMobile;
      rec.interimResults = true;
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
        }
      };

      rec.onend = () => {
        // If system is speaking via TTS, don't restart here (let the TTS onend handle the restart)
        if (shouldListenRef.current && voiceControlEnabled && !isSpeakingRef.current) {
          setTimeout(() => {
            try {
              if (shouldListenRef.current && voiceControlEnabled && !isSpeakingRef.current) {
                recognitionRef.current?.start();
              }
            } catch (err) {
              // Already listening or suppressed
            }
          }, 350); // Small cooldown allows physical device microphone hardware to reset cleanly
        } else if (!voiceControlEnabled) {
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
    // 1.2s refractory period
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

  // Simulate command utility
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
            playBeep(1440, 0.25, "sine");
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
          labelText: "充分休息",
          trackColor: "stroke-[#34C759]/10",
          themeTint: "#34C759"
        };
      case "completed":
        return {
          bg: "bg-[#FF2D55]/5 text-[#FF2D55] border-[#FF2D55]/10",
          accentColor: "text-[#FF2D55] bg-[#FF2D55]/10",
          ringColor: "text-[#FF2D55]",
          badgeColor: "bg-[#FF2D55] text-white",
          labelText: "完美通关",
          trackColor: "stroke-[#FF2D55]/10",
          themeTint: "#FF2D55"
        };
      default:
        return {
          bg: "bg-[#8E8E93]/5 text-[#8E8E93] border-[#8E8E93]/10",
          accentColor: "text-[#8E8E93] bg-[#8E8E93]/10",
          ringColor: "text-[#8E8E93]/30",
          badgeColor: "bg-[#8E8E93] text-white",
          labelText: "自律等待",
          trackColor: "stroke-[#8E8E93]/10",
          themeTint: "#8E8E93"
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
      <header className="w-full max-w-4xl px-4 sm:px-5 pt-5 sm:pt-7 pb-4 flex items-center justify-between border-b border-[#E5E5EA]/70 bg-[#F2F2F7]">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-9 w-9 sm:h-11 sm:w-11 rounded-[12px] bg-[#007AFF] flex items-center justify-center text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] shrink-0">
            <Flame className="h-4.5 w-4.5 sm:h-5.5 sm:w-5.5" strokeWidth={2} />
          </div>
          <div>
            <span className="text-[9px] font-bold text-[#8E8E93] tracking-widest uppercase hidden sm:block">VOICE HIIT TIMER</span>
            <h1 className="text-xl sm:text-2xl font-black text-[#1C1C1E] tracking-tight sm:-mt-1 flex items-center gap-2" id="header-app-name">
              Halo!
              {voiceControlEnabled && (
                <span className="relative flex h-2.5 w-2.5" title="智能语音控制运行中">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34C759] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#34C759]"></span>
                </span>
              )}
            </h1>
          </div>
        </div>

        {/* Dynamic iOS controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Audio volume toggler */}
          <button
            onClick={() => {
              const newVal = !voiceEnabled;
              setVoiceEnabled(newVal);
              speak(newVal ? "语音开启" : "");
            }}
            className={`h-10 w-10 rounded-full flex items-center justify-center border transition-all duration-250 shrink-0 ${
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
            className={`h-10 w-10 sm:w-auto sm:px-3.5 rounded-full flex items-center justify-center sm:gap-2 border transition-all duration-250 shrink-0 bg-white text-[#1C1C1E] border-[#E5E5EA] shadow-[0_2px_8px_rgba(0,0,0,0.04)]`}
            id="asr-microphone-switch"
            title={voiceControlEnabled ? "关闭语音控制" : "开启语音控制"}
          >
            {voiceControlEnabled ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34C759] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#34C759]"></span>
                </span>
                <span className="text-xs font-bold text-[#1C1C1E] tracking-tight hidden sm:inline whitespace-nowrap">智能口令开</span>
              </>
            ) : (
              <>
                <Mic className="h-4.5 w-4.5 text-[#007AFF] shrink-0" />
                <span className="text-xs font-semibold text-[#1C1C1E] tracking-tight hidden sm:inline whitespace-nowrap">语音控制</span>
              </>
            )}
          </button>

          {/* Config Settings trigger button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="h-10 w-10 sm:w-auto sm:px-4 rounded-full flex items-center justify-center sm:gap-1.5 border bg-white hover:bg-[#F2F2F7] text-[#1C1C1E] border-[#E5E5EA] transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.04)] active:scale-95 font-bold text-xs shrink-0"
            id="open-configuration-btn"
          >
            <Settings className="h-4.5 w-4.5 text-[#007AFF] shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">配置参数</span>
          </button>
        </div>
      </header>

      {/* 2. BODY SECTION (IFRAME MICROPHONE ACCESS GUIDES & VOICE RECOGNITION LIVE TRANSLATOR) */}
      <div className="w-full max-w-4xl px-5 mt-4 flex-1 flex flex-col justify-center items-center">
        
        {/* Sandbox warning */}
        {isSpeechBlockedInIFrame && (
          <div className="w-full max-w-md bg-white border border-[#FF9500]/20 rounded-[20px] p-4 shadow-[0_4px_16px_rgba(0,0,0,0.02)] mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative pr-10 sm:pr-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#FF9500]/10 rounded-xl text-[#FF9500] shrink-0 mt-0.5">
                <Info className="h-4.5 w-4.5" />
              </div>
              <div className="text-xs text-[#2C2C2E] leading-relaxed">
                <strong className="text-[#FF9500] font-bold block mb-0.5">浏览器沙盒安全提示：</strong>
                应用处于预览框架中，麦克风可能会受限。建议在新窗口中运行，完美享受免提语音控制！
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl bg-[#007AFF] hover:bg-[#0072E3] text-white text-[11px] font-bold flex items-center gap-1 shrink-0 transition-all shadow-[0_3px_8px_rgba(0,122,255,0.2)]"
                id="new-window-link"
              >
                <ExternalLink className="h-3 w-3" />
                <span>运行</span>
              </a>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem("dismissed_sandbox_warning", "true");
                  } catch (e) {}
                  setIsSpeechBlockedInIFrame(false);
                }}
                className="p-1 hover:bg-[#F2F2F7] rounded-lg text-[#8E8E93] hover:text-[#1C1C1E] transition-colors"
                title="不再提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Real-time Voice feedback replaced by ambient indicators */}

        {/* 3. MAIN WORKOUT CENTRAL STAGE */}
        <div className="w-full max-w-md flex flex-col justify-center items-center py-2" id="halo-timer-stage">
          <div className="w-full bg-white border border-[#E5E5EA]/60 rounded-[36px] p-7 sm:p-9 flex flex-col items-center justify-center shadow-[0_12px_40px_rgba(0,0,0,0.04)] relative overflow-hidden" id="apple-timer-card">
            
            {/* Soft Ambient Radial Background mapping */}
            <div
              className="absolute top-0 left-0 right-0 h-44 opacity-[0.06] transition-all duration-500 pointer-events-none"
              style={{ backgroundImage: `linear-gradient(to bottom, ${appleStyle.themeTint}, transparent)` }}
            />

            {/* Apple Styled Mini Header on card */}
            <div className="w-full flex justify-between items-center mb-6">
              <span className="text-xs font-extrabold text-[#8E8E93] tracking-widest uppercase">
                {selectedPreset}
              </span>
              
              <div className="flex gap-1.5">
                {currentMode !== "idle" && (
                  <span className={`text-[10px] font-bold tracking-widest px-3 py-1 rounded-full ${appleStyle.badgeColor} shadow-sm transition-all duration-300 uppercase`}>
                    {appleStyle.labelText}
                  </span>
                )}
              </div>
            </div>

            {/* Active set visual info */}
            <div className="text-center mb-2">
              {currentMode === "idle" ? (
                <span className="text-xs font-bold text-[#8E8E93] uppercase tracking-widest">
                  开启全新自律循环
                </span>
              ) : currentMode === "completed" ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs font-bold text-[#FF2D55] uppercase tracking-widest flex items-center gap-1">
                    <Award className="h-4 w-4 animate-bounce" />
                    恭喜，本次循环已完美通关！
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-xs font-black text-[#1C1C1E] bg-[#F2F2F7] px-3 py-1 rounded-full border border-[#E5E5EA]/40">
                    第 {currentSet} 组 / 共 {totalSets} 组
                  </span>
                </div>
              )}
            </div>

            {/* Main Interactive Apple Timer Ring Canvas */}
            <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center my-4" id="ring-container">
              
              {/* Outer static grey ring track */}
              <svg className="absolute w-full h-full transform -rotate-90">
                <circle
                  cx="128"
                  cy="128"
                  r={strokeRadius}
                  className="stroke-[#E5E5EA]/40 fill-transparent"
                  strokeWidth="6"
                  style={{ cx: "50%", cy: "50%" }}
                />
                
                {/* Active Dynamic Progress Ring */}
                {isTimerRunning && (
                  <circle
                    cx="128"
                    cy="128"
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
                    <span className="text-6xl font-black text-[#1C1C1E] tracking-tighter">Halo</span>
                    <span className="text-[10px] text-[#8E8E93] mt-2 font-bold tracking-wider uppercase">READY FOR ACTION</span>
                  </div>
                ) : currentMode === "completed" ? (
                  <div className="flex flex-col items-center px-4 animate-pulse">
                    <span className="text-3xl font-black text-[#34C759]">OVER</span>
                    <span className="text-[10px] text-[#8E8E93] mt-1.5 font-bold tracking-wider uppercase">ALL SETS DONE</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {/* iOS Mono Digit display to avoid width jitter */}
                    <span className="text-7xl sm:text-8xl font-extrabold tracking-tighter text-[#1C1C1E] font-mono">
                      {timeLeft}
                    </span>
                    <span className="text-[11px] font-bold text-[#8E8E93] uppercase tracking-widest mt-2">
                      {currentMode === "work" ? "SEC WORK" : currentMode === "rest" ? "SEC REST" : "SEC PREP"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Apple Stat Display Grid */}
            <div className="w-full grid grid-cols-2 gap-4 border-t border-[#F2F2F7] pt-5 mt-3">
              <div className="text-center">
                <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block mb-0.5">累计总用时</span>
                <span className="text-xl font-black text-[#1C1C1E] font-mono" id="apple-total-duration">
                  {formatTime(sessionTotalTime)}
                </span>
              </div>
              <div className="text-center border-l border-[#F2F2F7]">
                <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block mb-0.5">计划总组数</span>
                <span className="text-xl font-black text-[#1C1C1E]" id="apple-total-sets">
                  {totalSets} 组
                </span>
              </div>
            </div>

            {/* iOS SYMMETRIC ACTION CONTROL TRADITIONAL TRAY */}
            <div className="w-full flex items-center justify-center gap-4 mt-8">
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

      </div>

      {/* 4. iOS SLIDE-OVER BOTTOM SHEET / MODAL FOR CONFIGURATION & DATA */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          
          {/* Backdrop Blur Overlay */}
          <div 
            className="fixed inset-0 bg-black/45 backdrop-blur-md transition-opacity duration-300"
            onClick={() => setIsSettingsOpen(false)}
          />

          {/* Bottom Sheet Card */}
          <div 
            className="relative w-full max-w-xl bg-white rounded-t-[32px] shadow-[0_-12px_40px_rgba(0,0,0,0.12)] border-t border-[#E5E5EA] flex flex-col max-h-[88vh] z-50 overflow-hidden"
            id="halo-configuration-sheet"
          >
            {/* Sheet Handle Accent */}
            <div className="w-12 h-1.5 bg-[#E5E5EA] rounded-full mx-auto my-3 shrink-0" />

            {/* Header block with close */}
            <div className="px-6 pb-4 flex items-center justify-between border-b border-[#F2F2F7]">
              <div>
                <h3 className="text-lg font-black text-[#1C1C1E]">
                  Halo! 参数与自律轨迹
                </h3>
                <p className="text-[11px] text-[#8E8E93] mt-0.5 font-medium">
                  个性化定制您的高强度锻炼与语音指令方案
                </p>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="h-9 w-9 rounded-full bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#8E8E93] hover:text-[#1C1C1E] flex items-center justify-center transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Apple Styled Segmented Tab Switcher */}
            <div className="px-6 py-4 bg-white shrink-0">
              <div className="bg-[#F2F2F7] p-1 rounded-xl flex items-center justify-between relative">
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
                  内置预设
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
                  高级自定义
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
                  <History className="h-3.5 w-3.5" />
                  自律历史
                </button>
              </div>
            </div>

            {/* Inner Content Area - Scrollable */}
            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
              
              {/* Presets Grid */}
              {!showHistory && activeTab === "presets" && (
                <div className="space-y-3" id="apple-presets-container">
                  <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider block">
                    选择一套适合您的经典运动节奏：
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => {
                          applyPreset(preset);
                          setIsSettingsOpen(false); // Close modal on preset load
                        }}
                        className={`text-left p-4 rounded-2xl border transition-all duration-200 flex items-center justify-between group ${
                          selectedPreset === preset.name
                            ? "bg-[#007AFF]/5 border-[#007AFF]/25 shadow-sm"
                            : "bg-white border-[#E5E5EA]/70 hover:bg-[#F2F2F7]"
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-extrabold text-sm text-[#1C1C1E] group-hover:text-[#007AFF] transition-colors">
                            {preset.name}
                          </div>
                          <div className="text-[11px] text-[#8E8E93] mt-1 leading-normal line-clamp-2">
                            {preset.description}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-3">
                            <span className="text-[9px] font-extrabold bg-[#F2F2F7] text-[#1C1C1E] px-1.5 py-0.5 rounded">
                              动作: {preset.workDuration}s
                            </span>
                            <span className="text-[9px] font-extrabold bg-[#F2F2F7] text-[#1C1C1E] px-1.5 py-0.5 rounded">
                              休息: {preset.restDuration}s
                            </span>
                            <span className="text-[9px] font-extrabold bg-[#007AFF]/10 text-[#007AFF] px-1.5 py-0.5 rounded">
                              {preset.totalSets}组
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-4.5 w-4.5 text-[#C7C7CC] group-hover:text-[#007AFF] transition-all shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom sliders adjusters */}
              {!showHistory && activeTab === "custom" && (
                <div className="space-y-5" id="apple-custom-panel">
                  {/* Card 1: Work duration slider */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-[#1C1C1E] tracking-tight">
                        单组运动时长 (Work)
                      </span>
                      <span className="text-sm font-extrabold text-[#007AFF] font-mono">
                        {workDuration} 秒
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("work", false)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min="5"
                        max="180"
                        step="5"
                        value={workDuration}
                        onChange={(e) => {
                          setSelectedPreset("自定义");
                          setWorkDuration(parseInt(e.target.value));
                        }}
                        className="flex-1 accent-[#007AFF] h-1.5 rounded-lg appearance-none bg-[#E5E5EA] cursor-pointer"
                        id="work-duration-slider"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("work", true)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card 2: Rest duration slider */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-[#1C1C1E] tracking-tight">
                        单组休息时长 (Rest)
                      </span>
                      <span className="text-sm font-extrabold text-[#34C759] font-mono">
                        {restDuration} 秒
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("rest", false)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min="5"
                        max="180"
                        step="5"
                        value={restDuration}
                        onChange={(e) => {
                          setSelectedPreset("自定义");
                          setRestDuration(parseInt(e.target.value));
                        }}
                        className="flex-1 accent-[#34C759] h-1.5 rounded-lg appearance-none bg-[#E5E5EA] cursor-pointer"
                        id="rest-duration-slider"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("rest", true)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card 3: Total Sets slider */}
                  <div className="bg-[#F2F2F7]/50 rounded-2xl p-4 border border-[#E5E5EA]/40">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-bold text-[#1C1C1E] tracking-tight">
                        计划总轮数组数 (Sets)
                      </span>
                      <span className="text-sm font-extrabold text-[#FF9500] font-mono">
                        {totalSets} 组
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleCustomDurationChange("sets", false)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
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
                        className="flex-1 accent-[#FF9500] h-1.5 rounded-lg appearance-none bg-[#E5E5EA] cursor-pointer"
                        id="sets-slider"
                      />
                      <button
                        onClick={() => handleCustomDurationChange("sets", true)}
                        className="h-8 w-8 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center font-bold text-[#1C1C1E] active:scale-95 transition-all shadow-sm"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* History workout logs */}
              {showHistory && (
                <div className="space-y-3" id="apple-history-container">
                  {historyLogs.length === 0 ? (
                    <div className="text-center py-10 bg-[#F2F2F7]/30 border border-[#E5E5EA]/50 rounded-2xl">
                      <Award className="h-8 w-8 text-[#AEAEB2] mx-auto mb-2 opacity-50" />
                      <p className="text-xs text-[#8E8E93] font-medium">还没有任何锻炼历史记录哦</p>
                      <p className="text-[10px] text-[#AEAEB2] mt-1">完成一次完整的训练轮数后，成果将记入这里！</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-[#8E8E93] uppercase tracking-wider">
                          已记录的自律日志
                        </span>
                        <button
                          onClick={clearAllLogs}
                          className="text-xs text-[#FF3B30] hover:underline flex items-center gap-1 font-bold"
                          id="apple-clear-logs"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          清空记录
                        </button>
                      </div>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
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

              {/* Speech Reference Panel */}
              <div className="border-t border-[#F2F2F7] pt-5">
                <div className="bg-[#1C1C1E] text-white rounded-[20px] p-4 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-[#30B0C7] shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-xs text-[#E5E5EA] tracking-tight">
                        智能免提语音控制指南
                      </h4>
                      <p className="text-[11px] text-[#AEAEB2] mt-1 leading-relaxed">
                        在您大汗淋漓、双手不便触摸屏幕时，开启右上方「语音控制」后，可直接说出以下口令对 Halo! 计时器进行隔空操作：
                      </p>
                    </div>
                  </div>

                  {/* Commands dictionary */}
                  <div className="grid grid-cols-2 gap-2 mt-3.5 text-[10px]">
                    <div className="bg-white/10 p-2 rounded-xl">
                      <span className="font-bold text-[#FF9500] block mb-0.5">状态准备</span>
                      <span className="text-[#AEAEB2]">“准备好了” / “准备”</span>
                    </div>
                    <div className="bg-white/10 p-2 rounded-xl">
                      <span className="font-bold text-[#34C759] block mb-0.5">开启运行</span>
                      <span className="text-[#AEAEB2]">“开始” / “走起”</span>
                    </div>
                    <div className="bg-[#FF3B30]/20 p-2 rounded-xl">
                      <span className="font-bold text-[#FF3B30] block mb-0.5">紧急挂起</span>
                      <span className="text-[#AEAEB2]">“暂停” / “等一下”</span>
                    </div>
                    <div className="bg-[#007AFF]/20 p-2 rounded-xl">
                      <span className="font-bold text-[#007AFF] block mb-0.5">提前跨组</span>
                      <span className="text-[#AEAEB2]">“下一组” / “跳过”</span>
                    </div>
                  </div>

                  {/* Manual trigger panel within setting for swift validation */}
                  <div className="mt-4 pt-3.5 border-t border-white/10">
                    <span className="text-[10px] font-bold text-[#AEAEB2] block mb-2">
                      语音模拟调试按钮（模拟听筒接收）：
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => {
                          simulateCommand("准备好了");
                          setIsSettingsOpen(false); // Close settings for swift feedback
                        }}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[9px] font-bold rounded-lg transition-colors"
                      >
                        模拟: &quot;准备好了&quot;
                      </button>
                      <button
                        onClick={() => {
                          simulateCommand("开始");
                          setIsSettingsOpen(false);
                        }}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[9px] font-bold rounded-lg transition-colors"
                      >
                        模拟: &quot;开始&quot;
                      </button>
                      <button
                        onClick={() => {
                          simulateCommand("暂停");
                        }}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[9px] font-bold rounded-lg transition-colors"
                      >
                        模拟: &quot;暂停&quot;
                      </button>
                      <button
                        onClick={() => {
                          simulateCommand("下一组");
                        }}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white text-[9px] font-bold rounded-lg transition-colors"
                      >
                        模拟: &quot;下一组&quot;
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Bottom Button Panel */}
            <div className="px-6 py-4 bg-[#F2F2F7] border-t border-[#E5E5EA] flex justify-end shrink-0">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-full sm:w-28 py-2.5 rounded-xl bg-[#007AFF] hover:bg-[#0072E3] text-white text-xs font-black transition-all shadow-[0_3px_8px_rgba(0,122,255,0.2)]"
              >
                开始训练
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. iOS COMPACT FOOTER */}
      <footer className="w-full text-center py-5 border-t border-[#E5E5EA]/60 text-[#8E8E93] text-[10px] font-bold tracking-wider uppercase bg-[#F2F2F7]">
        Halo! • 设计源自加州苹果美学 • 2026
      </footer>
    </div>
  );
}
