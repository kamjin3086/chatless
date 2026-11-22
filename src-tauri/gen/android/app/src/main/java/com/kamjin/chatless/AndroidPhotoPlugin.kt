package com.kamjin.chatless

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import kotlin.concurrent.thread

class AndroidPhotoCaptureProvider : FileProvider()

@TauriPlugin
class AndroidPhotoPlugin(private val activity: Activity) : Plugin(activity) {
    private data class Capture(val file: File, val uri: Uri)

    private val cache get() = File(activity.cacheDir, "android-photo")
    private var capture: Capture? = null
    private var busy = false

    @Command
    fun acquire(invoke: Invoke) {
        val source = invoke.getArgs().optString("source")
        activity.runOnUiThread {
            if (busy) {
                outcome(invoke, "busy")
                return@runOnUiThread
            }
            busy = true
            try {
                // Discard temporary material left by process death before starting another request.
                cache.deleteRecursively()
                val intent = when (source) {
                    "capture" -> cameraIntent()
                    "pick" -> ActivityResultContracts.PickVisualMedia().createIntent(
                        activity,
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                    )
                    else -> throw IllegalArgumentException("Unknown photo source")
                }
                startActivityForResult(invoke, intent, "onPhotoResult")
            } catch (_: ActivityNotFoundException) {
                abort(invoke, "unavailable")
            } catch (_: Exception) {
                abort(invoke, "unreadable")
            }
        }
    }

    private fun cameraIntent(): Intent {
        val folder = File(cache, "capture").apply { mkdirs() }
        val file = File.createTempFile("photo-", ".jpg", folder)
        val uri = try {
            FileProvider.getUriForFile(activity, "${activity.packageName}.photo-capture", file)
        } catch (error: Exception) {
            file.delete()
            throw error
        }
        capture = Capture(file, uri)
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("Photo", uri)
            addFlags(URI_GRANTS)
        }
    }

    @ActivityCallback
    fun onPhotoResult(invoke: Invoke, result: ActivityResult) {
        val captured = releaseCapture()
        if (result.resultCode != Activity.RESULT_OK) {
            captured?.delete()
            busy = false
            outcome(invoke, if (result.resultCode == Activity.RESULT_CANCELED) "cancelled" else "unreadable")
            return
        }

        val selected = result.data?.data
        thread(name = "android-photo-import") {
            var local = captured
            val response = try {
                if (local == null && selected?.scheme == "content") {
                    cache.mkdirs()
                    local = File.createTempFile("picked-", ".image", cache)
                    copySelectedAndroidPhoto(activity.contentResolver, selected, local)
                }
                val photo = local ?: throw IllegalArgumentException("Missing photo")
                JSObject().apply {
                    put("status", "selected")
                    put("jpegBase64", androidPhotoJpeg(photo))
                }
            } catch (_: AndroidPhotoTooLarge) {
                receipt("too_large")
            } catch (_: Exception) {
                receipt("unreadable")
            } finally {
                local?.delete()
            }
            activity.runOnUiThread {
                busy = false
                invoke.resolve(response)
            }
        }
    }

    private fun releaseCapture(): File? {
        val captured = capture ?: return null
        capture = null
        runCatching { activity.revokeUriPermission(captured.uri, URI_GRANTS) }
        return captured.file
    }

    private fun abort(invoke: Invoke, status: String) {
        releaseCapture()?.delete()
        busy = false
        outcome(invoke, status)
    }

    private fun outcome(invoke: Invoke, status: String) = invoke.resolve(receipt(status))

    private fun receipt(status: String) = JSObject().apply { put("status", status) }

    private companion object {
        const val URI_GRANTS = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}
