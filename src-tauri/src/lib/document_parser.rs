use anyhow::{Context, Result};
use docx_rust::{document::BodyContent, DocxFile};
use pulldown_cmark::{Event, Options, Parser, Tag};
use std::fs;
use std::path::Path;
// 额外格式依赖
use calamine::{open_workbook_auto, DataType, Reader};
use csv::ReaderBuilder;
use html2text::from_read as html_to_text_from_read;
use log::{error, info};
use once_cell::sync::Lazy;
use tokio::sync::Semaphore;
use tokio::task::spawn_blocking;
use tokio::time::{timeout, Duration};

pub struct DocumentParser;

impl DocumentParser {
  /// 统一的文档解析入口点
  pub fn extract_text_from_file(file_path_str: &str) -> Result<String> {
    let path = Path::new(file_path_str);

    if !path.exists() {
      return Err(anyhow::anyhow!("文件未找到: {}", file_path_str));
    }

    // 简单的文件大小限制（20MB），防止卡顿
    const MAX_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;
    let meta = fs::metadata(path)?;
    if meta.len() > MAX_FILE_SIZE_BYTES {
      return Err(anyhow::anyhow!(
        "文档过大，超过限制：{}MB",
        MAX_FILE_SIZE_BYTES / (1024 * 1024)
      ));
    }

    let extension = path
      .extension()
      .and_then(std::ffi::OsStr::to_str)
      .map(|ext| ext.to_ascii_lowercase());
    match extension.as_deref() {
      Some("pdf") => Self::extract_pdf_text(file_path_str),
      Some("docx") => Self::extract_docx_text(file_path_str),
      Some("md") | Some("markdown") => Self::extract_markdown_text(file_path_str),
      Some("txt") => Self::extract_txt_text(file_path_str),
      Some("json") => Self::extract_json_text(file_path_str),
      Some("csv") => Self::extract_csv_text(file_path_str),
      Some("xlsx") | Some("xls") => Self::extract_xlsx_text(file_path_str),
      Some("html") | Some("htm") => Self::extract_html_text(file_path_str),
      Some("rtf") => Self::extract_rtf_text(file_path_str),
      Some("epub") => Self::extract_epub_text(file_path_str),
      Some(ext) => Err(anyhow::anyhow!("不支持的文件扩展名: {}", ext)),
      None => Err(anyhow::anyhow!(
        "无法确定文件类型，缺少扩展名: {}",
        file_path_str
      )),
    }
  }

  /// PDF 文本提取
  fn extract_pdf_text(file_path_str: &str) -> Result<String> {
    let file_path = Path::new(file_path_str);
    pdf_extract::extract_text(file_path)
      .with_context(|| format!("从PDF文件 '{}' 提取文本失败", file_path_str))
  }

  /// DOCX 文本提取
  fn extract_docx_text(file_path_str: &str) -> Result<String> {
    let file_path = Path::new(file_path_str);

    let docx_file =
      DocxFile::from_file(file_path).map_err(|e| anyhow::anyhow!("无法打开 DOCX 文件: {:?}", e))?;

    let docx = docx_file
      .parse()
      .map_err(|e| anyhow::anyhow!("解析 DOCX 文件失败: {:?}", e))?;
    let mut paragraphs = Vec::new();
    for content in &docx.document.body.content {
      match content {
        BodyContent::Paragraph(paragraph) => {
          let text = paragraph.text().trim().to_string();
          if !text.is_empty() { paragraphs.push(text); }
        }
        BodyContent::Table(table) => {
          let cells = table.iter_text().map(|text| text.to_string()).collect::<Vec<_>>();
          let text = cells.join(" | ").trim().to_string();
          if !text.is_empty() { paragraphs.push(text); }
        }
        BodyContent::Sdt(sdt) => {
          let text = sdt.text().trim().to_string();
          if !text.is_empty() { paragraphs.push(text); }
        }
        _ => {}
      }
    }
    let cleaned_text = paragraphs.join("\n");

    Ok(cleaned_text)
  }

