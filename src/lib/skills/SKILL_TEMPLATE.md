---
# SKILL.md 标准模板
#
# 这是 Chatless Skills 的标准格式规范
# 所有技能都应遵循此格式以确保正确解析和展示

# 必填字段
name: "技能名称"
description: "简短描述（用于技能索引，建议 100 字以内）"
version: "1.0.0"

# 可选字段
author: "作者名称"
category: "general"  # 分类：general, coding, writing, research, automation

# 标签（用于搜索和筛选）
tags:
  - "关键词1"
  - "关键词2"

# 触发关键词（用于意图识别）
triggers:
  - "触发词1"
  - "触发词2"

# 依赖项（用于环境检测）
dependencies:
  - python: ">=3.10"
  - node: ">=18"
  - binary: "git"
  - mcp_server: "filesystem"

# Hooks（用于 Agent Loop）
hooks:
  pre_execute: "echo 'Starting...'"  # 执行前命令
  post_execute: "echo 'Done!'"       # 执行后命令
  verify: "npm test"                 # 验证命令（返回 0 表示成功）
  on_error: "echo 'Error occurred'"  # 错误处理命令
---

# 技能名称

> 一句话描述这个技能的作用

## When to Use

描述什么情况下应该使用此技能。例如：

- 当用户需要...
- 当任务涉及...
- 当需要处理...

## Instructions

详细的使用说明和步骤。使用清晰的编号列表：

1. **第一步**：描述第一步操作
   - 子步骤 1.1
   - 子步骤 1.2

2. **第二步**：描述第二步操作
   ```bash
   # 如果需要，可以包含代码示例
   example_command --flag value
   ```

3. **第三步**：描述第三步操作

## Parameters

如果技能接受参数，在此列出：

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| input | string | 是 | 输入内容 |
| format | string | 否 | 输出格式，默认 "text" |
| verbose | boolean | 否 | 是否输出详细信息 |

## Examples

### 示例 1：基本用法

**输入**：
```
用户的输入示例
```

**输出**：
```
期望的输出结果
```

### 示例 2：高级用法

**输入**：
```
更复杂的输入示例
```

**输出**：
```
对应的输出结果
```

## Gotchas

使用此技能时的注意事项和常见错误：

1. ⚠️ **注意事项 1**：描述可能的问题
2. ⚠️ **注意事项 2**：描述如何避免错误
3. ❌ **禁止行为**：列出不应该做的事情

## Related Skills

相关的其他技能：

- `skill-id-1` - 相关技能描述
- `skill-id-2` - 另一个相关技能

## Changelog

- **1.0.0** (2024-01-01): 初始版本
- **1.1.0** (2024-02-01): 添加新功能

