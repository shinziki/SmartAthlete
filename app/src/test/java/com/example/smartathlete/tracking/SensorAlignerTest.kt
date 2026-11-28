package com.example.smartathlete.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SensorAlignerTest {

    private class Out(val t: Long, val gz: Float, val ok: Boolean)

    private fun aligner(out: MutableList<Out>) =
        SensorAligner { _, _, _, tNs, _, _, gz, ok -> out += Out(tNs, gz, ok) }

    private val ms = 1_000_000L

    @Test
    fun accelWaitsForGyroBatchThenGetsRotationOfItsOwnMoment() {
        val out = mutableListOf<Out>()
        val a = aligner(out).apply { reset(gyroEnabled = true) }
        // A 200 ms accelerometer batch arrives first…
        for (t in 0L..190L step 10) a.pushAccel(0f, 0f, 9.8f, t * ms)
        assertTrue("nothing may be handed on before the gyroscope covers it", out.isEmpty())
        // …then the gyroscope batch: rotation ramps 0 -> 2 rad/s over 200 ms
        for (t in 0L..200L step 20) a.pushGyro(0f, 0f, t / 100f, t * ms)
        assertEquals(20, out.size)
        out.forEachIndexed { i, o ->
            assertEquals(i * 10L * ms, o.t)                       // order kept
            assertEquals(o.t / ms / 100f, o.gz, 1e-4f)            // rotation at the sample's own time
            assertTrue(o.ok)
        }
    }

    @Test
    fun withoutGyroSamplesPassStraightThrough() {
        val out = mutableListOf<Out>()
        val a = aligner(out).apply { reset(gyroEnabled = false) }
        a.pushAccel(0f, 0f, 9.8f, 5 * ms)
        assertEquals(1, out.size)
        assertFalse(out[0].ok)
    }

    @Test
    fun stalledGyroReleasesSamplesMarkedNotOk() {
        val out = mutableListOf<Out>()
        val a = aligner(out).apply { reset(gyroEnabled = true) }
        for (t in 0L..100L step 20) a.pushGyro(0f, 0f, 1f, t * ms)
        for (t in 0L..700L step 10) a.pushAccel(0f, 0f, 9.8f, t * ms)
        // Everything more than 400 ms older than the newest sample has been handed on, in order
        val released = out.map { it.t / ms }
        assertEquals((0L..290L step 10).toList(), released)
        assertTrue(out.filter { it.t / ms <= 100 }.all { it.ok })
        assertTrue(out.filter { it.t / ms > 100 + SensorAligner.MAX_GYRO_GAP_NS / ms }.none { it.ok })
    }

    @Test
    fun resetDropsWaitingSamples() {
        val out = mutableListOf<Out>()
        val a = aligner(out).apply { reset(gyroEnabled = true) }
        a.pushAccel(0f, 0f, 9.8f, 10 * ms)
        a.reset(gyroEnabled = true)
        a.pushGyro(0f, 0f, 1f, 50 * ms)
        assertTrue(out.isEmpty())
    }
}
