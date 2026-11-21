package com.kamjin.chatless

import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(content)
    }

    override fun onWebViewCreate(webView: WebView) {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            private var dispatching = false

            override fun handleOnBackPressed() {
                // Android normally gives the IME first refusal. Do not forward Back while it is visible.
                val ime = WindowInsetsCompat.Type.ime()
                if (ViewCompat.getRootWindowInsets(webView)?.isVisible(ime) == true) {
                    WindowCompat.getInsetsController(window, webView).hide(ime)
                    return
                }
                if (dispatching) return
                dispatching = true
                webView.evaluateJavascript(
                    "!document.dispatchEvent(new Event('chatless:android-back', {cancelable: true}))"
                ) { handled ->
                    dispatching = false
                    if (handled != "true" && !isFinishing && !isDestroyed) {
                        isEnabled = false
                        try {
                            onBackPressedDispatcher.onBackPressed()
                        } finally {
                            isEnabled = true
                        }
                    }
                }
            }
        })
    }

    // Wry otherwise navigates WebView history on legacy Back key-down, before the app can dismiss a panel.
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyDown(keyCode, event)
        event?.startTracking()
        return true
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyUp(keyCode, event)
        if (event?.isTracking == true && !event.isCanceled) onBackPressedDispatcher.onBackPressed()
        return true
    }
}
