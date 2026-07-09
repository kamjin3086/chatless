use reqwest::{Client, Url};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use urlencoding::encode;

use crate::http_client;

// —— 默认参数常量 —— 避免散落的魔法值
const DEFAULT_DDG_LIMIT: usize = 5;
const DEFAULT_FETCH_MAX_CONTENT_CHARS: usize = 2000;
const DEFAULT_FETCH_MAX_LINKS: usize = 50;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
  pub provider: String, // "google" | "bing" | "custom_scrape" | "ollama" | "duckduckgo"
  pub query: String,    // 搜索关键词
  pub api_key: Option<String>, // provider 对应的 key（google/bing）
  pub cse_id: Option<String>, // google 的 CSE ID
  // —— 可选高级参数（按提供商适配，不一定全部生效） ——
  pub limit: Option<usize>,            // 结果条数（用于 ddg/custom）
  pub kl: Option<String>,              // ddg 区域/语言参数（如 us-en）
  pub accept_language: Option<String>, // 请求 Accept-Language 头
  pub safe: Option<bool>,              // ddg 安全搜索
  pub site: Option<String>,            // ddg site 限定
  pub max_results: Option<i32>,
  pub base_url: Option<String>,
  pub search_depth: Option<String>,
  pub topic: Option<String>,
  pub include_domains: Option<Vec<String>>,
  pub exclude_domains: Option<Vec<String>>,
  pub country: Option<String>,
  pub search_lang: Option<String>,
  pub safe_search: Option<String>,
  pub extra_snippets: Option<bool>,
  pub categories: Option<String>,
  pub language: Option<String>,
  pub time_range: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchRequest {
  pub provider: String,        // 目前主要支持 "ollama"
  pub url: String,             // 要抓取的网页地址
  pub api_key: Option<String>, // ollama 的 API Key
  pub max_links: Option<usize>,
  pub max_content_chars: Option<usize>,
  pub use_readability: Option<bool>,
}

#[derive(Serialize, Debug)]
pub struct WebSearchResult {
  pub snippet: String,
  pub source_title: String,
  pub url: String,
}

#[derive(Serialize, Debug)]
pub struct WebFetchResult {
  pub title: String,
  pub content: String,
  pub links: Vec<String>,
}

#[tauri::command]
pub async fn native_web_search(request: WebSearchRequest) -> Result<Vec<WebSearchResult>, String> {
  log::info!(
    "[WEB_SEARCH] provider={} query={}",
    request.provider,
    request.query
  );
  let client = http_client::get_browser_like_client() // 统一走“浏览器头”客户端，兼容更多场景
    .map_err(|e| format!("init http client failed: {}", e))?;
  let client_ref: &Client = &client;

  match request.provider.as_str() {
    "google" => call_google_search(client_ref, request).await,
    "bing" => call_bing_search(client_ref, request).await,
    "ollama" => call_ollama_search(client_ref, request).await,
    "tavily" => call_tavily_search(client_ref, request).await,
    "brave" => call_brave_search(client_ref, request).await,
    "searxng" => call_searxng_search(client_ref, request).await,
    // DuckDuckGo：默认采用官方html端点解析（无需API Key，鲁棒性强）
    // 如未来需要，可替换为 duckduckgo crate 的实现
    "duckduckgo" => call_duckduckgo_search(client_ref, request).await,
    "custom_scrape" => call_custom_scraper(client_ref, request).await,
    other => Err(format!("Unsupported search provider: {}", other)),
  }
}

async fn response_json(
  res: reqwest::Response,
  provider: &str,
) -> Result<serde_json::Value, String> {
  let status = res.status();
  let text = res
    .text()
    .await
    .map_err(|e| format!("{}: read response failed: {}", provider, e))?;
  if !status.is_success() {
    return Err(format!(
      "{} search failed (HTTP {}): {}",
      provider,
      status,
      sample_for_log(&text)
    ));
  }
  serde_json::from_str(&text).map_err(|e| {
    format!(
      "{} returned invalid JSON: {}; body_head={}",
      provider,
      e,
      sample_for_log(&text)
    )
  })
}

