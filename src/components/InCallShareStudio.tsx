import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  X, 
  PenTool, 
  Eraser, 
  Trash2, 
  Image as ImageIcon, 
  Upload, 
  Undo, 
  Download, 
  Sparkles, 
  Youtube, 
  Play, 
  Maximize2,
  Minimize2,
  Highlighter,
  Palette
} from 'lucide-react';

export type InCallShareType = 'whiteboard' | 'photo' | 'youtube';

interface InCallShareStudioProps {
  initialType?: InCallShareType;
  onStreamReady: (stream: MediaStream, type: InCallShareType) => void;
  onStopSharing: () => void;
  isOtherPartySharing?: boolean;
}

export const InCallShareStudio: React.FC<InCallShareStudioProps> = ({
  initialType = 'whiteboard',
  onStreamReady,
  onStopSharing,
  isOtherPartySharing = false
}) => {
  const [activeTab, setActiveTab] = useState<InCallShareType>(initialType);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Whiteboard drawing tools
  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [color, setColor] = useState<string>('#3b82f6'); // blue
  const [lineWidth, setLineWidth] = useState<number>(4);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);

  // Photo presentation state
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [photoScale, setPhotoScale] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // YouTube Watch Together state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Colors available for whiteboard
  const colors = [
    { label: 'White', value: '#ffffff' },
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Emerald', value: '#10b981' },
    { label: 'Amber', value: '#f59e0b' },
    { label: 'Rose', value: '#f43f5e' },
    { label: 'Purple', value: '#a855f7' },
    { label: 'Dark', value: '#0f172a' }
  ];

  // Helper to extract YouTube video ID
  const extractVideoId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  // Initialize canvas and stream capture
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill initial canvas with clean slate background
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid pattern / watermark
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Save initial state to history
    const initialData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory([initialData]);

    // Create stream from canvas
    try {
      let captureStream: MediaStream | null = null;
      if (typeof (canvas as any).captureStream === 'function') {
        captureStream = (canvas as any).captureStream(30);
      } else if (typeof (canvas as any).mozCaptureStream === 'function') {
        captureStream = (canvas as any).mozCaptureStream(30);
      }

      if (captureStream) {
        streamRef.current = captureStream;
        onStreamReady(captureStream, activeTab);
      }
    } catch (err) {
      console.warn('Canvas stream capture error:', err);
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // When active tab changes, redraw canvas appropriately
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (activeTab === 'photo' && selectedPhoto) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculate aspect ratio fit
        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio = Math.min(hRatio, vRatio) * 0.9 * photoScale;
        const centerShiftX = (canvas.width - img.width * ratio) / 2;
        const centerShiftY = (canvas.height - img.height * ratio) / 2;
        
        ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);
        
        // Save state
        const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setHistory(prev => [...prev.slice(-10), currentData]);
      };
      img.src = selectedPhoto;
    }
  }, [activeTab, selectedPhoto, photoScale]);

  // Touch & Pointer Coordinates
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  // Start Drawing
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);

    ctx.beginPath();
    ctx.moveTo(x, y);

    if (tool === 'eraser') {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = lineWidth * 4;
      ctx.globalAlpha = 1.0;
    } else if (tool === 'highlighter') {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * 3;
      ctx.globalAlpha = 0.4;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = 1.0;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  // Draw Line
  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  // Stop Drawing & Record History
  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.closePath();
    ctx.globalAlpha = 1.0;

    const currentData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory(prev => [...prev.slice(-15), currentData]);
  };

  // Undo Last Action
  const handleUndo = () => {
    if (history.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const newHistory = history.slice(0, history.length - 1);
    const previousState = newHistory[newHistory.length - 1];
    ctx.putImageData(previousState, 0, 0);
    setHistory(newHistory);
  };

  // Clear Board
  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Redraw subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    if (activeTab === 'photo' && selectedPhoto) {
      const img = new Image();
      img.onload = () => {
        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio = Math.min(hRatio, vRatio) * 0.9 * photoScale;
        const centerShiftX = (canvas.width - img.width * ratio) / 2;
        const centerShiftY = (canvas.height - img.height * ratio) / 2;
        ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setHistory([data]);
      };
      img.src = selectedPhoto;
    } else {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setHistory([data]);
    }
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setSelectedPhoto(result);
      setActiveTab('photo');
    };
    reader.readAsDataURL(file);
  };

  // Handle YouTube Play
  const handlePlayYoutube = (e: React.FormEvent) => {
    e.preventDefault();
    const vid = extractVideoId(youtubeUrl);
    if (vid) {
      setActiveVideoId(vid);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-white rounded-3xl overflow-hidden relative border border-slate-800 shadow-2xl">
      {/* Studio Top Header */}
      <div className="p-3 sm:p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            {activeTab === 'whiteboard' && <PenTool className="w-4 h-4" />}
            {activeTab === 'photo' && <ImageIcon className="w-4 h-4" />}
            {activeTab === 'youtube' && <Youtube className="w-4 h-4" />}
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <span>In-Call Screen Studio</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Live 30fps Stream
              </span>
            </h4>
            <p className="text-[10px] sm:text-xs text-slate-400">
              Streaming directly to call participants in real-time
            </p>
          </div>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-2xl border border-slate-700/50">
          <button
            type="button"
            onClick={() => setActiveTab('whiteboard')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'whiteboard'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Whiteboard</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('photo');
              if (!selectedPhoto && fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'photo'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Present Photo</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'youtube'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">YouTube</span>
          </button>
        </div>

        {/* Stop Sharing Button */}
        <button
          type="button"
          onClick={onStopSharing}
          className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 flex items-center gap-1.5 shrink-0"
        >
          <X className="w-4 h-4" />
          <span>Stop Sharing</span>
        </button>
      </div>

      {/* Main Studio View Area */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-2 sm:p-4 bg-slate-950 overflow-hidden">
        {activeTab === 'youtube' ? (
          /* YouTube Shared Watch View */
          <div className="w-full h-full max-w-4xl flex flex-col items-center justify-center gap-4 p-4">
            {!activeVideoId ? (
              <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-xl">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 mx-auto flex items-center justify-center">
                  <Youtube className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Watch YouTube Together</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Paste a YouTube link to stream and watch synchronized video with friends during your call.
                  </p>
                </div>
                <form onSubmit={handlePlayYoutube} className="space-y-3">
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full px-4 py-2.5 rounded-2xl bg-slate-800 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-hidden focus:border-rose-500 transition-colors"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={!youtubeUrl}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/20"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
                        setActiveVideoId('dQw4w9WgXcQ');
                      }}
                      className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
                    >
                      Demo Video
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <div className="w-full aspect-video max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-black">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${activeVideoId}?autoplay=1&enablejsapi=1&rel=0`}
                    title="YouTube video player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveVideoId(null)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                  >
                    Change Video
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Canvas View (Whiteboard or Photo Presenter) */
          <div className="w-full h-full flex flex-col items-center justify-center relative">
            {/* The Drawing & Presentation Canvas */}
            <div className="w-full h-full flex items-center justify-center relative rounded-2xl overflow-hidden border border-slate-800/80 bg-slate-900 shadow-2xl">
              <canvas
                ref={canvasRef}
                width={1280}
                height={720}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className="w-full h-full object-contain cursor-crosshair touch-none select-none"
              />

              {activeTab === 'photo' && !selectedPhoto && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-xs gap-3 p-4 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                    <ImageIcon className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white">Present Photo or Document</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      Select any photo, screenshot, slide, or diagram to present with live drawing markups to call participants.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-600/20 flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Choose Photo or Slide</span>
                  </button>
                </div>
              )}
            </div>

            {/* Hidden File Input for Photo Presenter */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>
        )}
      </div>

      {/* Studio Bottom Toolbar (Whiteboard Controls) */}
      {activeTab !== 'youtube' && (
        <div className="p-2 sm:p-3 bg-slate-900/95 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 z-10 backdrop-blur-md">
          {/* Tools: Pen, Highlighter, Eraser */}
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-2xl border border-slate-700/50">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`p-2 rounded-xl transition-all ${
                tool === 'pen'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Pen Tool"
            >
              <PenTool className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTool('highlighter')}
              className={`p-2 rounded-xl transition-all ${
                tool === 'highlighter'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Highlighter Tool"
            >
              <Highlighter className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`p-2 rounded-xl transition-all ${
                tool === 'eraser'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Eraser Tool"
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>

          {/* Color Palette */}
          {tool !== 'eraser' && (
            <div className="flex items-center gap-1.5 bg-slate-800/80 px-2 py-1.5 rounded-2xl border border-slate-700/50">
              {colors.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-6 h-6 rounded-full transition-transform border border-slate-700/80 ${
                    color === c.value ? 'scale-125 ring-2 ring-white shadow-md' : 'hover:scale-110 opacity-80 hover:opacity-100'
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          )}

          {/* Stroke Width Selector */}
          <div className="hidden sm:flex items-center gap-1.5 bg-slate-800/80 px-2 py-1.5 rounded-2xl border border-slate-700/50 text-xs text-slate-300">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Size:</span>
            {[2, 5, 10].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setLineWidth(size)}
                className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs transition-colors ${
                  lineWidth === size
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {size === 2 ? 'S' : size === 5 ? 'M' : 'L'}
              </button>
            ))}
          </div>

          {/* Action Buttons: Undo, Clear, Upload Photo */}
          <div className="flex items-center gap-1.5">
            {activeTab === 'photo' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-colors"
                title="Change Photo"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Change</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length <= 1}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs transition-colors border border-slate-700"
              title="Undo"
            >
              <Undo className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleClear}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-400 text-xs transition-colors border border-slate-700"
              title="Clear Canvas"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
