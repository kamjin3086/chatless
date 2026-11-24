package com.kamjin.chatless

import android.app.Activity
import android.content.ContentValues
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.MediaStore
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
import java.io.File
import java.net.URLDecoder
import java.text.SimpleDateFormat
import java.util.Date
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
     * A page of metadata for every folder the Agent may read, for one named folder, or for one
     * subdirectory inside one. [receipt] does the work; this only says which shape was asked for.
     */
    @Command
    fun inventory(invoke: Invoke) {
        val args = invoke.getArgs()
        val conversationId = args.getString("conversationId")
        executor.execute { invoke.resolve(receipt(conversationId, args, "list")) }
    }

    /**
     * The shape of a whole folder rather than a page of it: counts by kind, size and month, the
     * largest and the newest. Five thousand files come back as a screen of numbers, which is the
     * only way a chat answers "what kinds of files are in here" without paging for a minute.
     */
    @Command
    fun summarize(invoke: Invoke) {
        val args = invoke.getArgs()
        val conversationId = args.getString("conversationId")
        executor.execute { invoke.resolve(receipt(conversationId, args, "summary")) }
    }

    /**
     * Writes a listing out as a file instead of reciting it into the chat: five thousand names do
     * not fit a reply, and a model retyping them is a model that can drop one. The file goes to
     * the shared Downloads folder, which is where a phone user looks for what they asked for.
     */
    @Command
    fun export(invoke: Invoke) {
        val args = invoke.getArgs()
        val conversationId = args.getString("conversationId")
        executor.execute {
            val receipt = try {
                val scan = scanArgs(args)
                val all = agentRoots(conversationId)
                val targets = if (scan.root.isEmpty()) all else matched(all, scan.root)
                when {
                    all.isEmpty() -> status("none")
                    targets.isEmpty() -> status("root_not_found").apply { put("roots", JSONArray(all.map { it.name })) }
                    else -> exportFile(targets, scan, args)
                }
            } catch (_: Exception) {
                status("unavailable")
            }
            invoke.resolve(receipt)
        }
    }

    private class ScanArgs(
        val root: String,
        val under: String,
        val filters: DirectoryFilters,
        val groupBy: String?,
        val limit: Int,
        val offset: Int,
    )

    private fun scanArgs(args: JSObject): ScanArgs = ScanArgs(
        root = rootName(args.optString("root")),
        under = rootName(args.optString("under")),
        filters = DirectoryFilters.of(
            plain(args.optString("nameContains")),
            plain(args.optString("mimeType"))?.lowercase(Locale.ROOT),
            args.optLong("minBytes", -1).takeIf { it >= 0 },
            args.optLong("maxBytes", -1).takeIf { it >= 0 },
            args.optLong("modifiedFrom", -1).takeIf { it >= 0 },
            args.optLong("modifiedBefore", -1).takeIf { it >= 0 },
        ),
        groupBy = plain(args.optString("groupBy"))?.takeIf { it in GROUPS },
        limit = args.optInt("limit", 200).coerceIn(1, MAX_PAGE),
        offset = args.optInt("offset", 0).coerceAtLeast(0),
    )

    /** A missing argument reaches a plugin as the text "null", which is not what anyone typed. */
    private fun plain(value: String?): String? {
        val text = (value ?: "").trim()
        return if (text.isEmpty() || text.equals("null", true) || text.equals("undefined", true)) null else text
    }

    private fun receipt(conversationId: String?, args: JSObject, mode: String): JSObject {
        val scan = scanArgs(args)
        return try {
            val all = agentRoots(conversationId)
            val targets = if (scan.root.isEmpty()) all else matched(all, scan.root)
            when {
                all.isEmpty() -> status("none")
                targets.isEmpty() -> status("root_not_found").apply { put("roots", JSONArray(all.map { it.name })) }
                else -> sectionsOf(targets, scan, mode)
            }
        } catch (_: Exception) {
            status("unavailable")
        }
    }

    /**
     * One section per folder, each labelled with the folder it came from, so an answer across
     * folders can still say where a line came from. The first section also fills the single-folder
     * keys the composer preview reads.
     */
    private fun sectionsOf(targets: List<RootEntry>, scan: ScanArgs, mode: String): JSObject {
        val sections = JSONArray()
        val missing = mutableListOf<JSObject>()
        for (target in targets) {
            val root = openRoot(target.selection) ?: continue
            val nonce = target.selection.nonce
            var start = root
            if (scan.under.isNotEmpty()) {
                val found = resolveUnder(target.selection, root, scan.under, nonce)
                if (found is UnderMatch.Missing) {
                    missing.add(
                        JSObject().apply {
                            put("folder", target.name)
                            put("segment", found.segment)
                            put("available", JSONArray(found.available))
                        },
                    )
                    continue
                }
                start = (found as UnderMatch.Found).row
            }
            val read: (String, (DirectoryRow?) -> Boolean) -> Boolean = { id, accept ->
                queryChildren(target.selection, id, accept)
            }
            val inventory = AndroidDirectoryInventory(nonce)
            val result = if (mode == "summary") {
                inventory.summarize(start, read, scan.filters, scan.groupBy ?: "type")
            } else {
                inventory.scan(start, read, scan.filters, scan.groupBy, scan.limit, scan.offset)
            }
            sections.put(sectionOf(result))
        }
        if (sections.length() == 0) {
            return if (missing.isEmpty()) status("revoked") else status("subfolder_not_found").apply {
                put("under", scan.under)
                put("choices", JSONArray(missing))
            }
        }
        val first = sections.getJSONObject(0)
        return status("ready").apply {
            put("sections", sections)
            put("folder", first.getJSONObject("folder"))
            put("entries", first.optJSONArray("entries") ?: JSONArray())
            put("omissions", first.optJSONArray("omissions") ?: JSONArray())
            put("totals", first.optJSONObject("totals") ?: JSONObject())
            put("groups", first.optJSONArray("groups") ?: JSONArray())
        }
    }

    private fun sectionOf(result: ScanOutcome) = JSObject().apply {
        put("folder", result.folder.toJson())
        put("entries", entriesOf(result))
        put(
            "groups",
            JSONArray(
                result.groups.map { group ->
                    JSObject().apply {
                        put("label", group.label)
                        put("count", group.count)
                        put("bytes", group.bytes)
                        put("samples", JSONArray(group.samples))
                    }
                },
            ),
        )
        put("omissions", omissionsOf(result))
        put("totals", totalsOf(result.totals))
        put("largest", topOf(result.largest))
        put("newest", topOf(result.newest))
        put("oldest", topOf(result.oldest))
    }

    private fun totalsOf(totals: ScanTotals) = JSObject().apply {
        put("scanned", totals.scanned)
        put("matched", totals.matched)
        put("files", totals.files)
        put("directories", totals.directories)
        put("bytes", totals.bytes)
        put("unknownMetadata", totals.unknownMetadata)
        put("stopped", totals.stopped)
        put("elapsedMs", totals.elapsedMs)
    }

    /** Only the columns that make a top-list useful: where it is, how big, when. */
    private fun topOf(rows: List<DirectoryEntry>) = JSONArray(
        rows.map { row ->
            JSObject().apply {
                put("handle", row.item.handle)
                put("path", row.path)
                put("sizeBytes", row.sizeBytes ?: JSONObject.NULL)
                put("modifiedAt", row.modifiedAt ?: JSONObject.NULL)
            }
        },
    )

    private fun exportFile(targets: List<RootEntry>, scan: ScanArgs, args: JSObject): JSObject {
        val format = (plain(args.optString("format")) ?: "md").lowercase(Locale.ROOT).let {
            if (it in listOf("md", "csv", "txt")) it else "md"
        }
        val columns = columnsOf(args)
        val title = rootName(args.optString("title")).ifEmpty { "文件清单" }
        val rows = mutableListOf<DirectoryEntry>()
        var stopped = ""
        for (target in targets) {
            val root = openRoot(target.selection) ?: continue
            val nonce = target.selection.nonce
            var start = root
            if (scan.under.isNotEmpty()) {
                val found = resolveUnder(target.selection, root, scan.under, nonce)
                if (found is UnderMatch.Missing) {
                    return status("subfolder_not_found").apply {
                        put("under", scan.under)
                        put("choices", JSONArray(listOf(
                            JSObject().apply {
                                put("folder", target.name)
                                put("segment", found.segment)
                                put("available", JSONArray(found.available))
                            },
                        )))
                    }
                }
                start = (found as UnderMatch.Found).row
            }
            val result = AndroidDirectoryInventory(nonce).scan(
                start,
                { id, accept -> queryChildren(target.selection, id, accept) },
                scan.filters,
                scan.groupBy,
                MAX_PAGE * 20,
                0,
                EXPORT_ROWS,
                EXPORT_BUDGET_MS,
            )
            result.entries.filter { !it.directory }.forEach { rows.add(it) }
            if (result.totals.stopped.isNotEmpty()) stopped = result.totals.stopped
        }
        if (rows.isEmpty()) return status("empty")
        val name = fileName(title, format)
        val saved = saveExport(name, format, exportText(title, columns, rows, format, stopped))
            ?: return status("unavailable")
        return status("saved").apply {
            put("name", saved.second)
            put("uri", saved.first.toString())
            put("count", rows.size)
            put("bytes", rows.sumOf { it.sizeBytes ?: 0 })
            put("format", format)
            put("columns", JSONArray(columns))
            put("stopped", stopped)
        }
    }

    private fun columnsOf(args: JSObject): List<String> {
        val wanted = when (val raw = args.opt("columns")) {
            is JSONArray -> (0 until raw.length()).mapNotNull { raw.optString(it).lowercase(Locale.ROOT).takeIf { key -> key.isNotEmpty() } }
            else -> (plain(args.optString("columns")) ?: "").split(',', '，', ' ').map { it.trim().lowercase(Locale.ROOT) }.filter { it.isNotEmpty() }
        }
        val known = listOf("path", "name", "size", "date", "type")
        val chosen = wanted.filter { it in known }.ifEmpty { listOf("path", "size", "date") }
        return known.filter { it in chosen }
    }

    private fun exportText(
        title: String,
        columns: List<String>,
        rows: List<DirectoryEntry>,
        format: String,
        stopped: String,
    ): String {
        val bytes = rows.sumOf { it.sizeBytes ?: 0 }
        val builder = StringBuilder()
        // A Markdown or text listing is read by a person, so sizes and dates are the friendly
        // shape. A CSV is read by a spreadsheet, so it carries raw bytes and ISO dates instead.
        val headers = columns.map {
            when (it) {
                "path" -> if (format == "csv") "path" else "路径"
                "name" -> if (format == "csv") "name" else "文件名"
                "size" -> if (format == "csv") "size_bytes" else "大小"
                "date" -> if (format == "csv") "modified_at" else "修改时间"
                else -> if (format == "csv") "mime_type" else "类型"
            }
        }
        if (format == "csv") {
            builder.append(headers.joinToString(",") { csvCell(it) }).append('\n')
            rows.forEach { row ->
                builder.append(cells(columns, row, false).joinToString(",") { csvCell(it) }).append('\n')
            }
            return builder.toString()
        }
        if (format == "md") {
            builder.append("# ").append(title).append('\n')
            builder.append('\n').append(rows.size).append(" 项，共 ").append(humanBytes(bytes)).append('\n')
            if (stopped.isNotEmpty()) builder.append("\n（列表在 `").append(stopped).append("` 处停止，可能还有未列出的条目。）\n")
            builder.append('\n').append(headers.joinToString(" | ", "| ", " |")).append('\n')
            builder.append(headers.joinToString(" | ", "| ", " |") { "---" }).append('\n')
            rows.forEach { row -> builder.append(cells(columns, row, true).joinToString(" | ", "| ", " |")).append('\n') }
        } else {
            builder.append(title).append('\n')
            builder.append(rows.size).append(" 项，共 ").append(humanBytes(bytes)).append('\n')
            rows.forEach { row -> builder.append(cells(columns, row, true).joinToString("\t")).append('\n') }
        }
        return builder.toString()
    }

    private fun cells(columns: List<String>, row: DirectoryEntry, friendly: Boolean): List<String> =
        columns.map {
            when (it) {
                "path" -> row.path
                "name" -> row.item.name
                "size" ->
                    row.sizeBytes?.let { size -> if (friendly) humanBytes(size) else size.toString() } ?: ""
                "date" ->
                    row.modifiedAt?.let { stamp ->
                        if (friendly) stampFormat.format(Date(stamp)) else isoFormat.format(Date(stamp))
                    } ?: ""
                else -> row.mimeType ?: GroupKey.extension(row.item.name)?.let { "$it file" } ?: ""
            }
        }

    private fun csvCell(value: String) =
        if (value.any { it == ',' || it == '"' || it == '\n' }) "\"" + value.replace("\"", "\"\"") + "\"" else value

    private fun fileName(title: String, format: String): String {
        val safe = title.map { if (it in "\u0000/\\:*?\"<>|") '_' else it }.joinToString("").trim().take(60)
        val base = safe.ifEmpty { "文件清单" }
        return "$base-${SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(Date())}.$format"
    }

    /**
     * On Android 10 and later this is a Downloads row, which needs no permission at all; older
     * releases write next to the app's own files, where a write would otherwise need a permission
     * the app has no other use for.
     */
    private fun saveExport(name: String, format: String, text: String): Pair<Uri, String>? {
        val mime = when (format) {
            "csv" -> "text/csv"
            "txt" -> "text/plain"
            else -> "text/markdown"
        }
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                Pair(uri, "下载/$name")
            } else {
                val dir = File(activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Chatless")
                if (!dir.exists() && !dir.mkdirs()) return null
                val file = File(dir, name)
                file.writeText(text)
                MediaScannerConnection.scanFile(activity, arrayOf(file.absolutePath), null, null)
                Pair(Uri.fromFile(file), file.absolutePath)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun humanBytes(value: Long): String = when {
        value >= 1L shl 30 -> String.format(Locale.ROOT, "%.1f GiB", value / (1L shl 30).toDouble())
        value >= 1L shl 20 -> String.format(Locale.ROOT, "%.1f MiB", value / (1L shl 20).toDouble())
        value >= 1024 -> String.format(Locale.ROOT, "%.1f KiB", value / 1024.0)
        else -> "$value B"
    }

    /**
     * `under` reads one subdirectory instead of the whole folder: a name path the user would
     * recognize (`合同/2024`), or a folder handle from an earlier listing. A folder can hold
     * thousands of items, and one flat listing of the top of it answers nothing.
     */
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
        val byHandle = Regex("^[0-9a-f]{16}$").matches(under)
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

    private fun entriesOf(result: ScanOutcome) = JSONArray(result.entries.map { entry ->
        entry.item.toJson().apply {
            put("parentHandle", entry.parentHandle)
            put("path", entry.path)
            put("kind", if (entry.directory) "directory" else "file")
            put("mimeType", entry.mimeType ?: JSONObject.NULL)
            put("sizeBytes", entry.sizeBytes ?: JSONObject.NULL)
            put("modifiedAt", entry.modifiedAt ?: JSONObject.NULL)
        }
    })

    private val stampFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT)
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT)

    private fun omissionsOf(result: ScanOutcome) = JSONArray(result.omissions.map { omission ->
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
        private const val MAX_PAGE = 1000
        private const val EXPORT_ROWS = 200000
        private const val EXPORT_BUDGET_MS = 20000L
        private val GROUPS = setOf("type", "size", "date")
        private val executor = Executors.newFixedThreadPool(2)
        private val mimePattern = Regex("[a-z0-9][a-z0-9.+_-]{0,62}/[a-z0-9][a-z0-9.+_-]{0,62}")
        private val columns = arrayOf(
            Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
        )
    }
}