fn json_results(value: &serde_json::Value, path: &[&str], limit: usize) -> Vec<WebSearchResult> {
  let mut current = value;
  for key in path {
    current = match current.get(key) {
      Some(next) => next,
      None => return Vec::new(),
    };
  }
  current
    .as_array()
    .map(|items| {
      items
        .iter()
        .filter_map(|item| {
          let source_title = item
            .get("title")
            .or_else(|| item.get("name"))?
            .as_str()?
            .to_string();
          let url = item
            .get("url")
            .or_else(|| item.get("link"))?
            .as_str()?
            .to_string();
          let snippet = item
            .get("content")
            .or_else(|| item.get("description"))
            .or_else(|| item.get("snippet"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
          Some(WebSearchResult {
            snippet,
            source_title,
            url,
          })
        })
        .take(limit)
        .collect()
    })
    .unwrap_or_default()
}

async fn call_tavily_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let api_key = request
    .api_key
    .filter(|v| !v.trim().is_empty())
    .ok_or_else(|| "Tavily API key is missing".to_string())?;
  let max_results = request.max_results.unwrap_or(5).clamp(1, 20);
  let payload = serde_json::json!({
    "query": request.query,
    "max_results": max_results,
    "search_depth": request.search_depth.unwrap_or_else(|| "basic".to_string()),
    "topic": request.topic.unwrap_or_else(|| "general".to_string()),
    "include_answer": false,
    "include_raw_content": false,
    "include_domains": request.include_domains.unwrap_or_default(),
    "exclude_domains": request.exclude_domains.unwrap_or_default()
  });
  let res = client
    .post("https://api.tavily.com/search")
    .bearer_auth(api_key)
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("Tavily HTTP error: {}", e))?;
  let json = response_json(res, "Tavily").await?;
  let results = json_results(&json, &["results"], max_results as usize);
  if results.is_empty() {
    Err("Tavily returned no search results".to_string())
  } else {
    Ok(results)
  }
}

async fn call_brave_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let api_key = request
    .api_key
    .filter(|v| !v.trim().is_empty())
    .ok_or_else(|| "Brave Search API key is missing".to_string())?;
  let count = request.max_results.unwrap_or(5).clamp(1, 20);
  let count_text = count.to_string();
  let mut req = client
    .get("https://api.search.brave.com/res/v1/web/search")
    .header("Accept", "application/json")
    .header("X-Subscription-Token", api_key)
    .query(&[
      ("q", request.query.as_str()),
      ("count", count_text.as_str()),
    ]);
  if let Some(v) = request.country.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("country", v)]);
  }
  if let Some(v) = request.search_lang.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("search_lang", v)]);
  }
  if let Some(v) = request.safe_search.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("safesearch", v)]);
  }
  if let Some(v) = request.extra_snippets {
    req = req.query(&[("extra_snippets", v)]);
  }
  let res = req
    .send()
    .await
    .map_err(|e| format!("Brave Search HTTP error: {}", e))?;
  let json = response_json(res, "Brave Search").await?;
  let results = json_results(&json, &["web", "results"], count as usize);
  if results.is_empty() {
    Err("Brave Search returned no search results".to_string())
  } else {
    Ok(results)
  }
}

async fn call_searxng_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let base = request
    .base_url
    .filter(|v| !v.trim().is_empty())
    .ok_or_else(|| "SearXNG base URL is missing".to_string())?;
  let parsed = Url::parse(base.trim()).map_err(|e| format!("Invalid SearXNG URL: {}", e))?;
  if parsed.scheme() != "http" && parsed.scheme() != "https" {
    return Err("SearXNG URL must use http or https".to_string());
  }
  let endpoint = format!("{}/search", base.trim_end_matches('/'));
  let limit = request.max_results.unwrap_or(5).clamp(1, 20);
  let safe = request.safe_search.unwrap_or_else(|| "0".to_string());
  let mut req = client.get(endpoint).query(&[
    ("q", request.query.as_str()),
    ("format", "json"),
    ("safesearch", safe.as_str()),
  ]);
  if let Some(v) = request.language.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("language", v)]);
  }
  if let Some(v) = request.categories.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("categories", v)]);
  }
  if let Some(v) = request.time_range.as_deref().filter(|v| !v.is_empty()) {
    req = req.query(&[("time_range", v)]);
  }
  let res = req
    .send()
    .await
    .map_err(|e| format!("SearXNG HTTP error: {}", e))?;
  let json = response_json(res, "SearXNG").await?;
  let results = json_results(&json, &["results"], limit as usize);
  if results.is_empty() {
    Err("SearXNG returned no results (ensure JSON format is enabled)".to_string())
  } else {
    Ok(results)
  }
}

