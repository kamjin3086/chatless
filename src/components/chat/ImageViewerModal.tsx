"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

interface ImageViewerModalProps {
  open: boolean;
  onClose: () => void;
  src: string; // data URL
  filename?: string;
}

export function ImageViewerModal({ open, onClose, src, filename }: ImageViewerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [rotate, setRotate] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setScale(1);
      setRotate(0);
      setOffset({ x: 0, y: 0 });
      setDragging(false);
      dragStart.current = null;
    }
  }, [open]);

  const download = () => {
    try {
      const a = document.createElement('a');
      a.href = src;
      a.download = filename || 'image.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch { /* noop */ }
  };

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.max(0.2, Math.min(8, +(s + delta).toFixed(2))));
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!dragging || !dragStart.current) return;
    setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const onMouseUp: React.MouseEventHandler<HTMLDivElement> = () => {
    setDragging(false);
    dragStart.current = null;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] glass-scrim bg-black/80 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="relative w-[92vw] h-[92vh] bg-white dark:bg-slate-900 rounded-lg shadow-xl glass-overlay" onClick={(e)=>e.stopPropagation()}>
        {/* Toolbar */}
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <button className="px-2 py-1 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-700" onClick={download}>下载</button>
          <button className="px-2 py-1 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-700" onClick={() => setScale((s)=>Math.min(8, +(s+0.2).toFixed(2)))}>放大</button>
          <button className="px-2 py-1 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-700" onClick={() => setScale((s)=>Math.max(0.2, +(s-0.2).toFixed(2)))}>缩小</button>
          <button className="px-2 py-1 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-700" onClick={() => { setScale(1); setOffset({x:0,y:0}); setRotate(0); }}>重置</button>
          <button className="px-2 py-1 text-xs rounded-md bg-slate-800 text-white hover:bg-slate-700" onClick={() => setRotate((r)=> (r+90)%360)}>旋转</button>
          <button className="px-2 py-1 text-xs rounded-md bg-slate-600 text-white hover:bg-slate-500" onClick={onClose}>关闭</button>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <div
            className="w-full h-full flex items-center justify-center select-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px)`
            }}
          >
            {/* 原图 */}
            <img
              src={src}
              alt="preview"
              draggable={false}
              className="max-w-none"
              style={{ transform: `scale(${scale}) rotate(${rotate}deg)` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


