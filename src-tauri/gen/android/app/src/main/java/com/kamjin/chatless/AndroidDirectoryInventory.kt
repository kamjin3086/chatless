package com.kamjin.chatless

import java.security.MessageDigest

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
data class DirectoryInventory(val folder: DirectoryItem, val entries: List<DirectoryEntry>, val omissions: List<DirectoryOmission>)

class AndroidDirectoryInventory(
    private val selectionNonce: String,
    private val maxEntries: Int = 200,
    private val maxDepth: Int = 8,
) {
    private data class Branch(val id: String, val item: DirectoryItem, val parentHandle: String, val path: String, val depth: Int)

    fun item(row: DirectoryRow): DirectoryItem {
        // The random nonce changes on reselect and never crosses the native boundary.
        val digest = MessageDigest.getInstance("SHA-256").digest("$selectionNonce:${row.documentId}".toByteArray())
        val name = if (row.name.length <= 255) row.name else row.name.take(254) + "…"
        return DirectoryItem(digest.take(16).joinToString("") { "%02x".format(it) }, name)
    }

    // The provider supplies rows only under the queried parent. Returning false from
    // the visitor stops cursor traversal without loading the rest of a large folder.
    fun scan(root: DirectoryRow, readChildren: (String, (DirectoryRow?) -> Boolean) -> Boolean): DirectoryInventory {
        val rootItem = item(root)
        val pending = ArrayDeque<Branch>()
        pending.add(Branch(root.documentId, rootItem, rootItem.handle, "", 0))
        val visited = mutableSetOf(root.documentId)
        val entries = mutableListOf<DirectoryEntry>()
        val omissions = mutableListOf<DirectoryOmission>()
        var rows = 0
        while (pending.isNotEmpty()) {
            val branch = pending.removeFirst()
            var limited = false
            val complete = readChildren(branch.id) { row ->
                if (rows == maxEntries) {
                    limited = true
                    false
                } else {
                    rows += 1
                    if (row == null) {
                        omissions.add(DirectoryOmission("unreadable", branch.item.handle))
                    } else {
                        val item = item(row)
                        if (!visited.add(row.documentId)) {
                            omissions.add(DirectoryOmission("duplicate_or_cycle", branch.item.handle, item))
                        } else {
                            val path = if (branch.path.isEmpty()) item.name else "${branch.path}/${item.name}"
                            entries.add(DirectoryEntry(item, branch.item.handle, path, row.directory, row.mimeType, row.sizeBytes, row.modifiedAt))
                            if (row.directory) {
                                val depth = branch.depth + 1
                                if (depth == maxDepth) omissions.add(DirectoryOmission("depth_limit", branch.item.handle, item))
                                else pending.add(Branch(row.documentId, item, branch.item.handle, path, depth))
                            }
                        }
                    }
                    true
                }
            }
            if (limited) {
                omissions.add(DirectoryOmission("entry_limit", branch.parentHandle, branch.item))
                break
            }
            if (!complete) omissions.add(DirectoryOmission("unreadable", branch.parentHandle, branch.item))
        }
        return DirectoryInventory(rootItem, entries, omissions)
    }
}
