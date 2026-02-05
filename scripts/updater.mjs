import { Octokit } from "@octokit/rest";

const UPDATE_JSON_FILE = "update.json";
const UPDATE_JSON_PROXY = "update-proxy.json";

const ALPHA_TAG_NAME = "updater-alpha";
const ALPHA_UPDATE_JSON_FILE = "update.json";
const ALPHA_UPDATE_JSON_PROXY = "update-proxy.json";

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  if (!token && !DRY_RUN) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const { owner, repo } = resolveRepo();
  // 支持使用 PUBLIC_RELEASE_REPO 来生成指向公开仓库的 URL
  // 格式: owner/repo (例如: kamjin3086/chatless-pro2)
  const targetRepo = resolveTargetRepo();
  const octokit = token ? new Octokit({ auth: token }) : new Octokit();

  const explicitTag = process.env.RELEASE_TAG;
  const tags = explicitTag
    ? [{ name: explicitTag }]
    : await fetchAllTags(octokit, owner, repo);

  const stableTagRegex = /^v\d+\.\d+\.\d+$/;
  const preReleaseRegex = /^v\d+\.\d+\.\d+-(alpha|beta|rc|pre)(\.[0-9]+)?$/i;

  for (const t of tags) {
    const isAlpha = preReleaseRegex.test(t.name);
    const isStable = stableTagRegex.test(t.name);
    if (!isAlpha && !isStable) continue;
    await processRelease(octokit, { owner, repo }, t, isAlpha, targetRepo);
  }
}

function resolveRepo() {
  const envRepo = process.env.GITHUB_REPOSITORY;
  if (!envRepo) {
    throw new Error(
      "GITHUB_REPOSITORY is required (format: owner/repo). This script is intended to run in GitHub Actions."
    );
  }
  const [owner, repo] = envRepo.split("/");
  if (!owner || !repo) {
    throw new Error("Invalid GITHUB_REPOSITORY env value");
  }
  return { owner, repo };
}

/**
 * 解析目标仓库（用于生成下载 URL）
 * 优先使用 PUBLIC_RELEASE_REPO 环境变量，如果未设置则使用当前仓库
 * 这允许私有仓库构建后，生成指向公开仓库的下载链接
 */
function resolveTargetRepo() {
  const publicRepo = process.env.PUBLIC_RELEASE_REPO;
  if (publicRepo) {
    const [owner, repo] = publicRepo.split("/");
    if (owner && repo) {
      console.log(`Using PUBLIC_RELEASE_REPO for download URLs: ${publicRepo}`);
      return { owner, repo };
    }
    console.warn(`Invalid PUBLIC_RELEASE_REPO format: ${publicRepo}, falling back to GITHUB_REPOSITORY`);
  }
  return resolveRepo();
}

/**
 * 将原始下载 URL 转换为目标仓库的 URL
 * @param {string} originalUrl - 原始的 browser_download_url
 * @param {object} targetRepo - 目标仓库 { owner, repo }
 * @param {string} tagName - Release 标签名
 * @returns {string} 转换后的 URL
 */
function rewriteDownloadUrl(originalUrl, targetRepo, tagName) {
  if (!originalUrl) return originalUrl;
  
  // 提取文件名
  const fileName = originalUrl.split("/").pop();
  if (!fileName) return originalUrl;
  
  // 生成新的下载 URL
  return `https://github.com/${targetRepo.owner}/${targetRepo.repo}/releases/download/${tagName}/${fileName}`;
}

async function fetchAllTags(octokit, owner, repo) {
  const perPage = 100;
  let page = 1;
  const all = [];
  while (true) {
    const { data } = await octokit.repos.listTags({ owner, repo, per_page: perPage, page });
    all.push(...data);
    if (data.length < perPage) break;
    page += 1;
  }
  return all;
}

