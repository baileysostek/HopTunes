#!/usr/bin/env bash
set -e

echo "==> Building web assets..."
npx vite build

echo "==> Syncing to Android..."
npx cap sync android

echo "==> Building APK..."
cd android
JAVA_HOME="C:/Users/Bailey Sostek/.jdks/openjdk-22.0.1" ./gradlew.bat assembleDebug
cd ..

echo "==> Installing on device..."
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

echo "==> Done!"
