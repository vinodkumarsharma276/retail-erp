import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing material lives outside the repository:
// %USERPROFILE%\.retailerp\android\key.properties (storeFile, storePassword, keyAlias,
// keyPassword), or the file named by RETAILERP_ANDROID_KEY_PROPERTIES.
val keyPropertiesFile = file(
    System.getenv("RETAILERP_ANDROID_KEY_PROPERTIES")
        ?: "${System.getProperty("user.home")}/.retailerp/android/key.properties",
)
val keyProperties = Properties().apply {
    if (keyPropertiesFile.isFile) keyPropertiesFile.inputStream().use { load(it) }
}
val hasReleaseKey = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !keyProperties.getProperty(it).isNullOrBlank() }

android {
    namespace = "com.retailerpai.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.retailerpai.mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keyProperties.getProperty("storeFile"))
                storePassword = keyProperties.getProperty("storePassword")
                keyAlias = keyProperties.getProperty("keyAlias")
                keyPassword = keyProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Never fall back to the debug key: phones could not upgrade such a build.
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else null
        }
    }
}

// Debug builds need no key; a release build without one stops with instructions.
gradle.taskGraph.whenReady {
    if (!hasReleaseKey && allTasks.any { it.project == project && it.name.contains("Release") }) {
        throw GradleException(
            "Release signing key not found: ${keyPropertiesFile.path}. " +
                "Create it with apps/mobile-flutter/tool/create-release-keystore.ps1 " +
                "(see docs/features/deployment-and-release.md).",
        )
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}