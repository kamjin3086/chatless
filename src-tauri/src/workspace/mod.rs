//! 会话工作目录（@WorkDir）。
//!
//! 目录放在用户的文档目录下（`<Documents>/Chatless/<标题>-<摘要>`），用户能直接
//! 找到 AI 产物；而"哪个会话对应哪个目录"由 `workspaces/index.json` 唯一持有。
//!
//! 之所以把创建、定位、导出、清理都收敛到 Rust：这些操作都写在用户的真实文件
//! 系统上，渲染进程的 plugin-fs 作用域只覆盖应用自己的目录，用它会得到"看起来
//! 成功、实际没有权限"的结果。Rust 侧同时是唯一写者，避免前后端两份状态漂移。

pub mod commands;
pub mod index;
pub mod naming;