#[tauri::command]
pub async fn native_web_fetch(request: WebFetchRequest) -> Result<WebFetchResult, String> {
  log::info!(
    "[WEB_FETCH] provider={} url={}",
    request.provider,
    request.url
  );
  let client = http_client::get_browser_like_client()
    .map_err(|e| format!("init http client failed: {}", e))?;
  let client_ref: &Client = &client;

  match request.provider.as_str() {
    "ollama" => call_ollama_fetch(client_ref, request).await,
    // 其他 provider 暂未提供官方 fetch API，这里提供最简降级实现：直接抓取网页并抽取标题与正文
    _ => call_basic_fetch(client_ref, request).await,
  }
}

async fn call_google_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let api_key = request
    .api_key
    .ok_or_else(|| "Google API Key is missing".to_string())?;
  let cse_id = request
    .cse_id
    .ok_or_else(|| "Google CSE ID is missing".to_string())?;
  let url = format!(
    "https://www.googleapis.com/customsearch/v1?key={}&cx={}&q={}",
    api_key,
    cse_id,
    encode(&request.query)
  );
  log::info!(
    "[WEB_SEARCH][google] GET {}",
    "https://www.googleapis.com/customsearch/v1?..."
  );
  let res = client
    .get(url)
    .header("Accept", "application/json")
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?;
  let status = res.status();
  let text = res
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  log::info!(
    "[WEB_SEARCH][google] status={} body_head={}",
    status,
    sample_for_log(&text)
  );
  let resp: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
    format!(
      "decode json failed: {}; body_head={}",
      e,
      sample_for_log(&text)
    )
  })?;

  // 优化错误提示：Google 返回 { "error": { code, message, errors: [...] } }
  if let Some(err) = resp.get("error") {
    let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("Unknown error");
    let reason = err
      .get("errors")
      .and_then(|a| a.as_array())
      .and_then(|arr| arr.get(0))
      .and_then(|o| o.get("reason"))
      .and_then(|r| r.as_str())
      .unwrap_or("");
    return Err(format!(
      "Google API 错误 (code {}): {}{}",
      code,
      msg,
      if reason.is_empty() {
        "".to_string()
      } else {
        format!(" (reason: {})", reason)
      }
    ));
  }

  let items = resp
    .get("items")
    .and_then(|i| i.as_array())
    .ok_or_else(|| {
      let total = resp.get("searchInformation")
        .and_then(|s| s.get("totalResults"))
        .and_then(|t| t.as_str())
        .unwrap_or("0")
        .to_string();
      format!("Google 搜索无结果或受限（totalResults={}）。请检查 CSE 是否启用、搜索范围与 API Key/CSE ID 是否正确。", total)
    })?;

  let results: Vec<WebSearchResult> = items
    .iter()
    .filter_map(|item| {
      let title = item.get("title")?.as_str()?;
      let link = item.get("link")?.as_str()?;
      let snippet = item.get("snippet")?.as_str().unwrap_or("").to_string();
      Some(WebSearchResult {
        source_title: title.to_string(),
        url: link.to_string(),
        snippet,
      })
    })
    .take(5)
    .collect();

  Ok(results)
}

