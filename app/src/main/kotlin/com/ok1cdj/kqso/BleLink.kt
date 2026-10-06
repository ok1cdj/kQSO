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
import android.util.Log
import android.widget.ArrayAdapter
import org.json.JSONObject
import java.util.UUID

/** What tells one BLE device kind from another; everything else in BleLink is shared. */
class BleSpec(
    val service: UUID,
    val write: UUID,
    val notify: UUID, // may equal write (IC-705: one characteristic both ways)
    val battery: Boolean, // read + watch the Battery Service level
    val writeType: Int, // BluetoothGattCharacteristic.WRITE_TYPE_*
    val binary: Boolean, // bytes as hex strings to/from JS; else UTF-8 text
    val matches: (name: String, services: List<ParcelUuid>?) -> Boolean, // chooser filter
    val prefMac: String, // remembered device
    val jsObject: String, // window.<jsObject>.{state,data,battery,done}
    val searching: Int, // string resources
    val choose: Int,
    val none: Int,
    val notDevice: Int,
)

/**
 * One BLE device for the web side (web/src/platform/native.ts): connect, write, hand
 * back what arrives. Only bytes move here — the protocols are in the web core (CW
 * keyer: core/keyer.ts, IC-705 CI-V: core/civ.ts).
 *
 * Results go back to JS as window.<jsObject>.{state,data,battery,done}(…):
 *  - state('off' | 'connecting' | 'on', name)
 *  - data(text) — UTF-8 text, or lowercase hex for a binary spec
 *  - done(tried, error) answers each connect(): tried = false when there was no
 *    device to try (nothing remembered / no permission for a quiet reconnect),
 *    error = null | 'cancelled' (chooser closed) | a message.
 *
 * Everything runs on the main thread (bridge calls and GATT callbacks are posted there),
 * so the state needs no locking. Android allows one GATT operation at a time per
 * connection → ops queue; several BleLinks run side by side.
 */
