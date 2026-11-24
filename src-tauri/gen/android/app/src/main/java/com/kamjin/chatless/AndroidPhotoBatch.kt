package com.kamjin.chatless

import java.security.MessageDigest

/** The system picker and the reported grouping share one selection ceiling. */
internal const val MAX_PHOTO_BATCH = 20

data class PhotoBatchRow(
    val uri: String,
    val name: String,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val contentDigest: String? = null,
)

data class PhotoBatchItem(
    val handle: String,
    val name: String,
    val mimeType: String?,
    val sizeBytes: Long?,
    val contentDigest: String?,
)

data class PhotoBatchOmission(val reason: String, val name: String? = null)
data class PhotoBatchInventory(val items: List<PhotoBatchItem>, val omissions: List<PhotoBatchOmission>)

class AndroidPhotoBatch(
    private val selectionNonce: String,
    private val maxItems: Int = MAX_PHOTO_BATCH,
) {
    fun item(row: PhotoBatchRow): PhotoBatchItem {
        // The random nonce changes on reselect and never crosses the native boundary.
        val digest = MessageDigest.getInstance("SHA-256").digest("$selectionNonce:${row.uri}".toByteArray())
        val name = if (row.name.length <= 255) row.name else row.name.take(254) + "…"
        return PhotoBatchItem(
            handle = digest.take(16).joinToString("") { "%02x".format(it) },
            name = name,
            mimeType = row.mimeType,
            sizeBytes = row.sizeBytes,
            contentDigest = row.contentDigest,
        )
    }

    // A null row is a photo whose metadata could not be read; it is reported
    // rather than dropped. Content is read once, at selection time, by the caller.
    fun inventory(rows: List<PhotoBatchRow?>): PhotoBatchInventory {
        val items = mutableListOf<PhotoBatchItem>()
        val omissions = mutableListOf<PhotoBatchOmission>()
        for (row in rows) {
            if (items.size == maxItems) {
                omissions.add(PhotoBatchOmission("item_limit"))
                break
            }
            if (row == null || row.name.isBlank()) {
                omissions.add(PhotoBatchOmission("unreadable"))
                continue
            }
            items.add(item(row))
        }
        return PhotoBatchInventory(items, omissions)
    }
}
