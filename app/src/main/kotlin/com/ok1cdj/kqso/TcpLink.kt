package com.ok1cdj.kqso

import org.json.JSONObject
import java.io.IOException
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * Plain TCP text link for the ON4KST chat (web/src/platform/native.ts NativeTcp). Only
 * text moves here — the protocol is in the web core (core/kst.ts). One connection at a
 * time: connect closes the previous one. Only the ON4KST port may be opened.
 *
 * Results go back to JS as window.__kqsoTcp.{state,data}(…):
 *  - state('connecting' | 'on' | 'off', reason) — off only when it dropped by itself:
 *    close() stays quiet (a late 'off' would land on the page's next connection)
 *  - data(text) — UTF-8 text as it arrives
 *
 * The socket blocks, so each connection reads on its own thread and writes go through
 * one writer thread. Each connection has a number; a replaced or closed one stays quiet.
 */
class TcpLink(private val activity: MainActivity) {

    private val writer = Executors.newSingleThreadExecutor()
    private var socket: Socket? = null // guarded by this
    private var current = 0 // the live connection's number, 0 = none; guarded by this
    private var next = 0

    fun connect(host: String, port: Int) {
        val my = synchronized(this) {
            drop()
            current = ++next
            current
        }
        state("connecting", null)
        if (host != HOST || port != PORT) return ended(my, "not allowed")
        thread(name = "kqso-tcp-$my", isDaemon = true) { run(my, host, port) }
    }

    fun close() {
        synchronized(this) { drop() }
    }

    fun write(text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        writer.execute {
            val s = synchronized(this) { socket } ?: return@execute
            try {
                s.getOutputStream().apply {
                    write(bytes)
                    flush()
                }
            } catch (_: IOException) {
                // The reader sees the broken socket and reports it.
            }
        }
    }

    private fun run(my: Int, host: String, port: Int) {
        val s = Socket()
        try {
            s.connect(InetSocketAddress(host, port), CONNECT_MS)
            synchronized(this) {
                if (current != my) return s.close() // closed or replaced meanwhile
                socket = s
            }
            state("on", null)
            val reader = InputStreamReader(s.getInputStream(), Charsets.UTF_8)
            val buf = CharArray(4096)
            while (true) {
                val n = reader.read(buf)
                if (n < 0) break
                if (synchronized(this) { current != my }) return
                data(String(buf, 0, n))
            }
            ended(my, "closed")
        } catch (e: IOException) {
            try {
                s.close()
            } catch (_: IOException) {
            }
            ended(my, e.message ?: e.javaClass.simpleName)
        }
    }

    /** The connection `my` ended by itself: off with the reason, unless it was replaced. */
    private fun ended(my: Int, reason: String) {
        synchronized(this) {
            if (current != my) return
            drop()
        }
        state("off", reason)
    }

    /** Forgets and closes the connection (call holding the lock). */
    private fun drop() {
        current = 0
        socket?.let {
            try {
                it.close() // the reader's read() throws and finds itself replaced
            } catch (_: IOException) {
            }
        }
        socket = null
    }

    private fun state(s: String, reason: String?) =
        js("state", JSONObject.quote(s), if (reason == null) "undefined" else JSONObject.quote(reason))

    private fun data(text: String) = js("data", JSONObject.quote(text))

    private fun js(fn: String, vararg args: String) = activity.evalJs(
        "window.__kqsoTcp && window.__kqsoTcp.$fn(${args.joinToString(",")})",
    )

    companion object {
        // Mirrors KST_HOST / KST_PORT in web/src/core/kst.ts.
        private const val HOST = "www.on4kst.org"
        private const val PORT = 23001
        private const val CONNECT_MS = 15_000
    }
}
