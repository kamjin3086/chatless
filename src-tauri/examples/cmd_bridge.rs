//! A JSON-line bridge to the real Tauri commands, for acceptance runs.
//!
//! The desktop E2E checklist proves the UI; this proves the command layer that
//! the UI calls. It exists because the mocked unit tests once passed while
//! `shell__start` split its own command line and `read_shell_process` sent the
//! wrong argument name - both only visible when the real Rust command ran.
//!
//! Protocol: one JSON object per line on stdin, `{"id": 1, "command": "...",
//! "args": {...}}`, and one JSON reply per line on stdout. Arguments use the
//! same camelCase names Tauri passes.
//!
//! Build:  cargo build --example cmd_bridge
//! Run:    cmd_bridge [data-dir]

use chatless_lib::filesystem::commands::*;
use chatless_lib::filesystem::state::{AllowlistDirectory, AllowlistSnapshot, FilesystemAllowlistState};
use chatless_lib::filesystem::types::*;
use chatless_lib::sandbox::commands::{
  cancel_safe_shell, list_shell_processes, read_shell_process, run_blocking_shell,
  start_managed_process, stop_conversation_processes, stop_shell_process, ExecuteOptions,
  ManagedProcessOwner,
};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

struct Bridge {
  data_dir: PathBuf,
  allowlist: Arc<FilesystemAllowlistState>,
}

impl Bridge {
  async fn dispatch(&self, command: &str, args: Value) -> Result<Value, String> {
    let arg = |name: &str| -> Value { args.get(name).cloned().unwrap_or(Value::Null) };
    let string = |name: &str| -> String { arg(name).as_str().unwrap_or_default().to_string() };
    let optional = |name: &str| -> Option<String> {
      arg(name).as_str().map(|value| value.to_string()).filter(|value| !value.is_empty())
    };
    let parse = |name: &str| -> Result<Value, String> {
      let value = arg(name);
      if value.is_null() {
        return Err(format!("{name} is required"));
      }
      Ok(value)
    };

    match command {
      "filesystem_set_allowlist" => {
        let payload: SetAllowlistPayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        set_allowlist_inner(&self.data_dir, &self.allowlist, payload).await
      }
      "filesystem_grant_call_scope" => {
        let payload: GrantCallScopePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        let permissions = chatless_lib::filesystem::state::FsPermissions {
          read: payload.read,
          write: payload.write,
          create: payload.create,
          delete: payload.delete,
        };
        let path = self
          .allowlist
          .grant_call_scope(
            &payload.run_id,
            payload.call_id.as_deref(),
            &payload.path,
            permissions,
            chatless_lib::filesystem::state::CALL_SCOPE_TTL_MS,
          )
          .await?;
        Ok(json!({ "ok": true, "path": path }))
      }
      "filesystem_revoke_call_scope" => {
        let payload: RevokeCallScopePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        self
          .allowlist
          .revoke_call_scope(&payload.run_id, payload.call_id.as_deref())
          .await?;
        Ok(json!({ "ok": true }))
      }
      "filesystem_read_file" => {
        let payload: ReadFilePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(read_file_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "filesystem_write_file" => {
        let payload: WriteFilePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(write_file_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "filesystem_edit_file" => {
        let payload: EditFilePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(edit_file_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "filesystem_search_files" => {
        let payload: SearchFilesPayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(search_files_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "filesystem_list_directory" => {
        let payload: ListDirectoryPayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(list_directory_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "filesystem_create_directory" => {
        let payload: CreateDirectoryPayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        create_directory_inner(&self.data_dir, &self.allowlist, payload).await
      }
      "filesystem_delete_file" => {
        let payload: DeleteFilePayload = serde_json::from_value(parse("payload")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(delete_file_inner(&self.data_dir, &self.allowlist, payload).await?).unwrap())
      }
      "run_safe_shell" => {
        let options: ExecuteOptions = serde_json::from_value(parse("options")?).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(run_blocking_shell(options, self.data_dir.clone()).await?).unwrap())
      }
      "start_shell_process" => {
        let options: ExecuteOptions = serde_json::from_value(parse("options")?).map_err(|e| e.to_string())?;
        let owner = ManagedProcessOwner {
          conversation_id: string("conversationId"),
          run_id: optional("runId"),
          name: optional("name"),
        };
        Ok(serde_json::to_value(start_managed_process(options, self.data_dir.clone(), owner).await?).unwrap())
      }
      "read_shell_process" => {
        let limit = arg("limit").as_u64().map(|value| value as usize);
        let mut output = read_shell_process(string("executionId"), string("conversationId"), limit).await?;
        output.execution_id = output.execution_id.trim().to_string();
        Ok(serde_json::to_value(output).unwrap())
      }
      "stop_shell_process" => {
        Ok(serde_json::to_value(stop_shell_process(string("executionId"), string("conversationId")).await?).unwrap())
      }
      "list_shell_processes" => {
        Ok(serde_json::to_value(list_shell_processes(string("conversationId")).await?).unwrap())
      }
      "stop_conversation_processes" => {
        Ok(json!(stop_conversation_processes(string("conversationId")).await?))
      }
      "cancel_safe_shell" => Ok(json!(cancel_safe_shell(string("executionId")).await?)),
      "check_runtime_environment" => Ok(serde_json::to_value(
        chatless_lib::sandbox::commands::check_runtime_environment(string("runtime")).await?,
      )
      .unwrap()),
      "validate_command" => Ok(json!({ "valid": true, "reason": Value::Null })),
      "bridge_allowlist_snapshot" => {
        let snapshot = AllowlistSnapshot {
          version: 1,
          directories: Vec::<AllowlistDirectory>::new(),
        };
        Ok(serde_json::to_value(snapshot).unwrap())
      }
      other => Err(format!("unknown command: {other}")),
    }
  }
}

fn main() {
  let data_dir = std::env::args()
    .nth(1)
    .map(PathBuf::from)
    .unwrap_or_else(|| std::env::temp_dir().join("chatless-cmd-bridge"));
  std::fs::create_dir_all(&data_dir).expect("create bridge data dir");

  let runtime = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .build()
    .expect("build tokio runtime");

  let bridge = Arc::new(Bridge {
    data_dir: data_dir.clone(),
    allowlist: Arc::new(FilesystemAllowlistState::default()),
  });

  let stdin = std::io::stdin();
  let mut stdout = std::io::stdout();
  for line in stdin.lock().lines() {
    let line = match line {
      Ok(line) => line,
      Err(_) => break,
    };
    if line.trim().is_empty() {
      continue;
    }
    let request: Value = match serde_json::from_str(&line) {
      Ok(value) => value,
      Err(error) => {
        let _ = writeln!(stdout, "{}", json!({ "id": Value::Null, "error": error.to_string() }));
        let _ = stdout.flush();
        continue;
      }
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let command = request.get("command").and_then(Value::as_str).unwrap_or_default().to_string();
    let args = request.get("args").cloned().unwrap_or_else(|| json!({}));
    let result = runtime.block_on(bridge.dispatch(&command, args));
    let reply = match result {
      Ok(value) => json!({ "id": id, "result": value }),
      Err(error) => json!({ "id": id, "error": error }),
    };
    let _ = writeln!(stdout, "{reply}");
    let _ = stdout.flush();
  }
}
