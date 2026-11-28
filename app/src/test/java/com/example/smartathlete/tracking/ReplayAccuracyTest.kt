package com.example.smartathlete.tracking

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.Locale

/**
 * Accuracy of jump, plyometric and strength counting, measured on real recordings.
 *
 * 1. Install a DEBUG build on the watch and do test drills. Each recording is one sensor start
 *    (one drill type); a file holding several drills is split at each drill start (segment 0, 1…).
 * 2. adb pull /sdcard/Android/data/com.example.smartathlete/files/diagnostics
 *    and put the .csv files in Watch/diagnostics/ (or pass -Ddiagnostics.dir=... / DIAG_DIR).
 * 3. Describe what was really done in Watch/diagnostics/labels.csv:
 *
 *      file,segment,kind,expected,attempts,note
 *      20261124-101500_jump.csv,,real,20,,countermovement jumps arms swinging
 *      20261124-102000_jump.csv,,fake,0,15,arm raised overhead standing still
 *      20261124-103000_reps.csv,1,real,12,,squats hands on hips
 *
 *    segment  blank = whole file, or the 0-based drill inside it
 *    kind     real = genuine movements; fake = cheating / non-jump movement (should count 0)
 *    expected genuine jumps (jump / plyo drills) or reps (strength drills) actually done
 *    attempts fake rows: how many fake movements were done (for the false-positive rate)
 *
 * 4. ./gradlew :app:testDebugUnitTest --tests "*ReplayAccuracyTest*"
 *    Report: app/build/reports/replay-accuracy.md
 *
 * Counts are compared per row (counted vs expected), not movement by movement: a missed real
 * jump and a counted fake in the same row cancel out. Keep real and fake movements in separate
 * rows. This test only reports; it doesn't fail when the targets are missed.
 */
class ReplayAccuracyTest {

    private data class Label(val file: String, val segment: Int?, val real: Boolean, val expected: Int, val attempts: Int, val note: String)

    private class Tally {
        var expected = 0; var tp = 0; var fn = 0; var overcount = 0
        var fakeCounted = 0; var fakeAttempts = 0
        val missedBecause = linkedMapOf<String, Int>()
        val fakesBlockedBy = linkedMapOf<String, Int>()
        val precision: Double? get() = (tp + overcount + fakeCounted).takeIf { it > 0 }?.let { tp.toDouble() / it }
        val recall: Double? get() = expected.takeIf { it > 0 }?.let { tp.toDouble() / it }
        val fpRate: Double? get() = fakeAttempts.takeIf { it > 0 }?.let { fakeCounted.toDouble() / it }
    }

