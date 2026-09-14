package com.example.smartathlete.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText

/**
 * Screen displayed when the Wear OS watch is NOT yet linked to an athlete account.
 * Shows the pairing code and advertises over BLE for the mobile phone to connect.
 * When a mobile phone attempts to link, it presents an Accept / Decline confirmation request.
 */
@Composable
fun DeviceLinkPromptScreen(
    pairingCode: String,
    isAdvertising: Boolean = true,
    pendingDeviceName: String? = null,
    onAcceptLink: () -> Unit = {},
    onDeclineLink: () -> Unit = {},
    onManualLinkRequest: () -> Unit = {}
) {
    val emeraldGreen = Color(0xFF00A86B)
    val darkMutedGreen = Color(0xFF0B2B22)
    val warmAmber = Color(0xFFFFB300)
    val darkAmberBg = Color(0xFF2E2000)
    val darkRedBg = Color(0xFF3A1C1C)
    val brightRedText = Color(0xFFFF6B6B)

    val listState = rememberTransformingLazyColumnState()

    AppScaffold {
        ScreenScaffold(
            timeText = { TimeText() },
            scrollState = listState
        ) { paddingValues ->
            TransformingLazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                if (pendingDeviceName != null) {
                    // --- CONFIRMATION PROMPT STATE ---
                    item {
                        ListHeader {
                            Text(
                                text = "Link Request",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onBackground,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // Alert pill - Confirmation Needed
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.9f)
                                .height(26.dp)
                                .clip(CircleShape)
                                .background(darkAmberBg),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "● Accept Link Request?",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = warmAmber
                            )
                        }
                    }

                    // Device Info Display
                    item {
                        Spacer(modifier = Modifier.height(2.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.85f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(darkMutedGreen)
                                .padding(vertical = 8.dp, horizontal = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "REQUEST FROM",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = pendingDeviceName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = emeraldGreen,
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    }

                    // Explanation
                    item {
                        Text(
                            text = "Do you want to accept this device as your linked phone?",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)
                        )
                    }

                    // Accept / Decline Buttons
                    item {
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(0.9f),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Button(
                                onClick = onDeclineLink,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = darkRedBg,
                                    contentColor = brightRedText
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = "Decline",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }

                            Button(
                                onClick = onAcceptLink,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = emeraldGreen,
                                    contentColor = Color.White
                                ),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = "Accept",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                } else {
                    // --- WAITING FOR LINK STATE ---
                    item {
                        ListHeader {
                            Text(
                                text = "SmartAthlete",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onBackground,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    // Alert pill - Watch Not Linked
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.9f)
                                .height(26.dp)
                                .clip(CircleShape)
                                .background(darkAmberBg),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "● Watch Not Linked",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = warmAmber
                            )
                        }
                    }

                    // Instructions
                    item {
                        Text(
                            text = "Open SmartAthlete app on your phone and tap Scan",
                            style = MaterialTheme.typography.bodyExtraSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)
                        )
                    }

                    // Pairing Code Display
                    item {
                        Spacer(modifier = Modifier.height(2.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.85f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(darkMutedGreen)
                                .padding(vertical = 6.dp, horizontal = 10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = "PAIRING CODE",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = pairingCode,
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = emeraldGreen
                                )
                            }
                        }
                    }

                    // BLE Advertising Status Pill
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                            modifier = Modifier.padding(vertical = 2.dp)
                        ) {
                            Text(
                                text = if (isAdvertising) "● BLE Advertising Active" else "○ Waiting for BLE...",
                                style = MaterialTheme.typography.bodyExtraSmall,
                                color = if (isAdvertising) emeraldGreen else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}
