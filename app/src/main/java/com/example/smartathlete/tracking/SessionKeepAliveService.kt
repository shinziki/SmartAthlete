package com.example.smartathlete.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.example.smartathlete.R
import com.example.smartathlete.presentation.MainActivity

/**
 * Keeps the watch app running at full priority while a session is on, and while the watch
 * is linked to a phone (so the phone can connect by itself whenever they're near).
 *
 * Taking the watch off (or the screen timing out) turns the screen off. Without this the
 * system may treat the app as in the background and pause it: the session clock fell
 * behind, the wrist removal wasn't noticed until the screen came back, and the phone got
 * no telemetry meanwhile (pilot 2026-11-26). A foreground service keeps the process
 * running; MainActivity holds a partial wake lock alongside it so the CPU stays awake.
 */
class SessionKeepAliveService : Service() {

    companion object {
        private const val TAG = "SessionKeepAlive"
        private const val CHANNEL_ID = "session_tracking"
        private const val NOTIFICATION_ID = 4101

        private const val EXTRA_SESSION = "session"

        /** [session]: a session runs (or waits on the wrist); otherwise just linked to the phone. */
        fun start(context: Context, session: Boolean = true) {
            try {
                val intent = Intent(context, SessionKeepAliveService::class.java).putExtra(EXTRA_SESSION, session)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (e: Exception) {
                // E.g. started while the app was in the background: the wake lock still helps
                Log.w(TAG, "Could not start the session service: ${e.message}")
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, SessionKeepAliveService::class.java))
            } catch (_: Exception) {}
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val notification = buildNotification(intent?.getBooleanExtra(EXTRA_SESSION, true) ?: true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // Missing sensor permission (health type) or not allowed right now
            Log.w(TAG, "Could not run in the foreground: ${e.message}")
            stopSelf()
        }
        // Not restarted on its own: a session only runs with the app
        return START_NOT_STICKY
    }

    private fun buildNotification(session: Boolean): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Training session", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle(if (session) "Training session" else "SmartLit")
            .setContentText(if (session) "Recording your session" else "Connected to your phone")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }
}
