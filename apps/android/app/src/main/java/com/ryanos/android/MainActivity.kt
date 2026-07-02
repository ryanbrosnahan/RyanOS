package com.ryanos.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ryanos.android.ui.RyanOsApp
import com.ryanos.android.ui.RyanOsTheme
import com.ryanos.android.ui.RyanOsViewModel

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      RyanOsTheme {
        RyanOsApp(
          viewModel = viewModel<RyanOsViewModel>(),
          initialScreen = intent?.getStringExtra(EXTRA_INITIAL_SCREEN)
        )
      }
    }
  }

  companion object {
    const val EXTRA_INITIAL_SCREEN = "initial_screen"
    const val SCREEN_TASKS = "tasks"
    const val SCREEN_TODAY = "tasks"
    const val SCREEN_INBOX = "inbox"
    const val SCREEN_SHOPPING = "shopping"
    const val SCREEN_VOCABULARY = "vocabulary"
    const val SCREEN_CHAT = "chat"
    const val SCREEN_SETTINGS = "settings"
  }
}
