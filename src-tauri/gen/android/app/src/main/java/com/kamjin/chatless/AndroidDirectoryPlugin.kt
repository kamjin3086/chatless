package com.kamjin.chatless

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

@TauriPlugin
class AndroidDirectoryPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Selection(val uri: Uri, val nonce: String) {
        fun encode() = JSONObject().put("uri", uri.toString()).put("nonce", nonce).toString()
    }

    private val resolver = activity.contentResolver
    private val selections = activity.getSharedPreferences("android_directory_selections", Context.MODE_PRIVATE)
    private var activePicker: Invoke? = null
    // Tauri's shared activity-result callback is also used by other attachment pickers.
    private val treePicker by lazy {
        (activity as ComponentActivity).activityResultRegistry.register(
            "chatless-android-directory", ActivityResultContracts.StartActivityForResult(), ::directoryPicked,
        )
    }

    @Command
    fun pick(invoke: Invoke) {
        activity.runOnUiThread {
            if (activePicker != null) {
                invoke.resolve(status("unavailable"))
                return@runOnUiThread
            }
            activePicker = invoke
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
                    READ or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
                )
                treePicker.launch(intent)
            } catch (_: Exception) {
                activePicker = null
                invoke.resolve(status("unavailable"))
            }
        }
    }

    private fun directoryPicked(result: ActivityResult) {
        val invoke = activePicker ?: return
        val data = result.data
        val uri = data?.data
        if (result.resultCode == Activity.RESULT_CANCELED) {
            activePicker = null
            invoke.resolve(status("cancelled"))
            return
        }
        if (result.resultCode != Activity.RESULT_OK || uri == null || uri.scheme != ContentResolver.SCHEME_CONTENT ||
            !DocumentsContract.isTreeUri(uri) || uri.pathSegments.size != 2 || (data.flags and READ) == 0
        ) {
            activePicker = null
            invoke.resolve(status("unavailable"))
            return
        }

        val conversationId = invoke.getArgs().getString("conversationId")
        executor.execute {
            val reply = try {
                select(conversationId, uri)
            } catch (_: Exception) {
                status("unavailable")
            }
            activity.runOnUiThread {
                activePicker = null
                invoke.resolve(reply)
            }
        }
    }

    @Command
    fun selection(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        val selection = attached(conversationId) ?: return@runInBackground status("none")
        val root = openRoot(selection) ?: return@runInBackground status("revoked")
        if (attached(conversationId) != selection) return@runInBackground status("revoked")
        ready(AndroidDirectoryInventory(selection.nonce).item(root))
    }

    @Command
    fun forget(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        synchronized(selections) {
            val selection = getSelection(conversationId) ?: return@synchronized status("none")
            // Detaching leaves the folder authorized for the app: the user granted it once, on
            // purpose, and the next conversation gets it back without the picker. The marker is
            // what keeps this conversation's "not here" choice from being overwritten.
            if (!selections.edit().remove(conversationId).putString(detachedKey(conversationId), "1").commit()) {
                selections.edit().putString(conversationId, selection.encode()).commit()
                return@synchronized status("unavailable")
            }
            status("none")
        }
    }

    @Command
    fun inventory(invoke: Invoke) = runInBackground(invoke) { conversationId ->
        val selection = attached(conversationId) ?: return@runInBackground status("none")
        val root = openRoot(selection) ?: return@runInBackground status("revoked")
        val result = AndroidDirectoryInventory(selection.nonce).scan(root) { parentId, accept ->
            // Every query is made through the selected tree URI using IDs it supplied.
            // No model arguments choose a document ID, URI, or path.
            if (getSelection(conversationId) != selection) return@scan false
            try {
                val children = DocumentsContract.buildChildDocumentsUriUsingTree(selection.uri, parentId)
                resolver.query(children, columns, null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) if (!accept(cursor.toDirectoryRow())) break
                    !cursor.extras.getBoolean(DocumentsContract.EXTRA_LOADING) &&
                        !cursor.extras.containsKey(DocumentsContract.EXTRA_ERROR)
                } ?: false
            } catch (_: Exception) {
                false
            }
        }
        if (getSelection(conversationId) != selection || !hasReadGrant(selection.uri)) {
            return@runInBackground status("revoked")
        }
        ready(result.folder).apply {
            put("entries", JSONArray(result.entries.map { entry ->
                entry.item.toJson().apply {
                    put("parentHandle", entry.parentHandle)
                    put("kind", if (entry.directory) "directory" else "file")
                    put("mimeType", entry.mimeType ?: JSONObject.NULL)
                    put("sizeBytes", entry.sizeBytes ?: JSONObject.NULL)
                    put("modifiedAt", entry.modifiedAt ?: JSONObject.NULL)
                }
            }))
            put("omissions", JSONArray(result.omissions.map { omission ->
                (omission.item?.toJson() ?: JSObject()).apply {
                    put("parentHandle", omission.parentHandle)
                    put("reason", omission.reason)
                }
            }))
        }
    }

    private fun select(conversationId: String, uri: Uri): JSObject {
        val root = readRoot(uri) ?: return status("unavailable")
        val selection = Selection(uri, UUID.randomUUID().toString())
        synchronized(selections) {
            val previous = getSelection(conversationId)
            resolver.takePersistableUriPermission(uri, READ)
            val write = selections.edit()
                .putString(conversationId, selection.encode())
                .putString(LAST, selection.encode())
                .remove(detachedKey(conversationId))
            if (!write.commit()) {
                releaseIfUnused(uri)
                return status("unavailable")
            }
            if (previous != null && previous.uri != uri) releaseIfUnused(previous.uri)
            retain(uri)
        }
        return ready(AndroidDirectoryInventory(selection.nonce).item(root))
    }

    private fun getSelection(conversationId: String): Selection? = selections.getString(conversationId, null)?.let(::decode)

    /**
     * The folder this conversation reads, attaching the last authorized one when it has no
     * folder of its own.
     *
     * The OS grant is app-wide and survives a new conversation, so re-opening the system
     * picker for every chat was our own limitation, not Android's. A conversation that chose
     * to detach stays detached; a grant the user revoked in system settings is not reattached.
     */
    private fun attached(conversationId: String): Selection? {
        getSelection(conversationId)?.let { return it }
        if (selections.getString(detachedKey(conversationId), null) != null) return null
        val last = selections.getString(LAST, null)?.let(::decode) ?: return null
        if (!hasReadGrant(last.uri)) return null
        selections.edit().putString(conversationId, last.encode()).commit()
        return last
    }

    /** The granted trees kept readable without a picker, newest first. */
    private fun retain(uri: Uri) {
        val kept = retained().filter { it != uri.toString() }.toMutableList()
        kept.add(0, uri.toString())
        val dropped = kept.drop(MAX_RETAINED)
        selections.edit().putString(RETAINED, JSONArray(kept.take(MAX_RETAINED)).toString()).commit()
        dropped.forEach { releaseIfUnused(Uri.parse(it)) }
    }

    private fun retained(): List<String> =
        selections.getString(RETAINED, null)?.let { encoded ->
            try {
                (0 until JSONArray(encoded).length()).map { JSONArray(encoded).getString(it) }
            } catch (_: Exception) {
                null
            }
        } ?: emptyList()

    private fun detachedKey(conversationId: String) = "$conversationId$DETACHED"

    private fun decode(encoded: String): Selection? = try {
        val grant = JSONObject(encoded)
        Selection(Uri.parse(grant.getString("uri")), grant.getString("nonce"))
    } catch (_: Exception) {
        null
    }

    private fun hasReadGrant(uri: Uri) = resolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }

    private fun releaseIfUnused(uri: Uri) {
        // Android persists grants for the whole app, not an individual conversation.
        if (selections.all.values.any { it is String && decode(it)?.uri == uri }) return
        if (selections.getString(LAST, null)?.let(::decode)?.uri == uri) return
        try {
            resolver.releasePersistableUriPermission(uri, READ)
        } catch (_: SecurityException) {
            // The provider or OS has already revoked it.
        }
    }

    private fun openRoot(selection: Selection): DirectoryRow? =
        if (hasReadGrant(selection.uri)) readRoot(selection.uri) else null

    private fun readRoot(uri: Uri): DirectoryRow? = try {
        val rootId = DocumentsContract.getTreeDocumentId(uri)
        val rootUri = DocumentsContract.buildDocumentUriUsingTree(uri, rootId)
        resolver.query(rootUri, columns, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.toDirectoryRow()?.takeIf { it.directory && it.documentId == rootId } else null
        }
    } catch (_: Exception) {
        null
    }

    private fun Cursor.toDirectoryRow(): DirectoryRow? {
        val id = text(Document.COLUMN_DOCUMENT_ID)?.takeIf { it.isNotBlank() } ?: return null
        val name = text(Document.COLUMN_DISPLAY_NAME)?.takeIf { it.isNotBlank() } ?: return null
        val mimeType = text(Document.COLUMN_MIME_TYPE)?.lowercase(Locale.ROOT)
        return DirectoryRow(
            id, name, mimeType == Document.MIME_TYPE_DIR,
            mimeType?.takeIf { mimePattern.matches(it) },
            number(Document.COLUMN_SIZE)?.takeIf { it in 0..9_007_199_254_740_991L },
            number(Document.COLUMN_LAST_MODIFIED)?.takeIf { it in 1..253_402_300_799_999L },
        )
    }

    private fun Cursor.text(column: String): String? = getColumnIndex(column).takeIf { it >= 0 && !isNull(it) }?.let(::getString)
    private fun Cursor.number(column: String): Long? = text(column)?.toLongOrNull()

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

    private fun DirectoryItem.toJson() = JSObject().apply { put("handle", handle); put("name", name) }
    private fun ready(folder: DirectoryItem) = status("ready").apply { put("folder", folder.toJson()) }
    private fun status(value: String) = JSObject().apply { put("status", value) }

    companion object {
        private const val READ = Intent.FLAG_GRANT_READ_URI_PERMISSION
        private const val LAST = "__last__"
        private const val DETACHED = "#detached"
        private const val RETAINED = "__retained__"
        private const val MAX_RETAINED = 8
        private val executor = Executors.newFixedThreadPool(2)
        private val mimePattern = Regex("[a-z0-9][a-z0-9.+_-]{0,62}/[a-z0-9][a-z0-9.+_-]{0,62}")
        private val columns = arrayOf(
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
        )
    }
}
