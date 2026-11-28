package com.example.smartathlete.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Who the watch belongs to, sent by the phone (WEARER=23|Juan D.) so the coach can see
 * at a glance whose watch an athlete is wearing. No ':' or '{' in the command: older
 * watch builds would read those as a session start.
 */
data class WearerIdentity(val name: String, val jersey: String?) {
    fun toJson(): String = JSONObject().put("n", name).put("j", jersey ?: JSONObject.NULL).toString()

    companion object {
        /** From "WEARER=<jersey>|<name>" (jersey may be empty). */
        fun fromCommand(command: String): WearerIdentity? {
            val body = command.substringAfter('=', "")
            val jersey = body.substringBefore('|', "").trim().takeIf { it.isNotBlank() }
            val name = body.substringAfter('|', "").trim().takeIf { it.isNotBlank() } ?: return null
            return WearerIdentity(name, jersey)
        }

        fun fromJson(raw: String): WearerIdentity? = try {
            val json = JSONObject(raw.substring(raw.indexOf('{')))
            val name = json.optString("n").takeIf { it.isNotBlank() && it != "null" }
            name?.let {
                WearerIdentity(it, json.optString("j").takeIf { j -> j.isNotBlank() && j != "null" })
            }
        } catch (_: Exception) { null }
    }
}

/** Jersey number and name, shown on the tracking screen for the coach. */
@Composable
fun WearerBadge(wearer: WearerIdentity) {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.86f)
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFF1B2A44))
            .padding(vertical = 3.dp, horizontal = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = (wearer.jersey?.let { "#$it  " } ?: "") + wearer.name,
            color = Color.White,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/** Identity check from the phone: confirm with fingerprint / face within the time left. */
@Composable
fun IdentityCheckBanner(secondsLeft: Int, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth(0.86f)
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xF21E3A8A))
            .padding(vertical = 10.dp, horizontal = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🔔 Identity check", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(
                text = "Confirm on your phone",
                color = Color(0xFFDBEAFE),
                style = MaterialTheme.typography.labelSmall,
                textAlign = TextAlign.Center
            )
            Text("${secondsLeft}s", color = Color(0xFFFDE68A), fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("Still counting", color = Color(0xFF86EFAC), style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * Shown instead of the tracking screen while the wearer isn't verified. Nothing is
 * counted until the athlete verifies on their own phone, next to the watch.
 */
@Composable
fun WearerLockedScreen(
    wearer: WearerIdentity?,
    reason: String?,
    onWrist: Boolean,
    phoneConnected: Boolean,
    /** Taken off again: the coach has to confirm the wearer (approved in the coach's app) */
    awaitingCoach: Boolean = false,
    /** Ends the session from the watch: the way out when the phone can't be reached */
    onEndSession: () -> Unit
) {
    val red = Color(0xFFFF6B6B)
    // Two taps to end, so a brush against the screen doesn't end the session
    var confirmEnd by remember { mutableStateOf(false) }
    LaunchedEffect(confirmEnd) {
        if (confirmEnd) {
            delay(4_000L)
            confirmEnd = false
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF2A0F0F))
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("🔒 LOCKED", color = red, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                text = if (!onWrist) "Put the watch back on your wrist" else "Watch was taken off",
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = when {
                    awaitingCoach -> "Taken off twice: your coach must confirm it's you"
                    phoneConnected -> "Verify on your phone (face check), holding it next to this watch"
                    else -> "Bring your phone close to verify"
                },
                color = Color(0xFFCBD5E1),
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center
            )
            if (wearer != null) {
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "Watch of " + (wearer.jersey?.let { "#$it " } ?: "") + wearer.name,
                    color = Color(0xFF94A3B8),
                    style = MaterialTheme.typography.labelSmall,
                    textAlign = TextAlign.Center,
                    maxLines = 2
                )
            }
            Spacer(Modifier.height(4.dp))
            Text("Not counting", color = red, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(4.dp))
            CompactButton(
                onClick = { if (confirmEnd) onEndSession() else confirmEnd = true },
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (confirmEnd) Color(0xFFB91C1C) else Color(0xFF3F1D1D)
                )
            ) {
                Text(
                    text = if (confirmEnd) "Tap again to end" else "End session",
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall
                )
            }
        }
    }
}
