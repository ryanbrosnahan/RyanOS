# RyanOS Android Widget

Native Android companion for RyanOS. It includes a Material 3 app for Today, Shopping, Vocabulary, Chat, and Settings, plus RyanOS home-screen widgets.

## What It Includes

- A native Material 3 cockpit app with bottom navigation for Today, Shopping, Vocabulary, Chat, and Settings.
- A Jetpack Glance app widget with responsive 2x2, 4x1, and 4x2-style layouts.
- Direct widget actions for marking normal tasks complete and recording recurrence-day completions.
- DataStore-backed settings and cached widget payloads so the widget can render from local state.
- WorkManager refresh every 30 minutes, plus immediate refresh after widget and in-app actions.
- Quick-add capture for tasks, shopping items, vocabulary entries, and chat commands.

## Requirements

- Android phone running Android 8.0 or newer.
- Android Studio with support for Android Gradle Plugin 9.2, or command-line Gradle 9.4.1+.
- Android SDK platform 37 and SDK Build Tools 36.0.0 or newer.
- JDK 17. Android Studio normally provides this for IDE builds.
- A USB cable or Android wireless debugging if installing from this machine.
- An HTTPS URL the phone can reach for the RyanOS API.

This project uses AGP 9 built-in Kotlin support. Do not add the old `org.jetbrains.kotlin.android` plugin back to the Gradle files.
The project includes a Gradle wrapper pinned to Gradle 9.4.1. The helper scripts auto-detect Android Studio's bundled JBR on macOS when `JAVA_HOME` is not set.

Cleartext HTTP is disabled in the Android manifest. Use HTTPS for the API base URL.

## API Base URL

The Android app appends `/v1/...` to the API base URL you enter in the app.

If you expose the API service directly over HTTPS, use the API origin:

```text
https://ryanos-api.example.com
```

If you expose the RyanOS web service through Tailscale Serve or another proxy that forwards `/api/*` to the API, use the web origin with `/api`:

```text
https://your-machine.your-tailnet.ts.net/api
```

That works because the Android app will call:

```text
https://your-machine.your-tailnet.ts.net/api/v1/mobile/widget-items
```

The widget uses these endpoints:

- `GET /v1/mobile/widget-items`
- `POST /v1/mobile/items`
- `POST /v1/mobile/items/:itemId/toggle`

## Prepare RyanOS

For a deployed home server, follow [docs/HOME_SERVER_DEPLOY.md](../../docs/HOME_SERVER_DEPLOY.md). The important part for the phone is that you can open the HTTPS URL from the phone browser and the API health endpoint responds.
Production RyanOS deployments require sign-in. Create the account from the web
dashboard first, then use the same email and password in the Android Settings
screen. The app stores the returned RyanOS session cookie and sends it with API
requests; it does not ask for or trust a manually entered RyanOS user ID.

For local development, start RyanOS first:

```sh
pnpm docker:up
```

The Docker stack binds the API to localhost on the Mac. A phone cannot use `localhost` on your Mac, and the Android app will not use cleartext HTTP, so local phone testing still needs an HTTPS tunnel or private proxy. Tailscale Serve is the preferred private option for this project.

## Quick Check

From `apps/android`, run:

```sh
scripts/doctor.sh https://your-machine.your-tailnet.ts.net/api
```

The doctor checks local Android build/install tools and, when given a URL, probes:

- `/health`
- `/v1/mobile/widget-items`

If you are using Android Studio only, missing command-line `adb` may be acceptable. Android Studio can provide its own install path.

## Install With Android Studio

1. Open Android Studio.
2. Choose `File > Open`.
3. Select `apps/android`.
4. Let Gradle sync finish.
5. If prompted, install the requested Android SDK platform/build tools.
6. On the phone, enable Developer Options.
7. Enable USB debugging or Wireless debugging.
8. Connect the phone and accept the debugging prompt.
9. Select the `app` run configuration.
10. Click Run.
11. Open the RyanOS app on the phone.
12. Enter the API base URL and timezone.
13. Tap `Save`, then sign in if the API is running with `RYANOS_AUTH_MODE=required`.
14. Tap `Refresh`.
15. Long-press the home screen, choose Widgets, find `RyanOS To-Do`, and place it.

## Install From The Command Line

From `apps/android`, first check prerequisites:

```sh
scripts/doctor.sh
```

Build the debug APK:

```sh
./gradlew :app:assembleDebug
```

Install it on the connected phone:

```sh
scripts/install-debug-apk.sh
```

If you already built the APK and only want to reinstall:

```sh
scripts/install-debug-apk.sh --skip-build
```

The APK is written to:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## Configure The App On The Phone

Open RyanOS and set:

- API base URL: HTTPS URL described above.
- Timezone: usually your Android timezone, for example `America/Chicago`.
- Email/password: required for a production API; optional for `dev-local`.

Tap `Save`. The app immediately refreshes Today, Shopping, Vocabulary, Chat, and widget caches.

The app opens to `Today`. Use the bottom navigation for:

- `Today`: daily focus, due/recurring tasks, check/undo, star/unstar, and recurrence day chips.
- `Shopping`: fast add, category grouping, staple suggestions, and one-day checked-item undo.
- `Words`: vocabulary quick-add, search, filters, details, and lightweight editing.
- `Chat`: send RyanOS commands through the same message endpoint as the web dashboard.
- `Settings`: connection, widget display, sync diagnostics, and widget pin actions.

## Add The Widget

1. Long-press an empty area on the Android home screen.
2. Tap `Widgets`.
3. Find `RyanOS To-Do`.
4. Drag it to the home screen.
5. Resize it if desired.

The widget supports compact and larger layouts. Larger layouts show more items and secondary detail.

## Troubleshooting

- `Cleartext HTTP traffic not permitted`: use an `https://` API base URL.
- Widget says `Connect RyanOS`: open the RyanOS app, set the API base URL, and tap `Save`.
- Widget shows stale data: tap `Refresh` in the widget or app.
- Taps do nothing: verify the phone can reach the API URL in the browser and run `scripts/doctor.sh <api-base-url>` from this machine.
- Android Studio cannot sync: install a current Android Studio with AGP 9.2 support, SDK platform 37, and JDK 17.
- `adb` cannot see the phone: re-enable USB debugging, accept the phone prompt, or run `adb devices` and check the device is listed as `device`.
- Tailscale URL works in browser but not the app: if the web service proxies API under `/api`, enter the base URL with `/api` at the end.
