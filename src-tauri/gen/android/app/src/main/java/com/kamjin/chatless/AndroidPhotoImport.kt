package com.kamjin.chatless

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File

internal const val MAX_SOURCE_BYTES = 32L * 1024 * 1024
private const val MAX_EDGE = 2048
// The shared context estimator currently budgets base64 as text rather than image tokens.
private const val MAX_JPEG_BYTES = 120 * 1024

internal class AndroidPhotoTooLarge : Exception()

internal fun copySelectedAndroidPhoto(resolver: ContentResolver, uri: Uri, output: File) {
    val input = resolver.openInputStream(uri) ?: throw IllegalArgumentException("Missing photo")
    input.use { source ->
        output.outputStream().use { target ->
            var size = 0L
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = source.read(buffer)
                if (count == -1) break
                size += count
                if (size > MAX_SOURCE_BYTES) throw AndroidPhotoTooLarge()
                target.write(buffer, 0, count)
            }
        }
    }
}

internal fun androidPhotoJpeg(file: File): String {
    if (file.length() > MAX_SOURCE_BYTES) throw AndroidPhotoTooLarge()
    val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
            val width = info.size.width
            val height = info.size.height
            if (maxOf(width, height) > MAX_EDGE) {
                val scale = MAX_EDGE.toDouble() / maxOf(width, height)
                decoder.setTargetSize((width * scale).toInt().coerceAtLeast(1), (height * scale).toInt().coerceAtLeast(1))
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        decodeLegacyPhoto(file)
    }
    try {
        val jpeg = ByteArrayOutputStream()
        var candidate = bitmap
        try {
            // Try smaller sizes only after both quality settings at the current size fail.
            while (true) {
                for (quality in intArrayOf(85, 72)) {
                    jpeg.reset()
                    check(candidate.compress(Bitmap.CompressFormat.JPEG, quality, jpeg))
                    if (jpeg.size() <= MAX_JPEG_BYTES) {
                        // Preview and send use the same bytes; re-encoding drops source metadata.
                        return Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP)
                    }
                }
                check(maxOf(candidate.width, candidate.height) > 256) { "Could not normalize photo" }
                val smaller = Bitmap.createScaledBitmap(
                    bitmap,
                    (candidate.width * 0.85).toInt().coerceAtLeast(1),
                    (candidate.height * 0.85).toInt().coerceAtLeast(1),
                    true,
                )
                if (candidate !== bitmap) candidate.recycle()
                candidate = smaller
            }
        } finally {
            if (candidate !== bitmap) candidate.recycle()
        }
    } finally {
        bitmap.recycle()
    }
}

private fun decodeLegacyPhoto(file: File): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    var sample = 1
    while (longest / sample > 2 * MAX_EDGE) sample *= 2
    val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: throw IllegalArgumentException("Unreadable photo")
    val orientation = runCatching {
        ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val matrix = Matrix()
    val longestDecoded = maxOf(bitmap.width, bitmap.height)
    if (longestDecoded > MAX_EDGE) {
        val scale = MAX_EDGE.toFloat() / longestDecoded
        matrix.setScale(scale, scale)
    }
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(-90f)
    }
    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) bitmap.recycle()
    return oriented
}
