#!/usr/bin/env bash
set -e

echo "==> Building web assets..."
npx vite build

echo "==> Syncing to Android..."
npx cap sync android

echo "==> Building APK..."
cd android
JAVA_HOME="$HOME/Desktop/android-studio/jbr" ./gradlew assembleDebug
cd ..

echo "==> Installing on device..."
$HOME/Android/Sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk

echo "==> Done!"
