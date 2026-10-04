// Placeholder for HistoryHeader component
import { History } from 'lucide-react';

export default function HistoryHeader() {
  return (
    <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-purple-50">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-400 to-purple-400 text-white flex items-center justify-center shadow-md">
          <History className="w-5 h-5" />
        </div>
        <span className="font-semibold text-lg text-slate-800">对话历史</span>
      </div>
    </div>
  );
} 