async fn call_ollama_fetch(
  client: &Client,
  request: WebFetchRequest,
) -> Result<WebFetchResult, String> {
  let api_key = request
    .api_key
    .ok_or_else(|| "Ollama API Key is missing".to_string())?;
  let url = "https://ollama.com/api/web_fetch";
  let payload = serde_json::json!({
    "url": request.url
  });

  log::info!("[WEB_FETCH][ollama] POST {}", url);
  let res = client
    .post(url)
    .header("Accept", "application/json")
    .bearer_auth(api_key)
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?;
  let status = res.status();
  let text = res
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  log::info!(
    "[WEB_FETCH][ollama] status={} body_head={}",
    status,
    sample_for_log(&text)
  );
  let resp: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
    format!(
      "decode json failed: {}; body_head={}",
      e,
      sample_for_log(&text)
    )
  })?;

  let title = resp
    .get("title")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let content = resp
    .get("content")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let links: Vec<String> = resp
    .get("links")
    .and_then(|v| v.as_array())
    .map(|arr| {
      arr
        .iter()
        .filter_map(|x| x.as_str().map(|s| s.to_string()))
        .collect()
    })
    .unwrap_or_default();
  Ok(WebFetchResult {
    title,
    content,
    links,
  })
}

async fn call_basic_fetch(
  client: &Client,
  request: WebFetchRequest,
) -> Result<WebFetchResult, String> {
  // 兼容性降级：直接 GET 网页并尝试提取标题，正文以纯文本截断返回
  log::info!("[WEB_FETCH][basic] GET {}", request.url);
  let body = client
    .get(&request.url)
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  let document = Html::parse_document(&body);
  let title_sel = Selector::parse("title").map_err(|e| e.to_string())?;
  let mut title = document
    .select(&title_sel)
    .next()
    .map(|n| n.text().collect::<String>().trim().to_string())
    .unwrap_or_default();
  // 可读性提取（默认启用），失败时回退到纯文本
  let use_readability = request.use_readability.unwrap_or(true);
  let mut content = if use_readability {
    match extract_readable_text(&body, &request.url) {
      Some((t, c)) => {
        if !t.trim().is_empty() {
          title = t;
        }
        c
      }
      None => html2text::from_read(body.as_bytes(), 80),
    }
  } else {
    html2text::from_read(body.as_bytes(), 80)
  };
  // 截断正文
  let maxc = request
    .max_content_chars
    .unwrap_or(DEFAULT_FETCH_MAX_CONTENT_CHARS);
  let len = content.chars().count();
  if len > maxc {
    content = content.chars().take(maxc).collect();
  }
  // 抽取链接（相对转绝对），限制数量
  let max_links = request.max_links.unwrap_or(DEFAULT_FETCH_MAX_LINKS);
  let base = Url::parse(&request.url).ok();
  let link_sel = Selector::parse("a").map_err(|e| e.to_string())?;
  let mut links: Vec<String> = Vec::new();
  for a in document.select(&link_sel) {
    if links.len() >= max_links {
      break;
    }
    if let Some(href) = a.value().attr("href") {
      if let Some(base_url) = &base {
        if let Ok(abs) = base_url.join(href) {
          links.push(abs.to_string());
          continue;
        }
      }
      links.push(href.to_string());
    }
  }
  Ok(WebFetchResult {
    title,
    content,
    links,
  })
}

// —— 可读性正文提取（基于 readability::extractor，输入为 Reader + Url）——
fn extract_readable_text(html: &str, page_url: &str) -> Option<(String, String)> {
  use std::io::Cursor;
  let mut cursor = Cursor::new(html.as_bytes());
  let url = Url::parse(page_url).ok()?;
  match readability::extractor::extract(&mut cursor, &url) {
    Ok(product) => {
      let title = product.title;
      let text = if !product.text.trim().is_empty() {
        product.text
      } else {
        product.content
      };
      Some((title, text))
    }
    Err(_) => None,
  }
}

