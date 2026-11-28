package com.example.smartathlete.tracking

import java.io.File

/**
 * Replays a DiagnosticRecorder CSV through a fresh [WorkoutSensorTracker], exactly as the
 * watch processed it live (same detectors, same heart-rate / series / plyo-run rules), so a
 * change to any threshold can be re-scored against the same recordings.
 */
object ReplayHarness {
    /** Recorded samples further apart than this = counting was paused (pause, lock, off-wrist) */
    private const val PAUSE_GAP_MS = 1_000L

    /** One drill inside a recording (files split at "drill_start" events). */
    data class Segment(
        val index: Int,
        val drill: String?,
        val profile: SensorProfile,
        val jumps: Int,
        val reps: Int,
        val jumpsRejected: Int,
        /** Jumps still waiting for the heart rate at the end of the segment */
        val pendingJumps: Int,
        val notes: List<Pair<String, String>>,
    ) {
        /** What this drill type counts: reps for strength drills, jumps otherwise */
        val counted: Int get() = if (profile.countReps) reps else jumps
    }

    data class Recording(val file: File, val header: Map<String, String>, val profile: SensorProfile, val segments: List<Segment>)

    fun replay(file: File): Recording {
        val header = linkedMapOf<String, String>()
        file.useLines { lines ->
            for (l in lines) {
                if (!l.startsWith("#")) break
                val kv = l.removePrefix("#").trim()
                val i = kv.indexOf('=')
                if (i > 0) header[kv.substring(0, i)] = kv.substring(i + 1)
            }
        }
        val profile = SensorProfile.fromKey(header["profile"])
            ?: error("${file.name}: no '# profile=' header (not a DiagnosticRecorder file?)")
        val firstDrill = header["drill"]?.takeIf { it != "null" && it.isNotBlank() }

        val tracker = WorkoutSensorTracker(null)
        val notes = mutableListOf<Pair<String, String>>()
        tracker.onNote = { k, m -> notes += k to m }
        tracker.startReplay(
            profile, firstDrill,
            gyro = header["gyro"] == "true",
            barometer = header["barometer"] == "true",
            hrSensor = header["hrSensor"] != "false",
        )
        notes.clear()

        val segments = mutableListOf<Segment>()
        var drill = firstDrill
        var baseJumps = 0
        var baseReps = 0
        var baseRejected = 0
        var hasData = false
        var lastT = 0L

        fun closeSegment() {
            segments += Segment(
                segments.size, drill, profile,
                // Verified jumps: the live count also holds ones still being verified
                tracker.confirmedJumpCount - baseJumps, tracker.confirmedRepCount - baseReps, tracker.jumpsRejected - baseRejected,
                tracker.pendingJumpCount, notes.toList(),
            )
            notes.clear()
            baseJumps = tracker.confirmedJumpCount; baseReps = tracker.confirmedRepCount; baseRejected = tracker.jumpsRejected
            hasData = false
        }

        file.useLines { lines ->
            for ((n, line) in lines.withIndex()) {
                if (line.isEmpty() || line.startsWith("#")) continue
                try {
                    when (line[0]) {
                        'S' -> {
                            val p = line.split(',')
                            val t = p[1].toLong()
                            if (lastT > 0L && t - lastT > PAUSE_GAP_MS) tracker.replayNotCounting()
                            lastT = t
                            tracker.replaySample(
                                t, p[2].toFloat(), p[3].toFloat(), p[4].toFloat(),
                                p[5].toFloat(), p[6].toFloat(), p[7].toFloat(), p[8] == "1",
                            )
                            hasData = true
                        }
                        'B' -> { val p = line.split(','); tracker.replayBarometer(p[1].toLong(), p[2].toFloat()) }
                        'H' -> { val p = line.split(','); tracker.replayHeartRate(p[1].toLong(), p[2].toInt()) }
                        'E' -> {
                            val p = line.split(',', limit = 4)
                            when (p[2]) {
                                // Live decisions are re-derived by the replay; only drill changes are replayed
                                "drill" -> {
                                    drill = p.getOrNull(3)?.substringAfter('\'', "")?.substringBeforeLast('\'')?.takeIf { it.isNotEmpty() && it != "null" }
                                    tracker.setDrillName(drill)
                                }
                                "drill_start" -> {
                                    if (hasData) closeSegment()
                                    tracker.markDrillStart()
                                    notes.removeAll { it.first == "drill_start" }
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    throw IllegalStateException("${file.name} line ${n + 1}: can't read '$line'", e)
                }
            }
        }
        closeSegment()
        // A trailing empty segment (drill_start right before the end) isn't a drill
        val kept = segments.filterIndexed { i, s -> i == 0 || s.notes.isNotEmpty() || s.counted > 0 }
        return Recording(file, header, profile, kept)
    }

    private val REJECT_KINDS = setOf("jump_reject", "plyo_reject", "rep_reject", "rep_reset")

    /**
     * Why jump-shaped / rep-shaped movements were turned down, grouped with the numbers taken
     * out ("push only #ms ..."). Ordinary movement that never looked like a jump is left out.
     */
    fun rejectReasons(notes: List<Pair<String, String>>): Map<String, Int> {
        val out = linkedMapOf<String, Int>()
        for ((kind, msg) in notes) {
            val reason = when {
                kind in REJECT_KINDS -> msg.substringAfter(": ", msg)
                // Judged candidates (push + flight + landing) carry " light="; flight-stage
                // shape checks ("flight=50ms -> no: ...") are just ordinary movement
                kind == "jump_judge" && "-> no" in msg && ("light=" in msg || "sensor gap" in msg) ->
                    msg.substringAfter("-> no: ", msg.substringAfter("-> ", msg))
                else -> continue
            }
            val key = "${kind.substringBefore('_')}: " + reason.replace(Regex("-?\\d+(\\.\\d+)?"), "#")
            out[key] = (out[key] ?: 0) + 1
        }
        return out
    }
}