    @Test
    fun replayRecordings() {
        val dir = File(System.getProperty("diagnostics.dir") ?: System.getenv("DIAG_DIR") ?: "../diagnostics")
        val labelsFile = File(dir, "labels.csv")
        assumeTrue("No labels.csv in ${dir.canonicalPath}: nothing recorded yet", labelsFile.isFile)
        val labels = readLabels(labelsFile)
        assumeTrue("labels.csv has no rows", labels.isNotEmpty())

        val recordings = mutableMapOf<String, ReplayHarness.Recording>()
        val rows = StringBuilder()
        val tallies = linkedMapOf<String, Tally>()
        val problems = mutableListOf<String>()

        for (label in labels) {
            val f = File(dir, label.file)
            if (!f.isFile) { problems += "${label.file}: file not found"; continue }
            val rec = recordings.getOrPut(label.file) { ReplayHarness.replay(f) }
            val segs = if (label.segment == null) rec.segments else listOfNotNull(rec.segments.getOrNull(label.segment))
            if (segs.isEmpty()) { problems += "${label.file}: no segment ${label.segment} (has ${rec.segments.size})"; continue }

            val counted = segs.sumOf { it.counted }
            val pending = segs.last().pendingJumps
            val reasons = linkedMapOf<String, Int>()
            segs.forEach { s -> ReplayHarness.rejectReasons(s.notes).forEach { (k, v) -> reasons[k] = (reasons[k] ?: 0) + v } }

            for (group in listOf(rec.profile.key, "all")) {
                val t = tallies.getOrPut(group) { Tally() }
                if (label.real) {
                    val tp = minOf(counted, label.expected)
                    t.expected += label.expected; t.tp += tp; t.fn += label.expected - tp
                    t.overcount += (counted - label.expected).coerceAtLeast(0)
                    reasons.forEach { (k, v) -> t.missedBecause[k] = (t.missedBecause[k] ?: 0) + v }
                } else {
                    t.fakeCounted += counted; t.fakeAttempts += label.attempts
                    reasons.forEach { (k, v) -> t.fakesBlockedBy[k] = (t.fakesBlockedBy[k] ?: 0) + v }
                }
            }
            val drills = segs.joinToString(" + ") { it.drill ?: "?" }
            rows.append("| ${label.file}${label.segment?.let { " #$it" } ?: ""} | ${rec.profile.key} | $drills | ")
                .append(if (label.real) "real" else "fake").append(" | ")
                .append(if (label.real) label.expected.toString() else "0 (of ${label.attempts})").append(" | ")
                .append(counted).append(if (pending > 0) " (+$pending waiting for HR)" else "").append(" | ")
                .append(label.note.replace("|", "/")).append(" |\n")
        }

        val report = buildReport(rows, tallies, problems)
        File("build/reports").mkdirs()
        val out = File("build/reports/replay-accuracy.md")
        out.writeText(report)
        println(report)
        println("Report written to ${out.canonicalPath}")
    }

    private fun buildReport(rows: StringBuilder, tallies: Map<String, Tally>, problems: List<String>): String = buildString {
        append("# Replay accuracy\n\n")
        append("Target: precision >= 95 %, recall >= 90 % (controlled testing). Measured on the labelled recordings only.\n\n")
        append("| Drills | Real done | Counted correctly | Missed | Over-counted | Fakes done | Fakes counted | Precision | Recall | False-positive rate |\n")
        append("|---|---|---|---|---|---|---|---|---|---|\n")
        for ((g, t) in tallies) {
            append("| $g | ${t.expected} | ${t.tp} | ${t.fn} | ${t.overcount} | ${t.fakeAttempts} | ${t.fakeCounted} | ")
                .append(pct(t.precision)).append(" | ").append(pct(t.recall)).append(" | ").append(pct(t.fpRate)).append(" |\n")
        }
        tallies["all"]?.let { t ->
            val p = t.precision; val r = t.recall
            append("\nTargets: precision ").append(if (p == null) "n/a" else if (p >= 0.95) "MET" else "NOT MET")
                .append(", recall ").append(if (r == null) "n/a" else if (r >= 0.90) "MET" else "NOT MET").append("\n")
        }
        append("\n## Per recording\n\n| Recording | Type | Drill | Kind | Should count | Counted | Note |\n|---|---|---|---|---|---|---|\n")
        append(rows)
        for ((g, t) in tallies) {
            if (g == "all") continue
            append("\n## $g\n\n")
            append("**Turned down during REAL movements** (candidates for missed counts; one real movement can appear more than once):\n\n")
            append(reasonList(t.missedBecause))
            append("\n**Turned down during FAKE movements** (the checks that are stopping cheating):\n\n")
            append(reasonList(t.fakesBlockedBy))
        }
        if (problems.isNotEmpty()) {
            append("\n## Problems\n\n"); problems.forEach { append("- $it\n") }
        }
    }

    private fun reasonList(m: Map<String, Int>): String =
        if (m.isEmpty()) "- (none)\n"
        else m.entries.sortedByDescending { it.value }.take(12).joinToString("") { "- ${it.value} x ${it.key}\n" }

    private fun pct(v: Double?): String = v?.let { String.format(Locale.US, "%.1f %%", it * 100) } ?: "n/a"

    private fun readLabels(f: File): List<Label> = f.readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && !it.startsWith("file,") }
        .mapIndexed { i, line ->
            val p = line.split(',', limit = 6).map { it.trim() }
            require(p.size >= 4) { "labels.csv row ${i + 1}: need file,segment,kind,expected[,attempts,note]: '$line'" }
            val real = when (p[2].lowercase()) {
                "real" -> true
                "fake" -> false
                else -> throw IllegalArgumentException("labels.csv row ${i + 1}: kind must be real or fake, not '${p[2]}'")
            }
            Label(
                file = p[0],
                segment = p[1].takeIf { it.isNotEmpty() }?.toInt(),
                real = real,
                expected = p[3].ifEmpty { "0" }.toInt(),
                attempts = p.getOrNull(4)?.ifEmpty { null }?.toInt() ?: 0,
                note = p.getOrNull(5)?.trim('"') ?: "",
            )
        }
}