async fn call_bing_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let api_key = request
    .api_key
    .ok_or_else(|| "Bing API Key is missing".to_string())?;
  let url = "https://api.bing.microsoft.com/v7.0/search";
  log::info!("[WEB_SEARCH][bing] GET {}", url);
  let res = client
    .get(url)
    .header("Accept", "application/json")
    .header("Ocp-Apim-Subscription-Key", api_key)
    .query(&[("q", request.query.as_str())])
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?;
  let status = res.status();
  let text = res
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  log::info!(
    "[WEB_SEARCH][bing] status={} body_head={}",
    status,
    sample_for_log(&text)
  );
  let resp: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
    format!(
      "decode json failed: {}; body_head={}",
      e,
      sample_for_log(&text)
    )
  })?;

  let items = resp
    .get("webPages")
    .and_then(|wp| wp.get("value"))
    .and_then(|v| v.as_array())
    .ok_or_else(|| "No webPages found in Bing response".to_string())?;

  let results: Vec<WebSearchResult> = items
    .iter()
    .filter_map(|item| {
      let title = item.get("name")?.as_str()?;
      let url = item.get("url")?.as_str()?;
      let snippet = item.get("snippet")?.as_str().unwrap_or("").to_string();
      Some(WebSearchResult {
        source_title: title.to_string(),
        url: url.to_string(),
        snippet,
      })
    })
    .take(5)
    .collect();

  Ok(results)
}

/// DuckDuckGo 搜索
/// 说明：当前实现沿用基于 https://html.duckduckgo.com 的解析逻辑，与 `custom_scrape` 一致。
/// 这样可在无需额外密钥的情况下提供稳定可用的结果。
/// 若后续需要切换为 duckduckgo crate，可在此处替换为 crate 的调用与结果映射。
async fn call_duckduckgo_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  call_custom_scraper(client, request).await
}

async fn call_custom_scraper(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  // 构建 DDG URL（支持 site/kl/kp 等）
  let mut q = request.query.clone();
  if let Some(site) = request.site.as_ref().filter(|s| !s.trim().is_empty()) {
    q = format!("site:{} {}", site.trim(), q);
  }
  let mut url = format!("https://html.duckduckgo.com/html/?q={}", encode(&q));
  if let Some(kl) = request.kl.as_ref().filter(|s| !s.trim().is_empty()) {
    url.push_str(&format!("&kl={}", encode(kl)));
  }
  if let Some(safe) = request.safe {
    let kp = if safe { "1" } else { "-2" };
    url.push_str(&format!("&kp={}", kp));
  }
  log::info!("[WEB_SEARCH][scrape] GET {}", url);
  let mut req = client.get(url);
  if let Some(lang) = request
    .accept_language
    .as_ref()
    .filter(|s| !s.trim().is_empty())
  {
    req = req.header("Accept-Language", lang);
  }
  let body = req
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  log::info!("[WEB_SEARCH][scrape] body_head={}", sample_for_log(&body));

  let document = Html::parse_document(&body);
  let result_selector = Selector::parse("div.result").map_err(|e| e.to_string())?;
  let title_selector =
    Selector::parse("h2.result__title > a.result__a").map_err(|e| e.to_string())?;
  let snippet_selector = Selector::parse("a.result__snippet").map_err(|e| e.to_string())?;
  let url_selector = Selector::parse("a.result__url").map_err(|e| e.to_string())?;

  let take_n = request.limit.unwrap_or(DEFAULT_DDG_LIMIT);
  let results: Vec<WebSearchResult> = document
    .select(&result_selector)
    .filter_map(|el| {
      let title = el
        .select(&title_selector)
        .next()?
        .text()
        .collect::<String>()
        .trim()
        .to_string();
      let snippet = el
        .select(&snippet_selector)
        .next()?
        .text()
        .collect::<String>()
        .trim()
        .to_string();
      let raw = el
        .select(&url_selector)
        .next()?
        .value()
        .attr("href")?
        .trim()
        .to_string();
      let url = match Url::parse(&raw) {
        Ok(parsed) => {
          if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "uddg") {
            urlencoding::decode(v.as_ref())
              .map(|d| d.into_owned())
              .unwrap_or_else(|_| v.into_owned())
          } else {
            raw
          }
        }
        Err(_) => raw,
      };
      Some(WebSearchResult {
        source_title: title,
        snippet,
        url,
      })
    })
    .take(take_n)
    .collect();

  Ok(results)
}

