package com.kamjin.chatless

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.AlarmClock
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidCountdownPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun start(invoke: Invoke) {
        val seconds = invoke.getArgs().opt("durationSeconds") as? Int
        if (seconds == null || seconds !in 1..86_400) {
            invoke.reject("Countdown duration must be a whole number of seconds from 1 to 86400.")
            return
        }

        val intent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        activity.runOnUiThread {
            val status = try {
                // Let Android resolve the activity; package visibility can hide it from queries.
                activity.startActivity(intent)
                "handed_off"
            } catch (_: ActivityNotFoundException) {
                "unavailable"
            } catch (error: Exception) {
                invoke.reject("Android countdown handoff was not confirmed", error)
                return@runOnUiThread
            }
            invoke.resolve(JSObject().apply { put("status", status) })
        }
    }
}
