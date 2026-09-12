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
  HelpCircle
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
    description: "高效燃脂，全力冲刺30秒，休息15秒，循环8组"
  },
  {
    name: "经典 Tabata",
    workDuration: 20,
    restDuration: 10,
    totalSets: 8,
    description: "极致心肺挑战，全力20秒，休息10秒，经典高能训练"
  },
  {
    name: "力量训练间隔",
    workDuration: 45,
    restDuration: 45,
    totalSets: 5,
    description: "适合自重或器械，45秒专注发力，45秒充分拉伸复原"
  },
  {
    name: "温和唤醒",
    workDuration: 40,
    restDuration: 20,
    totalSets: 4,
    description: "晨间拉伸或核心唤醒，中低强度持续激活"
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
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showVoiceGuide, setShowVoiceGuide] = useState<boolean>(false);

  // Recognition States
  const [recognitionStatus, setRecognitionStatus] = useState<"inactive" | "listening" | "error" | "unsupported">("inactive");
  const [lastRecognizedCommand, setLastRecognizedCommand] = useState<string>("");
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean | null>(null);

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

  // Speech Recognition instance ref
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef<boolean>(false);

  // Audio Context Ref (for sound beeps)
  const audioContextRef = useRef<AudioContext | null>(null);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem("workout_timer_logs", JSON.stringify(historyLogs));
  }, [historyLogs]);

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

      // Resume context if suspended (browser security policy)
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);

      // Smooth decay to prevent clicking sounds
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
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
      // Cancel any ongoing speech to deliver timely feedback
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1.05; // Slightly faster for workout energy
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
      rec.interimResults = false;
      rec.lang = "zh-CN";

      rec.onstart = () => {
        setRecognitionStatus("listening");
        setMicPermissionGranted(true);
      };

      rec.onresult = (event: any) => {
        const resultIndex = event.resultIndex;
        const transcript = event.results[resultIndex][0].transcript.trim().toLowerCase();
        setLastRecognizedCommand(transcript);
        handleVoiceCommand(transcript);
      };

      rec.onerror = (event: any) => {
        console.warn("ASR error event:", event.error);
        if (event.error === "not-allowed") {
          setMicPermissionGranted(false);
          setRecognitionStatus("error");
          setVoiceControlEnabled(false);
        } else if (event.error === "no-speech") {
          // No-speech is normal and handles automatically
        } else {
          setRecognitionStatus("error");
        }
      };

      rec.onend = () => {
        // Automatically restart if should be listening to keep mic open during exercise
        if (shouldListenRef.current && voiceControlEnabled) {
          try {
            recognitionRef.current?.start();
          } catch (err) {
            // In case it's already running
          }
        } else {
          setRecognitionStatus("inactive");
        }
      };

      recognitionRef.current = rec;
    } catch (err) {
      console.error("Speech Recognition Init Error:", err);
      setRecognitionStatus("unsupported");
    }
  };

  // Check microphone permissions on mount if Voice Control was enabled
  useEffect(() => {
    initSpeechRecognition();
    return () => {
      shouldListenRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  // Handle Speech Recognition activation based on switch toggle
  useEffect(() => {
    if (voiceControlEnabled) {
      shouldListenRef.current = true;
      if (!recognitionRef.current) {
        initSpeechRecognition();
      }

      if (recognitionRef.current && recognitionStatus !== "listening") {
        try {
          // Request user gesture to trigger mic permission safely
          recognitionRef.current.start();
          speak("语音指令已开启，您可以说'开始'、'暂停'或'下一组'");
        } catch (err) {
          console.warn("Error starting ASR:", err);
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

  // Voice commands interpreter
  const handleVoiceCommand = (command: string) => {
    // Standardizing Chinese input variations
    const cleanCmd = command.replace(/[。，？！.?! ]/g, "");
    
    // Command mapping
    const isStart = /开始|走起|运动|计时|继续|跑|go|start|resume/i.test(cleanCmd);
    const isPause = /暂停|暂停计时|休息一下|等一下|停|停止|pause|stop/i.test(cleanCmd);
    const isNext = /下一组|下一节|跳过|完成|搞定|next|skip|done/i.test(cleanCmd);
    const isReset = /重新开始|重置|取消|清空|restart|reset/i.test(cleanCmd);
    const isReady = /准备好了|我准备好了|准备|ready/i.test(cleanCmd);

    if (isStart) {
      triggerStart();
      speak("开始计时");
    } else if (isPause) {
      triggerPause();
      speak("已暂停");
    } else if (isNext) {
      triggerSkip();
    } else if (isReset) {
      triggerReset();
      speak("已重置");
    } else if (isReady) {
      if (currentMode === "idle") {
        triggerStart();
        speak("准备倒计时开始");
      } else if (currentMode === "prepare") {
        // Skip prep countdown, start training instantly
        startWorkoutPhase(1);
      }
    }
  };

  // --- CORE TIMER MANAGEMENT ---

  // Stop running interval
  const clearActiveTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Skip / Next Phase Function
  const triggerSkip = () => {
    if (currentMode === "idle") return;

    if (currentMode === "prepare") {
      // Skip preparation, start workout set 1
      speak("跳过准备，开始第一组");
      startWorkoutPhase(1);
    } else if (currentMode === "work") {
      // Skip active set early
      speak(`第 ${currentSet} 组提前结束`);
      if (currentSet < totalSets) {
        startRestPhase(currentSet);
      } else {
        completeSession();
      }
    } else if (currentMode === "rest") {
      // Skip rest early
      const nextS = currentSet + 1;
      speak(`跳过休息，开始第 ${nextS} 组`);
      startWorkoutPhase(nextS);
    }
  };

  // Start workout phase
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

  // Start rest phase
  const startRestPhase = (finishedSet: number) => {
    clearActiveTimer();
    setCurrentMode("rest");
    setCurrentSet(finishedSet);
    setTimeLeft(restDuration);
    setPhaseTotalDuration(restDuration);
    setIsTimerRunning(true);
    speak(`第 ${finishedSet} 组结束，休息 ${restDuration} 秒`);
    lastTickRef.current = Date.now();
  };

  // Start prepare countdown phase
  const startPreparePhase = () => {
    clearActiveTimer();
    setCurrentMode("prepare");
    setCurrentSet(1);
    setTimeLeft(prepDuration);
    setPhaseTotalDuration(prepDuration);
    setIsTimerRunning(true);
    speak(`准备开始，倒计时 ${prepDuration} 秒`);
    lastTickRef.current = Date.now();
  };

  // Complete workout session
  const completeSession = () => {
    clearActiveTimer();
    setCurrentMode("completed");
    setIsTimerRunning(false);
    speak(`恭喜完成！您一共完成了 ${totalSets} 组锻炼，总用时 ${formatMinutesAndSeconds(sessionTotalTime)}。太棒了！`);

    // Log the workout in history
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

  // Trigger Resume / Play
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

  // Trigger Pause
  const triggerPause = () => {
    setIsTimerRunning(false);
    clearActiveTimer();
  };

  // Trigger Reset
  const triggerReset = () => {
    clearActiveTimer();
    setCurrentMode("idle");
    setCurrentSet(1);
    setTimeLeft(0);
    setPhaseTotalDuration(0);
    setIsTimerRunning(false);
    setSessionTotalTime(0);
  };

  // Accuracy-optimized React loop using relative elapsed system duration.
  // This avoids typical timer slowdowns caused by JavaScript frame throttling.
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
        lastTickRef.current = now - (elapsedMs % 1000); // preserve fractional offset

        // Keep total session timer running during active prep, work, and rest states
        setSessionTotalTime((prev) => prev + secondsToSub);

        setTimeLeft((prevVal) => {
          const newVal = Math.max(0, prevVal - secondsToSub);

          // Audio countdown alerts on final seconds (3, 2, 1)
          if (newVal > 0 && newVal <= 3) {
            playBeep(800, 0.1);
            speak(newVal.toString());
          }

          if (newVal === 0) {
            playBeep(1200, 0.3); // High GO tone on zero
            clearActiveTimer();

            // Transition logic based on current timer state
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
            }, 100);
          }

          return newVal;
        });
      }
    }, 100);

    return () => clearActiveTimer();
  }, [isTimerRunning, currentMode, currentSet, workDuration, restDuration, totalSets]);

  // Handle preset clicks
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

  // Duration formatting utilities
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

  // Preset check for custom changes
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
    if (confirm("确定要清空所有锻炼历史记录吗？")) {
      setHistoryLogs([]);
    }
  };

  // Get active layout configurations based on the running phase
  const getPhaseStyles = () => {
    switch (currentMode) {
      case "prepare":
        return {
          bg: "bg-indigo-50/85 text-indigo-900 border-indigo-200",
          cardBg: "bg-white/80 border-indigo-100",
          accentColor: "text-indigo-600 bg-indigo-100/50",
          ringColor: "border-indigo-600",
          pulseRing: "animate-ping border-indigo-300",
          badge: "bg-indigo-600 text-white",
          labelText: "准备开始"
        };
      case "work":
        return {
          bg: "bg-emerald-50/85 text-emerald-900 border-emerald-200",
          cardBg: "bg-white/80 border-emerald-100",
          accentColor: "text-emerald-600 bg-emerald-100/50",
          ringColor: "border-emerald-600",
          pulseRing: "animate-pulse border-emerald-300",
          badge: "bg-emerald-600 text-white animate-bounce",
          labelText: "正在锻炼"
        };
      case "rest":
        return {
          bg: "bg-amber-50/85 text-amber-900 border-amber-200",
          cardBg: "bg-white/80 border-amber-100",
          accentColor: "text-amber-600 bg-amber-100/50",
          ringColor: "border-amber-600",
          pulseRing: "animate-ping border-amber-300",
          badge: "bg-amber-600 text-white",
          labelText: "呼吸休息"
        };
      case "completed":
        return {
          bg: "bg-teal-50/85 text-teal-900 border-teal-200",
          cardBg: "bg-white/80 border-teal-100",
          accentColor: "text-teal-600 bg-teal-100/50",
          ringColor: "border-teal-600",
          pulseRing: "border-teal-200",
          badge: "bg-teal-600 text-white",
          labelText: "锻炼完成"
        };
      default:
        return {
          bg: "bg-slate-50 text-slate-900 border-slate-200",
          cardBg: "bg-white border-slate-100",
          accentColor: "text-slate-600 bg-slate-100",
          ringColor: "border-slate-300",
          pulseRing: "border-slate-100",
          badge: "bg-slate-600 text-white",
          labelText: "待机准备"
        };
    }
  };

  const phaseStyle = getPhaseStyles();

  // Circular progress calculation
  const progressPercentage = phaseTotalDuration > 0 ? (timeLeft / phaseTotalDuration) * 100 : 0;
  const strokeDashoffset = 2 * Math.PI * 90 * (1 - progressPercentage / 100);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-between font-sans selection:bg-indigo-100 selection:text-indigo-900 antialiased">
      {/* HEADER SECTION */}
      <header className="w-full max-w-4xl px-4 pt-6 pb-4 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200">
            <Flame className="h-5 w-5" id="app-logo" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight" id="app-title">简约锻炼计时器</h1>
            <p className="text-xs text-slate-500">智能语音运动助手</p>
          </div>
        </div>

        {/* Action Toggles */}
        <div className="flex items-center gap-2">
          {/* TTS Audio Voice Button */}
          <button
            onClick={() => {
              const newVal = !voiceEnabled;
              setVoiceEnabled(newVal);
              speak(newVal ? "语音播报已开启" : "");
            }}
            className={`p-2.5 rounded-xl border transition-all duration-200 ${
              voiceEnabled
                ? "bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100"
                : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
            }`}
            title={voiceEnabled ? "禁用语音播报" : "启用语音播报"}
            id="voice-toggle-btn"
          >
            {voiceEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>

          {/* ASR Speech Recognition Microphone Button */}
          <button
            onClick={() => setVoiceControlEnabled(!voiceControlEnabled)}
            className={`p-2.5 rounded-xl border flex items-center gap-1.5 transition-all duration-200 ${
              voiceControlEnabled
                ? "bg-indigo-500 text-white border-indigo-400 shadow-md shadow-indigo-100 hover:bg-indigo-600 animate-pulse"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
            title={voiceControlEnabled ? "禁用语音控制" : "开启语音控制(免手控制)"}
            id="voice-control-btn"
          >
            {voiceControlEnabled ? (
              <>
                <Mic className="h-5 w-5" />
                <span className="text-xs font-semibold px-0.5 hidden sm:inline">语音指令中</span>
              </>
            ) : (
              <>
                <MicOff className="h-5 w-5" />
                <span className="text-xs font-medium text-slate-500 hidden sm:inline">语音指令</span>
              </>
            )}
          </button>

          {/* Quick Help Dialog Trigger */}
          <button
            onClick={() => setShowVoiceGuide(!showVoiceGuide)}
            className="p-2.5 rounded-xl border bg-white text-slate-500 border-slate-200 hover:bg-slate-50 transition-all duration-200"
            title="查看语音指南"
            id="help-toggle-btn"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* VOICE COMMAND FLOATING ALERT OR MIC ERROR NOTICE */}
      <div className="w-full max-w-xl px-4 mt-2">
        {showVoiceGuide && (
          <div className="bg-indigo-950 text-indigo-100 rounded-2xl p-5 mb-3 shadow-lg border border-indigo-800 relative animate-fadeIn" id="speech-guide-card">
            <button
              onClick={() => setShowVoiceGuide(false)}
              className="absolute top-3 right-3 text-indigo-300 hover:text-white text-sm"
              id="close-guide-btn"
            >
              关闭
            </button>
            <h3 className="font-bold text-base text-white flex items-center gap-2 mb-2">
              <Mic className="h-4 w-4 text-indigo-400" />
              免手智能语音控制
            </h3>
            <p className="text-xs text-indigo-200 mb-3 leading-relaxed">
              专门为锻炼场景设计，允许您在双手负重或远离设备时通过呼喊口令来精准控制计时器。点击上方 “语音指令” 即可开启。
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-indigo-900/50 p-2.5 rounded-lg border border-indigo-800/60">
                <span className="font-bold text-amber-300 block mb-1">开始计时</span>
                <span className="text-indigo-200">“开始” / “开始计时” / “Go”</span>
              </div>
              <div className="bg-indigo-900/50 p-2.5 rounded-lg border border-indigo-800/60">
                <span className="font-bold text-amber-300 block mb-1">暂停时间</span>
                <span className="text-indigo-200">“暂停” / “等一下” / “停”</span>
              </div>
              <div className="bg-indigo-900/50 p-2.5 rounded-lg border border-indigo-800/60">
                <span className="font-bold text-amber-300 block mb-1">跳过本节/完成</span>
                <span className="text-indigo-200">“下一组” / “搞定” / “跳过”</span>
              </div>
              <div className="bg-indigo-900/50 p-2.5 rounded-lg border border-indigo-800/60">
                <span className="font-bold text-amber-300 block mb-1">重置/重新开始</span>
                <span className="text-indigo-200">“重新开始” / “重置”</span>
              </div>
            </div>
            {micPermissionGranted === false && (
              <div className="mt-3 bg-rose-950/80 border border-rose-800/80 rounded-xl p-2.5 text-xs text-rose-200 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span>
                  <strong>麦克风权限未授予：</strong>无法启动语音识别。请在浏览器地址栏前点击锁图标或设置，开启麦克风权限后刷新重试。
                </span>
              </div>
            )}
          </div>
        )}

        {voiceControlEnabled && (
          <div className="bg-white border border-indigo-100 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-3 mb-2 transition-all">
            <div className="flex items-center gap-2">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </div>
              <span className="text-xs font-semibold text-slate-700">正在聆听语音口令...</span>
            </div>
            {lastRecognizedCommand ? (
              <div className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg font-mono truncate max-w-[180px] sm:max-w-[280px]">
                听见: &quot;{lastRecognizedCommand}&quot;
              </div>
            ) : (
              <span className="text-xs text-slate-400 italic">试着说 “开始” </span>
            )}
          </div>
        )}
      </div>

      {/* MAIN CONTAINER */}
      <main className="w-full max-w-4xl px-4 flex-1 flex flex-col lg:flex-row gap-6 items-center lg:items-stretch justify-center py-4">
        
        {/* LEFT COLUMN: ACTIVE TIMER */}
        <div className="flex-1 w-full flex flex-col justify-center items-center">
          
          {/* STAGE DISPLAY BOX */}
          <div className={`w-full max-w-md border rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center shadow-sm relative overflow-hidden transition-all duration-300 ${phaseStyle.bg}`} id="timer-stage-card">
            
            {/* Elegant Ambient Glowing/Pulsing circles behind */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full border-4 opacity-10 pointer-events-none ${phaseStyle.pulseRing}`} />

            {/* Current Preset badge */}
            <div className="absolute top-4 left-4 flex gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase bg-slate-900/10 text-slate-800 px-2.5 py-1 rounded-full whitespace-nowrap">
                {selectedPreset}
              </span>
              {currentMode !== "idle" && (
                <span className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full ${phaseStyle.badge}`}>
                  {phaseStyle.labelText}
                </span>
              )}
            </div>

            {/* Set info marker */}
            <div className="text-center mt-3 mb-1">
              {currentMode === "idle" ? (
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  准备好了吗？
                </span>
              ) : currentMode === "completed" ? (
                <div className="flex flex-col items-center gap-1">
                  <Award className="h-8 w-8 text-teal-600 animate-bounce" />
                  <span className="text-sm font-bold text-teal-800">全部组数已搞定！</span>
                </div>
              ) : (
                <span className="text-sm font-bold uppercase tracking-widest text-slate-500">
                  第 <span className="text-2xl font-black text-slate-900 px-1">{currentSet}</span> / {totalSets} 组
                </span>
              )}
            </div>

            {/* CIRCULAR PROGRESS AND MAIN NUMERICAL TIMER */}
            <div className="relative my-4 flex items-center justify-center">
              {/* Circular Meter SVG */}
              <svg className="w-56 h-56 sm:w-64 sm:h-64 transform -rotate-90">
                {/* Background Ring */}
                <circle
                  cx="112"
                  cy="112"
                  r="90"
                  className="stroke-current text-slate-200/50"
                  strokeWidth="8"
                  fill="transparent"
                  style={{ cx: "50%", cy: "50%" }}
                />
                {/* Active Progress Ring */}
                {currentMode !== "idle" && currentMode !== "completed" && (
                  <circle
                    cx="112"
                    cy="112"
                    r="90"
                    className={`stroke-current ${phaseStyle.ringColor} transition-all duration-300`}
                    strokeWidth="10"
                    strokeDasharray={2 * Math.PI * 90}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    style={{ cx: "50%", cy: "50%" }}
                  />
                )}
              </svg>

              {/* Central text display */}
              <div className="absolute flex flex-col items-center justify-center text-center">
                {currentMode === "idle" ? (
                  <div className="flex flex-col items-center">
                    <span className="text-6xl font-black text-slate-900 tracking-tight" id="timer-display-idle">Go</span>
                    <span className="text-xs text-slate-500 mt-2">点击下方开始</span>
                  </div>
                ) : currentMode === "completed" ? (
                  <div className="flex flex-col items-center px-4">
                    <span className="text-2xl font-black text-teal-900">太棒了</span>
                    <span className="text-xs text-teal-700 mt-1">完美完成训练</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="text-6xl sm:text-7xl font-black tracking-tighter text-slate-900 font-mono" id="timer-display-active">
                      {timeLeft}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-1">
                      秒后{currentMode === "work" ? "休息" : "进入下组"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Total Duration Stat (Bottom of Timer) */}
            <div className="w-full flex items-center justify-around bg-white/50 backdrop-blur-sm rounded-2xl py-3 px-4 border border-slate-100 mt-2">
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 font-medium">累计用时</span>
                <span className="text-base font-bold text-slate-800 font-mono" id="stat-total-duration">
                  {formatTime(sessionTotalTime)}
                </span>
              </div>
              <div className="w-[1px] h-8 bg-slate-200" />
              <div className="flex flex-col items-center">
                <span className="text-xs text-slate-400 font-medium">目标组数</span>
                <span className="text-base font-bold text-slate-800" id="stat-total-sets">
                  {totalSets} 组
                </span>
              </div>
            </div>

            {/* MAIN CONTROLS ROW */}
            <div className="w-full flex items-center justify-center gap-4 mt-6">
              {/* Reset Control */}
              <button
                onClick={triggerReset}
                disabled={currentMode === "idle"}
                className={`p-3.5 rounded-2xl border transition-all duration-200 ${
                  currentMode === "idle"
                    ? "bg-transparent text-slate-300 border-slate-200 cursor-not-allowed"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 active:scale-95"
                }`}
                title="重新开始"
                id="control-reset-btn"
              >
                <RotateCcw className="h-5 w-5" />
              </button>

              {/* Big Play/Pause Trigger */}
              <button
                onClick={isTimerRunning ? triggerPause : triggerStart}
                className={`flex-1 max-w-[180px] py-4 rounded-2xl text-white font-bold flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 shadow-md ${
                  isTimerRunning
                    ? "bg-slate-900 hover:bg-slate-800 shadow-slate-200"
                    : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100"
                }`}
                id="control-play-pause-btn"
              >
                {isTimerRunning ? (
                  <>
                    <Pause className="h-5 w-5 fill-white" />
                    <span>暂停</span>
                  </>
                ) : (
                  <>
                    <Play className="h-5 w-5 fill-white" />
                    <span>{currentMode === "completed" ? "再次锻炼" : currentMode === "idle" ? "开始锻炼" : "继续"}</span>
                  </>
                )}
              </button>

              {/* Skip / Next Set Control */}
              <button
                onClick={triggerSkip}
                disabled={currentMode === "idle" || currentMode === "completed"}
                className={`p-3.5 rounded-2xl border transition-all duration-200 ${
                  currentMode === "idle" || currentMode === "completed"
                    ? "bg-transparent text-slate-300 border-slate-200 cursor-not-allowed"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 active:scale-95"
                }`}
                title="跳过本节"
                id="control-skip-btn"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>

          </div>
        </div>

        {/* RIGHT COLUMN: PRESETS, CONFIG & RECENT HISTORY */}
        <div className="flex-1 w-full max-w-md flex flex-col gap-5 justify-between">
          
          {/* PANEL CONTROLLER TABS */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Settings className="h-4 w-4 text-indigo-500" />
                间歇参数配置
              </h2>
              
              {/* Presets vs Manual Switch */}
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setShowHistory(false)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    !showHistory
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-config-btn"
                >
                  时间配置
                </button>
                <button
                  onClick={() => setShowHistory(true)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                    showHistory
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                  id="tab-history-btn"
                >
                  <History className="h-3 w-3" />
                  历史记录
                </button>
              </div>
            </div>

            {!showHistory ? (
              <div className="space-y-4">
                {/* 1. WORK TIMER */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-slate-600">单组运动时长</label>
                    <span className="text-sm font-bold text-indigo-600 font-mono" id="config-work-label">{workDuration}秒</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCustomDurationChange("work", false)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-work-minus"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    {/* Range slider for fluid input */}
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
                      className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      id="config-work-slider"
                    />
                    <button
                      onClick={() => handleCustomDurationChange("work", true)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-work-plus"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* 2. REST TIMER */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-slate-600">每组休息时间</label>
                    <span className="text-sm font-bold text-amber-600 font-mono" id="config-rest-label">{restDuration}秒</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCustomDurationChange("rest", false)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-rest-minus"
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
                      className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      id="config-rest-slider"
                    />
                    <button
                      onClick={() => handleCustomDurationChange("rest", true)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-rest-plus"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* 3. TOTAL SETS */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-slate-600">总锻炼组数</label>
                    <span className="text-sm font-bold text-slate-800 font-mono" id="config-sets-label">{totalSets}组</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCustomDurationChange("sets", false)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-sets-minus"
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
                      className="flex-1 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-800"
                      id="config-sets-slider"
                    />
                    <button
                      onClick={() => handleCustomDurationChange("sets", true)}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 active:scale-95"
                      id="config-sets-plus"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* PRESETS GRID SCROLLER */}
                <div className="pt-2">
                  <span className="text-xs font-bold text-slate-400 block mb-2">快速开始：经典训练模版</span>
                  <div className="grid grid-cols-2 gap-2" id="presets-grid">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => applyPreset(preset)}
                        className={`text-left p-3 rounded-2xl border transition-all duration-200 hover:border-indigo-300 ${
                          selectedPreset === preset.name
                            ? "bg-indigo-50/50 border-indigo-200 shadow-sm"
                            : "bg-white border-slate-150 hover:bg-slate-50"
                        }`}
                        id={`preset-btn-${preset.name.replace(/\s+/g, "-")}`}
                      >
                        <div className="font-bold text-xs text-slate-800 line-clamp-1">{preset.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {preset.workDuration}s 动 / {preset.restDuration}s 歇 / {preset.totalSets}组
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* HISTORY LOGS DISPLAY */
              <div className="space-y-3 max-h-[310px] overflow-y-auto pr-1" id="history-logs-container">
                {historyLogs.length === 0 ? (
                  <div className="text-center py-10 flex flex-col items-center justify-center text-slate-400">
                    <History className="h-10 w-10 text-slate-300 stroke-1 mb-2" />
                    <p className="text-xs">暂无历史记录，现在就开始第一次锻炼吧！</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400">锻炼档案</span>
                      <button
                        onClick={clearAllLogs}
                        className="text-xs text-rose-500 hover:text-rose-700 flex items-center gap-1 font-medium"
                        id="clear-history-btn"
                      >
                        <Trash2 className="h-3 w-3" />
                        清空记录
                      </button>
                    </div>
                    <div className="space-y-2">
                      {historyLogs.map((log) => (
                        <div
                          key={log.id}
                          className="bg-slate-50 hover:bg-slate-100 border border-slate-150 rounded-2xl p-3 flex items-center justify-between gap-2 transition-all"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-800 line-clamp-1">{log.presetName}</span>
                              <span className="text-[10px] bg-indigo-50 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">
                                {log.setsCompleted}组完成
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 font-mono">
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-3 w-3 text-slate-400" />
                                {formatMinutesAndSeconds(log.totalDuration)}
                              </span>
                              <span>•</span>
                              <span>{log.date}</span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => deleteLog(log.id, e)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            title="删除此记录"
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

          {/* MOTIVATIONAL BANNER OR LIVE WORKOUT TRIVIA */}
          <div className="bg-gradient-to-tr from-slate-900 to-indigo-950 text-white rounded-3xl p-5 shadow-sm border border-slate-800 flex items-center gap-4">
            <div className="bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-2xl text-indigo-400 self-start mt-0.5">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-indigo-200">科学证明：间歇训练（Interval）</h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                交替的高强度运动和低强度休息能显著提高线粒体效率，提升心肺耐力，并产生持久的运动后过氧消耗（EPOC）持续燃脂。
              </p>
            </div>
          </div>

        </div>
      </main>

      {/* COMPACT FLOATING FOOTER */}
      <footer className="w-full text-center py-6 border-t border-slate-100 text-slate-400 text-[11px] font-medium tracking-wide">
        简约锻炼计时器 © 2026 • 专注极简，极客自律
      </footer>
    </div>
  );
}