async fn call_ollama_search(
  client: &Client,
  request: WebSearchRequest,
) -> Result<Vec<WebSearchResult>, String> {
  let api_key = request
    .api_key
    .ok_or_else(|| "Ollama API Key is missing".to_string())?;
  let url = "https://ollama.com/api/web_search";
  let payload = serde_json::json!({
    "query": request.query,
    "max_results": request.max_results.unwrap_or(5)
  });

  log::info!("[WEB_SEARCH][ollama] POST {}", url);
  let res = client
    .post(url)
    .header("Accept", "application/json")
    .bearer_auth(api_key)
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("http error: {}", e))?;
  let status = res.status();
  let text = res
    .text()
    .await
    .map_err(|e| format!("read body failed: {}", e))?;
  log::info!(
    "[WEB_SEARCH][ollama] status={} body_head={}",
    status,
    sample_for_log(&text)
  );
  let resp: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
    format!(
      "decode json failed: {}; body_head={}",
      e,
      sample_for_log(&text)
    )
  })?;

  let items = resp
    .get("results")
    .and_then(|i| i.as_array())
    .ok_or_else(|| "No results found in Ollama response".to_string())?;
  let results: Vec<WebSearchResult> = items
    .iter()
    .filter_map(|item| {
      let title = item.get("title")?.as_str()?;
      let url = item.get("url")?.as_str()?;
      let content = item
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
      Some(WebSearchResult {
        source_title: title.to_string(),
        url: url.to_string(),
        snippet: content,
      })
    })
    .take(5)
    .collect();

  Ok(results)
}

fn sample_for_log(s: &str) -> String {
  let trimmed = s.trim();
  let head: String = trimmed.chars().take(280).collect();
  if trimmed.len() > 280 {
    format!("{}… (len={})", head, trimmed.len())
  } else {
    head
  }
}

// ===== DuckRush 风格 JSON API 封装（仅返回 JSON 结构，不改变现有 web_search 返回类型） =====
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DuckrushItem {
  pub title: String,
  pub url: String,
  pub description: String,
  #[serde(rename = "searchEngine")]
  pub search_engine: String,
  pub rank: i32,
  pub timestamp: i64,
}

#[derive(Serialize, Debug)]
pub struct DuckrushData {
  pub results: Vec<DuckrushItem>,
}

#[derive(Serialize, Debug)]
pub struct DuckrushResponse {
  pub code: i32,
  pub message: String,
  pub data: DuckrushData,
}

/// 提供与参考项目类似的 JSON API 返回结构
/// - 输入：query（搜索关键词）
/// - 输出：{ code, message, data: { results: [ { title, url, description, searchEngine, rank, timestamp } ] } }
#[tauri::command]
pub async fn duckrush_search_api(query: String) -> Result<DuckrushResponse, String> {
  let client = http_client::get_browser_like_client()
    .map_err(|e| format!("init http client failed: {}", e))?;
  let results = call_duckduckgo_search(
    &client,
    WebSearchRequest {
      provider: "duckduckgo".to_string(),
      query: query.clone(),
      api_key: None,
      cse_id: None,
      limit: Some(5),
      kl: None,
      accept_language: None,
      safe: None,
      site: None,
      max_results: None,
      base_url: None,
      search_depth: None,
      topic: None,
      include_domains: None,
      exclude_domains: None,
      country: None,
      search_lang: None,
      safe_search: None,
      extra_snippets: None,
      categories: None,
      language: None,
      time_range: None,
    },
  )
  .await?;

  let now_ms = (std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_else(|_| std::time::Duration::from_millis(0)))
  .as_millis() as i64;

  let items: Vec<DuckrushItem> = results
    .into_iter()
    .enumerate()
    .map(|(i, r)| DuckrushItem {
      title: r.source_title,
      url: r.url,
      description: r.snippet,
      search_engine: "DuckDuckGo".to_string(),
      rank: (i as i32) + 1,
      timestamp: now_ms,
    })
    .collect();

  Ok(DuckrushResponse {
    code: 0,
    message: "OK".to_string(),
    data: DuckrushData { results: items },
  })
}
