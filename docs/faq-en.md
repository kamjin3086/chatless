# FAQ and troubleshooting

[中文](faq.md) | English

Some versions still display the Chinese settings labels shown below.

## Why won't Chatless start after installation?

- **Chatless closes immediately on Windows:** Some systems need Microsoft's [Visual C++ Redistributable (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe).
- **Chatless won't open on macOS, or the Linux package won't run:** Check that the download matches your operating system and processor, then follow the steps for your platform in the [installation guide](../INSTALLATION_INSTRUCTIONS_EN.md).

## Why can't I send a message even though the provider is reachable?

Open the provider you're using under **Settings → AI Models** (`AI模型`). A reachable status means the service responded. It does not confirm that your API key is valid or that it has access to the selected model.

| Symptom | What to check first |
| --- | --- |
| `401` / `403`, invalid key or missing permissions | Confirm that the key belongs to the selected provider, is still valid, and has access to the selected model. |
| `404`, incorrect API address | Compare the service address and API path with the provider's documentation. Use the API base URL, not a web page or a full chat endpoint. Check the model ID too. |
| Connection refused, timed out, or host not found | Check the host and port. For a local service, confirm it is running; for a remote service, confirm it is reachable from your network. |

## What should I do if the provider returns `429` or "Too many requests"?

If you see `429` or `请求过于频繁` ("Too many requests"), pause instead of retrying repeatedly. If the provider gives a wait period (such as `Retry-After`) or a rate-limit reset time, wait until it has passed, then retry once with the **same provider, model, and settings**. Use **Retry** (`重试`) if it appears beside the reply; otherwise, resend the original message.

If `429` persists, check the provider dashboard for rate limits, remaining quota, or billing status. Waiting briefly usually won't help if you've used up your quota. Chatless cannot reset provider limits.

## Why don't my local Ollama models appear?

1. Make sure the Ollama service is running. Select **Ollama** under **Settings → AI Models** (`AI模型`) and check the service address. The default for a local installation is `http://localhost:11434`, without `/v1`.
2. If Ollama runs on this computer, check the installed models in a terminal:

   ```bash
   ollama list
   ```

3. If the model is missing, install it in Ollama and refresh the model list in Chatless. If the command cannot connect, check whether Ollama is running. If you use a remote instance, check the models on the configured server instead of checking the local list.

## How do I report a problem that I couldn't resolve?

1. Find your version under **Settings → About** (`关于`). Note the OS version, processor architecture, steps to reproduce, expected behavior, and actual error. For model issues, include the provider name, model ID, and what you've already tried.
2. If you need logs, choose **Export logs** (`导出日志`) in **Settings → Advanced** (`高级`) **→ Logging** (`日志系统`). Keep only the excerpt around the time of the error. The **Debug** (`调试`) level writes the request body sent to the model into the log, truncated after about 20,000 characters, and that body contains your own conversation text. If you enabled it temporarily, restore the previous level after reproducing the problem.
3. Before posting, remove API keys, tokens, private messages, file paths, and other sensitive information from logs, screenshots, and error text. Do not upload a full log export or your database.
4. [Search existing issues](https://github.com/kamjin3086/chatless/issues), then select **Bug report** on the [template chooser](https://github.com/kamjin3086/chatless/issues/new/choose). You can also open the feedback page from **Settings → About** (`关于`) **→ Submit feedback** (`提交反馈`). Write in whichever language lets you describe the problem accurately. No translation is required.

For usage questions, use [GitHub Discussions](https://github.com/kamjin3086/chatless/discussions). Report security vulnerabilities privately as described in the [security policy (in Chinese)](../SECURITY.md), not in public issues or discussions.