  /// Markdown 文本提取
  fn extract_markdown_text(file_path_str: &str) -> Result<String> {
    let file_path = Path::new(file_path_str);
    let markdown_input = fs::read_to_string(file_path)
      .with_context(|| format!("无法读取 Markdown 文件: {}", file_path_str))?;

    let mut plain_text = String::new();
    let parser = Parser::new_ext(&markdown_input, Options::empty());

    for event in parser {
      match event {
        Event::Text(text) => {
          plain_text.push_str(&text);
        }
        Event::End(Tag::Paragraph) => {
          plain_text.push('\n');
        }
        Event::End(Tag::Heading { .. }) => {
          plain_text.push('\n');
        }
        Event::End(Tag::CodeBlock(_)) => {
          plain_text.push('\n');
        }
        Event::SoftBreak => {
          plain_text.push(' ');
        }
        Event::HardBreak => {
          plain_text.push('\n');
        }
        _ => {}
      }
    }

    Ok(plain_text.trim().to_string())
  }

  /// TXT 文本提取
  fn extract_txt_text(file_path_str: &str) -> Result<String> {
    let file_path = Path::new(file_path_str);
    fs::read_to_string(file_path).with_context(|| format!("无法读取 TXT 文件: {}", file_path_str))
  }

  /// JSON 文本提取（原样读取）
  fn extract_json_text(file_path_str: &str) -> Result<String> {
    let file_path = Path::new(file_path_str);
    let text = fs::read_to_string(file_path)
      .with_context(|| format!("无法读取 JSON 文件: {}", file_path_str))?;
    Ok(text.trim().to_string())
  }

  /// CSV 文本提取（以逗号分隔并换行）
  fn extract_csv_text(file_path_str: &str) -> Result<String> {
    let mut rdr = ReaderBuilder::new()
      .has_headers(false)
      .from_path(file_path_str)
      .with_context(|| format!("无法读取 CSV 文件: {}", file_path_str))?;
    let mut out = String::new();
    for result in rdr.records() {
      let record = result.with_context(|| "解析 CSV 记录失败")?;
      out.push_str(&record.iter().collect::<Vec<_>>().join(", "));
      out.push('\n');
    }
    Ok(out.trim().to_string())
  }

