package com.ok1cdj.kqso

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * kQSO Android shell. A single WebView that runs the bundled web
 * app. Storage/export/share/keep-awake go through KQSOBridge (window.KQSONative);
 * the web layer is otherwise identical to the browser build.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var pendingExport: String? = null
    private var pendingChooser: ValueCallback<Array<Uri>>? = null

    // System "Save as" dialog (SAF) for exporting a log as a .adi file.
    private val createDocument = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/octet-stream")
    ) { uri: Uri? ->
        val content = pendingExport
        pendingExport = null
        if (uri != null && content != null) {
            contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) }
        }
    }

    // System file picker (SAF) for <input type=file> (callsign DB import). All types:
    // .tsv has no reliable MIME type on Android, the web layer validates the content.
    private val openDocument = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        // The callback must always be answered (null on cancel), or the input stays dead.
        pendingChooser?.onReceiveValue(uri?.let { arrayOf(it) })
        pendingChooser = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Debug builds: allow chrome://inspect and forward JS console to logcat.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        // The web build (base /, same as kqso.ok1cdj.com) is bundled at assets/kQSO/;
        // serve that folder at the root, so /index.html and /assets/... resolve.
        val assets = WebViewAssetLoader.AssetsPathHandler(this)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/") { path -> assets.handle("kQSO/$path") }
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Assets are local (WebViewAssetLoader) — never cache. A cached index.html
            // from a previous APK points at asset hashes the update no longer ships →
            // blank screen; disabling the HTTP cache keeps every launch on the shipped build.
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(KQSOBridge(this@MainActivity), "KQSONative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            }
            // Without a WebChromeClient the WebView silently suppresses window.alert /
            // confirm — which would break delete confirmations and the export prompt.
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    Log.i("kQSOWeb", "${m.messageLevel()} ${m.message()} @${m.sourceId()}:${m.lineNumber()}")
                    return true
                }

                // Without this the WebView ignores <input type=file> entirely.
                override fun onShowFileChooser(
                    view: WebView?,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams?,
                ): Boolean {
                    pendingChooser?.onReceiveValue(null)
                    pendingChooser = callback
                    openDocument.launch(arrayOf("*/*"))
                    return true
                }

                override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                        .setOnCancelListener { result.cancel() }
                        .show()
                    return true
                }

                override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult): Boolean {
                    AlertDialog.Builder(this@MainActivity)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
                        .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                        .setOnCancelListener { result.cancel() }
                        .show()
                    return true
                }
            }
        }
        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    fun setKeepScreenOn(on: Boolean) = runOnUiThread {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun exportFile(content: String, filename: String) {
        pendingExport = content
        runOnUiThread { createDocument.launch(filename) }
    }

    fun shareFile(content: String, filename: String) = runOnUiThread {
        val dir = File(cacheDir, "shared").apply { mkdirs() }
        val file = File(dir, filename).apply { writeText(content) }
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, filename))
    }
}
