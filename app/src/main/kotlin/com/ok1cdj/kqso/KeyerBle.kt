package com.ok1cdj.kqso

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.widget.ArrayAdapter
import org.json.JSONObject
import java.util.UUID

/**
 * CW keyer (M5-ESP32-keyer) over BLE — the APK side of the web KeyerTransport
 * (web/src/platform/native.ts). Nordic UART: lines written to RX, notifications from TX;
 * Battery Service for the level. Only bytes move here, the line protocol is core/keyer.ts.
 *
 * Results go back to JS as window.__kqsoKeyer.{state,data,battery,done}(…):
 *  - state('off' | 'connecting' | 'on', name)
 *  - done(tried, error) answers each keyerConnect(): tried = false when there was no
 *    keyer to try (nothing remembered / no permission for a quiet reconnect),
 *    error = null | 'cancelled' (chooser closed) | a message.
 *
 * Everything runs on the main thread (bridge calls and GATT callbacks are posted there),
 * so the state needs no locking. Android allows one GATT operation at a time → ops queue.
 */
@SuppressLint("MissingPermission") // checked in hasPermissions() before any BLE call
class KeyerBle(private val activity: MainActivity) {

    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences("kqso", Context.MODE_PRIVATE)
    private val adapter: BluetoothAdapter? =
        (activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter

    private var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var name: String? = null
    private var connectPending = false // a keyerConnect() still waiting for its done()
    private var payload = 20 // bytes per write: MTU − 3

    private val ops = ArrayDeque<() -> Boolean>() // each starts one GATT op; false = skip
    private var opBusy = false

    // --- bridge (called on the main thread by KQSOBridge) ---------------------

    fun connect(pick: Boolean) {
        if (gatt != null) return done(true, null) // already connecting / connected
        if (adapter == null) return done(pick, activity.getString(R.string.keyer_no_bt))
        if (!pick) {
            val mac = prefs.getString(PREF_MAC, null)
            // Quiet reconnect never asks for anything: no keyer or no permission → not tried.
            if (mac == null || !hasPermissions() || !adapter.isEnabled) return done(false, null)
            return open(adapter.getRemoteDevice(mac))
        }
        activity.requestBlePermissions { granted ->
            when {
                !granted -> done(true, activity.getString(R.string.keyer_no_permission))
                !adapter.isEnabled -> done(true, activity.getString(R.string.keyer_bt_off))
                else -> choose()
            }
        }
    }

    fun disconnect() {
        val g = gatt ?: return state("off")
        if (connectPending) done(true, "cancelled")
        g.disconnect()
        dropped(null) // don't wait for the callback: it does not always come before connected
    }

    fun forget() {
        prefs.edit().remove(PREF_MAC).apply()
        disconnect()
    }

    fun write(chunk: String) {
        val bytes = chunk.toByteArray(Charsets.UTF_8)
        enqueue {
            val g = gatt
            val c = rx
            if (g == null || c == null) false
            else if (Build.VERSION.SDK_INT >= 33) {
                g.writeCharacteristic(c, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT // with response → order kept
                @Suppress("DEPRECATION")
                c.value = bytes
                @Suppress("DEPRECATION")
                g.writeCharacteristic(c)
            }
        }
    }

    fun mtu(): Int = payload

    fun close() {
        gatt?.close()
        gatt = null
    }

    // --- chooser ----------------------------------------------------------------

    /** Scan for keyers and list them live; a tap connects. Stops after SCAN_MS. */
    private fun choose() {
        val scanner = adapter?.bluetoothLeScanner ?: return done(true, activity.getString(R.string.keyer_bt_off))
        val found = LinkedHashMap<String, BluetoothDevice>()
        val list = ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1)
        var scanning = true
        lateinit var dialog: AlertDialog

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, r: ScanResult) {
                val dev = r.device
                val n = r.scanRecord?.deviceName ?: dev.name ?: return
                val nus = r.scanRecord?.serviceUuids?.contains(ParcelUuid(NUS)) == true
                if (!nus && !n.startsWith("keyer-")) return
                if (found.put(dev.address, dev) == null) main.post { list.add(n) }
            }
        }
        val stop = {
            if (scanning) {
                scanning = false
                try { scanner.stopScan(cb) } catch (_: Exception) {}
            }
        }
        val timeout = Runnable {
            stop()
            dialog.setTitle(if (found.isEmpty()) R.string.keyer_none else R.string.keyer_choose)
        }

        dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.keyer_searching)
            .setAdapter(list) { _, which ->
                main.removeCallbacks(timeout)
                stop()
                val dev = found.values.elementAt(which)
                prefs.edit().putString(PREF_MAC, dev.address).apply()
                open(dev)
            }
            .setNegativeButton(android.R.string.cancel) { d, _ -> d.cancel() }
            .setOnCancelListener {
                main.removeCallbacks(timeout)
                stop()
                done(true, "cancelled")
            }
            .show()

        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(null, settings, cb) // no filter: the name prefix can't be a ScanFilter
        main.postDelayed(timeout, SCAN_MS)
    }

    // --- GATT -------------------------------------------------------------------

    private fun open(dev: BluetoothDevice) {
        name = dev.name ?: dev.address
        connectPending = true
        state("connecting")
        gatt = dev.connectGatt(activity, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    /** Link down (or never came up): close, report, answer a pending connect. */
    private fun dropped(error: String?) {
        gatt?.close()
        gatt = null
        rx = null
        ops.clear()
        opBusy = false
        payload = 20
        state("off")
        if (connectPending) done(true, error ?: activity.getString(R.string.keyer_failed))
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            main.post {
                if (g != gatt) return@post
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    if (!g.requestMtu(MTU)) g.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                    dropped(if (connectPending) activity.getString(R.string.keyer_failed_status, status) else null)
                }
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            main.post {
                if (g != gatt) return@post
                if (status == BluetoothGatt.GATT_SUCCESS) payload = (mtu - 3).coerceAtLeast(20)
                g.discoverServices()
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            main.post { setUp(g, status) }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            main.post { if (g == gatt) next() }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            main.post { if (g == gatt) next() }
        }

        @Deprecated("API < 33")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            @Suppress("DEPRECATION")
            val v = c.value
            main.post { if (g == gatt) { received(c, v); next() } }
        }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            main.post { if (g == gatt) { received(c, value); next() } }
        }

        @Deprecated("API < 33")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            val v = c.value?.copyOf()
            main.post { received(c, v) }
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            main.post { received(c, value) }
        }
    }

    /** Services found: NUS check, notifications (TX, battery), battery read, then 'on'. */
    private fun setUp(g: BluetoothGatt, status: Int) {
        if (g != gatt) return
        val nus = g.getService(NUS)
        val tx = nus?.getCharacteristic(TX)
        val rxc = nus?.getCharacteristic(RX)
        if (status != BluetoothGatt.GATT_SUCCESS || tx == null || rxc == null) {
            g.disconnect()
            dropped(activity.getString(R.string.keyer_not_keyer))
            return
        }
        rx = rxc
        notify(g, tx)
        g.getService(BATTERY)?.getCharacteristic(BATTERY_LEVEL)?.let { level ->
            notify(g, level)
            enqueue { g.readCharacteristic(level) }
        }
        // Up once the queued setup is done: the first command can't overtake it anyway.
        enqueue {
            connectPending = false
            state("on")
            done(true, null)
            false // no GATT op: next
        }
    }

    private fun received(c: BluetoothGattCharacteristic, v: ByteArray?) {
        if (v == null || v.isEmpty()) return
        when (c.uuid) {
            TX -> js("data", JSONObject.quote(String(v, Charsets.UTF_8)))
            BATTERY_LEVEL -> js("battery", (v[0].toInt() and 0xFF).toString())
        }
    }

    /** Notifications on: local flag + the CCCD write (queued). */
    private fun notify(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
        g.setCharacteristicNotification(c, true)
        val cccd = c.getDescriptor(CCCD) ?: return
        enqueue {
            val on = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            if (Build.VERSION.SDK_INT >= 33) {
                g.writeDescriptor(cccd, on) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                cccd.value = on
                @Suppress("DEPRECATION")
                g.writeDescriptor(cccd)
            }
        }
    }

    // --- op queue ---------------------------------------------------------------

    private fun enqueue(op: () -> Boolean) {
        ops.addLast(op)
        if (!opBusy) next()
    }

    /** Start the next op; one that started nothing (false) is skipped right away. */
    private fun next() {
        opBusy = false
        while (ops.isNotEmpty()) {
            if (ops.removeFirst()()) {
                opBusy = true
                return
            }
        }
    }

    // --- to JS --------------------------------------------------------------------

    private fun state(s: String) = js("state", JSONObject.quote(s), JSONObject.quote(name ?: ""))

    private fun done(tried: Boolean, error: String?) {
        connectPending = false
        js("done", tried.toString(), if (error == null) "null" else JSONObject.quote(error))
    }

    private fun js(fn: String, vararg args: String) = activity.evalJs(
        "window.__kqsoKeyer && window.__kqsoKeyer.$fn(${args.joinToString(",")})",
    )

    private fun hasPermissions(): Boolean = blePermissions().all {
        activity.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    companion object {
        private val NUS: UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        private val RX: UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e") // write
        private val TX: UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e") // notify
        private val BATTERY: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        private val BATTERY_LEVEL: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val PREF_MAC = "keyerMac"
        private const val MTU = 185
        private const val SCAN_MS = 10_000L

        /** Runtime permissions BLE needs on this Android version. */
        fun blePermissions(): Array<String> =
            if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
            else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
}
