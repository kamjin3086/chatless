package com.kamjin.chatless

import org.junit.Assert.*
import org.junit.Test

class AndroidDirectoryInventoryTest {
    private val root = DirectoryRow("provider:private/root", "Inbox", true)
    private val nested = DirectoryRow("provider:private/deep", "Nested", true)
    private val file = DirectoryRow("provider:private/file", "notes.txt", false, "text/plain", 80, null)
    private val locked = DirectoryRow("provider:private/locked", "Locked", true)
    private val outside = DirectoryRow("provider:outside", "Do not read", true)

    @Test fun inventoriesOnlyDescendantsAndReportsUnreadableBranchesAndRows() {
        val accessed = mutableListOf<String>()
        val children = mapOf(root.documentId to listOf(nested, locked, null), nested.documentId to listOf(file, root))
        val inventory = AndroidDirectoryInventory("grant-one").scan(root) { id, accept ->
            accessed.add(id)
            children[id]?.all(accept) ?: false
        }
        assertEquals(listOf(root.documentId, nested.documentId, locked.documentId), accessed)
        assertFalse(outside.documentId in accessed)
        assertEquals(listOf("Nested", "Locked", "notes.txt"), inventory.entries.map { it.item.name })
        assertEquals(inventory.folder.handle, inventory.entries.first().parentHandle)
        assertEquals(inventory.entries.first().item.handle, inventory.entries.last().parentHandle)
        assertEquals(listOf("unreadable", "duplicate_or_cycle", "unreadable"), inventory.omissions.map { it.reason })
        assertEquals("Locked", inventory.omissions.last().item?.name)
        assertFalse(inventory.toString().contains("provider:"))
    }

    @Test fun handlesAreStableWithinASelectionAndUnrelatedAfterReselect() {
        fun scan(selection: String) = AndroidDirectoryInventory(selection).scan(root) { _, accept -> accept(file) }
        assertEquals(scan("grant-one"), scan("grant-one"))
        assertNotEquals(scan("grant-one").folder.handle, scan("grant-two").folder.handle)
        assertNotEquals(scan("grant-one").entries.single().item.handle, scan("grant-two").entries.single().item.handle)
    }

    @Test fun boundsProviderRowsAndDepthAndReportsLimits() {
        var delivered = 0
        val bounded = AndroidDirectoryInventory("grant", maxEntries = 2).scan(root) { _, accept ->
            (1..500).all { n ->
                delivered += 1
                accept(file.copy(documentId = "$n"))
            }
        }
        assertEquals(3, delivered)
        assertEquals(2, bounded.entries.size)
        assertEquals("entry_limit", bounded.omissions.single().reason)

        val shallow = AndroidDirectoryInventory("grant", maxDepth = 1).scan(root) { id, accept ->
            assertEquals(root.documentId, id)
            accept(nested)
        }
        assertEquals("depth_limit", shallow.omissions.single().reason)
        assertEquals("Nested", shallow.omissions.single().item?.name)
    }
}