  /// XLSX/XLS 文本提取（按工作表/行拼接）
  fn extract_xlsx_text(file_path_str: &str) -> Result<String> {
    let mut workbook = open_workbook_auto(file_path_str)
      .with_context(|| format!("无法打开表格文件: {}", file_path_str))?;
    let mut out = String::new();
    for sheet_name in workbook.sheet_names().to_owned() {
      if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
        out.push_str(&format!("# {}\n", sheet_name));
        for row in range.rows() {
          let line = row
            .iter()
            .map(|c| match c {
              DataType::Empty => "".to_string(),
              DataType::String(s) => s.to_string(),
              DataType::Float(f) => f.to_string(),
              DataType::Int(i) => i.to_string(),
              DataType::Bool(b) => b.to_string(),
              _ => "".to_string(),
            })
            .collect::<Vec<_>>()
            .join("\t");
          out.push_str(&line);
          out.push('\n');
        }
        out.push('\n');
      }
    }
    Ok(out.trim().to_string())
  }

  /// HTML 文本提取
  fn extract_html_text(file_path_str: &str) -> Result<String> {
    let bytes =
      fs::read(file_path_str).with_context(|| format!("无法读取 HTML 文件: {}", file_path_str))?;
    let cursor = std::io::Cursor::new(bytes);
    // 大宽度避免自动换行
    let text = html_to_text_from_read(cursor, 1_000_000);
    Ok(text.trim().to_string())
  }

  /// RTF 简易文本提取（基础剥离控制词）
  fn extract_rtf_text(file_path_str: &str) -> Result<String> {
    let raw = fs::read_to_string(file_path_str)
      .with_context(|| format!("无法读取 RTF 文件: {}", file_path_str))?;
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
      match ch {
        '{' | '}' => { /* 分组符号，忽略 */ }
        '\\' => {
          // 跳过控制词/转义
          let mut word = String::new();
          while let Some(&c) = chars.peek() {
            if c.is_alphabetic() {
              word.push(c);
              chars.next();
            } else {
              break;
            }
          }
          // 处理 \'hh 十六进制
          if word.is_empty() {
            if let Some(&'\'') = chars.peek() {
              // backslash + ' pattern
              chars.next(); // consume '\''
              let h1 = chars.next();
              let h2 = chars.next();
              if let (Some(a), Some(b)) = (h1, h2) {
                let hex = format!("{}{}", a, b);
                if let Ok(v) = u8::from_str_radix(&hex, 16) {
                  out.push(v as char);
                }
              }
            }
          } else {
            // 跳过可选的数字参数
            while let Some(&c) = chars.peek() {
              if c.is_ascii_digit() || c == '-' {
                chars.next();
              } else {
                break;
              }
            }
          }
          // 控制词通常以空格或非字母数字结束，若有空格需消耗
          if let Some(&' ') = chars.peek() {
            chars.next();
          }
        }
        _ => out.push(ch),
      }
    }
    Ok(out.trim().to_string())
  }

  /// EPUB 文本提取（合并章节文本）
  fn extract_epub_text(file_path_str: &str) -> Result<String> {
    let mut doc = epub::doc::EpubDoc::new(file_path_str)
      .with_context(|| format!("无法打开 EPUB 文件: {}", file_path_str))?;
    let mut out = String::new();
    // 优先从 spine 获取章节，若失败则从其他资源回退
    let spine = doc.spine.clone();
    for item in spine {
      if let Some(ref id) = item.id {
        if let Some((bytes, _mime)) = doc.get_resource(id) {
          let cursor = std::io::Cursor::new(bytes);
          let text = html_to_text_from_read(cursor, 1_000_000);
          out.push_str(text.trim());
          out.push('\n');
        }
      }
    }
    if out.trim().is_empty() {
      // 回退：遍历资源目录（HashMap<String, (PathBuf, String)>），按扩展名再次读取
      let resources = doc.resources.clone();
      for (id, (_path, mime)) in resources {
        if mime.contains("html") || mime.contains("xhtml") {
          if let Some((bytes, _)) = doc.get_resource(&id) {
            let cursor = std::io::Cursor::new(bytes);
            let text = html_to_text_from_read(cursor, 1_000_000);
            out.push_str(text.trim());
            out.push('\n');
          }
        }
      }
    }
    Ok(out.trim().to_string())
  }

  /// 解析Markdown内容（从字符串）
  pub fn parse_markdown_content(markdown_input: &str) -> Result<String> {
    let mut plain_text = String::new();
    let parser = Parser::new_ext(markdown_input, Options::empty());

    for event in parser {
      match event {
        Event::Text(text) => {
          plain_text.push_str(&text);
        }
        Event::End(Tag::Paragraph) => {
          plain_text.push('\n');
        }
        Event::End(Tag::Heading { .. }) => {
          plain_text.push('\n');
        }
        Event::End(Tag::CodeBlock(_)) => {
          plain_text.push('\n');
        }
        Event::SoftBreak => {
          plain_text.push(' ');
        }
        Event::HardBreak => {
          plain_text.push('\n');
        }
        _ => {}
      }
    }

    Ok(plain_text.trim().to_string())
  }
}

// —— Orchestrator：并发限制 + 超时保护 ——
static PARSE_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(2)); // 默认并发 2
const ORCH_TIMEOUT_MS: u64 = 30_000; // 30s 统一超时

async fn orchestrate_from_path(file_path: String) -> Result<String, String> {
  let _permit = PARSE_SEMAPHORE
    .acquire()
    .await
    .map_err(|e| format!("获取解析许可失败: {}", e))?;

  let label = format!("parse_from_path: {}", &file_path);
  info!("[DOC] 开始解析: {}", label);

  let fut = async move {
    // 在阻塞线程运行同步解析，避免阻塞异步 runtime
    let path_clone = file_path.clone();
    let res = spawn_blocking(move || DocumentParser::extract_text_from_file(&path_clone))
      .await
      .map_err(|e| format!("解析线程错误: {}", e))?
      .map_err(|e| e.to_string());
    res
  };

  match timeout(Duration::from_millis(ORCH_TIMEOUT_MS), fut).await {
    Ok(r) => match r {
      Ok(text) => {
        info!("[DOC] 解析完成: {} ({} 字符)", label, text.len());
        Ok(text)
      }
      Err(e) => {
        error!("[DOC] 解析失败: {} => {}", label, e);
        Err(e)
      }
    },
    Err(_) => {
      error!("[DOC] 解析超时: {}", label);
      Err("解析超时，请稍后重试".to_string())
    }
  }
}

