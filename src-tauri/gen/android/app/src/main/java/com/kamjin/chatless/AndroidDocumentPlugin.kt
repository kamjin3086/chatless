package com.kamjin.chatless

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidDocumentPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun pick(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "text/plain"))
        activity.runOnUiThread {
            try {
                startActivityForResult(invoke, intent, "documentPicked")
            } catch (_: Exception) {
                resolveStatus(invoke, "inaccessible")
            }
        }
    }

    @ActivityCallback
    fun documentPicked(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            resolveStatus(invoke, "cancelled")
            return
        }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri?.scheme != ContentResolver.SCHEME_CONTENT) {
            resolveStatus(invoke, "inaccessible")
            return
        }

        Thread {
            try {
                val resolver = activity.contentResolver
                val mime = resolver.getType(uri).orEmpty()
                val fallbackName = when (mime) {
                    "application/pdf" -> "Document.pdf"
                    "text/plain" -> "Document.txt"
                    else -> "Document"
                }
                val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
                    ?.take(255)?.takeIf { it.isNotBlank() } ?: fallbackName
                val descriptor = resolver.openFileDescriptor(uri, "r")
                if (descriptor == null) {
                    resolveStatus(invoke, "inaccessible")
                    return@Thread
                }
                descriptor.use {
                    val receipt = JSObject().apply {
                        put("status", "selected")
                        put("name", name)
                        put("mime", mime)
                    }
                    // Transfer ownership; Rust closes the descriptor without retaining the URI grant.
                    receipt.put("fd", it.detachFd())
                    invoke.resolve(receipt)
                }
            } catch (_: Exception) {
                resolveStatus(invoke, "inaccessible")
            }
        }.start()
    }

    private fun resolveStatus(invoke: Invoke, status: String) {
        invoke.resolve(JSObject().apply { put("status", status) })
    }
}
