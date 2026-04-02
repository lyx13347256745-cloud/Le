/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, X, Share2, Check } from "lucide-react";

export default function App() {
  const [dataLog, setDataLog] = useState<any[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [showStartMonitor, setShowStartMonitor] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [baudRate, setBaudRate] = useState(115200);
  const [step, setStep] = useState(0); // 0-13: Evolution stages
  const [arduinoData, setArduinoData] = useState({
    density: 0.5,
    porosity: 0.1,
    hardness: 0.2,
    complexity: 0.1,
    activity: 0.1,
    interfaceCount: 0.5
  });
  const [lastDataTime, setLastDataTime] = useState(0);
  const [showDoctor, setShowDoctor] = useState(false);
  const [doctorLogs, setDoctorLogs] = useState<string[]>([]);
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectingRef = useRef(false);
  const isReadingRef = useRef(false);
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const [jitter, setJitter] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [volume, setVolume] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  const [rawSerialLines, setRawSerialLines] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<'serial' | 'audio' | 'keyboard'>('serial');
  const [stoneProfile, setStoneProfile] = useState<'large' | 'small'>('large');
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  const [showStatusOverlay, setShowStatusOverlay] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [sensitivity, setSensitivity] = useState(1.5);
  const lastTriggerTime = useRef(0);
  const [flickerIndices, setFlickerIndices] = useState<number[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const prevData = useRef(arduinoData);

  // Show status overlay when experience starts
  useEffect(() => {
    if (hasStarted) {
      setShowStatusOverlay(true);
      const timer = setTimeout(() => setShowStatusOverlay(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [hasStarted]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const colors = {
    bg: "transparent",
    paper: "#D1D1D1",
    highlight: "#FFFFFF",
    lines: "#4A4A4A",
  };

  const paperPath = `
    M 120 40 
    L 480 40 
    L 480 120 
    L 540 120 
    L 540 300 
    L 480 300 
    L 480 450 
    L 520 450 
    L 520 580 
    L 400 580 
    L 400 760 
    L 60 760 
    L 60 600 
    L 100 600 
    L 100 450 
    L 120 450 
    Z
  `;

  const paperVertices = [
    [120, 40], [480, 40], [480, 120], [540, 120], [540, 300], [480, 300], 
    [480, 450], [520, 450], [520, 580], [400, 580], [400, 760], [60, 760], 
    [60, 600], [100, 600], [100, 450], [120, 450]
  ];

  const isPointInPolygon = (x: number, y: number, vs: number[][]) => {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Initialize Audio Context
  const startAudioInput = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      setIsListening(true);
      setHasStarted(true);
      setInputMode('audio');
      setError(null);
    } catch (err) {
      setError("Microphone access denied. Please allow microphone access to use audio mode.");
      console.error("Microphone access denied:", err);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Web Serial Connection Logic
  const disconnectArduino = async () => {
    console.log("Disconnecting Arduino...");
    isReadingRef.current = false;
    
    // 1. Cancel the reader first
    if (readerRef.current) {
      try {
        console.log("Cancelling reader...");
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      } catch (e) {
        console.warn("Error cancelling reader:", e);
      }
    }

    // 2. Abort the stream controller
    if (abortControllerRef.current) {
      try {
        console.log("Aborting stream...");
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      } catch (e) {
        console.warn("Error aborting stream:", e);
      }
    }

    // 3. Close the port
    if (portRef.current) {
      try {
        console.log("Closing port...");
        await portRef.current.close();
        portRef.current = null;
      } catch (e) {
        console.warn("Error closing port:", e);
      }
    }
    
    setIsSerialConnected(false);
    setIsConnecting(false);
  };

  const addLog = (msg: string) => {
    console.log(msg);
    setConnectionLog(prev => [...prev.slice(-4), msg]);
  };

  const addDoctorLog = (msg: string) => {
    setDoctorLogs(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const runSerialDoctor = async () => {
    setShowDoctor(true);
    addDoctorLog("Starting Serial Port Diagnostic...");
    
    if (!('serial' in navigator)) {
      addDoctorLog("ERROR: Web Serial API not supported.");
      return;
    }

    try {
      const ports = await (navigator as any).serial.getPorts();
      addDoctorLog(`Found ${ports.length} authorized ports.`);
      
      for (const [i, p] of ports.entries()) {
        const info = p.getInfo();
        addDoctorLog(`Port ${i}: VID: ${info.usbVendorId || '?'}, PID: ${info.usbProductId || '?'}`);
        
        try {
          addDoctorLog(`Attempting to force-close Port ${i}...`);
          await p.close();
          addDoctorLog(`Port ${i} closed successfully.`);
        } catch (e) {
          addDoctorLog(`Port ${i} close failed (likely already closed or busy).`);
        }
      }
      
      addDoctorLog("Diagnostic complete. If connection still fails, please UNPLUG and REPLUG the USB cable.");
    } catch (e: any) {
      addDoctorLog(`Diagnostic error: ${e.message}`);
    }
  };

  const connectArduino = async () => {
    if (connectingRef.current) {
      addLog("Connection already in progress, ignoring request.");
      return;
    }
    
    addLog("Starting connection sequence...");
    setError(null);
    setConnectionLog(["Initializing..."]);
    setIsConnecting(true);
    connectingRef.current = true;
    
    if (!('serial' in navigator)) {
      setError("Web Serial is not supported in this browser or is blocked in this view. Please try opening the app in a new tab (top right button).");
      setIsConnecting(false);
      connectingRef.current = false;
      return;
    }

    // Aggressive cleanup of all existing ports with timeout
    try {
      addLog("Cleaning up existing ports...");
      const ports = await (navigator as any).serial.getPorts();
      await Promise.race([
        Promise.all(ports.map(async (p: any) => {
          try {
            await p.close();
            addLog("Closed a stale port handle.");
          } catch (e) {}
        })),
        new Promise(resolve => setTimeout(resolve, 2000)) // 2s timeout for cleanup
      ]);
    } catch (e) {
      addLog("Cleanup warning: " + e);
    }

    // Cleanup current refs
    await disconnectArduino();

    // Larger delay to ensure previous close finished and OS released the port
    addLog("Waiting for OS to release port...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      let port;
      let openSuccess = false;
      
      addLog("Requesting port selection...");
      try {
        port = await (navigator as any).serial.requestPort();
      } catch (e: any) {
        if (e.name === 'NotFoundError') {
          throw new Error("No port selected. Please click 'Connect' and select your Arduino.");
        }
        if (e.name === 'SecurityError') {
          throw new Error("Security Error: Access to serial port was denied. This often happens in iframes. Please open the app in a new tab.");
        }
        throw e;
      }

      if (!port) throw new Error("No port selected.");
      addLog("Port selected. Preparing to open...");

      // Ensure it's closed before we try to open it
      try { await port.close(); } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 1500));

      let lastOpenErr;
      const baudRatesToTry = [baudRate, baudRate === 115200 ? 9600 : 115200];
      
      for (const currentBaud of baudRatesToTry) {
        addLog(`Trying baud rate: ${currentBaud}...`);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            addLog(`Open attempt ${attempt + 1}/3 at ${currentBaud}...`);
            
            // Only try to close if we suspect it might be open
            if (attempt > 0) {
              try { await port.close(); } catch (e) {}
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await port.open({ baudRate: currentBaud });
            
            addLog("Port opened. Setting signals...");
            try {
              await port.setSignals({ dataTerminalReady: false });
              await new Promise(resolve => setTimeout(resolve, 200));
              await port.setSignals({ dataTerminalReady: true, requestToSend: true });
            } catch (sigErr) {
              addLog("Signal warning: " + sigErr);
            }
            
            openSuccess = true;
            break;
          } catch (openErr: any) {
            lastOpenErr = openErr;
            addLog(`Attempt ${attempt + 1} failed: ${openErr.message}`);
            
            if (openErr.name === 'SecurityError') break; 
            
            if (openErr.message.includes("already in progress")) {
              addLog("Waiting 5s for 'in progress' lock to clear...");
              await new Promise(resolve => setTimeout(resolve, 5000));
              continue;
            }
            
            if (openErr.message.includes("Failed to open serial port")) {
              addLog("Driver lock detected. Waiting 3s...");
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            const delay = 2000 * (attempt + 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        if (openSuccess) break;
      }

      if (!openSuccess && lastOpenErr) {
        const openErr = lastOpenErr;
        addLog("All connection attempts failed.");
        
        if (openErr.name === 'SecurityError') {
          throw new Error("Security Error: The browser blocked access to the serial port. Please ensure you are not in a restricted environment and try opening the app in a new tab.");
        }

        if (openErr.message.includes("Failed to open serial port") || openErr.name === 'NetworkError' || openErr.name === 'InvalidStateError') {
          // Proactively forget the port to force a fresh permission request next time
          if (port.forget) {
            try { await port.forget(); } catch (e) {}
          }
          throw new Error("Port Busy: Another app (like Arduino IDE, Cura, or another tab) is using this port. Please CLOSE them, UNPLUG and REPLUG your Arduino, then try again. If it still fails, use the 'Nuclear Reset' button below.");
        }
        
        throw openErr;
      }

      addLog("Connection established!");
      portRef.current = port;
      setIsSerialConnected(true);
      setHasStarted(true);
      isReadingRef.current = true;
      setIsConnecting(false);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable, { signal: abortController.signal });
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buffer = "";
      try {
        while (isReadingRef.current) {
          try {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;
              
              // Update raw monitor
              setRawSerialLines(prev => [...prev.slice(-9), trimmedLine]);
              setLastDataTime(Date.now());

              const parts = trimmedLine.split(/[,\s]+/).filter(p => p.length > 0);
              
              if (parts.length > 0) {
                const newData: any = {};
                
                if (parts[0] === "START") {
                  // START,ch,val,ch,val...
                  for (let i = 1; i < parts.length - 1; i += 2) {
                    const ch = parseInt(parts[i]);
                    const rawVal = parseInt(parts[i+1]);
                    const val = isNaN(rawVal) ? 0.5 : Math.min(1, Math.max(0, rawVal / 1023));
                    if (ch === 0) newData.density = val;
                    if (ch === 1) newData.porosity = val;
                    if (ch === 2) newData.hardness = val;
                    if (ch === 3) newData.complexity = val;
                    if (ch === 4) newData.activity = val;
                    if (ch === 5) newData.interfaceCount = val;
                  }
                } else if (parts.length >= 2 && !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1]))) {
                  // ch,val,ch,val...
                  for (let i = 0; i < parts.length - 1; i += 2) {
                    const ch = parseInt(parts[i]);
                    const rawVal = parseInt(parts[i+1]);
                    const val = isNaN(rawVal) ? 0.5 : Math.min(1, Math.max(0, rawVal / 1023));
                    if (ch === 0) newData.density = val;
                    if (ch === 1) newData.porosity = val;
                    if (ch === 2) newData.hardness = val;
                    if (ch === 3) newData.complexity = val;
                    if (ch === 4) newData.activity = val;
                    if (ch === 5) newData.interfaceCount = val;
                  }
                } else if (parts.length === 1 && !isNaN(parseInt(parts[0]))) {
                  // Just a single value, assume channel 0 (Density)
                  const rawVal = parseInt(parts[0]);
                  newData.density = Math.min(1, Math.max(0, rawVal / 1023));
                }
                
                if (Object.keys(newData).length > 0) {
                  const now = Date.now();
                  if (now - lastTriggerTime.current > 1500) {
                    const isHighActivity = Object.values(newData).some((v: any) => (v * sensitivity) > 0.7);
                    if (isHighActivity) {
                      setStep((prev) => (prev < 13 ? prev + 1 : prev));
                      lastTriggerTime.current = now;
                    }
                  }
                  setArduinoData(prev => {
                    const next = { ...prev, ...newData };
                    prevData.current = next;
                    return next;
                  });
                  
                  setDataLog(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), ...newData }]);
                }
              }
            }
          } catch (readErr) {
            console.error("Read error:", readErr);
            break;
          }
        }
      } finally {
        setIsSerialConnected(false);
        isReadingRef.current = false;
      }
    } catch (err: any) {
      console.error("Serial connection failed:", err);
      setIsConnecting(false);
      connectingRef.current = false;
      setIsSerialConnected(false);
      
      const errorMessage = err.message || "";
      if (err.name === 'SecurityError' || errorMessage.includes("Security Error")) {
        setError("Access denied. This usually happens in iframes. Please open the app in a new tab (top right button).");
      } else if (err.name === 'NotFoundError' || errorMessage.includes("No port selected")) {
        setError("No port was selected. Please click 'Connect' again and select your Arduino.");
      } else if (errorMessage.includes("Port Busy") || err.name === 'InvalidStateError' || errorMessage.includes("Failed to open") || errorMessage.includes("already in progress")) {
        setError("Port Busy: Please CLOSE the Arduino IDE Serial Monitor and any other browser tabs using the Arduino, then try again. If it still fails, unplug and replug the USB cable.");
      } else {
        setError(`Connection failed: ${err.message || 'Unknown error'}.`);
      }
    } finally {
      setIsConnecting(false);
      connectingRef.current = false;
    }
  };

  useEffect(() => {
    if (inputMode === 'audio' && isListening && analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const update = () => {
        if (!isListening || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Map audio frequency bands to evolution parameters
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const vol = (avg / 255) * sensitivity;
        
        setVolume(vol);
        
        // Low frequencies -> Density
        const low = (dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10 / 255) * sensitivity;
        // Mid frequencies -> Complexity
        const mid = (dataArray.slice(10, 40).reduce((a, b) => a + b, 0) / 30 / 255) * sensitivity;
        // High frequencies -> Activity
        const high = (dataArray.slice(40, 100).reduce((a, b) => a + b, 0) / 60 / 255) * sensitivity;

        const newData = {
          density: Math.min(1, low * 1.5),
          complexity: Math.min(1, mid * 1.5),
          activity: Math.min(1, high * 2),
          hardness: Math.min(1, vol),
          porosity: prevData.current.porosity,
          interfaceCount: prevData.current.interfaceCount
        };

        setArduinoData(newData);
        prevData.current = newData;
        
        // Add to data log (keep last 50 points)
        setDataLog(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), ...newData }]);

        if (vol > 0.35) {
          const now = Date.now();
          if (now - lastTriggerTime.current > 1200) {
            setStep(prev => (prev < 13 ? prev + 1 : prev));
            lastTriggerTime.current = now;
          }
        }

        requestAnimationFrame(update);
      };
      update();
    }
  }, [inputMode, isListening]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (inputMode !== 'keyboard') return;
      
      const key = e.key;
      const val = Math.min(1, 0.8 * sensitivity); // Apply sensitivity to keyboard input
      
      setArduinoData(prev => {
        const next = { ...prev };
        if (key === '1') next.density = val;
        if (key === '2') next.porosity = val;
        if (key === '3') next.hardness = val;
        if (key === '4') next.complexity = val;
        if (key === '5') next.activity = val;
        if (key === '6') next.interfaceCount = val;
        prevData.current = next;
        
        // Add to data log
        setDataLog(p => [...p.slice(-49), { time: new Date().toLocaleTimeString(), ...next }]);
        
        return next;
      });

      if (['1', '2', '3', '4', '5', '6'].includes(key)) {
        const now = Date.now();
        if (now - lastTriggerTime.current > 1000) {
          setStep(prev => (prev < 13 ? prev + 1 : prev));
          lastTriggerTime.current = now;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputMode]);

  // Cleanup on unmount
  useEffect(() => {
    const handleDisconnect = (event: any) => {
      console.log("Serial device disconnected:", event);
      if (portRef.current === event.target) {
        disconnectArduino();
        setError("Device disconnected. Please check your USB cable.");
      }
    };

    if ('serial' in navigator) {
      (navigator as any).serial.addEventListener('disconnect', handleDisconnect);
    }

    return () => {
      isReadingRef.current = false;
      if ('serial' in navigator) {
        (navigator as any).serial.removeEventListener('disconnect', handleDisconnect);
      }
      if (portRef.current) {
        portRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Track mouse position for Step 16 interactivity
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize mouse position relative to center
      setMousePos({ 
        x: e.clientX - window.innerWidth / 2, 
        y: e.clientY - window.innerHeight / 2 
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Flicker and Move logic
  useEffect(() => {
    if (step < 1) {
      setFlickerIndices([]);
      return;
    }
    
    // Squares start disappearing in Step 1 (condensed)
    if (step >= 2) return;

    const size = step === 2 ? 8 : 16;
    const interval = setInterval(() => {
      const count = step === 2 ? 10 : 30;
      const newIndices = Array.from({ length: count }, () => Math.floor(Math.random() * (size * size)));
      setFlickerIndices(newIndices);
    }, 600);

    return () => clearInterval(interval);
  }, [step]);

  // Grid Line Generation with randomized directions
  const generateLines = (size: number) => {
    const lines = [];
    const stepSize = 600 / size;
    const mainV = 16; // Center vertical for 32x32
    const mainH = 12; // Offset horizontal for 32x32

    for (let i = 1; i < size; i++) {
      const isMainV = i === mainV;
      const isMainH = i === mainH;
      const isLevel2 = i % (size / 8) === 0;
      const isLevel3 = i % (size / 16) === 0;

      let level = 4;
      if (isMainV || isMainH) level = 1;
      else if (isLevel2) level = 2;
      else if (isLevel3) level = 3;

      // Vertical Line
      const vDir = Math.random() > 0.5 ? 'down' : 'up';
      lines.push({
        id: `v-${size}-${i}`,
        x1: i * stepSize,
        y1: vDir === 'down' ? 0 : 800,
        x2: i * stepSize,
        y2: vDir === 'down' ? 800 : 0,
        level
      });

      // Horizontal Line
      const hDir = Math.random() > 0.5 ? 'right' : 'left';
      lines.push({
        id: `h-${size}-${i}`,
        x1: hDir === 'right' ? 0 : 600,
        y1: i * stepSize + 100,
        x2: hDir === 'right' ? 600 : 0,
        y2: i * stepSize + 100,
        level
      });
    }
    return lines;
  };

  // We use a 32x32 grid as the master set for maximum density
  const allGridLines = useRef(generateLines(32)).current;

  // Step 6: Non-uniform fractal grid (Quadtree style) - Fully filling the shape
  const quadtreeLines = useMemo(() => {
    const lines: any[] = [];
    const subdivide = (x: number, y: number, size: number, depth: number) => {
      if (depth >= 8) return; 
      
      // High subdivision chance to ensure density across the entire area
      const noise = Math.sin(x * 0.02) * Math.cos(y * 0.02);
      const chance = 0.95 - (depth * 0.08) + (noise * 0.05);
      
      // Always subdivide at early depths to ensure coverage
      if (Math.random() < chance || depth < 4) {
        const half = size / 2;
        const vDir = Math.random() > 0.5 ? 'down' : 'up';
        const hDir = Math.random() > 0.5 ? 'right' : 'left';

        lines.push({
          id: `qv-${x}-${y}-${depth}`,
          x1: x + half, 
          y1: vDir === 'down' ? y : y + size, 
          x2: x + half, 
          y2: vDir === 'down' ? y + size : y,
          depth
        });
        lines.push({
          id: `qh-${x}-${y}-${depth}`,
          x1: hDir === 'right' ? x : x + size, 
          y1: y + half, 
          x2: hDir === 'right' ? x + size : x, 
          y2: y + half,
          depth
        });
        
        subdivide(x, y, half, depth + 1);
        subdivide(x + half, y, half, depth + 1);
        subdivide(x, y + half, half, depth + 1);
        subdivide(x + half, y + half, half, depth + 1);
      }
    };
    // Start from a larger area to ensure the irregular shape is fully covered
    subdivide(-100, -100, 1000, 0);
    return lines;
  }, []);

  // Step 7: Ultra-dense glitch fractal grid (Replicating reference images)
  const glitchLines = useMemo(() => {
    const lines: any[] = [];
    const subdivide = (x: number, y: number, size: number, depth: number) => {
      // Use noise to create varied density (sparse vs dense areas)
      const noise = (Math.sin(x * 0.02) + Math.cos(y * 0.02) + 2) / 4;
      
      // Depth 8 for higher detail, but with careful element management
      if (depth >= 8 || (depth >= 5 && Math.random() > 0.85)) {
        // Add dense parallel lines in leaf nodes to create the "glitch" texture
        // Replicating the vertical-heavy look of the reference
        const count = Math.floor(noise * 12) + 3; 
        for (let i = 0; i <= count; i++) {
          const offset = (i / count) * size;
          lines.push({ 
            id: `gl-v-${x}-${y}-${depth}-${i}`, 
            x1: x + offset, y1: y, 
            x2: x + offset, y2: y + size, 
            depth,
            type: 'texture'
          });
        }
        // Add block boundaries
        lines.push({ id: `gb-h1-${x}-${y}-${depth}`, x1: x, y1: y, x2: x + size, y2: y, depth, type: 'boundary' });
        lines.push({ id: `gb-h2-${x}-${y}-${depth}`, x1: x, y1: y + size, x2: x + size, y2: y + size, depth, type: 'boundary' });
        lines.push({ id: `gb-v1-${x}-${y}-${depth}`, x1: x, y1: y, x2: x, y2: y + size, depth, type: 'boundary' });
        lines.push({ id: `gb-v2-${x}-${y}-${depth}`, x1: x + size, y1: y, x2: x + size, y2: y + size, depth, type: 'boundary' });
        return;
      }
      
      const chance = 0.98 - (depth * 0.1);
      if (Math.random() < chance || depth < 3) {
        const half = size / 2;
        subdivide(x, y, half, depth + 1);
        subdivide(x + half, y, half, depth + 1);
        subdivide(x, y + half, half, depth + 1);
        subdivide(x + half, y + half, half, depth + 1);
      } else {
        // Larger blocks also get some texture
        const count = Math.floor(noise * 6) + 2;
        for (let i = 0; i <= count; i++) {
          const offset = (i / count) * size;
          lines.push({ id: `gl-v-lg-${x}-${y}-${depth}-${i}`, x1: x + offset, y1: y, x2: x + offset, y2: y + size, depth, type: 'texture' });
        }
        lines.push({ id: `gb-v-${x}-${y}-${depth}`, x1: x, y1: y, x2: x, y2: y + size, depth, type: 'boundary' });
        lines.push({ id: `gb-h-${x}-${y}-${depth}`, x1: x, y1: y, x2: x + size, y2: y, depth, type: 'boundary' });
      }
    };
    subdivide(-100, -100, 1000, 0);
    return lines;
  }, []);

  // Jitter effect for Step 6 (Old Step 11)
  useEffect(() => {
    if (step !== 6) return;
    const interval = setInterval(() => {
      setJitter({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2
      });
    }, 100);
    return () => clearInterval(interval);
  }, [step]);
  const step8Blocks = useMemo(() => {
    const largePalette = [
      "#2C3E50", "#34495E", "#16A085", // Deep Teals/Grays
      "#7F8C8D", "#95A5A6", "#273746", // Heavy Grays
      "#D35400", "#E67E22", "#A04000", // Deep Ochre/Burnt Orange
      "#1B2631", "#212F3C", "#283747", // Darker accents
    ];

    const smallPalette = [
      "#70C1D1", "#A0E0E6", "#4A90E2", // Bright Blues
      "#8FBC8F", "#D5F5E3", "#ABEBC6", // Light Greens/Mints
      "#FAD7A0", "#FDEBD0", "#FEF9E7", // Pale Sands/Creams
      "#EBDEF0", "#D7BDE2", "#F5EEF8", // Soft Purples
    ];

    const palette = stoneProfile === 'large' ? largePalette : smallPalette;

    const getFluorescentColor = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const nr = Math.min(255, r + 120);
      const ng = Math.min(255, g + 120);
      const nb = Math.min(255, b + 120);
      return `rgb(${nr}, ${ng}, ${nb})`;
    };

    const getHSL = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) { h = s = 0; } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };

    const blocks: any[] = [];
    const subdivide = (x: number, y: number, size: number, depth: number) => {
      const noise = (Math.sin(x * 0.01) + Math.cos(y * 0.01) + 2) / 4;
      const chance = 0.92 - (depth * 0.12) + (noise * 0.1);
      
      if (depth < 7 && (Math.random() < chance || depth < 3)) {
        const half = size / 2;
        subdivide(x, y, half, depth + 1);
        subdivide(x + half, y, half, depth + 1);
        subdivide(x, y + half, half, depth + 1);
        subdivide(x + half, y + half, half, depth + 1);
      } else {
        // Only add blocks whose center is inside the irregular shape
        const centerX = x + size / 2;
        const centerY = y + size / 2;
        
        if (isPointInPolygon(centerX, centerY, paperVertices)) {
          const color = palette[Math.floor(Math.random() * palette.length)];
          const hsl = getHSL(color);
          const opacity = 0.2 + Math.random() * 0.6;
          const hasDots = Math.random() > 0.6;
          const dotCount = Math.floor(Math.random() * 4) + 1;
          const textureType = Math.random() > 0.7 ? 'newspaper' : (Math.random() > 0.5 ? 'radial' : 'none');
          const blockTexture = Math.random() > 0.6 ? 'stoneTexture' : (Math.random() > 0.3 ? 'grittyTexture' : 'wavyTexture');
          const isShimmering = Math.random() > 0.85; // 15% chance to shimmer
          const shimmerColor = isShimmering ? getFluorescentColor(color) : color;
          const rotation = (Math.random() - 0.5) * 45; // Random rotation for step 11
          const driftX = (Math.random() - 0.5) * 20;
          const driftY = (Math.random() - 0.5) * 20;
          const coordLabel = `x: ${Math.floor(x)} y: ${Math.floor(y)}`;
          
          // Step 12 Grid Positions
          const step10Rx = [0, size / 4, size / 2][Math.floor(Math.random() * 3)];

          const jitterSeedX = Math.random() - 0.5;
          const jitterSeedY = Math.random() - 0.5;
          const dotSeeds = Array.from({ length: 40 }, () => ({
            x: Math.random(),
            y: Math.random(),
            r: Math.random()
          }));
          
          blocks.push({ 
            id: `b8-${x}-${y}-${depth}`, 
            x, y, size, color, opacity, hasDots, dotCount, depth, textureType,
            isShimmering, shimmerColor, rotation, driftX, driftY, coordLabel,
            step10Rx, blockTexture, jitterSeedX, jitterSeedY, dotSeeds,
            hue: hsl.h, saturation: hsl.s, lightness: hsl.l
          });
        }
      }
    };
    subdivide(-100, -100, 1000, 0);

    // Center the grid positions after all blocks are generated
    const gridCols = stoneProfile === 'large' ? 8 : 12;
    const cellW = 600 / gridCols;
    const cellH = 800 / (stoneProfile === 'large' ? 8 : 12); // Base cell height
    const totalRows = Math.ceil(blocks.length / gridCols);
    const startX = (600 - gridCols * cellW) / 2;
    const startY = (800 - totalRows * cellH) / 2;

    blocks.forEach((block, idx) => {
      const col = idx % gridCols;
      const row = Math.floor(idx / gridCols);
      block.row = row;
      block.gridX = startX + col * cellW + cellW / 2 - block.size / 2;
      block.gridY = startY + row * cellH + cellH / 2 - block.size / 2;
      block.gridShape = row % 2 === 0 ? 'circle' : 'square';

      // Step 10 Stack Positions (Vertical Stone Stack)
      // We want them to stack vertically in the center
      const stackCenterY = 400;
      const stackHeight = totalRows * (stoneProfile === 'large' ? 50 : 30);
      block.stackX = 300 - block.size / 2 + (Math.sin(row * 0.5) * (stoneProfile === 'large' ? 20 : 10)); // Organic wobble
      block.stackY = (800 - stackHeight) / 2 + row * (stoneProfile === 'large' ? 55 : 35);
      block.stackSize = (stoneProfile === 'large' ? 60 : 30) + (Math.random() * 20); // More uniform stone size
      
      // Diverse shapes for Step 10
      const stoneTypes = ['circle', 'square', 'ellipse', 'rhombus', 'organic'];
      block.stoneType = stoneTypes[row % stoneTypes.length];
      block.stoneWidthScale = (stoneProfile === 'large' ? 0.9 : 0.7) + Math.random() * 0.6; 
      block.stoneHeightScale = (stoneProfile === 'large' ? 0.8 : 0.6) + Math.random() * 0.4;

      // Step 11 Fusion Position (Single Large Stone)
      // We converge everything to the center with high overlap
      block.fusionX = 300 - block.size / 2 + (Math.random() - 0.5) * (stoneProfile === 'large' ? 60 : 30);
      block.fusionY = 400 - block.size / 2 + (Math.random() - 0.5) * (stoneProfile === 'large' ? 60 : 30);
      block.fusionScale = (stoneProfile === 'large' ? 4 : 3) + Math.random() * 1.5;
      block.fusionRotate = (Math.random() - 0.5) * (stoneProfile === 'large' ? 15 : 45);

      // Step 12: Split into two shapes (Tall/Slender and Short/Plump)
      const isTallGroup = idx % 2 === 0;
      if (isTallGroup) {
        // Tall and Slender (Left-ish, vertically stretched cluster)
        block.splitX = 250 - block.size / 2 + (Math.random() - 0.5) * 15;
        block.splitY = 400 - (idx % 15) * (stoneProfile === 'large' ? 15 : 8) + (Math.random() - 0.5) * 10;
        block.splitScale = (stoneProfile === 'large' ? 3 : 2) + Math.random() * 0.8;
        block.splitRotate = (Math.random() - 0.5) * 8;
        // Merge position for Step 12 (Coming together)
        block.mergeX = 290 - block.size / 2 + (Math.random() - 0.5) * 10;
        block.mergeY = 400 - (idx % 15) * (stoneProfile === 'large' ? 12 : 6) + (Math.random() - 0.5) * 5;
      } else {
        // Short and Plump (Right-ish, horizontally compact cluster)
        block.splitX = 350 - block.size / 2 + (Math.random() - 0.5) * 45;
        block.splitY = 410 - (idx % 8) * (stoneProfile === 'large' ? 6 : 3) + (Math.random() - 0.5) * 15;
        block.splitScale = (stoneProfile === 'large' ? 3.5 : 2.5) + Math.random() * 1.2;
        block.splitRotate = (Math.random() - 0.5) * 35;
        // Merge position for Step 12 (Coming together)
        block.mergeX = 310 - block.size / 2 + (Math.random() - 0.5) * 20;
        block.mergeY = 405 - (idx % 8) * (stoneProfile === 'large' ? 5 : 2) + (Math.random() - 0.5) * 8;
      }

      // Step 13: Twin Geometric Shapes (Left: Slender, Right: Plump)
      if (isTallGroup) {
        // Slender and elongated (Left)
        block.twinX = 285 - block.size / 2;
        block.twinY = 400 - (idx % 15) * (stoneProfile === 'large' ? 10 : 5);
        block.twinScale = stoneProfile === 'large' ? 2.4 : 1.8;
        block.twinRotate = 0;
        block.twinRx = stoneProfile === 'large' ? 2 : 10; 
      } else {
        // Shorter and plumper (Right)
        block.twinX = 315 - block.size / 2;
        block.twinY = 405 - (idx % 8) * (stoneProfile === 'large' ? 5 : 3);
        block.twinScale = stoneProfile === 'large' ? 3.2 : 2.4;
        block.twinRotate = 0;
        block.twinRx = stoneProfile === 'large' ? 2 : 10;
      }
    });

    return blocks;
  }, [paperVertices, stoneProfile]);

  return (
    <div 
      className="min-h-screen w-full flex flex-col items-center justify-center p-8 overflow-hidden font-sans relative"
    >
      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#D1D1D1]"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              <img 
                src="https://i.postimg.cc/nLzYrxtB/tubiao.jpg" 
                alt="Icon" 
                className="w-24 h-24 rounded-3xl shadow-2xl mb-8 object-cover border-4 border-white/50"
                referrerPolicy="no-referrer"
              />
              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: "#000", color: "#fff" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setShowSplash(false);
                }}
                className="px-16 py-4 bg-white/80 backdrop-blur-md text-black rounded-full font-black tracking-[0.4em] uppercase text-sm shadow-xl border border-black/5 transition-all"
              >
                开始
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Image Layer */}
      <img 
        src="https://i.postimg.cc/15nPZndL/zqj-da-zuo.png" 
        alt="Background"
        className="absolute inset-0 w-full h-full object-cover -z-10 opacity-60"
        referrerPolicy="no-referrer"
      />

      {/* Start / Connect Overlay */}
      <AnimatePresence>
        {!hasStarted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#D1D1D1]/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center p-12 bg-white/95 backdrop-blur-xl rounded-[3rem] shadow-2xl border border-black/5 max-w-lg w-full relative overflow-hidden"
            >
              {/* Decorative background element */}
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
              <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />

              <div className="relative z-10">
                <img 
                  src="https://i.postimg.cc/nLzYrxtB/tubiao.jpg" 
                  alt="Stone Icon" 
                  className="w-20 h-20 mx-auto mb-6 rounded-2xl shadow-lg border-2 border-black/5 object-cover"
                  referrerPolicy="no-referrer"
                />
                <h1 className="text-2xl font-black tracking-[0.15em] uppercase mb-2 text-[#2A2A2A]">Stone Evolution</h1>
                <div className="w-12 h-1 bg-black/10 mx-auto mb-6 rounded-full" />
                
                <p className="text-sm text-[#4A4A4A]/70 mb-10 leading-relaxed tracking-wide font-medium">
                  A dedicated interactive portal exploring the internal geometry of stone.
                  <br />
                  <span className="text-[10px] opacity-50 uppercase tracking-[0.2em] mt-2 block">Interactive Visualization Project</span>
                </p>
                
                <div className="flex flex-col gap-4">
                  <div className="space-y-2 mb-4">
                    <p className="text-[8px] font-black text-black/30 uppercase tracking-[0.2em] text-center">Select Stone Type</p>
                    <div className="flex gap-2 p-1 bg-black/5 rounded-2xl border border-black/5">
                      <button 
                        onClick={() => setStoneProfile('large')}
                        className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${stoneProfile === 'large' ? 'bg-white shadow-md text-black' : 'text-black/40 hover:text-black/60'}`}
                      >
                        Large Stone
                      </button>
                      <button 
                        onClick={() => setStoneProfile('small')}
                        className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${stoneProfile === 'small' ? 'bg-white shadow-md text-black' : 'text-black/40 hover:text-black/60'}`}
                      >
                        Small Stone
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2 p-1 bg-black/5 rounded-2xl border border-black/5 mb-4">
                    <button 
                      onClick={() => setInputMode('serial')}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${inputMode === 'serial' ? 'bg-white shadow-md text-black' : 'text-black/40 hover:text-black/60'}`}
                    >
                      Serial
                    </button>
                    <button 
                      onClick={() => {
                        if (inputMode !== 'audio') startAudioInput();
                      }}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${inputMode === 'audio' ? 'bg-white shadow-md text-black' : 'text-black/40 hover:text-black/60'}`}
                    >
                      Audio
                    </button>
                    <button 
                      onClick={() => setInputMode('keyboard')}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${inputMode === 'keyboard' ? 'bg-white shadow-md text-black' : 'text-black/40 hover:text-black/60'}`}
                    >
                      Keys
                    </button>
                  </div>

                  {inputMode === 'serial' ? (
                    <>
                      <button 
                        onClick={isSerialConnected ? disconnectArduino : connectArduino}
                        disabled={isConnecting}
                        className={`w-full px-8 py-5 bg-[#2A2A2A] text-white rounded-2xl text-[11px] font-black tracking-[0.3em] uppercase transition-all shadow-xl active:scale-95 ${isConnecting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black hover:shadow-2xl hover:-translate-y-0.5'}`}
                      >
                        {isConnecting ? "Connecting..." : (isSerialConnected ? "Arduino Connected" : "Connect Arduino")}
                      </button>

                      <div className="flex flex-col items-center gap-3 mt-4">
                        <div className="flex items-center justify-center gap-4 w-full">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isSerialConnected ? (Date.now() - lastDataTime < 500 ? 'bg-green-500 animate-pulse' : 'bg-red-500') : 'bg-zinc-300'}`} />
                            <span className="text-[9px] font-black uppercase tracking-widest text-black/40">
                              {!isSerialConnected ? "Not Connected" : (Date.now() - lastDataTime < 500 ? "Receiving Data" : "No Data Stream")}
                            </span>
                          </div>
                          <button 
                            onClick={() => setShowStartMonitor(!showStartMonitor)}
                            className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all ${showStartMonitor ? 'bg-black text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'}`}
                          >
                            {showStartMonitor ? "Hide Monitor" : "Show Monitor"}
                          </button>
                        </div>

                        {showStartMonitor && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="w-full p-3 bg-black rounded-xl font-mono text-[9px] text-green-400 overflow-hidden border border-black/10"
                          >
                            <div className="flex justify-between items-center mb-2 opacity-40 text-[7px] uppercase tracking-widest">
                              <span>Raw Serial Stream</span>
                              <span>{baudRate} Baud</span>
                            </div>
                            <div className="h-24 overflow-y-auto space-y-1">
                              {rawSerialLines.length > 0 ? (
                                rawSerialLines.map((l, i) => <div key={i} className="border-b border-white/5 pb-1">{l}</div>)
                              ) : (
                                <div className="text-white/20 italic h-full flex items-center justify-center">
                                  {isSerialConnected ? "Waiting for data..." : "Connect to see stream"}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                        
                        {isSerialConnected && Date.now() - lastDataTime >= 500 && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="w-full p-4 bg-red-50 rounded-2xl border border-red-100 text-left"
                          >
                            <p className="text-[10px] font-black text-red-900 uppercase tracking-widest mb-2">Troubleshooting (Red Light):</p>
                            <ul className="text-[9px] text-red-800/70 space-y-1 list-disc pl-4 font-medium mb-3">
                              <li>Check if Arduino is sending data via <code>Serial.println()</code></li>
                              <li>Try changing the Baud Rate below</li>
                              <li>Ensure you have a <code>\n</code> at the end of each line</li>
                              <li>Close Arduino IDE Serial Monitor if it's open</li>
                            </ul>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  const code = `void setup() {\n  Serial.begin(115200);\n}\nvoid loop() {\n  Serial.print("START,0,");\n  Serial.println(analogRead(A0));\n  delay(50);\n}`;
                                  navigator.clipboard.writeText(code);
                                  alert("Test code copied!");
                                }}
                                className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-900 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                              >
                                Copy Code
                              </button>
                              <button 
                                onClick={async () => {
                                  if ((navigator as any).serial) {
                                    const ports = await (navigator as any).serial.getPorts();
                                    for (const p of ports) { try { await p.forget(); } catch(e){} }
                                    alert("Ports reset. Please reconnect.");
                                    window.location.reload();
                                  }
                                }}
                                className="flex-1 py-2 bg-black/5 hover:bg-black/10 text-black/60 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                              >
                                Reset Port
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[#4A4A4A]/60 uppercase tracking-widest font-bold">Sensitivity:</span>
                          <input 
                            type="range" 
                            min="0.5" 
                            max="5" 
                            step="0.1"
                            value={sensitivity}
                            onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                            className="w-20 accent-black"
                          />
                          <span className="text-[10px] font-black text-black w-6">{sensitivity}x</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-[#4A4A4A]/60 uppercase tracking-widest font-bold">Baud:</span>
                          <select 
                            value={baudRate} 
                            onChange={(e) => setBaudRate(parseInt(e.target.value))}
                            className="text-[10px] font-black bg-black/5 rounded-lg px-2 py-1 outline-none border border-black/5"
                          >
                            <option value={9600}>9600</option>
                            <option value={115200}>115200</option>
                            <option value={57600}>57600</option>
                            <option value={38400}>38400</option>
                          </select>
                        </div>
                      </div>
                    </>
                  ) : inputMode === 'audio' ? (
                    <div className="p-8 bg-blue-50/50 rounded-[2rem] border border-blue-100/50 text-center backdrop-blur-sm">
                      <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest mb-3">Audio Mode Active</p>
                      <p className="text-[11px] text-blue-800/70 leading-relaxed mb-6 font-medium">
                        Evolution is driven by your microphone. Make noise to evolve the structure!
                      </p>
                      <button 
                        onClick={() => setHasStarted(true)}
                        className="w-full py-4 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200"
                      >
                        Enter Experience
                      </button>
                    </div>
                  ) : (
                    <div className="p-8 bg-purple-50/50 rounded-[2rem] border border-purple-100/50 text-center backdrop-blur-sm">
                      <p className="text-[10px] font-black text-purple-900 uppercase tracking-widest mb-3">Keyboard Mode Active</p>
                      <p className="text-[11px] text-purple-800/70 leading-relaxed mb-6 font-medium">
                        Use keys <span className="font-black text-purple-900">1-6</span> to simulate sensors and evolve the stone!
                      </p>
                      <button 
                        onClick={() => setHasStarted(true)}
                        className="w-full py-4 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all shadow-lg hover:shadow-purple-200"
                      >
                        Enter Experience
                      </button>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <button 
                      onClick={() => {
                        if (inputMode === 'audio' && !isListening) {
                          startAudioInput();
                        } else {
                          setHasStarted(true);
                        }
                      }}
                      className="py-3 px-4 bg-black/5 hover:bg-black/10 text-[#4A4A4A] rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                    >
                      Skip to Experience
                    </button>
                    <button 
                      onClick={copyUrl}
                      className="py-3 px-4 bg-black/5 hover:bg-black/10 text-[#4A4A4A] rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      {isCopied ? <Check size={12} className="text-green-600" /> : <Share2 size={12} />}
                      {isCopied ? "Copied!" : "Share Link"}
                    </button>
                  </div>

                  <button 
                    onClick={() => setShowTroubleshooter(true)}
                    className="text-[9px] text-blue-600/60 hover:text-blue-600 transition-colors uppercase tracking-[0.2em] font-black mt-4"
                  >
                    Troubleshooting Guide
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-12 pt-8 border-t border-black/5 text-[8px] text-black/30 uppercase tracking-[0.3em] font-bold">
                © 2026 Stone Evolution Project • Built with AIS
              </div>
            </motion.div>

      {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-5 bg-red-50 rounded-2xl border border-red-200 shadow-xl max-w-md w-full"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <p className="text-[11px] text-red-600 font-bold uppercase tracking-[0.2em]">
                      Connection Error
                    </p>
                  </div>

                  <p className="text-[12px] text-red-700 leading-relaxed mb-4 font-medium">
                    {error}
                  </p>

                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={async () => {
                        setError("Attempting nuclear port reset...");
                        try {
                          const ports = await (navigator as any).serial.getPorts();
                          for (const p of ports) {
                            try { await p.close(); } catch (e) {}
                            if (p.forget) await p.forget();
                          }
                          setError("Nuclear reset complete. Please REFRESH the page, UNPLUG your Arduino, and try again.");
                        } catch (e) {
                          setError("Nuclear reset failed. Please refresh the page manually.");
                        }
                      }}
                      className="w-full py-3 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-red-700 transition-all shadow-lg"
                    >
                      Nuclear Reset (Forget All)
                    </button>
                    
                    {window.location.href.includes('ais-dev') && (
                      <button 
                        onClick={() => window.open(window.location.href, '_blank')}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-blue-700 transition-all shadow-lg"
                      >
                        Open in New Tab (Recommended)
                      </button>
                    )}
                  </div>

                  {isSerialConnected && (
                    <div className="mb-4 p-3 bg-black/90 rounded-xl border border-white/10 font-mono text-[9px] text-green-400">
                      <p className="font-bold uppercase mb-1 text-white/50">Raw Serial Monitor:</p>
                      {rawSerialLines.length === 0 ? (
                        <p className="opacity-30 italic">Waiting for data...</p>
                      ) : (
                        rawSerialLines.map((line, i) => (
                          <div key={i} className="truncate">
                            <span className="opacity-30 mr-2">{i}</span>
                            {line}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {connectionLog.length > 0 && (
                    <div className="mb-4 p-3 bg-black/5 rounded-xl border border-black/5 font-mono text-[9px] text-red-800/70">
                      <p className="font-bold uppercase mb-1 opacity-50">Connection Log:</p>
                      {connectionLog.map((log, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="opacity-30">[{i}]</span>
                          <span>{log}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {(error.includes("Port Busy") || error.includes("Failed to open") || error.includes("progress")) && (
                    <div className="mb-5 p-4 bg-red-600 text-white rounded-xl shadow-inner animate-pulse-slow">
                      <p className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                        <RotateCcw size={14} className="animate-spin-slow" />
                        CRITICAL ACTION REQUIRED:
                      </p>
                      <div className="text-[11px] font-bold leading-tight space-y-1">
                        <p>1. CLOSE the Arduino IDE Serial Monitor.</p>
                        <p>2. Close Cura, PrusaSlicer, or other tabs.</p>
                        <p>3. Unplug & Replug the USB cable.</p>
                        <p className="pt-2 text-[9px] opacity-80 italic">Note: Ensure your code uses Serial.begin({baudRate});</p>
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] text-red-600/80 text-left space-y-2 bg-white/60 p-4 rounded-xl border border-red-100">
                    <p className="font-bold uppercase tracking-widest text-[9px] mb-1">Advanced Recovery:</p>
                    <div className="pt-1 flex flex-col gap-2">
                      <button 
                        onClick={() => window.location.reload()}
                        className="w-full py-2 bg-white border border-red-200 text-red-600 rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-red-50 transition-colors shadow-sm"
                      >
                        Hard Refresh Page
                      </button>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={runSerialDoctor}
                          className="py-2 px-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-[8px] font-bold uppercase tracking-tighter hover:bg-blue-100 transition-colors"
                        >
                          Run Serial Doctor
                        </button>
                        <button 
                          onClick={async () => {
                            setError("Clearing device permissions...");
                            try {
                              const ports = await (navigator as any).serial.getPorts();
                              for (const p of ports) {
                                if (p.forget) await p.forget();
                              }
                              setError("Permissions cleared. Please click 'Connect' and re-select your Arduino.");
                            } catch (e) {
                              setError("Failed to clear permissions. Please refresh the page.");
                            }
                          }}
                          className="py-2 px-1 bg-red-100/50 text-red-700 rounded-lg text-[8px] font-bold uppercase tracking-tighter hover:bg-red-100 transition-colors"
                        >
                          Forget Device
                        </button>
                      </div>
                      
                      <button 
                        onClick={async () => {
                          setError("Attempting nuclear port reset...");
                          try {
                            const ports = await (navigator as any).serial.getPorts();
                            for (const p of ports) {
                              try { await p.close(); } catch (e) {}
                              if (p.forget) await p.forget();
                            }
                            setError("Nuclear reset complete. Please REFRESH the page, UNPLUG your Arduino, and try again.");
                          } catch (e) {
                            setError("Nuclear reset failed. Please refresh the page manually.");
                          }
                        }}
                        className="w-full py-2 bg-black text-white rounded-lg text-[8px] font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors shadow-sm"
                      >
                        Nuclear Reset (Forget All)
                      </button>
                    </div>
                  </div>

                  {(error.includes("iframe") || window.self !== window.top) && (
                    <button 
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="mt-4 w-full py-3 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-red-700 transition-all shadow-lg"
                    >
                      Open in New Tab (Recommended)
                    </button>
                  )}
                </motion.div>
              )}
            </motion.div>
        )}
      </AnimatePresence>

      {/* Troubleshooting Guide Modal */}
      <AnimatePresence>
        {showTroubleshooter && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl shadow-2xl border border-black/10 max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-blue-50">
                <div>
                  <h2 className="text-lg font-bold text-blue-900">Troubleshooting Guide</h2>
                  <p className="text-[10px] text-blue-700 uppercase tracking-widest font-bold">Serial Connection Help</p>
                </div>
                <button onClick={() => setShowTroubleshooter(false)} className="p-2 hover:bg-blue-100 rounded-full transition-colors text-blue-900">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-black/40 border-b pb-1">1. Software Checklist</h3>
                  <ul className="text-[11px] space-y-2 text-zinc-700">
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">A</span>
                      <span>Close the <span className="font-bold">Arduino IDE Serial Monitor</span>. Only one app can use the port at a time.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">B</span>
                      <span>Close Cura, PrusaSlicer, or other 3D printing software.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">C</span>
                      <span>Check other browser tabs. If you have this app open in another tab, close it.</span>
                    </li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-black/40 border-b pb-1">2. Hardware Checklist</h3>
                  <ul className="text-[11px] space-y-2 text-zinc-700">
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">A</span>
                      <span><span className="font-bold">Unplug and Replug</span> the USB cable. This resets the hardware controller.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">B</span>
                      <span>Try a different USB port or a different USB cable.</span>
                    </li>
                  </ul>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-widest text-black/40 border-b pb-1">3. Advanced Fixes</h3>
                  <ul className="text-[11px] space-y-2 text-zinc-700">
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">A</span>
                      <span>Go to <code className="bg-zinc-100 px-1 rounded">chrome://flags</code> and enable <span className="font-bold">"Experimental Web Platform features"</span>.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="w-4 h-4 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">B</span>
                      <span><span className="font-bold">Linux Users:</span> Run <code className="bg-zinc-100 px-1 rounded">sudo usermod -a -G dialout $USER</code> and restart.</span>
                    </li>
                  </ul>
                </section>

                <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100">
                  <p className="text-[10px] font-bold text-purple-900 uppercase tracking-widest mb-2">Still Stuck?</p>
                  <p className="text-[11px] text-purple-900 leading-relaxed">
                    Use <span className="font-bold">Keyboard Mode</span> (Keys 1-6) or <span className="font-bold">Audio Mode</span> (Microphone) to skip the serial connection entirely and enjoy the experience!
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showDoctor && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl shadow-2xl border border-black/10 max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-blue-50">
                <div>
                  <h2 className="text-lg font-bold text-blue-900 flex items-center gap-2">
                    <RotateCcw className="animate-spin-slow" size={20} />
                    Serial Port Doctor
                  </h2>
                  <p className="text-[10px] text-blue-700 uppercase tracking-widest font-bold">Hardware Diagnostic Tool</p>
                </div>
                <button 
                  onClick={() => setShowDoctor(false)}
                  className="p-2 hover:bg-blue-100 rounded-full transition-colors text-blue-900"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="bg-black/90 rounded-2xl p-4 font-mono text-[10px] text-green-400 h-64 overflow-y-auto shadow-inner border border-white/10">
                  {doctorLogs.map((log, i) => (
                    <div key={i} className="mb-1 border-l-2 border-green-500/30 pl-2">
                      {log}
                    </div>
                  ))}
                  <div className="animate-pulse">_</div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={runSerialDoctor}
                    className="py-3 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg"
                  >
                    Re-Run Diagnostic
                  </button>
                  <button 
                    onClick={() => {
                      setShowDoctor(false);
                      connectArduino();
                    }}
                    className="py-3 bg-green-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg"
                  >
                    Try Connecting
                  </button>
                </div>
                
                <div className="p-4 bg-yellow-50 rounded-2xl border border-yellow-200">
                  <p className="text-[10px] font-bold text-yellow-800 uppercase tracking-widest mb-2">Expert Advice:</p>
                  <p className="text-[11px] text-yellow-900 leading-relaxed">
                    If the diagnostic shows "close failed", another app (like Arduino IDE) is definitely holding the port. <span className="font-bold">Physically unplugging</span> the USB cable is the only way to force a hardware reset on most systems.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {(isSerialConnected || isListening || inputMode === 'keyboard') && showDashboard && (
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="fixed top-8 left-8 z-50 p-5 bg-black/90 backdrop-blur-xl rounded-2xl border border-white/10 text-[10px] font-mono text-white/60 space-y-4 shadow-2xl min-w-[240px]"
        >
          <div className="flex justify-between items-center border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${((isSerialConnected && Date.now() - lastDataTime < 500) || isListening || inputMode === 'keyboard') ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-white font-black tracking-widest uppercase">Sensor Dashboard</span>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setHasStarted(false)} 
                className="px-2 py-0.5 rounded text-[8px] font-bold uppercase bg-white/10 text-white/40 hover:text-white transition-colors"
                title="Change Input Mode"
              >
                Mode
              </button>
              <button onClick={() => setShowRawData(!showRawData)} className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${showRawData ? 'bg-green-600 text-white' : 'bg-white/10 text-white/40'}`}>
                Raw
              </button>
              <button onClick={() => setShowLog(!showLog)} className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${showLog ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/40'}`}>
                Log
              </button>
              <button onClick={() => setShowDashboard(false)} className="text-white/40 hover:text-white">
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1 mb-4">
              <div className="flex justify-between text-[8px] font-bold text-white/40">
                <span>STONE PROFILE</span>
                <span className="text-white uppercase">{stoneProfile}</span>
              </div>
              <div className="flex gap-1 p-0.5 bg-white/5 rounded-lg border border-white/5">
                <button 
                  onClick={() => setStoneProfile('large')}
                  className={`flex-1 py-1 rounded-md text-[7px] font-black uppercase tracking-widest transition-all ${stoneProfile === 'large' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                >
                  Large
                </button>
                <button 
                  onClick={() => setStoneProfile('small')}
                  className={`flex-1 py-1 rounded-md text-[7px] font-black uppercase tracking-widest transition-all ${stoneProfile === 'small' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                >
                  Small
                </button>
              </div>
            </div>

            <div className="space-y-1 mb-4">
              <div className="flex justify-between text-[8px] font-bold text-white/40">
                <span>SENSITIVITY</span>
                <span className="text-white">{sensitivity.toFixed(1)}x</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="5" 
                step="0.1"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white cursor-pointer"
              />
            </div>

            {[
              { label: 'DENSITY', val: arduinoData.density, color: 'bg-blue-500' },
              { label: 'POROSITY', val: arduinoData.porosity, color: 'bg-green-500' },
              { label: 'HARDNESS', val: arduinoData.hardness, color: 'bg-red-500' },
              { label: 'COMPLEXITY', val: arduinoData.complexity, color: 'bg-purple-500' },
              { label: 'ACTIVITY', val: arduinoData.activity, color: 'bg-yellow-500' },
              { label: 'INTERFACE', val: arduinoData.interfaceCount, color: 'bg-cyan-500' },
              { label: 'VOLUME', val: volume, color: 'bg-white', isTrigger: true },
            ].map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="flex justify-between text-[8px] font-bold">
                  <span>{s.label}</span>
                  <span className="text-white">{(s.val * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden relative">
                  <motion.div 
                    className={`h-full ${s.color} ${s.isTrigger && s.val > 0.3 ? 'shadow-[0_0_8px_rgba(255,255,255,0.8)]' : ''}`}
                    animate={{ width: `${s.val * 100}%` }}
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                  />
                  {s.isTrigger && (
                    <div className="absolute top-0 left-[35%] w-px h-full bg-red-500/50 z-10" title="Trigger Threshold" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {isListening && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex justify-between text-[8px] font-bold mb-1">
                <span>MIC VOLUME</span>
                <span className="text-white">{(volume * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500"
                  animate={{ width: `${Math.min(100, volume * 100)}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              </div>
            </div>
          )}

          {showLog && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex justify-between items-center mb-2">
                <p className="text-[8px] font-bold text-white/30 uppercase">Data History (Last 50):</p>
                <button 
                  onClick={() => {
                    const csv = "Time,Density,Porosity,Hardness,Complexity,Activity,Interface\n" + 
                      dataLog.map(d => `${d.time},${d.density},${d.porosity},${d.hardness},${d.complexity},${d.activity},${d.interfaceCount}`).join("\n");
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `sensor_data_${Date.now()}.csv`;
                    a.click();
                  }}
                  className="text-[8px] bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded text-white"
                >
                  Export CSV
                </button>
              </div>
              <div className="bg-black/50 p-2 rounded-lg text-[7px] text-blue-300 h-32 overflow-y-auto font-mono">
                {dataLog.slice().reverse().map((d, i) => (
                  <div key={i} className="border-b border-white/5 py-1">
                    <span className="text-white/30 mr-2">[{d.time}]</span>
                    D:{d.density?.toFixed(2)} P:{d.porosity?.toFixed(2)} H:{d.hardness?.toFixed(2)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showRawData && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-[8px] font-bold text-white/30 uppercase mb-2">Raw Serial Stream:</p>
              <div className="bg-black/50 p-2 rounded-lg text-[8px] text-green-400 h-24 overflow-y-auto font-mono">
                {rawSerialLines.map((line, i) => (
                  <div key={i} className="truncate opacity-70">{line}</div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {!showDashboard && (isSerialConnected || isListening || inputMode === 'keyboard') && (
        <button 
          onClick={() => setShowDashboard(true)}
          className="fixed top-8 left-8 z-50 p-3 bg-black/80 text-white rounded-full border border-white/10 shadow-xl hover:bg-black transition-all"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <motion.div className="relative z-10 w-full max-w-5xl aspect-video drop-shadow-2xl">
        {/* Reset Button */}
        {hasStarted && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setStep(0)}
            className="absolute -top-16 right-0 p-2 text-white/50 hover:text-white transition-colors"
            title="Restart Evolution"
          >
            <RotateCcw size={20} />
          </motion.button>
        )}

        <motion.svg 
          viewBox="0 0 1066 600" 
          className="w-full h-full" 
          xmlns="http://www.w3.org/2000/svg" 
          style={{ background: 'transparent' }}
          animate={{
            scale: (isSerialConnected || isListening || inputMode === 'keyboard') ? (1 + arduinoData.activity * 0.05 * sensitivity) : 1,
            filter: (isSerialConnected || isListening || inputMode === 'keyboard') && arduinoData.activity > 0.8 ? "contrast(1.2) brightness(1.1)" : "none"
          }}
        >
          <defs>
            <clipPath id="shapeClip">
              <path d={paperPath} />
            </clipPath>

            {/* Grainy Texture Filter */}
            <filter id="grainy">
              <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.15" />
              </feComponentTransfer>
              <feComposite operator="in" in2="SourceGraphic" />
            </filter>

            {/* Ink Wash / Bleed Filter for Step 11 - Refined for Clarity */}
            <filter id="inkFilter" x="-50%" y="-50%" width="200%" height="200%">
              <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="15" xChannelSelector="R" yChannelSelector="G" result="distorted" />
              <feGaussianBlur in="distorted" stdDeviation="3" result="blurred" />
              <feComponentTransfer in="blurred" result="ink">
                <feFuncA type="linear" slope="1.3" intercept="-0.1" />
              </feComponentTransfer>
              <feComposite in="SourceGraphic" in2="ink" operator="over" />
            </filter>

            {/* Subtle Micro-grid Pattern */}
            <pattern id="microGrid" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(150,150,150,0.05)" strokeWidth="0.5"/>
            </pattern>

            {/* Dense Etching Pattern for Step 7 */}
            <pattern id="denseEtching" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M 0 2 L 12 10 M 2 0 L 10 12 M 0 6 L 12 6 M 6 0 L 6 12" stroke="rgba(150,150,150,0.15)" strokeWidth="0.2"/>
              <path d="M 0 0 L 12 12 M 12 0 L 0 12" stroke="rgba(150,150,150,0.1)" strokeWidth="0.1"/>
            </pattern>

            {/* Stipple Pattern for Step 7 */}
            <pattern id="stipple" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.4" fill="rgba(150,150,150,0.1)" />
              <circle cx="3" cy="3" r="0.3" fill="rgba(150,150,150,0.05)" />
            </pattern>

            {/* Woodcut Texture Pattern */}
            <pattern id="woodcut" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
              <path d="M 0 5 Q 5 0, 10 5 T 20 5" fill="none" stroke="rgba(150,150,150,0.08)" strokeWidth="0.8"/>
              <path d="M 0 15 Q 5 10, 10 15 T 20 15" fill="none" stroke="rgba(150,150,150,0.05)" strokeWidth="0.5"/>
              <path d="M 5 0 L 5 20" fill="none" stroke="rgba(150,150,150,0.03)" strokeWidth="0.3"/>
            </pattern>

            {/* Stone Texture Pattern */}
            <pattern id="stoneTexture" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
              <rect width="100" height="100" fill="transparent" />
              <path d="M 0 20 Q 25 5, 50 20 T 100 10" fill="none" stroke="rgba(150,150,150,0.08)" strokeWidth="1" opacity="0.5" />
              <path d="M 10 0 Q 5 25, 20 50 T 10 100" fill="none" stroke="rgba(150,150,150,0.08)" strokeWidth="1" opacity="0.5" />
              <circle cx="30" cy="70" r="12" fill="rgba(150,150,150,0.03)" />
              <circle cx="80" cy="40" r="8" fill="rgba(150,150,150,0.04)" />
              <path d="M 40 40 L 45 45 M 60 60 L 65 65" stroke="rgba(150,150,150,0.1)" strokeWidth="0.5" />
            </pattern>

            {/* Gritty Noise Pattern */}
            <pattern id="grittyTexture" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="transparent" />
              <circle cx="1" cy="1" r="0.5" fill="rgba(150,150,150,0.15)" />
              <circle cx="3" cy="2" r="0.3" fill="rgba(150,150,150,0.1)" />
            </pattern>

            {/* Wavy/Rippled Texture */}
            <pattern id="wavyTexture" x="0" y="0" width="20" height="10" patternUnits="userSpaceOnUse">
              <path d="M 0 5 Q 5 0, 10 5 T 20 5" fill="none" stroke="rgba(150,150,150,0.1)" strokeWidth="0.5" opacity="0.4" />
            </pattern>

            {/* Subtle Gradient for the Shape */}
            <linearGradient id="shapeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D8D8D8" />
              <stop offset="50%" stopColor="#D1D1D1" />
              <stop offset="100%" stopColor="#C8C8C8" />
            </linearGradient>

            {/* Newspaper Text Pattern */}
            <pattern id="newspaperText" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <rect width="40" height="40" fill="rgba(255,255,255,0.1)" />
              <path d="M 5 10 L 35 10 M 5 15 L 30 15 M 5 20 L 35 20 M 5 25 L 25 25 M 5 30 L 35 30" stroke="rgba(150,150,150,0.2)" strokeWidth="1" />
            </pattern>

            {/* Radial Gear/Mandala Pattern */}
            <pattern id="radialCutout" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(150,150,150,0.15)" strokeWidth="0.5" strokeDasharray="2,2" />
              <circle cx="15" cy="15" r="8" fill="none" stroke="rgba(150,150,150,0.1)" strokeWidth="1" strokeDasharray="1,3" />
              <path d="M 15 3 L 15 27 M 3 15 L 27 15 M 6 6 L 24 24 M 6 24 L 24 6" stroke="rgba(150,150,150,0.1)" strokeWidth="0.5" />
            </pattern>
          </defs>

          <g transform="translate(533, 300) rotate(-90) translate(-300, -400)">
            {/* The "Paper" base shape with texture */}
            <g>
            <motion.path
              d={paperPath}
              fill="transparent"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ 
                scale: step >= 4 ? [1, 1.01, 1] : 1,
                opacity: step >= 6 ? 0 : (step >= 5 ? 0.4 : (step >= 4 ? 0.8 : 1)),
              }}
              transition={{ 
                scale: step >= 4 ? { duration: 6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.8 },
                opacity: { duration: 1.5 }
              }}
            />
            
            {/* Texture Layer 1: Micro-grid */}
            <motion.path
              d={paperPath}
              fill="url(#microGrid)"
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: step === 1 ? 0.3 : (step === 2 ? 0.25 : (step >= 5 ? 0 : (step >= 4 ? 0.1 : 0.15))) 
              }}
              transition={{ duration: 1.2, delay: 0.4 }}
              pointerEvents="none"
            />

            {/* Texture Layer 2: Woodcut Texture */}
            <motion.path
              d={paperPath}
              fill="url(#woodcut)"
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: step === 1 ? 0.2 : (step === 2 ? 0.15 : (step >= 5 ? 0 : (step >= 4 ? 0.1 : 0.1))) 
              }}
              transition={{ duration: 1.5, delay: 0.6 }}
              pointerEvents="none"
            />

            {/* Texture Layer 3: Grain */}
            <motion.path
              d={paperPath}
              fill="#000"
              filter="url(#grainy)"
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: step === 1 ? 0.1 : (step === 2 ? 0.08 : (step >= 5 ? 0 : (step >= 4 ? 0.05 : 0.05))) 
              }}
              transition={{ duration: 1.5, delay: 0.8 }}
              pointerEvents="none"
            />

            {/* Texture Layer 4: Dense Etching & Stipple (Step 2+) */}
            <AnimatePresence>
              {step >= 2 && (
                <motion.g key="etching-group">
                  <motion.path
                    d={paperPath}
                    fill="url(#stipple)"
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: step === 2 ? 0.2 : (step >= 5 ? 0 : (step >= 4 ? 0.05 : 0.1)) 
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.5 }}
                    pointerEvents="none"
                  />
                  <motion.path
                    d={paperPath}
                    fill="url(#denseEtching)"
                    initial={{ opacity: 0 }}
                    animate={{ 
                      opacity: step === 2 ? 0.15 : (step >= 5 ? 0 : (step >= 4 ? 0.05 : 0.08)) 
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2, delay: 0.5 }}
                    pointerEvents="none"
                  />
                </motion.g>
              )}
            </AnimatePresence>
          </g>

          {/* Interactive Elements clipped to shape */}
          <g clipPath={step >= 9 ? undefined : "url(#shapeClip)"}>
            <AnimatePresence>
              {/* Regular Grid Layers (Step 1 & 2) */}
              {step >= 1 && step <= 2 && (
                <motion.g 
                  key="lines-layer" 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: step === 1 ? 1 : 0.4 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.5 }}
                >
                  {allGridLines.map((line) => {
                    // Show all levels in Step 1 to form the dense grid
                    const isVisible = line.level <= 4;

                    if (!isVisible) return null;

                    return (
                      <motion.line
                        key={line.id}
                        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                        stroke={colors.lines}
                        strokeWidth={line.level === 1 ? "1" : "0.5"}
                        opacity={0.6}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ 
                          duration: 2, 
                          ease: "easeInOut",
                          // Staggered growth from center/main lines
                          delay: line.level === 1 ? 0 : 0.5 + Math.random() * 1.5
                        }}
                      />
                    );
                  })}

                  {/* Flickering White Squares in Step 1 */}
                  {flickerIndices.map((idx, i) => {
                    const size = 16;
                    const stepSize = 600 / size;
                    const x = idx % size;
                    const y = Math.floor(idx / size);
                    
                    return (
                      <motion.rect
                        key={`flicker-${idx}-${i}`}
                        x={x * stepSize}
                        y={y * stepSize + 100}
                        width={stepSize}
                        height={stepSize}
                        fill={colors.highlight}
                        style={{ transformOrigin: 'center', transformBox: 'fill-box' }}
                        initial={{ opacity: 0, scale: 1 }}
                        animate={{ 
                          opacity: [0, 1, 0.5, 1, 0],
                          scale: 1
                        }}
                        transition={{ 
                          duration: 0.4,
                          ease: "easeInOut"
                        }}
                      />
                    );
                  })}

                  {/* Dense Quadtree Fractal Grid Overlay in Step 1 */}
                  {quadtreeLines.map((line) => (
                    <motion.line
                      key={line.id}
                      x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                      stroke={colors.lines}
                      strokeWidth={line.depth < 4 ? "0.8" : "0.3"}
                      opacity={line.depth < 4 ? "0.8" : "0.5"}
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ 
                        duration: 1.5, 
                        ease: "easeInOut",
                        delay: 1 + line.depth * 0.1 + Math.random() * 0.5
                      }}
                    />
                  ))}
                </motion.g>
              )}

              {/* Step 2: Ultra-dense Glitch Fractal (Old Step 6-7) */}
              {step >= 2 && (
                <motion.g 
                  key="glitch-layer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 1.5 }}
                >
                  {glitchLines.map((line) => {
                    const isTop = line.y1 < 400;
                    const isBoundary = line.type === 'boundary';
                    return (
                      <motion.line
                        key={line.id}
                        x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                        stroke={colors.lines}
                        strokeWidth={isBoundary ? "0.4" : "0.2"}
                        opacity={step >= 6 ? 0 : (step >= 5 ? 0.1 : (step >= 4 ? (isBoundary ? 0.2 : 0.1) : (isBoundary ? 0.8 : 0.5)))}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ 
                          duration: 1.5, 
                          ease: "easeInOut",
                          delay: (isTop ? (line.y1 / 400) : ((800 - line.y1) / 400)) + Math.random() * 0.2
                        }}
                      />
                    );
                  })}
                </motion.g>
              )}
            </AnimatePresence>
          </g>

          {/* Step 8, 9 & 10: Unclipped Colorful Grid Overlay */}
          {/* We move this outside the clipPath group so circles on the edge are "completed" */}
          <AnimatePresence>
            {step >= 3 && (
              <motion.g 
                key="step8-layer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.5 }}
              >
                {step8Blocks.map((block, idx) => {
                  const isStep13 = step === 13;
                  const isStep12 = step === 12;
                  const isStep11 = step >= 11;
                  const isStep10 = step >= 10;
                  const isStep9 = step >= 9;
                  const isStep8 = step >= 8;
                  const isStep7 = step >= 7;
                  const isStep6 = step >= 6;
                  const isStep5 = step >= 5;
                  const isStep4 = step >= 4;
                  
                  // In Step 11/12/13, we merge all blocks into central points
                  const targetX = isStep13 ? block.twinX : (isStep12 ? [block.splitX, block.mergeX] : (isStep11 ? block.fusionX : (isStep10 ? block.stackX : (isStep8 ? block.gridX : (isStep7 || isStep6 ? block.x + block.driftX + jitter.x : block.x)))));
                  const targetY = isStep13 ? block.twinY : (isStep12 ? [block.splitY, block.mergeY] : (isStep11 ? block.fusionY : (isStep10 ? block.stackY : (isStep8 ? block.gridY : (isStep7 || isStep6 ? block.y + block.driftY + jitter.y : block.y)))));
                  
                  // Final steps are static and neatly arranged
                  const targetScale = isStep13 ? block.twinScale : (isStep12 ? block.splitScale : (isStep11 ? block.fusionScale : (isStep10 ? 1.2 : (isStep9 ? 0.9 : (isStep8 ? 0.8 : (isStep7 ? 1.2 : (isStep5 ? 1.1 : 1)))))));
                  
                  const targetRotate = isStep13 ? block.twinRotate : (isStep12 ? block.splitRotate : (isStep11 ? block.fusionRotate : (isStep10 ? (idx % 2 === 0 ? 5 : -5) : (isStep9 ? 0 : (isStep7 ? block.rotation * 2 : (isStep6 ? block.rotation : 0))))));
                  
                  // Stone-like rounding for Step 10, 11 & 12, Geometric for 13
                  let targetRx = isStep13 ? block.twinRx : ((isStep11 || isStep12) ? block.size * 0.45 : (isStep8 
                    ? (block.gridShape === 'circle' ? block.size / 2 : 0)
                    : (isStep5 ? block.step10Rx : (isStep4 ? block.size / 4 : 0))));

                  if (isStep10 && !isStep11 && !isStep12 && !isStep13) {
                    if (block.stoneType === 'circle') targetRx = block.size / 2;
                    else if (block.stoneType === 'square') targetRx = block.size * 0.1;
                    else if (block.stoneType === 'ellipse' || block.stoneType === 'organic') targetRx = block.size * 0.4;
                    else targetRx = 0; // Rhombus handled by scale/rotate or clip
                  }

                  // In Step 10/11/12/13, we only want subset of blocks to be fully visible to simulate merging
                  const isMainStone = idx % 10 === 0; // Pick one block per row (assuming 10 cols)
                  const step10Opacity = isStep10 ? (isMainStone ? 1 : 0.1) : 1;
                  const step11Opacity = isStep11 ? (idx % 15 === 0 ? 0.95 : 0.05) : step10Opacity;
                  const step12Opacity = isStep12 ? (idx % 12 === 0 ? 0.9 : 0.1) : step11Opacity;
                  const finalOpacity = isStep13 ? (idx % 10 === 0 ? 1 : 0) : step12Opacity;

                  const stoneWidth = isStep10 ? block.size * block.stoneWidthScale : block.size;
                  const stoneHeight = isStep10 ? block.size * block.stoneHeightScale : block.size;

                  return (
                    <motion.g 
                      key={block.id}
                      animate={{
                        x: targetX - block.x + (isStep10 ? (block.size - stoneWidth) / 2 : 0) + ((isSerialConnected || isListening || inputMode === 'keyboard') && step < 11 ? block.jitterSeedX * Math.pow(arduinoData.complexity, 0.7) * 80 * sensitivity : 0),
                        y: targetY - block.y + (isStep10 ? (block.size - stoneHeight) / 2 : 0) + ((isSerialConnected || isListening || inputMode === 'keyboard') && step < 11 ? block.jitterSeedY * Math.pow(arduinoData.complexity, 0.7) * 80 * sensitivity : 0),
                        scale: targetScale * ((isSerialConnected || isListening || inputMode === 'keyboard') && step < 11 ? (0.6 + Math.pow(arduinoData.interfaceCount, 0.5) * 1.2 * sensitivity) : 1),
                        rotate: targetRotate + (isStep10 && block.stoneType === 'rhombus' ? 45 : 0) + ((isSerialConnected || isListening || inputMode === 'keyboard') && step < 11 ? arduinoData.hardness * 360 * sensitivity : 0),
                        opacity: finalOpacity
                      }}
                      transition={{ 
                        duration: (isStep11 || isStep12 || isStep13) ? 3 : (isStep10 ? 2.5 : (isStep8 ? 2 : (isStep7 || isStep6 ? 0.2 : 1))),
                        type: "spring",
                        stiffness: (isStep11 || isStep12 || isStep13) ? 20 : (isStep10 ? 30 : (isStep8 ? 50 : 100)),
                        damping: 15
                      }}
                      style={{ transformOrigin: `${block.x + block.size/2}px ${block.y + block.size/2}px` }}
                    >
                      {/* Static Wrapper for final steps */}
                      <motion.g
                        animate={{
                          x: 0,
                          y: 0,
                          rotate: 0,
                          scale: 1
                        }}
                        transition={{ duration: 0.5 }}
                      >
                        <motion.rect
                          x={block.x}
                          y={block.y}
                          width={stoneWidth}
                          height={stoneHeight}
                          rx={(isSerialConnected || isListening || inputMode === 'keyboard') ? (arduinoData.porosity < 0.2 ? 0 : (arduinoData.porosity < 0.5 ? stoneWidth/2 : (arduinoData.porosity < 0.8 ? stoneWidth/4 : 0))) : targetRx}
                          fill={block.color}
                          opacity={isStep8 ? 0.8 : block.opacity}
                          stroke={isStep8 ? "rgba(255,255,255,0.4)" : "rgba(100,100,100,0.1)"}
                          strokeWidth={isStep8 ? "1" : "0.2"}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ 
                            opacity: isStep8 ? 0.8 : (step >= 3 && block.isShimmering ? [block.opacity, 0.05, block.opacity] : block.opacity),
                            filter: (step === 11 || step === 12) ? "url(#inkFilter)" : (isStep8 ? `drop-shadow(0 0 8px ${block.color})` : 'none'),
                            // Enhanced Hue shift with sound, while keeping overall saturation low and avoiding black
                            fill: (isSerialConnected || isListening || inputMode === 'keyboard') ? `hsl(${block.hue + (arduinoData.density * 180)}, ${block.saturation * 0.4 * (0.5 + arduinoData.density * 1.5)}%, ${Math.max(40, block.lightness)}%)` : block.color
                          }}
                          transition={{ 
                            duration: 3, 
                            delay: Math.random() * 0.5 + (block.y / 800),
                            opacity: (step >= 3 && block.isShimmering) ? {
                              duration: 4,
                              repeat: Infinity,
                              ease: "easeInOut",
                              delay: Math.random() * 2
                            } : { duration: 3 }
                          }}
                        />

                        {/* Texture Overlay Layer */}
                        <rect
                          x={block.x}
                          y={block.y}
                          width={stoneWidth}
                          height={stoneHeight}
                          rx={targetRx}
                          fill={`url(#${block.blockTexture})`}
                          style={{ mixBlendMode: 'multiply', pointerEvents: 'none' }}
                          opacity={isStep8 ? 0.4 : 0.6}
                        />

                        {/* Inner Geometric Bridge Layer (Step 7, 8, 9) */}
                        {(isStep7 || isStep8 || isStep9) && !isStep10 && (
                          <motion.g
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ 
                              opacity: 1, 
                              scale: 1,
                              y: (isStep8 && !isStep9) ? [0, -20, 0] : 0
                            }}
                            transition={{
                              y: (isStep8 && !isStep9) ? {
                                duration: 4 + Math.random() * 2,
                                repeat: Infinity,
                                ease: "easeInOut"
                              } : { duration: 0.8 }
                            }}
                          >
                            {/* Nested Geometric Shape 1 */}
                            <motion.rect
                              x={block.x + block.size * 0.2}
                              y={block.y + block.size * 0.2}
                              width={block.size * 0.6}
                              height={block.size * 0.6}
                              rx={targetRx * 0.6}
                              fill="white"
                              opacity={isStep7 ? 0.3 : 0.15}
                              animate={{
                                rotate: isStep7 ? [0, 90, 0] : 0
                              }}
                              transition={{
                                rotate: isStep7 ? {
                                  duration: 6,
                                  repeat: Infinity,
                                  ease: "linear"
                                } : { duration: 0.5 },
                                duration: 0.8
                              }}
                            />
                            {/* Nested Geometric Shape 2 */}
                            <motion.rect
                              x={block.x + block.size * 0.35}
                              y={block.y + block.size * 0.35}
                              width={block.size * 0.3}
                              height={block.size * 0.3}
                              rx={targetRx * 0.3}
                              fill="rgba(150,150,150,0.1)"
                              opacity={isStep7 ? 0.2 : 0.1}
                              animate={isStep9 ? {
                                scale: [1, 1.2, 1],
                                opacity: [0.1, 0.3, 0.1]
                              } : {}}
                              transition={isStep9 ? {
                                duration: 3,
                                repeat: Infinity,
                                ease: "easeInOut"
                              } : {}}
                            />
                            {/* Final Glow for Step 8, 9 */}
                            {(isStep8 || isStep9) && (
                              <circle 
                                cx={block.x + block.size/2} 
                                cy={block.y + block.size/2} 
                                r={block.size/6} 
                                fill="white" 
                                opacity="0.4"
                              />
                            )}
                          </motion.g>
                        )}
                      </motion.g>

                      {/* Coordinate Labels for Step 6 & 7 */}
                      {(isStep6 || isStep7) && idx % 4 === 0 && (
                        <text
                          x={block.x + block.size + 2}
                          y={block.y + block.size / 2}
                          fontSize="4"
                          fontFamily="monospace"
                          fill="rgba(100,100,100,0.6)"
                          style={{ pointerEvents: 'none' }}
                        >
                          {block.coordLabel}
                        </text>
                      )}

                      {/* Shimmer Layer - Only active in Step 3 (Stage 8) */}
                      {block.isShimmering && step === 3 && (
                        <motion.rect
                          x={block.x}
                          y={block.y}
                          width={block.size}
                          height={block.size}
                          rx={isStep5 ? block.step10Rx : (isStep4 ? block.size/4 : 0)}
                          fill={block.shimmerColor}
                          animate={{
                            opacity: [0, 0.8, 0],
                            scale: [1, 1.05, 1],
                          }}
                          transition={{
                            duration: 2 + Math.random() * 2,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: Math.random() * 5
                          }}
                          style={{ mixBlendMode: 'screen' }}
                        />
                      )}
                      
                      {/* Textures */}
                      {step >= 3 && block.textureType !== 'none' && (
                        <motion.rect
                          x={block.x}
                          y={block.y}
                          width={block.size}
                          height={block.size}
                          rx={isStep5 ? block.step10Rx : (isStep4 ? block.size/4 : 0)}
                          fill={block.textureType === 'newspaper' ? "url(#newspaperText)" : "url(#radialCutout)"}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.4 }}
                          transition={{ duration: 4, delay: Math.random() * 0.5 }}
                        />
                      )}
                      {block.hasDots && Array.from({ length: (isSerialConnected || isListening || inputMode === 'keyboard') ? Math.floor(Math.pow(arduinoData.activity, 0.6) * 40) : block.dotCount }).map((_, i) => (
                        <circle
                          key={`${block.id}-dot-${i}`}
                          cx={block.x + (block.dotSeeds?.[i]?.x || 0.5) * block.size}
                          cy={block.y + (block.dotSeeds?.[i]?.y || 0.5) * block.size}
                          r={0.5 + (block.dotSeeds?.[i]?.r || 0.5) * 1.5}
                          fill="rgba(150,150,150,0.3)"
                        />
                      ))}
                    </motion.g>
                  );
                })}
              </motion.g>
            )}
          </AnimatePresence>
          </g>
        </motion.svg>
      </motion.div>

      {/* Retry Button at the end */}
      <AnimatePresence>
        {step === 13 && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setStep(0)}
            className="mt-8 px-10 py-4 bg-[#4A4A4A] text-white rounded-full shadow-2xl font-medium tracking-widest uppercase text-sm"
          >
            Retry Experience
          </motion.button>
        )}
      </AnimatePresence>

      {/* Compact Integrated Navigation (Bottom Center of screen) */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center bg-black/40 backdrop-blur-xl rounded-lg border border-white/20 overflow-hidden shadow-2xl">
        <button 
          onClick={() => setStep((prev) => Math.max(0, prev - 1))}
          className="p-3 hover:bg-white/10 text-white/60 hover:text-white transition-colors border-r border-white/10"
          title="Previous Step"
        >
          <ChevronLeft size={18} />
        </button>
        
        <div className="px-5 py-2.5 flex flex-col items-center min-w-[100px]">
          <span className="text-[11px] font-mono text-white/80 uppercase tracking-widest mb-2">
            STAGE {step} <span className="opacity-40">/</span> 13
          </span>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
              animate={{ width: `${(step / 13) * 100}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>

        <button 
          onClick={() => setStep((prev) => Math.min(13, prev + 1))}
          className="p-3 hover:bg-white/10 text-white/60 hover:text-white transition-colors border-l border-white/10"
          title="Next Step"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <AnimatePresence>
        {showStatusOverlay && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] bg-black/90 backdrop-blur-xl border border-white/20 px-8 py-4 rounded-full shadow-2xl flex items-center gap-4"
          >
            <div className={`w-3 h-3 rounded-full ${((isSerialConnected && Date.now() - lastDataTime < 500) || isListening || inputMode === 'keyboard') ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <div className="flex flex-col">
              <span className="text-white text-[11px] font-black uppercase tracking-widest">
                {inputMode === 'serial' ? (isSerialConnected ? "Arduino Connected" : "Arduino Disconnected") : 
                 inputMode === 'audio' ? (isListening ? "Microphone Active" : "Microphone Off") : "Keyboard Mode Active"}
              </span>
              <span className="text-white/40 text-[9px] font-bold uppercase tracking-widest">
                {((isSerialConnected && Date.now() - lastDataTime < 500) || isListening || inputMode === 'keyboard') ? "System Running Normally" : "Waiting for Data Stream..."}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
