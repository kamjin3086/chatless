package com.kamjin.chatless

import android.os.SystemClock
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class DirectoryRow(
    val documentId: String,
    val name: String,
    val directory: Boolean,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val modifiedAt: Long? = null,
)

data class DirectoryItem(val handle: String, val name: String)

data class DirectoryEntry(
    val item: DirectoryItem,
    val parentHandle: String,
    /** Name path from the scanned root, e.g. `合同/2024/报告.pdf`. Handles cannot say that. */
    val path: String,
    val directory: Boolean,
    val mimeType: String?,
    val sizeBytes: Long?,
    val modifiedAt: Long?,
)

data class DirectoryOmission(val reason: String, val parentHandle: String, val item: DirectoryItem? = null)

/**
 * How far a scan got, next to what it found. A folder of five thousand files answered from two
 * hundred rows is not a summary, it is a sample, and the model has to be able to tell the two
 * apart. `scanned`, `files` and `bytes` describe what the walk looked at; `matched` counts the
 * rows the filters and paging let through, folders included.
 */
data class ScanTotals(
    var scanned: Int = 0,
    var matched: Int = 0,
    var files: Int = 0,
    var directories: Int = 0,
    var bytes: Long = 0,
    var unknownMetadata: Int = 0,
    var stopped: String = "",
    var elapsedMs: Long = 0,
)

/** A count, a byte total and a few paths: enough to answer "what kinds are in here" in one round. */
data class DirectoryGroup(val label: String, var count: Int = 0, var bytes: Long = 0) {
    val samples = mutableListOf<String>()
}

data class ScanOutcome(
    val folder: DirectoryItem,
    val entries: List<DirectoryEntry>,
    val groups: List<DirectoryGroup>,
    val omissions: List<DirectoryOmission>,
    val totals: ScanTotals,
    val largest: List<DirectoryEntry> = emptyList(),
    val newest: List<DirectoryEntry> = emptyList(),
    val oldest: List<DirectoryEntry> = emptyList(),
)

/**
 * What counts as a hit. The filter lives here rather than in the caller so a folder of thousands
 * is filtered while it is walked: filtering after a row cap silently answers "none" for matches
 * sitting past the cap.
 */
class DirectoryFilters(
    private val nameContains: String? = null,
    private val mime: String? = null,
    private val minBytes: Long? = null,
    private val maxBytes: Long? = null,
    private val modifiedFrom: Long? = null,
    private val modifiedBefore: Long? = null,
) {
    companion object {
        const val MATCH = 0
        const val EXCLUDED = 1
        const val UNKNOWN = 2

        fun of(
            name: String?,
            mime: String?,
            minBytes: Long?,
            maxBytes: Long?,
            from: Long?,
            before: Long?,
        ): DirectoryFilters = DirectoryFilters(
            name?.takeIf { it.isNotBlank() }?.lowercase(Locale.ROOT),
            mime?.takeIf { it.isNotBlank() },
            minBytes,
            maxBytes,
            from,
            before,
        )

        val none = of(null, null, null, null, null, null)
    }

    /** Name filters read folder names too; type and size filters do not - a folder is not a type. */
    fun verdict(row: DirectoryRow): Int {
        if (nameContains != null && !row.name.lowercase(Locale.ROOT).contains(nameContains)) return EXCLUDED
        if (row.directory) return MATCH
        var unknown = false
        if (mime != null) {
            val value = row.mimeType
            if (value == null) unknown = true
            else if (mime.endsWith("/")) {
                if (!value.startsWith(mime)) return EXCLUDED
            } else if (value != mime) return EXCLUDED
        }
        if (minBytes != null || maxBytes != null) {
            val size = row.sizeBytes
            if (size == null) unknown = true
            else if (size < (minBytes ?: 0L) || size > (maxBytes ?: Long.MAX_VALUE)) return EXCLUDED
        }
        if (modifiedFrom != null || modifiedBefore != null) {
            val stamp = row.modifiedAt
            if (stamp == null) unknown = true
            else if (stamp < (modifiedFrom ?: 0L) || stamp >= (modifiedBefore ?: Long.MAX_VALUE)) return EXCLUDED
        }
        return if (unknown) UNKNOWN else MATCH
    }
}

/**
 * Reads a folder through a SAF tree, in one of two shapes: a page of entries, or the shape of the
 * whole folder as numbers. Both walk with a row budget and a time budget, because a folder can be
 * huge and a DocumentsProvider can be a network share - an unbounded walk hangs the chat.
 */
