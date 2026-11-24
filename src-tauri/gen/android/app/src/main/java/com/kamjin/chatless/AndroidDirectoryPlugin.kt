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
import java.net.URLDecoder
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

@TauriPlugin
class AndroidDirectoryPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Selection(val uri: Uri, val nonce: String) {
        fun encode() = JSONObject().put("uri", uri.toString()).put("nonce", nonce).toString()
    }

    private val resolver = activity.contentResolver
    private val agent = activity.getSharedPreferences("android_directory_agent", Context.MODE_PRIVATE)
    private val nonces = activity.getSharedPreferences("android_directory_nonces", Context.MODE_PRIVATE)
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

    /**
     * Every folder this app still holds a read grant for, and what the Agent may do with each.
     *
     * The system owns the grant list, so this reads it back instead of keeping a parallel one:
     * a folder the user revoked in system settings simply stops appearing here. Names come from
     * the documents provider, not from the URI, because a tree URI spells a path the user never
     * typed and a provider may not resolve it at all.
     */
    @Command
    fun roots(invoke: Invoke) {
        executor.execute {
            val list = JSONArray()
            try {
                val seen = HashSet<String>()
                for (grant in resolver.persistedUriPermissions) {
                    val uri = grant.uri
                    if (!grant.isReadPermission || !DocumentsContract.isTreeUri(uri)) continue
                    if (!seen.add(uri.toString())) continue
                    list.put(JSObject().apply {
                        put("uri", uri.toString())
                        put("name", readRoot(uri)?.name ?: displayNameOf(uri))
                        put("agentEnabled", agentEnabled(uri))
                    })
                }
            } catch (_: Exception) {
                // A provider that will not answer is left out: the list is only what could be read.
            }
            invoke.resolve(JSObject().apply { put("roots", list) })
        }
    }

    /**
     * Whether the Agent may read one authorized folder.
     *
     * Two different questions get two answers here: what Android lets this app touch, and what
     * the user is willing to let a model read from any conversation. A folder switched off stays
     * authorized on the system side and is simply absent from the tool.
     */
    @Command
    fun setRootAgent(invoke: Invoke) {
        executor.execute {
            val args = invoke.getArgs()
            val uri = Uri.parse(args.getString("uri") ?: "")
            agent.edit().putBoolean(uri.toString(), args.optBoolean("agentEnabled", true)).commit()
            invoke.resolve(status(if (hasReadGrant(uri)) "ready" else "revoked"))
        }
    }

    @Command
    fun revokeRoot(invoke: Invoke) {
        executor.execute {
            val uri = Uri.parse(invoke.getArgs().getString("uri") ?: "")
            synchronized(selections) {
                try {
                    resolver.releasePersistableUriPermission(uri, READ)
                } catch (_: SecurityException) {
                    // Already gone; the point of the call is the state afterwards.
                }
                agent.edit().remove(uri.toString()).commit()
                val kept = JSONArray()
                retained().filter { it != uri.toString() }.forEach { kept.put(it) }
                val edit = selections.edit().putString(RETAINED, kept.toString())
                selections.all.forEach { (key, value) ->
                    if (value is String && decode(value)?.uri == uri) edit.remove(key)
                }
                if (selections.getString(LAST, null)?.let(::decode)?.uri == uri) edit.remove(LAST)
                edit.commit()
            }
            invoke.resolve(status("ready"))
        }
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

    /**
     * The inventory of every folder the Agent is allowed to read, or of one named folder.
     *
     * Authorized means Android still holds the grant and the user has not switched the folder off;
     * a conversation that excluded folders keeps that exclusion. Results come back per folder, so
     * a model that asked across folders can say which folder an answer came from, and the first
     * folder is also reported under the single-folder keys the composer preview reads. Filters are
     * applied in TypeScript: this walks trees, and no model argument names a path.
     */
    @Command
    fun inventory(invoke: Invoke) {
        val conversationId = invoke.getArgs().getString("conversationId")
        val selector = rootName(invoke.getArgs().optString("root"))
        val under = rootName(invoke.getArgs().optString("under"))
        executor.execute {
            val receipt = try {
                val all = agentRoots(conversationId)
                val targets = if (selector.isEmpty()) all else matched(all, selector)
                when {
                    all.isEmpty() -> status("none")
                    targets.isEmpty() -> status("root_not_found").apply {
                        put("roots", JSONArray(all.map { it.name }))
                    }
                    under.isEmpty() -> sectionsOf(targets, "")
                    else -> scopedSections(targets, under)
                }
            } catch (_: Exception) {
                status("unavailable")
            }
            invoke.resolve(receipt)
        }
    }

    /**
     * `under` reads one subdirectory instead of the whole folder: a name path the user would
     * recognize (`合同/2024`), or a folder handle from an earlier listing. A folder can hold
     * thousands of items, and one flat listing of the top of it answers nothing.
     */
    private fun scopedSections(targets: List<RootEntry>, under: String): JSObject {
        val missing = mutableListOf<JSObject>()
        for (target in targets) {
            val root = openRoot(target.selection) ?: continue
            val nonce = target.selection.nonce
            when (val found = resolveUnder(target.selection, root, under, nonce)) {
                is UnderMatch.Found -> {
                    val result = AndroidDirectoryInventory(nonce).scan(found.row) { parentId, accept ->
                        queryChildren(target.selection, parentId, accept)
                    } ?: continue
                    return status("ready").apply {
                        val section = JSObject().apply {
                            put("folder", result.folder.toJson())
                            put("entries", entriesOf(result))
                            put("omissions", omissionsOf(result))
                        }
                        put("sections", JSONArray(listOf(section)))
                        put("folder", section.getJSONObject("folder"))
                        put("entries", section.getJSONArray("entries"))
                        put("omissions", section.getJSONArray("omissions"))
                    }
                }
                is UnderMatch.Missing -> missing.add(
                    JSObject().apply {
                        put("folder", target.name)
                        put("segment", found.segment)
                        put("available", JSONArray(found.available))
                    },
                )
            }
        }
        return status("subfolder_not_found").apply {
            put("under", under)
            put("choices", JSONArray(missing))
        }
    }

    private sealed class UnderMatch {
        data class Found(val row: DirectoryRow) : UnderMatch()
        data class Missing(val segment: String, val available: List<String>) : UnderMatch()
    }

    /** Walks the path one level at a time, so a wrong segment names what was there instead. */
    private fun resolveUnder(
        selection: Selection,
        root: DirectoryRow,
        under: String,
        nonce: String,
    ): UnderMatch {
        val byHandle = Regex("^[0-9a-f]{32}$").matches(under)
        val segments = if (byHandle) listOf(under) else under.split('/', '\\', '／').map(String::trim).filter(String::isNotEmpty)
        var current = root
        for (segment in segments) {
            val children = mutableListOf<DirectoryRow>()
            queryChildren(selection, current.documentId) { row ->
                if (row != null) children.add(row)
                true
            }
            val directories = children.filter(DirectoryRow::directory)
            val next = if (byHandle) {
                directories.firstOrNull { AndroidDirectoryInventory(nonce).item(it).handle == segment }
            } else {
                directories.firstOrNull { it.name.equals(segment, ignoreCase = true) }
            }
            if (next == null) {
                return UnderMatch.Missing(segment, directories.map(DirectoryRow::name))
            }
            current = next
        }
        return UnderMatch.Found(current)
    }

    /**
     * A model passes whatever the person called the folder, often with the chat's own quotes
     * around it, and an empty string means it has no name rather than "match that".
     */
    private fun rootName(value: String?): String {
        // A missing argument reaches a Kotlin plugin as the text "null", and an empty one means
        // the model had no name to give. Neither is a folder called that.
        val text = (value ?: "")
            .replace(Regex("[“”„«»『』「」【】\"']"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
        return if (text.isEmpty() || text.equals("null", true) || text.equals("undefined", true)) "" else text
    }

    /** Exact name first; a name that contains it counts only when it is the only candidate. */
    private fun matched(roots: List<RootEntry>, selector: String): List<RootEntry> {
        val exact = roots.filter { it.name.equals(selector, ignoreCase = true) }
        if (exact.isNotEmpty()) return exact
        val partial = roots.filter { it.name.contains(selector, ignoreCase = true) }
        return if (partial.size == 1) partial else emptyList()
    }

    private fun sectionsOf(targets: List<RootEntry>, under: String): JSObject {
        val sections = JSONArray()
        for (entry in targets) {
            val row = openRoot(entry.selection) ?: continue
            val result = AndroidDirectoryInventory(entry.selection.nonce).scan(row) { parentId, accept ->
                queryChildren(entry.selection, parentId, accept)
            } ?: continue
            sections.put(JSObject().apply {
                put("folder", result.folder.toJson())
                put("entries", entriesOf(result))
                put("omissions", omissionsOf(result))
            })
        }
        if (sections.length() == 0) return status("revoked")
        val first = sections.getJSONObject(0)
        return status("ready").apply {
            put("sections", sections)
            put("folder", first.getJSONObject("folder"))
            put("entries", first.getJSONArray("entries"))
            put("omissions", first.getJSONArray("omissions"))
        }
    }

    /** Every query goes through the authorized tree URI using IDs it supplied. */
    private fun queryChildren(selection: Selection, parentId: String, accept: (DirectoryRow?) -> Boolean): Boolean {
        if (!hasReadGrant(selection.uri) || !agentEnabled(selection.uri)) return false
        return try {
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

    private fun entriesOf(result: DirectoryInventory) = JSONArray(result.entries.map { entry ->
        entry.item.toJson().apply {
            put("parentHandle", entry.parentHandle)
            put("path", entry.path)
            put("kind", if (entry.directory) "directory" else "file")
            put("mimeType", entry.mimeType ?: JSONObject.NULL)
            put("sizeBytes", entry.sizeBytes ?: JSONObject.NULL)
            put("modifiedAt", entry.modifiedAt ?: JSONObject.NULL)
        }
    })

    private fun omissionsOf(result: DirectoryInventory) = JSONArray(result.omissions.map { omission ->
        (omission.item?.toJson() ?: JSObject()).apply {
            put("parentHandle", omission.parentHandle)
            put("reason", omission.reason)
        }
    })

    private data class RootEntry(val selection: Selection, val name: String)

    /** The folders the Agent may read right now: granted, switched on, not excluded here. */
    private fun agentRoots(conversationId: String?): List<RootEntry> {
        if (conversationId != null && getSelection(conversationId) == null &&
            selections.getString(detachedKey(conversationId), null) != null) return emptyList()
        val seen = HashSet<String>()
        return resolver.persistedUriPermissions
            .filter { it.isReadPermission && DocumentsContract.isTreeUri(it.uri) && agentEnabled(it.uri) }
            .map { it.uri }
            .filter { seen.add(it.toString()) }
            .mapNotNull { uri ->
                val selection = Selection(uri, nonceFor(uri))
                val row = openRoot(selection) ?: return@mapNotNull null
                RootEntry(selection, row.name.ifEmpty { displayNameOf(uri) })
            }
    }

    /**
     * The nonce a folder's handles are derived from, stable across conversations.
     *
     * A model may hold handles from an earlier conversation; a per-conversation nonce would expire
     * them the moment a new chat attached the same folder.
     */
    private fun nonceFor(uri: Uri): String = synchronized(nonces) {
        nonces.getString(uri.toString(), null) ?: UUID.randomUUID().toString().also {
            nonces.edit().putString(uri.toString(), it).commit()
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
        getSelection(conversationId)?.let { return if (agentEnabled(it.uri)) it else null }
        if (selections.getString(detachedKey(conversationId), null) != null) return null
        val last = selections.getString(LAST, null)?.let(::decode) ?: return null
        if (!hasReadGrant(last.uri) || !agentEnabled(last.uri)) return null
        selections.edit().putString(conversationId, last.encode()).commit()
        return last
    }

    private fun agentEnabled(uri: Uri) = agent.getBoolean(uri.toString(), true)

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

    /** The folder name for a tree URI when the provider cannot or will not answer. */
    private fun displayNameOf(uri: Uri): String {
        val raw = uri.lastPathSegment ?: return uri.toString()
        val decoded = try {
            URLDecoder.decode(raw, "UTF-8")
        } catch (_: Exception) {
            raw
        }
        return decoded.substringAfterLast('/').ifEmpty { decoded }
    }

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
