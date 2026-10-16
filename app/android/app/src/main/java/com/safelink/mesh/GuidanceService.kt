package com.safelink.mesh

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
import androidx.core.app.NotificationCompat

/**
 * Keeps the app running (and allowed to read GPS) while live directions are on and the phone is locked
 * or another app is in front. It does nothing itself: its job is the foreground notification, which is
 * what Android requires before it lets an app use location in the background. It runs only between
 * "Start live directions" and "Stop".
 */
class GuidanceService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Live directions", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while SafeLink is following your route"
            setShowBadge(false)
          })
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val tap =
        PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification: Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SafeLink directions")
            .setContentText("Following your route. Tap to open.")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setContentIntent(tap)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY // if Android ever kills it, do not quietly come back: the user stops and starts directions
  }

  companion object {
    private const val CHANNEL_ID = "safelink_guidance"
    private const val NOTIFICATION_ID = 4107
  }
}
