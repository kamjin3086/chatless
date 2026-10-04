import { CheckCircle, XCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import { InputField } from "./InputField";

interface ModelCardProps {
  icon: string | React.ReactNode;
  name: string;
  isConnected: boolean;
  serviceUrl: string;
  onServiceUrlChange: (url: string) => void;
  availableModels?: string[];
  iconBgGradient?: string;
}

export function ModelCard({
  icon,
  name,
  isConnected,
  serviceUrl,
  onServiceUrlChange,
  availableModels,
  iconBgGradient = "from-indigo-100 to-purple-100"
}: ModelCardProps) {
  return (
    <div className="border border-slate-100 dark:border-slate-700/60 rounded-lg p-4 mb-5 bg-white dark:bg-slate-800 transition-colors">
      <div className="flex gap-4">
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-md text-xl shadow-sm flex-shrink-0",
          `bg-gradient-to-br ${iconBgGradient} dark:from-slate-100 dark:to-slate-200`
        )}>
          {typeof icon === 'string' ? icon : icon}
        </div>
        <div className="flex-1 min-w-0"> {/* Added min-w-0 for flex truncation */} 
          <div className="flex justify-between items-center mb-3 flex-wrap gap-2"> {/* Added flex-wrap */} 
            <div className="font-medium text-base text-slate-800 dark:text-slate-200 truncate">{name}</div>
            <div className={cn(
              "flex items-center gap-2 text-sm px-3 py-1 rounded-full flex-shrink-0",
              isConnected
                ? "bg-green-50 dark:bg-green-900 text-green-600 dark:text-green-300"
                : "bg-red-50 dark:bg-red-900 text-red-600 dark:text-red-300"
            )}>
              {isConnected ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span>{isConnected ? '已连接' : '未连接'}</span>
            </div>
          </div>
          <div className="mb-4">
            <InputField
              label="服务地址"
              value={serviceUrl}
              onChange={(e) => onServiceUrlChange(e.target.value)}
              placeholder={`输入${name}服务地址`}
            />
          </div>
          {availableModels && availableModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableModels.map((modelName, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300 px-3 py-1.5 rounded-full text-sm tag-hover cursor-default"
                >
                  <span>{modelName}</span>
                  {/* TODO: Add checkmark if active/default? */} 
                  {/* <Check className="w-3 h-3 text-xs" /> */}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 