@SuppressLint("MissingPermission") // checked in hasPermissions() before any BLE call
class BleLink(private val activity: MainActivity, private val spec: BleSpec) {

    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences("kqso", Context.MODE_PRIVATE)
    private val adapter: BluetoothAdapter? =
        (activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter

    private var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var name: String? = null
    private var connectPending = false // a connect() still waiting for its done()
    private var payload = 20 // bytes per write: MTU − 3

    private val ops = ArrayDeque<() -> Boolean>() // each starts one GATT op; false = skip
    private var opBusy = false

    // --- bridge (called on the main thread by KQSOBridge) ---------------------

    fun connect(pick: Boolean) {
        if (gatt != null) return done(true, null) // already connecting / connected
        if (adapter == null) return done(pick, activity.getString(R.string.ble_no_bt))
        if (!pick) {
            val mac = prefs.getString(spec.prefMac, null)
            // Quiet reconnect never asks for anything: no device or no permission → not tried.
            if (mac == null || !hasPermissions() || !adapter.isEnabled) return done(false, null)
            return open(adapter.getRemoteDevice(mac))
        }
        activity.requestBlePermissions { granted ->
            when {
                !granted -> done(true, activity.getString(R.string.ble_no_permission))
                !adapter.isEnabled -> done(true, activity.getString(R.string.ble_bt_off))
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
        prefs.edit().remove(spec.prefMac).apply()
        disconnect()
    }

    fun write(chunk: String) {
        val bytes = if (spec.binary) fromHex(chunk) else chunk.toByteArray(Charsets.UTF_8)
        if (BuildConfig.DEBUG) Log.d(TAG, "${spec.jsObject} → ${toHex(bytes)}")
        enqueue {
            val g = gatt
            val c = rx
            if (g == null || c == null) false
            else if (Build.VERSION.SDK_INT >= 33) {
                g.writeCharacteristic(c, bytes, spec.writeType) == BluetoothGatt.GATT_SUCCESS
            } else {
                // Without response too, onCharacteristicWrite comes once the stack took it → order kept.
                @Suppress("DEPRECATION")
                c.writeType = spec.writeType
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

    /** Scan for matching devices and list them live; a tap connects. Stops after SCAN_MS. */
    private fun choose() {
        val scanner = adapter?.bluetoothLeScanner ?: return done(true, activity.getString(R.string.ble_bt_off))
        val found = LinkedHashMap<String, BluetoothDevice>()
        val list = ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1)
        var scanning = true
        lateinit var dialog: AlertDialog

        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, r: ScanResult) {
                val dev = r.device
                val n = r.scanRecord?.deviceName ?: dev.name ?: return
                if (!spec.matches(n, r.scanRecord?.serviceUuids)) return
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
            dialog.setTitle(if (found.isEmpty()) spec.none else spec.choose)
        }

        dialog = AlertDialog.Builder(activity)
            .setTitle(spec.searching)
            .setAdapter(list) { _, which ->
                main.removeCallbacks(timeout)
                stop()
                val dev = found.values.elementAt(which)
                prefs.edit().putString(spec.prefMac, dev.address).apply()
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
        scanner.startScan(null, settings, cb) // no filter: a name prefix can't be a ScanFilter
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
        if (connectPending) done(true, error ?: activity.getString(R.string.ble_failed))
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            main.post {
                if (g != gatt) return@post
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    if (!g.requestMtu(MTU)) g.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
                    dropped(if (connectPending) activity.getString(R.string.ble_failed_status, status) else null)
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
            if (BuildConfig.DEBUG) Log.d(TAG, "${spec.jsObject} CCCD status $status")
            main.post { if (g == gatt) next() }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (BuildConfig.DEBUG) Log.d(TAG, "${spec.jsObject} write status $status")
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

    /** Services found: service check, notifications (data, battery), battery read, then 'on'. */
    private fun setUp(g: BluetoothGatt, status: Int) {
        if (g != gatt) return
        val svc = g.getService(spec.service)
        val tx = svc?.getCharacteristic(spec.notify)
        val rxc = svc?.getCharacteristic(spec.write)
        if (status != BluetoothGatt.GATT_SUCCESS || tx == null || rxc == null) {
            g.disconnect()
            dropped(activity.getString(spec.notDevice))
            return
        }
        rx = rxc
        notify(g, tx)
        if (spec.battery) {
            g.getService(BATTERY)?.getCharacteristic(BATTERY_LEVEL)?.let { level ->
                notify(g, level)
                enqueue { g.readCharacteristic(level) }
            }
        }
        // Up once the queued setup is done: the first write can't overtake it anyway.
        enqueue {
            connectPending = false
            state("on")
            done(true, null)
            false // no GATT op: next
        }
    }

    private fun received(c: BluetoothGattCharacteristic, v: ByteArray?) {
        if (v == null || v.isEmpty()) return
        if (BuildConfig.DEBUG) Log.d(TAG, "${spec.jsObject} ← ${toHex(v)}")
        when (c.uuid) {
            spec.notify -> js("data", JSONObject.quote(if (spec.binary) toHex(v) else String(v, Charsets.UTF_8)))
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
        "window.${spec.jsObject} && window.${spec.jsObject}.$fn(${args.joinToString(",")})",
    )

    private fun hasPermissions(): Boolean = blePermissions().all {
        activity.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    companion object {
        private val BATTERY: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        private val BATTERY_LEVEL: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val MTU = 185
        private const val SCAN_MS = 10_000L
        private const val TAG = "kqso-ble"

        private val NUS: UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        private val ICOM: UUID = UUID.fromString("14cf8001-1ec2-d408-1b04-2eb270f14203")
        private val ICOM_DATA: UUID = UUID.fromString("14cf8002-1ec2-d408-1b04-2eb270f14203")

        /** M5-ESP32-keyer: Nordic UART, lines written to RX, notifications from TX. */
        val KEYER = BleSpec(
            service = NUS,
            write = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e"),
            notify = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e"),
            battery = true,
            writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT, // with response
            binary = false,
            matches = { n, s -> s?.contains(ParcelUuid(NUS)) == true || n.startsWith("keyer-") },
            prefMac = "keyerMac",
            jsObject = "__kqsoKeyer",
            searching = R.string.keyer_searching,
            choose = R.string.keyer_choose,
            none = R.string.keyer_none,
            notDevice = R.string.keyer_not_keyer,
        )

        /** Icom IC-705: CI-V over Icom's BLE serial, one characteristic both ways. Writes
         *  without response — with response the radio drops the link after the handshake. */
        val IC705 = BleSpec(
            service = ICOM,
            write = ICOM_DATA,
            notify = ICOM_DATA,
            battery = false,
            writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE,
            binary = true,
            matches = { n, s -> s?.contains(ParcelUuid(ICOM)) == true || n.startsWith("ICOM BT") },
            prefMac = "rigMac",
            jsObject = "__kqsoRig",
            searching = R.string.rig_searching,
            choose = R.string.rig_choose,
            none = R.string.rig_none,
            notDevice = R.string.rig_not_rig,
        )

        /** Runtime permissions BLE needs on this Android version. */
        fun blePermissions(): Array<String> =
            if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
            else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

        private fun toHex(b: ByteArray): String = b.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

        private fun fromHex(s: String): ByteArray = ByteArray(s.length / 2) { i -> s.substring(2 * i, 2 * i + 2).toInt(16).toByte() }
    }
}