async function processRelease(octokit, options, tag, isAlpha, targetRepo) {
  try {
    const { data: release } = await octokit.repos.getReleaseByTag({ ...options, tag: tag.name });

    const updateData = createEmptyUpdate(tag.name, release.body);

    // 构建 asset id 到 asset 的映射，用于通过 API 获取签名内容
    const assetMap = new Map();
    for (const asset of release.assets) {
      assetMap.set(asset.name, asset);
    }

    // 收集 Linux 资产候选，便于在收集完成后按优先级选择（.deb > .rpm > AppImage/tarball）
    const linuxCandidates = {};
    const ensureArch = (arch) => {
      if (!linuxCandidates[arch]) linuxCandidates[arch] = { deb: {}, rpm: {}, app: {}, tar: {} };
      return linuxCandidates[arch];
    };
    const detectLinuxArch = (lower) => {
      if (lower.includes("aarch64") || lower.includes("arm64")) return "aarch64";
      if (lower.includes("x86_64") || lower.includes("amd64")) return "x86_64";
      if (lower.includes("i386") || lower.includes("i686") || (lower.includes("x86") && !lower.includes("x86_64"))) return "i686";
      return "x86_64";
    };

    // 辅助函数：通过 GitHub API 获取签名文件内容（支持私有仓库）
    const getSignatureFromAsset = async (sigFileName) => {
      const sigAsset = assetMap.get(sigFileName);
      if (!sigAsset) {
        console.warn(`Signature asset not found: ${sigFileName}`);
        return "Not Found";
      }
      return await getSignatureViaApi(octokit, options, sigAsset.id);
    };

    const fillTasks = release.assets.map(async (asset) => {
      const { name, browser_download_url: originalUrl } = asset;
      // 使用目标仓库的 URL（如果配置了 PUBLIC_RELEASE_REPO）用于最终的下载链接
      const browser_download_url = rewriteDownloadUrl(originalUrl, targetRepo, tag.name);

      // Windows x64
      if (name.endsWith("x64-setup.exe")) {
        updateData.platforms.win64.url = browser_download_url;
        updateData.platforms["windows-x86_64"].url = browser_download_url;
      }
      if (name.endsWith("x64-setup.exe.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms.win64.signature = sig;
        updateData.platforms["windows-x86_64"].signature = sig;
      }

      // Windows x86
      if (name.endsWith("x86-setup.exe")) {
        updateData.platforms["windows-x86"].url = browser_download_url;
        updateData.platforms["windows-i686"].url = browser_download_url;
      }
      if (name.endsWith("x86-setup.exe.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms["windows-x86"].signature = sig;
        updateData.platforms["windows-i686"].signature = sig;
      }

      // Windows ARM64
      if (name.endsWith("arm64-setup.exe")) {
        updateData.platforms["windows-aarch64"].url = browser_download_url;
      }
      if (name.endsWith("arm64-setup.exe.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms["windows-aarch64"].signature = sig;
      }

      // macOS Intel（非 aarch64）。如需假定通用包可在 Apple Silicon 使用，可设置环境变量 UPDATER_ASSUME_UNIVERSAL_DARWIN=true
      if (name.endsWith(".app.tar.gz") && !name.includes("aarch") && !name.includes("arm64")) {
        updateData.platforms.darwin.url = browser_download_url;
        updateData.platforms["darwin-intel"].url = browser_download_url;
        updateData.platforms["darwin-x86_64"].url = browser_download_url;
        if (process.env.UPDATER_ASSUME_UNIVERSAL_DARWIN === "1" || process.env.UPDATER_ASSUME_UNIVERSAL_DARWIN === "true") {
          updateData.platforms["darwin-aarch64"].url = browser_download_url;
        }
      }
      if (name.endsWith(".app.tar.gz.sig") && !name.includes("aarch") && !name.includes("arm64")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms.darwin.signature = sig;
        updateData.platforms["darwin-intel"].signature = sig;
        updateData.platforms["darwin-x86_64"].signature = sig;
        if (process.env.UPDATER_ASSUME_UNIVERSAL_DARWIN === "1" || process.env.UPDATER_ASSUME_UNIVERSAL_DARWIN === "true") {
          updateData.platforms["darwin-aarch64"].signature = sig;
        }
      }

      // macOS Apple Silicon (aarch64)
      if (name.endsWith("aarch64.app.tar.gz")) {
        updateData.platforms["darwin-aarch64"].url = browser_download_url;
      }
      if (name.endsWith("aarch64.app.tar.gz.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms["darwin-aarch64"].signature = sig;
      }

      // macOS Apple Silicon (arm64) - 新增支持
      if (name.endsWith("arm64.app.tar.gz")) {
        updateData.platforms["darwin-aarch64"].url = browser_download_url;
      }
      if (name.endsWith("arm64.app.tar.gz.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms["darwin-aarch64"].signature = sig;
      }

      // macOS Intel (x64) - 新增支持
      if (name.endsWith("x64.app.tar.gz")) {
        updateData.platforms.darwin.url = browser_download_url;
        updateData.platforms["darwin-intel"].url = browser_download_url;
        updateData.platforms["darwin-x86_64"].url = browser_download_url;
      }
      if (name.endsWith("x64.app.tar.gz.sig")) {
        const sig = await getSignatureFromAsset(name);
        updateData.platforms.darwin.signature = sig;
        updateData.platforms["darwin-intel"].signature = sig;
        updateData.platforms["darwin-x86_64"].signature = sig;
      }

      // Linux (common patterns) —— 先匹配 aarch64/arm64，其次 x86_64/amd64，最后再考虑 i686/x86，避免 "x86_64" 误被识别为 x86
      if (name.endsWith(".AppImage.tar.gz") || name.endsWith("linux-x86_64.tar.gz") || name.endsWith("linux-aarch64.tar.gz")) {
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        if (lower.includes("aarch64") || lower.includes("arm64")) {
          updateData.platforms["linux-aarch64"].url = browser_download_url;
        } else if (lower.includes("x86_64") || lower.includes("amd64")) {
          updateData.platforms["linux-x86_64"].url = browser_download_url;
        } else if (lower.includes("i686") || (lower.includes("x86") && !lower.includes("x86_64"))) {
          updateData.platforms["linux-i686"].url = browser_download_url;
          updateData.platforms["linux-x86"].url = browser_download_url;
        } else {
          updateData.platforms["linux-x86_64"].url = browser_download_url;
        }
        updateData.platforms.linux.url = updateData.platforms.linux.url || browser_download_url;
        // 记录候选（作为 app/tarball 类）
        ensureArch(arch).app.url = ensureArch(arch).app.url || browser_download_url;
      }
      if (name.endsWith(".AppImage.tar.gz.sig") || name.endsWith("linux-x86_64.tar.gz.sig") || name.endsWith("linux-aarch64.tar.gz.sig")) {
        const sig = await getSignatureFromAsset(name);
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        if (lower.includes("aarch64") || lower.includes("arm64")) {
          updateData.platforms["linux-aarch64"].signature = sig;
        } else if (lower.includes("x86_64") || lower.includes("amd64")) {
          updateData.platforms["linux-x86_64"].signature = sig;
        } else if (lower.includes("i686") || (lower.includes("x86") && !lower.includes("x86_64"))) {
          updateData.platforms["linux-i686"].signature = sig;
          updateData.platforms["linux-x86"].signature = sig;
        } else {
          updateData.platforms["linux-x86_64"].signature = sig;
        }
        updateData.platforms.linux.signature = updateData.platforms.linux.signature || sig;
        // 记录候选签名
        ensureArch(arch).app.signature = ensureArch(arch).app.signature || sig;
      }

      // Linux .deb（仅在对应平台尚未设置 url/signature 时填充，避免覆盖 AppImage/tarball）
      if (name.endsWith(".deb")) {
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        // 记录 deb 候选
        ensureArch(arch).deb.url = browser_download_url;
        if (arch === "aarch64" && !updateData.platforms["linux-aarch64"].url) {
          updateData.platforms["linux-aarch64"].url = browser_download_url;
        } else if (arch === "x86_64" && !updateData.platforms["linux-x86_64"].url) {
          updateData.platforms["linux-x86_64"].url = browser_download_url;
        } else if (arch === "i686" && !updateData.platforms["linux-i686"].url) {
          updateData.platforms["linux-i686"].url = browser_download_url;
          updateData.platforms["linux-x86"].url = browser_download_url;
        }
        updateData.platforms.linux.url = updateData.platforms.linux.url || browser_download_url;
      }
      if (name.endsWith(".deb.sig")) {
        const sig = await getSignatureFromAsset(name);
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        // 记录 deb 签名
        ensureArch(arch).deb.signature = sig;
        if (arch === "aarch64" && !updateData.platforms["linux-aarch64"].signature) {
          updateData.platforms["linux-aarch64"].signature = sig;
        } else if (arch === "x86_64" && !updateData.platforms["linux-x86_64"].signature) {
          updateData.platforms["linux-x86_64"].signature = sig;
        } else if (arch === "i686" && !updateData.platforms["linux-i686"].signature) {
          updateData.platforms["linux-i686"].signature = sig;
          updateData.platforms["linux-x86"].signature = sig;
        }
        updateData.platforms.linux.signature = updateData.platforms.linux.signature || sig;
      }

      // Linux .rpm（同样仅在未设置时填充）
      if (name.endsWith(".rpm")) {
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        // 记录 rpm 候选
        ensureArch(arch).rpm.url = browser_download_url;
        if (arch === "aarch64" && !updateData.platforms["linux-aarch64"].url) {
          updateData.platforms["linux-aarch64"].url = browser_download_url;
        } else if (arch === "x86_64" && !updateData.platforms["linux-x86_64"].url) {
          updateData.platforms["linux-x86_64"].url = browser_download_url;
        } else if (arch === "i686" && !updateData.platforms["linux-i686"].url) {
          updateData.platforms["linux-i686"].url = browser_download_url;
          updateData.platforms["linux-x86"].url = browser_download_url;
        }
        updateData.platforms.linux.url = updateData.platforms.linux.url || browser_download_url;
      }
      if (name.endsWith(".rpm.sig")) {
        const sig = await getSignatureFromAsset(name);
        const lower = name.toLowerCase();
        const arch = detectLinuxArch(lower);
        // 记录 rpm 签名
        ensureArch(arch).rpm.signature = sig;
        if (arch === "aarch64" && !updateData.platforms["linux-aarch64"].signature) {
          updateData.platforms["linux-aarch64"].signature = sig;
        } else if (arch === "x86_64" && !updateData.platforms["linux-x86_64"].signature) {
          updateData.platforms["linux-x86_64"].signature = sig;
        } else if (arch === "i686" && !updateData.platforms["linux-i686"].signature) {
          updateData.platforms["linux-i686"].signature = sig;
          updateData.platforms["linux-x86"].signature = sig;
        }
        updateData.platforms.linux.signature = updateData.platforms.linux.signature || sig;
      }
    });

    await Promise.allSettled(fillTasks);

    // 清理未解析的平台
    Object.entries(updateData.platforms).forEach(([key, value]) => {
      if (!value.url) delete updateData.platforms[key];
    });

    // 可选：严格模式下剔除非标准别名键，避免冗余（默认不启用以保持兼容）
    if (process.env.UPDATER_STRICT_KEYS === "1" || process.env.UPDATER_STRICT_KEYS === "true") {
      ["win64", "darwin", "darwin-intel", "linux"].forEach((alias) => {
        if (updateData.platforms[alias]) delete updateData.platforms[alias];
      });
    }

    // Linux 平台选择优先级：.deb > .rpm > AppImage/tarball（按架构独立决策，不覆盖已确定值）
    const prefer = (archKey, candidateKind) => {
      const platKey = archKey === "aarch64" ? "linux-aarch64" : archKey === "i686" ? "linux-i686" : "linux-x86_64";
      if (!updateData.platforms[platKey]) return;
      const current = updateData.platforms[platKey];
      const cands = linuxCandidates[archKey] || {};
      const pick = (k) => (cands[k] && cands[k].url && cands[k].signature ? cands[k] : undefined);
      const pickUrl = (k) => (cands[k] && cands[k].url ? cands[k] : undefined);
      // 若当前条目缺失或来自 app/tarball/rpm，且存在更高优先级的 deb，则用 deb；否则若缺失且有 rpm，用 rpm；否则保留已有
      const isWeak = !current.url || (!current.signature);
      if (candidateKind === "deb") {
        const d = pick("deb") || pickUrl("deb");
        if (d && (isWeak || current.url.endsWith(".rpm"))) {
          updateData.platforms[platKey].url = d.url;
          if (d.signature) updateData.platforms[platKey].signature = d.signature;
        }
      } else if (candidateKind === "rpm") {
        if (!updateData.platforms[platKey].url || !updateData.platforms[platKey].signature) {
          const r = pick("rpm") || pickUrl("rpm");
          if (r) {
            updateData.platforms[platKey].url = updateData.platforms[platKey].url || r.url;
            if (!updateData.platforms[platKey].signature && r.signature) updateData.platforms[platKey].signature = r.signature;
          }
        }
      }
    };

    // 应用优先级：先尝试用 deb 替换/补全，再尝试 rpm 补全
    ["x86_64", "aarch64", "i686"].forEach((arch) => {
      prefer(arch, "deb");
    });
    ["x86_64", "aarch64", "i686"].forEach((arch) => {
      prefer(arch, "rpm");
    });

    // 在应用优先级之后再生成代理数据，确保两者一致
    const updateDataProxy = makeProxyData(updateData);

    // 选择目标 release（稳定：当前版本；预发布：updater-alpha 固定通道）
    const jsonFile = isAlpha ? ALPHA_UPDATE_JSON_FILE : UPDATE_JSON_FILE;
    const proxyFile = isAlpha ? ALPHA_UPDATE_JSON_PROXY : UPDATE_JSON_PROXY;

    const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
    if (DRY_RUN) {
      console.log(`\n===== ${isAlpha ? "[DRY] alpha" : "[DRY] stable"} ${jsonFile} (${tag.name}) =====`);
      console.log(JSON.stringify(updateData, null, 2));
      console.log(`\n===== ${isAlpha ? "[DRY] alpha" : "[DRY] stable"} ${proxyFile} (${tag.name}) =====`);
      console.log(JSON.stringify(updateDataProxy, null, 2));
    } else {
      let targetRelease;
      if (isAlpha) {
        targetRelease = await getOrCreateRelease(octokit, options, ALPHA_TAG_NAME, true);
      } else {
        targetRelease = release; // 将 update.json 直接上传到当前稳定版的 Release
      }

      // 删除同名旧资产
      for (const asset of targetRelease.assets) {
        if (asset.name === jsonFile || asset.name === proxyFile) {
          try {
            await octokit.repos.deleteReleaseAsset({ ...options, asset_id: asset.id });
          } catch (e) {
            console.warn(`Delete asset failed (${asset.name}):`, e.message);
          }
        }
      }

      // 上传新的 JSON 资产
      await uploadJsonAsset(octokit, options, targetRelease.id, jsonFile, updateData);
      await uploadJsonAsset(octokit, options, targetRelease.id, proxyFile, updateDataProxy);

      console.log(
        `Uploaded ${isAlpha ? "alpha" : "stable"} update files to ${isAlpha ? ALPHA_TAG_NAME : tag.name}`
      );
    }
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release not found for tag: ${tag.name}, skipping...`);
    } else {
      console.error(`Failed to process tag ${tag.name}:`, error.message);
    }
  }
}

function createEmptyUpdate(tagName, releaseBody) {
  const normalizedVersion = typeof tagName === "string" && tagName.startsWith("v")
    ? tagName.slice(1)
    : tagName;

  return {
    version: normalizedVersion,
    notes: releaseBody || "",
    pub_date: new Date().toISOString(),
    platforms: {
      win64: { signature: "", url: "" },
      linux: { signature: "", url: "" },
      darwin: { signature: "", url: "" },
      "darwin-aarch64": { signature: "", url: "" },
      "darwin-intel": { signature: "", url: "" },
      "darwin-x86_64": { signature: "", url: "" },
      "linux-x86_64": { signature: "", url: "" },
      "linux-x86": { signature: "", url: "" },
      "linux-i686": { signature: "", url: "" },
      "linux-aarch64": { signature: "", url: "" },
      "linux-armv7": { signature: "", url: "" },
      "windows-x86_64": { signature: "", url: "" },
      "windows-aarch64": { signature: "", url: "" },
      "windows-x86": { signature: "", url: "" },
      "windows-i686": { signature: "", url: "" }
    }
  };
}

function makeProxyData(updateData) {
  const clone = JSON.parse(JSON.stringify(updateData));
  const prefix = process.env.UPDATER_PROXY_PREFIX || "";
  for (const [key, value] of Object.entries(clone.platforms)) {
    if (!value.url) continue;
    clone.platforms[key].url = prefix ? `${prefix}${value.url}` : value.url;
  }
  return clone;
}

async function getOrCreateRelease(octokit, options, tag, prerelease) {
  try {
    const { data } = await octokit.repos.getReleaseByTag({ ...options, tag });
    return data;
  } catch (error) {
    if (error.status === 404) {
      const { data } = await octokit.repos.createRelease({
        ...options,
        tag_name: tag,
        name: prerelease ? "Auto-update Alpha Channel" : "Auto-update Stable Channel",
        body: `This release contains the update information for ${prerelease ? "alpha" : "stable"} channel.`,
        prerelease
      });
      return data;
    }
    throw error;
  }
}

async function uploadJsonAsset(octokit, options, releaseId, name, json) {
  await octokit.repos.uploadReleaseAsset({
    ...options,
    release_id: releaseId,
    name,
    data: Buffer.from(JSON.stringify(json, null, 2), "utf8"),
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(JSON.stringify(json, null, 2)).toString()
    }
  });
}

/**
 * 通过 GitHub API 获取 Release asset 内容（支持私有仓库）
 * @param {Octokit} octokit - GitHub API 客户端
 * @param {object} options - { owner, repo }
 * @param {number} assetId - Asset ID
 * @returns {Promise<string>} 签名内容
 */
async function getSignatureViaApi(octokit, options, assetId) {
  try {
    // 使用 GitHub API 获取 asset 内容
    const { data } = await octokit.repos.getReleaseAsset({
      ...options,
      asset_id: assetId,
      headers: {
        Accept: "application/octet-stream"
      }
    });
    
    // data 可能是 ArrayBuffer 或 string
    let text;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data);
    } else {
      // 尝试转换为字符串
      text = String(data);
    }
    
    // 验证签名内容是否有效
    if (!text || text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("Not Found")) {
      console.warn(`Invalid signature content for asset ${assetId}`);
      return "Not Found";
    }
    
    return text.trim();
  } catch (error) {
    console.warn(`Error fetching signature via API (asset ${assetId}):`, error.message);
    return "Not Found";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

