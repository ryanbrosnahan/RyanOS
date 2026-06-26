plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "com.ryanos.android"
  compileSdk = 37

  defaultConfig {
    applicationId = "com.ryanos.android"
    minSdk = 26
    targetSdk = 37
    versionCode = 3
    versionName = "0.1.2"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2026.05.01"))
  implementation("androidx.activity:activity-compose:1.12.4")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-extended")
  implementation("androidx.compose.runtime:runtime")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.core:core-ktx:1.16.0")
  implementation("androidx.datastore:datastore-preferences:1.1.7")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
  implementation("androidx.navigation:navigation-compose:2.9.8")
  implementation("androidx.work:work-runtime-ktx:2.10.5")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

  debugImplementation("androidx.compose.ui:ui-tooling")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.json:json:20260522")
}
