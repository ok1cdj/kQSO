import org.gradle.api.JavaVersion
import java.util.Properties

plugins {
    // AGP 9 compiles Kotlin via its built-in support — no separate kotlin plugin.
    alias(libs.plugins.android.application)
}

// Signing config is read from local.properties (gitignored). CI writes it from
// repository secrets (see .github/workflows/release.yml). Same pattern as kRadar.
val signingProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun prop(key: String): String = signingProps.getProperty(key, "")

val storeFilePath = prop("signing.storeFile")
val hasSigning = storeFilePath.isNotEmpty() && rootProject.file(storeFilePath).exists()

android {
    namespace = "com.ok1cdj.kqso"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.ok1cdj.kqso"
        minSdk = 30
        targetSdk = 37
        versionCode = 15
        versionName = "1.8.2"
    }

    buildFeatures {
        buildConfig = true // exposes BuildConfig.VERSION_NAME to the bridge
    }

    if (hasSigning) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(storeFilePath)
                storePassword = prop("signing.storePassword")
                keyAlias = prop("signing.keyAlias")
                keyPassword = prop("signing.keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Reuse the SAME keystore for every release, or app updates fail with a
            // signature mismatch. Unsigned locally (no keystore) → CI signs it.
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Copy the built web app (web/dist) into the APK assets before packaging. Sync, so
// old hashed bundles don't pile up. MainActivity serves this folder at the root (/).
val copyWebAssets = tasks.register<Sync>("copyWebAssets") {
    from(rootProject.layout.projectDirectory.dir("web/dist"))
    into(layout.projectDirectory.dir("src/main/assets/kQSO"))
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
}
