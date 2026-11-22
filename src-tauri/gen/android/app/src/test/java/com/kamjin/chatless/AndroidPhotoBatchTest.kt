package com.kamjin.chatless

import org.junit.Assert.*
import org.junit.Test

class AndroidPhotoBatchTest {
    private fun row(
        name: String,
        uri: String = "content://media/external/images/$name",
        digest: String? = "bytes-of-$name",
    ) = PhotoBatchRow(uri, name, "image/jpeg", 2400, digest)

    @Test fun handlesAreStableWithinASelectionAndUnrelatedAfterReselect() {
        fun scan(nonce: String) = AndroidPhotoBatch(nonce).inventory(
            listOf(row("IMG_4021.jpg"), row("IMG_4022.jpg")),
        )
        assertEquals(scan("select-one"), scan("select-one"))
        assertNotEquals(scan("select-one").items.first().handle, scan("select-two").items.first().handle)
        assertFalse(scan("select-one").toString().contains("content:"))
    }

    @Test fun reportsUnreadablePhotosInsteadOfDroppingThem() {
        val inventory = AndroidPhotoBatch("select-one").inventory(listOf(null, row("IMG_4021.jpg")))
        assertEquals(listOf("IMG_4021.jpg"), inventory.items.map { it.name })
        assertEquals(listOf(PhotoBatchOmission("unreadable")), inventory.omissions)
    }

    @Test fun keepsAnUncomparedPhotoAndBoundsTheSelection() {
        val uncompared = AndroidPhotoBatch("select-one").inventory(listOf(row("IMG_4021.jpg", digest = null)))
        assertEquals(null, uncompared.items.single().contentDigest)
        assertEquals(emptyList<PhotoBatchOmission>(), uncompared.omissions)

        val rows = List(MAX_PHOTO_BATCH + 5) { row("IMG_$it.jpg", "content://media/external/images/$it") }
        val bounded = AndroidPhotoBatch("select-one").inventory(rows)
        assertEquals(MAX_PHOTO_BATCH, bounded.items.size)
        assertEquals(listOf(PhotoBatchOmission("item_limit")), bounded.omissions)
    }
}
