package com.example.smartathlete.tracking

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Records the raw motion data of jump, plyometric and strength drills, plus every decision the
 * detectors make about it (counted / not counted, and why), to CSV files on the watch.
 * DEBUG BUILDS ONLY ([forDebugBuild] returns null in a release build), for testing accuracy:
 * the files are replayed through JumpDetector offline to measure precision and recall, and to
 * find which check turned down a real movement.
 *
 * Files: <external files dir>/diagnostics/<yyyyMMdd-HHmmss>_<profile>.csv, one per sensor
 * start (drill profile switch). Get them with:
 *   adb pull /sdcard/Android/data/com.example.smartathlete/files/diagnostics
 *
 * Rows (times are sensor time, ms):
 *   # key=value                           header (device, profile, sensors)
 *   S,t,ax,ay,az,gx,gy,gz,gyroOk          accelerometer (m/s²) + aligned gyroscope (rad/s)
 *   B,t,hPa                               barometer
 *   H,t,bpm                               heart rate
 *   E,t,kind,"detail"                     a detector decision or drill change
 *
 * Writing happens on a background thread; nothing here may disturb tracking, so every
 * failure is only logged.
 */
class DiagnosticRecorder private constructor(private val dir: File) {

    companion object {
        private const val TAG = "DiagnosticRecorder"
        /** Stop writing to one file past this size (~2 h at 100 Hz) */
        private const val MAX_FILE_BYTES = 50L * 1024 * 1024
        /** Older recordings beyond this many are deleted */
        private const val KEEP_FILES = 30
        /** Lines are handed to the writer thread in chunks of about this size */
        private const val FLUSH_CHARS = 16 * 1024

        /** A recorder in debuggable builds, null in release builds. */
        fun forDebugBuild(context: Context): DiagnosticRecorder? {
            if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return null
            val base = context.getExternalFilesDir(null) ?: context.filesDir
            return DiagnosticRecorder(File(base, "diagnostics"))
        }
    }

    private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "diag-writer").apply { isDaemon = true } }
    private val buf = StringBuilder(FLUSH_CHARS + 512)
    private var file: File? = null
    private var written = 0L
    private var full = false

    val recording: Boolean get() = file != null && !full

    /** Starts a new file; [header] lines are written as "# key=value". */
    fun begin(label: String, header: Map<String, Any?>) {
        end()
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val safe = label.lowercase(Locale.US).replace(Regex("[^a-z0-9]+"), "-").trim('-').take(30)
        val f = File(dir, "${stamp}_$safe.csv")
        file = f
        written = 0L
        full = false
        buf.append("# device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
        header.forEach { (k, v) -> buf.append("# ").append(k).append('=').append(v).append('\n') }
        buf.append("# columns: S,t,ax,ay,az,gx,gy,gz,gyroOk | B,t,hPa | H,t,bpm | E,t,kind,detail\n")
        writer.execute {
            try {
                dir.mkdirs()
                dir.listFiles { x -> x.name.endsWith(".csv") }?.sortedByDescending { it.name }
                    ?.drop(KEEP_FILES - 1)?.forEach { it.delete() }
            } catch (e: Exception) {
                Log.w(TAG, "Could not prepare $dir", e)
            }
        }
        Log.d(TAG, "Recording to ${f.absolutePath}")
    }

    fun sample(t: Long, ax: Float, ay: Float, az: Float, gx: Float, gy: Float, gz: Float, gyroOk: Boolean) {
        if (!recording) return
        buf.append("S,").append(t).append(',')
            .append(r(ax)).append(',').append(r(ay)).append(',').append(r(az)).append(',')
            .append(r(gx)).append(',').append(r(gy)).append(',').append(r(gz)).append(',')
            .append(if (gyroOk) '1' else '0').append('\n')
        maybeFlush()
    }

    fun barometer(t: Long, hPa: Float) {
        if (!recording) return
        buf.append("B,").append(t).append(',').append(String.format(Locale.US, "%.3f", hPa)).append('\n')
        maybeFlush()
    }

    fun heartRate(t: Long, bpm: Int) {
        if (!recording) return
        buf.append("H,").append(t).append(',').append(bpm).append('\n')
        maybeFlush()
    }

    fun event(t: Long, kind: String, detail: String) {
        if (!recording) return
        buf.append("E,").append(t).append(',').append(kind).append(",\"")
            .append(detail.replace("\"", "'")).append("\"\n")
        maybeFlush()
    }

    /** Writes what's left and closes the current file. */
    fun end() {
        if (file == null) return
        flush()
        file = null
    }

    private fun maybeFlush() {
        if (buf.length >= FLUSH_CHARS) flush()
    }

    private fun flush() {
        val f = file ?: return
        if (buf.isEmpty()) return
        val chunk = buf.toString()
        buf.setLength(0)
        written += chunk.length
        if (written > MAX_FILE_BYTES) {
            full = true
            Log.w(TAG, "${f.name} reached ${MAX_FILE_BYTES / 1024 / 1024} MB: recording stopped")
        }
        writer.execute {
            try {
                FileWriter(f, true).use { it.write(chunk) }
            } catch (e: Exception) {
                Log.w(TAG, "Could not write ${f.name}", e)
            }
        }
    }

    /** 3 decimals: well below sensor noise, keeps files small */
    private fun r(v: Float): String = String.format(Locale.US, "%.3f", v)
}
