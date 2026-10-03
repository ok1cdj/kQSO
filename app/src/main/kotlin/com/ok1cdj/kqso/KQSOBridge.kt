package com.ok1cdj.kqso

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import java.io.File

/**
 * window.KQSONative — the storage/host bridge. Pure file I/O keyed by log
 * id, mirroring the OPFS worker protocol; the web NativePlatform wraps these
 * synchronous methods into the async KQSOPlatform. Logs are real .adi files in
 * app storage (reachable via ADB), so there is no WebKit-style eviction.
 */
class KQSOBridge(private val activity: MainActivity, private val keyer: KeyerBle) {

    private val ctx: Context = activity.applicationContext
    private val logsDir: File = File(ctx.filesDir, "logs").apply { mkdirs() }
    private val prefs = ctx.getSharedPreferences("kqso", Context.MODE_PRIVATE)

    // Callsign DB live layer: one file outside logsDir, so deleting logs never touches it.
    private val callDb: File = File(ctx.filesDir, "calldb.tsv")

    private fun adi(id: String) = File(logsDir, "$id.adi")
    private fun journal(id: String) = File(logsDir, "$id.journal")

    @JavascriptInterface
    fun displayMode(): String = "eink" // e-ink hardcoded in the shell

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME // APK version, shown in About

    @JavascriptInterface
    fun isPersisted(): Boolean = true // real files in app storage

    @JavascriptInterface
    fun list(): String {
        val ids = logsDir.listFiles { f -> f.name.endsWith(".adi") }
            ?.map { it.name.removeSuffix(".adi") }
            ?: emptyList()
        return JSONArray(ids).toString()
    }

    @JavascriptInterface
    fun createHeader(id: String, content: String) = adi(id).writeText(content)

    @JavascriptInterface
    fun append(id: String, text: String) = adi(id).appendText(text)

    @JavascriptInterface
    fun read(id: String): String = adi(id).let { if (it.exists()) it.readText() else "" }

    @JavascriptInterface
    fun rewrite(id: String, content: String) = adi(id).writeText(content)

    @JavascriptInterface
    fun remove(id: String) {
        adi(id).delete()
        journal(id).delete()
    }

    @JavascriptInterface
    fun writeJournal(id: String, text: String) = journal(id).writeText(text)

    @JavascriptInterface
    fun readJournal(id: String): String = journal(id).let { if (it.exists()) it.readText() else "" }

    @JavascriptInterface
    fun clearJournal(id: String) = journal(id).writeText("")

    @JavascriptInterface
    fun getSetting(key: String): String? = prefs.getString(key, null)

    @JavascriptInterface
    fun setSetting(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    @JavascriptInterface
    fun exportLog(id: String, filename: String) = activity.exportFile(read(id), filename)

    @JavascriptInterface
    fun exportText(content: String, filename: String) = activity.exportFile(content, filename)

    @JavascriptInterface
    fun readCallDb(): String = if (callDb.exists()) callDb.readText() else ""

    @JavascriptInterface
    fun writeCallDb(text: String) = callDb.writeText(text)

    @JavascriptInterface
    fun shareLog(id: String, filename: String) = activity.shareFile(read(id), filename)

    @JavascriptInterface
    fun keepAwake(on: Boolean) = activity.setKeepScreenOn(on)

    // CW keyer (KeyerBle). Bridge calls come on a binder thread; BLE state lives on main.
    @JavascriptInterface
    fun keyerConnect(pick: Boolean) = activity.runOnUiThread { keyer.connect(pick) }

    @JavascriptInterface
    fun keyerDisconnect() = activity.runOnUiThread { keyer.disconnect() }

    @JavascriptInterface
    fun keyerForget() = activity.runOnUiThread { keyer.forget() }

    @JavascriptInterface
    fun keyerWrite(chunk: String) = activity.runOnUiThread { keyer.write(chunk) }

    @JavascriptInterface
    fun keyerMtu(): Int = keyer.mtu()
}