class AndroidDirectoryInventory(
    private val selectionNonce: String,
    private val maxEntries: Int = 200,
    private val maxDepth: Int = 12,
) {
    private data class Branch(
        val id: String,
        val item: DirectoryItem,
        val parentHandle: String,
        val path: String,
        val depth: Int,
    )

    fun item(row: DirectoryRow): DirectoryItem {
        // The random nonce changes on reselect and never crosses the native boundary. Eight bytes
        // identifies an item inside one answer, and a full digest on every row of a five-thousand
        // file listing is context the model pays for twice.
        val digest = MessageDigest.getInstance("SHA-256").digest("$selectionNonce:${row.documentId}".toByteArray())
        val name = if (row.name.length <= 255) row.name else row.name.take(254) + "…"
        return DirectoryItem(digest.take(8).joinToString("") { "%02x".format(it) }, name)
    }

    /** A page of what matches. The walk stops once the page is full: a page was asked for. */
    fun scan(
        root: DirectoryRow,
        readChildren: (String, (DirectoryRow?) -> Boolean) -> Boolean,
        filters: DirectoryFilters = DirectoryFilters.none,
        groupBy: String? = null,
        limit: Int = maxEntries,
        offset: Int = 0,
        rowBudget: Int = 20000,
        budgetMs: Long = 8000,
    ): ScanOutcome = walk(root, readChildren, filters, groupBy, limit, offset, rowBudget, budgetMs, true)

    /**
     * The whole folder, only its shape. Everything aggregates while rows stream past, so five
     * thousand files cost a screen of numbers instead of five thousand lines of JSON.
     */
    fun summarize(
        root: DirectoryRow,
        readChildren: (String, (DirectoryRow?) -> Boolean) -> Boolean,
        filters: DirectoryFilters = DirectoryFilters.none,
        groupBy: String? = "type",
        rowBudget: Int = 200000,
        budgetMs: Long = 8000,
    ): ScanOutcome = walk(root, readChildren, filters, groupBy, 0, 0, rowBudget, budgetMs, false)

    private fun walk(
        root: DirectoryRow,
        readChildren: (String, (DirectoryRow?) -> Boolean) -> Boolean,
        filters: DirectoryFilters,
        groupBy: String?,
        limit: Int,
        offset: Int,
        rowBudget: Int,
        budgetMs: Long,
        collectEntries: Boolean,
    ): ScanOutcome {
        val started = SystemClock.elapsedRealtime()
        val rootItem = item(root)
        val pending = ArrayDeque<Branch>()
        pending.add(Branch(root.documentId, rootItem, rootItem.handle, "", 0))
        val visited = mutableSetOf(root.documentId)
        val entries = mutableListOf<DirectoryEntry>()
        val omissions = mutableListOf<DirectoryOmission>()
        val groups = LinkedHashMap<String, DirectoryGroup>()
        val largest = ArrayList<DirectoryEntry>(32)
        val newest = ArrayList<DirectoryEntry>(32)
        val oldest = ArrayList<DirectoryEntry>(32)
        val totals = ScanTotals()
        var stopped = ""
        // A page needs offset+limit hits; a summary needs no rows at all, only the counts.
        val want = if (collectEntries) maxOf(offset + limit, 1) else 0

        while (pending.isNotEmpty()) {
            val branch = pending.removeFirst()
            var pageFull = false
            val complete = readChildren(branch.id) { row ->
                when {
                    SystemClock.elapsedRealtime() - started > budgetMs -> {
                        stopped = "time_limit"
                        false
                    }
                    totals.scanned >= rowBudget -> {
                        stopped = "row_limit"
                        false
                    }
                    else -> {
                        totals.scanned += 1
                        if (row == null) {
                            omissions.add(DirectoryOmission("unreadable", branch.item.handle))
                        } else if (!visited.add(row.documentId)) {
                            omissions.add(DirectoryOmission("duplicate_or_cycle", branch.item.handle, item(row)))
                        } else {
                            val made = entry(branch, row)
                            totals.elapsedMs = SystemClock.elapsedRealtime() - started
                            record(made, row, filters, groupBy, limit, offset, collectEntries, entries, groups, totals, largest, newest, oldest)
                            if (row.directory) {
                                val depth = branch.depth + 1
                                if (depth == maxDepth) omissions.add(DirectoryOmission("depth_limit", branch.item.handle, made.item))
                                else pending.add(Branch(row.documentId, made.item, branch.item.handle, made.path, depth))
                            }
                            pageFull = collectEntries && totals.matched >= want
                            !pageFull
                        }
                    }
                }
            }
            if (stopped.isNotEmpty()) break
            if (pageFull) {
                stopped = "limit"
                break
            }
            if (!complete && omissions.none { it.parentHandle == branch.item.handle && it.reason == "unreadable" }) {
                omissions.add(DirectoryOmission("unreadable", branch.item.handle))
            }
        }
        totals.stopped = stopped
        totals.elapsedMs = SystemClock.elapsedRealtime() - started
        val ordered = groups.values.sortedWith(compareByDescending<DirectoryGroup> { it.count }.thenByDescending { it.bytes })
        return ScanOutcome(rootItem, entries, ordered, omissions, totals, largest, newest, oldest)
    }

    private fun entry(branch: Branch, row: DirectoryRow): DirectoryEntry {
        val made = item(row)
        val path = if (branch.path.isEmpty()) made.name else "${branch.path}/${made.name}"
        return DirectoryEntry(made, branch.item.handle, path, row.directory, row.mimeType, row.sizeBytes, row.modifiedAt)
    }

    @Suppress("LongParameterList")
    private fun record(
        entry: DirectoryEntry,
        row: DirectoryRow,
        filters: DirectoryFilters,
        groupBy: String?,
        limit: Int,
        offset: Int,
        collectEntries: Boolean,
        entries: MutableList<DirectoryEntry>,
        groups: LinkedHashMap<String, DirectoryGroup>,
        totals: ScanTotals,
        largest: ArrayList<DirectoryEntry>,
        newest: ArrayList<DirectoryEntry>,
        oldest: ArrayList<DirectoryEntry>,
    ) {
        if (row.directory) {
            totals.directories += 1
        } else {
            totals.files += 1
            totals.bytes += row.sizeBytes ?: 0
            track(largest, newest, oldest, entry)
        }
        when (filters.verdict(row)) {
            DirectoryFilters.UNKNOWN -> totals.unknownMetadata += 1
            DirectoryFilters.EXCLUDED -> return
        }
        totals.matched += 1
        // The page window is `offset` hits deep and `limit` hits wide; the walk stops above once
        // it has walked past both.
        if (collectEntries && totals.matched > offset && (limit <= 0 || entries.size < limit)) entries.add(entry)
        if (groupBy != null && !row.directory) {
            val label = GroupKey.of(row, groupBy)
            val group = groups.getOrPut(label) { DirectoryGroup(label) }
            group.count += 1
            group.bytes += row.sizeBytes ?: 0
            if (group.samples.size < 5) group.samples.add(entry.path)
        }
    }

    private fun track(
        largest: ArrayList<DirectoryEntry>,
        newest: ArrayList<DirectoryEntry>,
        oldest: ArrayList<DirectoryEntry>,
        entry: DirectoryEntry,
    ) {
        if (entry.sizeBytes != null) insert(largest, entry, 20) { a, b -> compareValues(a.sizeBytes ?: -1L, b.sizeBytes ?: -1L) }
        if (entry.modifiedAt != null) {
            insert(newest, entry, 20) { a, b -> compareValues(a.modifiedAt ?: 0L, b.modifiedAt ?: 0L) }
            insert(oldest, entry, 10) { a, b -> -compareValues(a.modifiedAt ?: 0L, b.modifiedAt ?: 0L) }
        }
    }

    private fun insert(
        list: ArrayList<DirectoryEntry>,
        entry: DirectoryEntry,
        size: Int,
        better: (DirectoryEntry, DirectoryEntry) -> Int,
    ) {
        if (list.size < size) {
            list.add(entry)
            return
        }
        var worst = 0
        for (i in list.indices) if (better(list[i], list[worst]) <= 0) worst = i
        if (better(entry, list[worst]) > 0) list[worst] = entry
    }
}

/** Group labels have to read the same on both ends, so they are computed where the rows are. */
object GroupKey {
    private const val MiB = 1024L * 1024

    private val month = SimpleDateFormat("yyyy-MM", Locale.ROOT).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun of(row: DirectoryRow, by: String): String = when (by) {
        "date" -> row.modifiedAt?.let { month.format(Date(it)) } ?: "Unknown date"
        "size" -> when {
            row.sizeBytes == null -> "Unknown size"
            row.sizeBytes < MiB -> "Under 1 MiB"
            row.sizeBytes < 10 * MiB -> "1 to under 10 MiB"
            else -> "10 MiB or more"
        }
        else -> row.mimeType ?: extension(row.name)?.let { "$it file" } ?: "Unknown type"
    }

    fun extension(name: String): String? {
        val dot = name.lastIndexOf('.')
        if (dot <= 0 || dot == name.length - 1) return null
        val ext = name.substring(dot + 1).lowercase(Locale.ROOT)
        return if (ext.length in 1..5) ext else null
    }
}
