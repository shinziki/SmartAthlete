package com.example.smartathlete.tracking

import com.example.smartathlete.tracking.WorkoutSensorTracker.PlyoStyle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The plyometric drill names on the phone (constants/workouts.ts) map to the right checks. */
class PlyoStyleTest {

    @Test
    fun tuckJumpsAreMaxEffortJumpsInPlaceWithMovingArms() {
        // One at a time with a reset between; the hands move to the knees in the air, so the
        // arm-swing and tuck allowances apply (JumpDetector.tuck)
        assertEquals(setOf(PlyoStyle.RESET), PlyoStyle.forDrill("Tuck jumps"))
        assertTrue(PlyoStyle.armSwing("Tuck jumps"))
        assertTrue(PlyoStyle.tuck("Tuck jumps"))
        assertTrue(PlyoStyle.tuck("Repeated tuck jumps"))
        assertFalse(PlyoStyle.tuck("Jump squats"))
    }

    @Test
    fun repeatedTuckJumpsAreRebounds() {
        assertEquals(setOf(PlyoStyle.REBOUND), PlyoStyle.forDrill("Repeated tuck jumps"))
    }

    @Test
    fun jumpSquatsSwingTheArmsLikeSquatJumps() {
        // Done back to back (they link within the reset gap) with the arms driven up each time
        assertEquals(setOf(PlyoStyle.RESET), PlyoStyle.forDrill("Jump squats"))
        assertTrue(PlyoStyle.armSwing("Jump squats"))
        assertTrue(PlyoStyle.armSwing("Squat jumps"))
    }

    @Test
    fun lateralBoundsLinkWithOrWithoutAStick() {
        assertEquals(setOf(PlyoStyle.REBOUND, PlyoStyle.RESET), PlyoStyle.forDrill("Lateral bounds"))
        assertTrue(PlyoStyle.armSwing("Lateral bounds"))
    }

    @Test
    fun stakeholderCircuitExercisesEachGetTheirOwnChecks() {
        assertEquals(setOf(PlyoStyle.BOX), PlyoStyle.forDrill("Box jumps"))
        assertEquals(setOf(PlyoStyle.REBOUND), PlyoStyle.forDrill("Single-leg hops"))
        assertFalse(PlyoStyle.armSwing("Single-leg hops"))
        assertFalse(PlyoStyle.armSwing("Box jumps"))
    }

    @Test
    fun bothTuckDrillsInOneSessionAllowBoth() {
        assertEquals(
            setOf(PlyoStyle.REBOUND, PlyoStyle.RESET),
            PlyoStyle.forDrill("Tuck jumps, Repeated tuck jumps"),
        )
    }
}
