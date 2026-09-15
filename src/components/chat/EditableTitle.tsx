"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditableTitleProps {
  initialTitle: string;
  onTitleChange: (newTitle: string) => void;
  className?: string;
  inputClassName?: string;
  buttonSize?: "sm" | "icon" | "default" | "lg" | null;
}

export function EditableTitle({
  initialTitle,
  onTitleChange,
  className,
  inputClassName,
}: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEditing = () => {
    setIsEditing(true);
  };

  const handleConfirm = () => {
    if (title.trim() !== '') {
      onTitleChange(title.trim());
      setIsEditing(false);
    } else {
      setTitle(initialTitle);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setTitle(initialTitle);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex items-center gap-1 min-w-0 flex-1 max-w-[min(50vw,24rem)]", className)}>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleConfirm}
          className={cn(
            "min-w-0 flex-1 h-7 bg-transparent border-0 border-b border-slate-300/70 dark:border-slate-600/60 rounded-none px-0.5 text-xs text-slate-700 dark:text-slate-200",
            "inline-edit outline-none focus:ring-0 shadow-none",
            inputClassName
          )}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleConfirm}
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="确认"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleCancel}
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="取消"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <span
      className={cn("cursor-pointer truncate hover:text-slate-700 dark:hover:text-slate-200 transition-colors", className)}
      onClick={handleStartEditing}
      onDoubleClick={handleStartEditing}
      title="点击编辑标题"
    >
      {initialTitle}
    </span>
  );
}
