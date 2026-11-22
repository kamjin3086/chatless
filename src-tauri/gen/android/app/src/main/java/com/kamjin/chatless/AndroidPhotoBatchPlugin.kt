package com.kamjin.chatless

import android.app.Activity
import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

@TauriPlugin
class AndroidPhotoBatchPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Batch(val count: Int, val inventory: PhotoBatchInventory)

    private val resolver = activity.contentResolver
    private val batches = HashMap<String, Batch>()
    private var activePicker: Invoke? = null
    // The photo batch keeps its own result key: the single-photo and document
    // pickers must not capture this selection, or this one theirs.
    private val picker by lazy {
        (activity as ComponentActivity).activityResultRegistry.register(
            "chatless-android-photo-batch",
            ActivityResultContracts.PickMultipleVisualMedia(MAX_PHOTO_BATCH),
            ::batchPicked,
        )
    }

    @Command
    fun pick(invoke: Invoke) {
        activity.runOnUiThread {
            if (activePicker != null) {
                invoke.resolve(status("busy"))
                return@runOnUiThread
            }
            activePicker = invoke
            try {
                picker.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            } catch (_: Exception) {
                activePicker = null
                invoke.resolve(status("unavailable"))
            }
        }
    }

    private fun batchPicked(uris: List<Uri>) {
        val invoke = activePicker ?: return
        if (uris.isEmpty()) {
            activePicker = null
            invoke.resolve(status("cancelled"))
            return
        }
        executor.execute {
            val reply = try {
                select(invoke.getArgs().getString("conversationId"), uris)
            } catch (_: Exception) {
                status("unavailable")
            }
            activity.runOnUiThread {
                activePicker = null
                invoke.resolve(reply)
            }
        }
    }

    // Reads each explicitly selected photo once, then keeps only metadata and
    // opaque handles: no URI outlives the selection and no content is uploaded.
    private fun select(conversationId: String, uris: List<Uri>): JSObject {
        val rows = uris.map { uri -> runCatching { row(uri) }.getOrNull() }
        val inventory = AndroidPhotoBatch(UUID.randomUUID().toString()).inventory(rows)
        synchronized(batches) { batches[conversationId] = Batch(uris.size, inventory) }
        return status("ready").apply { put("count", uris.size) }
    }

    private fun row(uri: Uri): PhotoBatchRow? {
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
        val (name, sizeBytes) = metadata(uri) ?: return null
        return PhotoBatchRow(uri.toString(), name, resolver.getType(uri), sizeBytes, digest(uri))
    }

    private fun metadata(uri: Uri): Pair<String, Long?>? {
        val columns = arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        resolver.query(uri, columns, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val name = if (nameIndex >= 0 && !cursor.isNull(nameIndex)) cursor.getString(nameIndex) else null
            if (name.isNullOrBlank()) return null
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else null
            return name to size
        }
        return null
    }

    // Identical bytes are the only duplicate signal, so the whole file is read
    // once up to the single-photo import ceiling; anything larger stays uncompared.
    private fun digest(uri: Uri): String? {
        val input = resolver.openInputStream(uri) ?: return null
        return input.use { stream ->
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (true) {
                val read = stream.read(buffer)
                if (read == -1) break
                total += read
                if (total > MAX_SOURCE_BYTES) return null
                digest.update(buffer, 0, read)
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }
    }

    @Command
    fun selection(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        val batch = synchronized(batches) { batches[conversationId] } ?: return@runInBackground status("none")
        status("ready").apply { put("count", batch.count) }
    }

    @Command
    fun forget(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        synchronized(batches) { batches.remove(conversationId) }
        status("none")
    }

    @Command
    fun inventory(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        val batch = synchronized(batches) { batches[conversationId] } ?: return@runInBackground status("none")
        status("ready").apply {
            put("count", batch.count)
            put("items", JSONArray(batch.inventory.items.map { it.toJson() }))
            put("omissions", JSONArray(batch.inventory.omissions.map { it.toJson() }))
        }
    }

    private fun runInBackground(invoke: Invoke, work: (String) -> JSObject) {
        executor.execute {
            val receipt = try {
                work(invoke.getArgs().getString("conversationId"))
            } catch (_: Exception) {
                status("unavailable")
            }
            invoke.resolve(receipt)
        }
    }

    private fun PhotoBatchItem.toJson() = JSObject().apply {
        put("handle", handle)
        put("name", name)
        put("mimeType", mimeType ?: JSONObject.NULL)
        put("sizeBytes", sizeBytes ?: JSONObject.NULL)
        put("contentDigest", contentDigest ?: JSONObject.NULL)
    }

    private fun PhotoBatchOmission.toJson() = JSObject().apply {
        put("reason", reason)
        put("name", name ?: JSONObject.NULL)
    }

    private fun status(value: String) = JSObject().apply { put("status", value) }

    private companion object {
        private val executor = Executors.newFixedThreadPool(2)
    }
}