async fn orchestrate_from_binary(
  file_name: String,
  file_content: Vec<u8>,
) -> Result<String, String> {
  let _permit = PARSE_SEMAPHORE
    .acquire()
    .await
    .map_err(|e| format!("获取解析许可失败: {}", e))?;

  let fname_for_log = file_name.clone();
  info!(
    "[DOC] 开始二进制解析: {} ({} bytes)",
    fname_for_log,
    file_content.len()
  );

  let fut = async move {
    use std::time::{SystemTime, UNIX_EPOCH};

    // 生成唯一的临时文件名
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0);

    let temp_file_name = format!("tauri_doc_parse_{}_{}", timestamp, file_name);
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join(&temp_file_name);

    struct TempFileGuard {
      path: std::path::PathBuf,
    }
    impl Drop for TempFileGuard {
      fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
      }
    }
    let guard = TempFileGuard {
      path: temp_file_path.clone(),
    };

    // 将写入与解析放在阻塞线程中执行
    let res = spawn_blocking(move || {
      // 写入临时文件
      fs::write(&temp_file_path, &file_content)
        .map_err(|e| anyhow::anyhow!("创建临时文件失败: {}", e))?;
      // 解析
      let temp_path_str = temp_file_path.to_string_lossy().to_string();
      let out = DocumentParser::extract_text_from_file(&temp_path_str)?;
      // guard 在这里 drop，自动删除
      std::mem::drop(guard);
      Ok::<String, anyhow::Error>(out)
    })
    .await
    .map_err(|e| format!("解析线程错误: {}", e))
    .and_then(|r| r.map_err(|e| e.to_string()));

    res
  };

  match timeout(Duration::from_millis(ORCH_TIMEOUT_MS), fut).await {
    Ok(r) => match r {
      Ok(text) => {
        info!(
          "[DOC] 二进制解析完成: {} ({} 字符)",
          fname_for_log,
          text.len()
        );
        Ok(text)
      }
      Err(e) => {
        error!("[DOC] 二进制解析失败: {} => {}", fname_for_log, e);
        Err(e)
      }
    },
    Err(_) => {
      error!("[DOC] 二进制解析超时: {}", fname_for_log);
      Err("解析超时，请稍后重试".to_string())
    }
  }
}

/// Tauri 命令：解析文档文本（从文件路径）
#[tauri::command]
pub async fn parse_document_text(file_path: String) -> Result<String, String> {
  orchestrate_from_path(file_path).await
}

/// Tauri 命令：从二进制数据解析文档（新的统一方案）
#[tauri::command]
pub async fn parse_document_from_binary(
  file_name: String,
  file_content: Vec<u8>,
) -> Result<String, String> {
  orchestrate_from_binary(file_name, file_content).await
}

/// Tauri 命令：从文件内容解析文档（简化版，仅用于纯文本）
#[tauri::command]
pub async fn parse_document_content(
  file_name: String,
  file_content: Vec<u8>,
) -> Result<String, String> {
  // 从文件名获取扩展名
  let extension = Path::new(&file_name)
    .extension()
    .and_then(std::ffi::OsStr::to_str)
    .unwrap_or_default();

  // 根据文件类型调用不同的解析逻辑
  match extension {
    "md" | "markdown" => {
      let content_str = String::from_utf8(file_content)
        .map_err(|e| format!("无法将文件内容转换为UTF-8字符串: {}", e))?;
      DocumentParser::parse_markdown_content(&content_str).map_err(|e| e.to_string())
    }
    "txt" => {
      String::from_utf8(file_content).map_err(|e| format!("无法将文件内容转换为UTF-8字符串: {}", e))
    }
    _ => Err(format!("不支持从内容解析'{}'类型的文件", extension)),
  }
}

/// Tauri 命令：获取支持的文件类型
#[tauri::command]
pub fn get_supported_file_types() -> Vec<String> {
  vec![
    "pdf".to_string(),
    "docx".to_string(),
    "md".to_string(),
    "markdown".to_string(),
    "txt".to_string(),
    "json".to_string(),
    "csv".to_string(),
    "xlsx".to_string(),
    "xls".to_string(),
    "html".to_string(),
    "htm".to_string(),
    "rtf".to_string(),
    "epub".to_string(),
  ]
}
