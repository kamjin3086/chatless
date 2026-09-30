"use client";
import React, { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolAvailability {
  tool_name: string;
  available: boolean;
  path?: string;
  error_message?: string;
}

interface EnvironmentHealth {
  overall_healthy: boolean;
  tools: ToolAvailability[];
  missing_critical_tools: string[];
  recommendations: string[];
}

export function useMcpEnvironmentHealth() {
  const [health, setHealth] = useState<EnvironmentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<EnvironmentHealth>("get_environment_health");
      setHealth(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load environment status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { health, loading, error, reload };
}

export function McpEnvironmentStatus({
  health,
  loading,
  error,
}: {
  health: EnvironmentHealth | null;
  loading: boolean;
  error: string | null;
}) {
  const unhealthy = !loading && !error && health && !health.overall_healthy;

  let text = "MCP 依赖已就绪";
  if (loading) text = "正在检测 MCP 依赖…";
  else if (error || !health) text = "暂时无法检测 MCP 依赖";
  else if (!health.overall_healthy) {
    text = `缺少工具：${health.missing_critical_tools.join("、")}`;
  }

  return (
    <h2
      className={cn(
        "text-sm font-medium tracking-tight",
        error || (!health && !loading)
          ? "text-slate-500 dark:text-slate-400"
          : unhealthy
          ? "text-amber-700 dark:text-amber-400"
          : "text-slate-600 dark:text-slate-300"
      )}
    >
      {unhealthy && (
        <AlertTriangle className="inline-block w-3.5 h-3.5 mr-1.5 -mt-0.5" />
      )}
      {text}
    </h2>
  );
}
