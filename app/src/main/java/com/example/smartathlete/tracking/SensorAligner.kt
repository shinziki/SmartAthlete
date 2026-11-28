package com.example.smartathlete.tracking

/**
 * Pairs each accelerometer sample with the gyroscope reading taken at the same moment.
 *
 * Both sensors are batched by the sensor hub (WorkoutSensorTracker's ACCEL_MAX_LATENCY_US,
 * 200 ms) and each batch is delivered on its own schedule. "The latest gyroscope value" while
 * an accelerometer sample is handled can therefore be up to ~200 ms off, before or after it.
 * That matters to the anti-cheat checks: the wrist rotation measured "during a jump's flight"
 * could belong to the push-off, the landing or the next movement.
 *
 * Accelerometer samples are held here until the gyroscope has reported past their timestamp,
 * then handed on, in order, with the rotation interpolated at their exact time. If the
 * gyroscope falls behind by more than [MAX_WAIT_NS] of accelerometer time (stalled or
 * stopped), samples are handed on anyway with the nearest reading and `gyroOk = false`.
 *
 * Without a gyroscope (`gyroEnabled = false` in [reset]) samples pass straight through.
 * Not thread-safe: use from one thread (the sensor callbacks all arrive on the main thread).
 */
class SensorAligner(private val sink: Sink) {

    fun interface Sink {
        /**
         * One accelerometer sample ([ax], [ay], [az] m/s², sensor time [tNs]) with the wrist
         * rotation at that moment ([gx], [gy], [gz] rad/s). [gyroOk] is false when no gyroscope
         * reading was close enough to that moment (rotation is then the nearest one, or 0).
         */
        fun onSample(ax: Float, ay: Float, az: Float, tNs: Long, gx: Float, gy: Float, gz: Float, gyroOk: Boolean)
    }

    companion object {
        /** Longest an accelerometer sample waits for the gyroscope (sensor time) */
        const val MAX_WAIT_NS = 400_000_000L
        /** Two gyroscope readings further apart than this don't describe the time between */
        const val MAX_GYRO_GAP_NS = 80_000_000L
        private const val GYRO_CAP = 128   // ~2.5 s at 50 Hz
        private const val ACCEL_CAP = 128  // ~1.3 s at 100 Hz
    }

    private var gyroEnabled = false

    // Gyroscope ring buffer (oldest at gHead - gCount)
    private val gT = LongArray(GYRO_CAP)
    private val gX = FloatArray(GYRO_CAP)
    private val gY = FloatArray(GYRO_CAP)
    private val gZ = FloatArray(GYRO_CAP)
    private var gHead = 0
    private var gCount = 0

    // Accelerometer samples waiting for the gyroscope (oldest at aTail)
    private val aT = LongArray(ACCEL_CAP)
    private val aX = FloatArray(ACCEL_CAP)
    private val aY = FloatArray(ACCEL_CAP)
    private val aZ = FloatArray(ACCEL_CAP)
    private var aTail = 0
    private var aCount = 0
    private var newestAccelNs = 0L

    /** Clears everything; call whenever the sensors are (re)registered. */
    fun reset(gyroEnabled: Boolean) {
        this.gyroEnabled = gyroEnabled
        gHead = 0; gCount = 0
        aTail = 0; aCount = 0
        newestAccelNs = 0L
    }

    fun pushAccel(x: Float, y: Float, z: Float, tNs: Long) {
        if (!gyroEnabled) {
            sink.onSample(x, y, z, tNs, 0f, 0f, 0f, false)
            return
        }
        if (aCount == ACCEL_CAP) releaseOldest()   // never lose a sample: hand it on early
        val i = (aTail + aCount) % ACCEL_CAP
        aT[i] = tNs; aX[i] = x; aY[i] = y; aZ[i] = z
        aCount++
        if (tNs > newestAccelNs) newestAccelNs = tNs
        drain()
    }

    fun pushGyro(x: Float, y: Float, z: Float, tNs: Long) {
        if (!gyroEnabled) return
        if (gCount > 0 && tNs <= gT[(gHead - 1 + GYRO_CAP) % GYRO_CAP]) return   // out of order
        gT[gHead] = tNs; gX[gHead] = x; gY[gHead] = y; gZ[gHead] = z
        gHead = (gHead + 1) % GYRO_CAP
        if (gCount < GYRO_CAP) gCount++
        drain()
    }

    private fun newestGyroNs(): Long = if (gCount == 0) Long.MIN_VALUE else gT[(gHead - 1 + GYRO_CAP) % GYRO_CAP]

    /** Hands on every waiting sample the gyroscope has caught up with (or given up on). */
    private fun drain() {
        while (aCount > 0) {
            val t = aT[aTail]
            if (newestGyroNs() >= t || newestAccelNs - t > MAX_WAIT_NS) releaseOldest() else break
        }
    }

    private fun releaseOldest() {
        val i = aTail
        aTail = (aTail + 1) % ACCEL_CAP
        aCount--
        emitAligned(aX[i], aY[i], aZ[i], aT[i])
    }

    /** Interpolates the gyroscope at [t] and hands the sample on. */
    private fun emitAligned(x: Float, y: Float, z: Float, t: Long) {
        if (gCount == 0) {
            sink.onSample(x, y, z, t, 0f, 0f, 0f, false)
            return
        }
        // Newest reading at or before t, searching back from the newest
        var after = -1
        for (k in 0 until gCount) {
            val j = (gHead - 1 - k + GYRO_CAP) % GYRO_CAP
            if (gT[j] <= t) {
                if (after < 0) {
                    // t is at or past the newest reading (the gyroscope stalled)
                    val ok = t - gT[j] <= MAX_GYRO_GAP_NS
                    sink.onSample(x, y, z, t, gX[j], gY[j], gZ[j], ok)
                    return
                }
                val span = gT[after] - gT[j]
                val f = if (span > 0) (t - gT[j]).toFloat() / span else 0f
                sink.onSample(
                    x, y, z, t,
                    gX[j] + f * (gX[after] - gX[j]),
                    gY[j] + f * (gY[after] - gY[j]),
                    gZ[j] + f * (gZ[after] - gZ[j]),
                    span <= MAX_GYRO_GAP_NS,
                )
                return
            }
            after = j
        }
        // t is older than every buffered reading (the gyroscope only just started)
        sink.onSample(x, y, z, t, gX[after], gY[after], gZ[after], gT[after] - t <= MAX_GYRO_GAP_NS)
    }
}
