package com.ryanos.android.util

import android.os.SystemClock
import android.util.Log

object WidgetTiming {
  private const val TAG = "RyanOSWidget"

  fun now(): Long = SystemClock.elapsedRealtime()

  fun elapsed(startedAt: Long): Long = now() - startedAt

  fun event(operation: String, event: String, details: String = "") {
    Log.d(TAG, format(operation, event, details))
  }

  fun mark(operation: String, stage: String, startedAt: Long, details: String = "") {
    Log.d(TAG, format(operation, "$stage ${elapsed(startedAt)}ms", details))
  }

  fun shortId(id: String): String =
    if (id.length <= 8) id else id.take(8)

  private fun format(operation: String, message: String, details: String): String {
    val suffix = details.takeIf { it.isNotBlank() }?.let { " $it" }.orEmpty()
    return "$operation $message$suffix"
  }
}
