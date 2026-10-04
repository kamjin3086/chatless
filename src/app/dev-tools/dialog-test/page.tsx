"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModelParametersDialog } from "@/components/chat/ModelParametersDialog";
import { SessionParametersDialog } from "@/components/chat/SessionParametersDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DialogTestPage() {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">对话框测试页面</h1>
        <p className="text-slate-600 dark:text-slate-400">
          测试优化后的模型参数设置对话框
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 模型参数设置对话框测试 */}
        <Card>
          <CardHeader>
            <CardTitle>模型参数设置</CardTitle>
            <CardDescription>
              测试优化后的模型参数设置对话框，展示轻盈精致的界面设计
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium">功能特性：</h4>
              <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                <li>• 轻盈精致的界面设计</li>
                <li>• 优化的滑块交互体验</li>
                <li>• 清晰的信息层次结构</li>
                <li>• 响应式布局适配</li>
                <li>• 暗色模式支持</li>
              </ul>
            </div>
            <Button 
              onClick={() => setModelDialogOpen(true)}
              className="w-full"
            >
              打开模型参数设置
            </Button>
          </CardContent>
        </Card>

        {/* 会话参数设置对话框测试 */}
        <Card>
          <CardHeader>
            <CardTitle>会话参数设置</CardTitle>
            <CardDescription>
              测试优化后的会话参数设置对话框，展示参数优先级管理
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="font-medium">功能特性：</h4>
              <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                <li>• 会话级别参数管理</li>
                <li>• 参数优先级显示</li>
                <li>• 实时参数变更检测</li>
                <li>• 多种重置选项</li>
                <li>• 优雅的加载状态</li>
              </ul>
            </div>
            <Button 
              onClick={() => setSessionDialogOpen(true)}
              className="w-full"
            >
              打开会话参数设置
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 对话框组件 */}
      <ModelParametersDialog
        open={modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        providerName="openai"
        modelId="gpt-4"
        modelLabel="GPT-4"
      />

      <SessionParametersDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        providerName="openai"
        modelId="gpt-4"
        modelLabel="GPT-4"
        conversationId="test-conversation-123"
        onParametersChange={(params) => {
          console.log('会话参数变更:', params);
        }}
      />
    </div>
  );
} 