package com.ok1cdj.kqso

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.widget.FrameLayout
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * kQSO Android shell. A single WebView that runs the bundled web
 * app. Storage/export/share/keep-awake go through KQSOBridge (window.KQSONative);
 * the web layer is otherwise identical to the browser build.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private lateinit var keyer: KeyerBle
    private var pendingPermission: ((Boolean) -> Unit)? = null
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

    // Bluetooth permissions for the CW keyer, asked on the first Connect.
    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        val cb = pendingPermission
        pendingPermission = null
        cb?.invoke(result.values.all { it })
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
            keyer = KeyerBle(this@MainActivity)
            addJavascriptInterface(KQSOBridge(this@MainActivity, keyer), "KQSONative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                // Links out of the app (Buy Me a Coffee, the new release on GitHub) open in
                // the system browser instead of replacing the app in the WebView.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == "appassets.androidplatform.net") return false
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: Exception) {
                        // No browser: nothing to open it with.
                    }
                    return true
                }
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
        // Android 15+ (targetSdk 35+) always draws edge-to-edge: without this the
        // header sits under the status bar and its buttons can't be tapped. Pad a
        // container by the system bars / cutout (and the soft keyboard, for the form
        // fields); where the system isn't edge-to-edge (the Kompakt) the insets are 0.
        root = FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        // Only after setContentView: before it there is no decor view and Android 12
        // (the Kompakt) throws an NPE here.
        setDarkBars(false) // dark icons on white until the page says otherwise
        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    override fun onDestroy() {
        keyer.close()
        super.onDestroy()
    }

    /** Dark page theme: the bars' background (the padded root) and their icons follow it. */
    fun setDarkBars(dark: Boolean) {
        root.setBackgroundColor(if (dark) 0xFF131313.toInt() else android.graphics.Color.WHITE)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    /** Ask for the BLE permissions (or answer at once when already granted). */
    fun requestBlePermissions(cb: (Boolean) -> Unit) {
        val perms = KeyerBle.blePermissions()
        if (perms.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) return cb(true)
        pendingPermission?.invoke(false)
        pendingPermission = cb
        requestPermissions.launch(perms)
    }

    fun evalJs(script: String) {
        webView.post { webView.evaluateJavascript(script, null) }
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
