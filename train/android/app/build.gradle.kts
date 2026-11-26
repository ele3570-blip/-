// 전국 철도 경영 안드로이드 앱: train/web 의 게임 파일을 그대로 앱 안에 넣어 WebView로 실행
import java.util.Properties

plugins { id("com.android.application") }

// 서명 키(저장소에 넣지 않음): train/android/keystore.properties 가 있으면 그걸로 release 서명
val ksProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "kr.railgame.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "kr.railgame.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 17
        versionName = "0.17"
    }
    signingConfigs {
        if (ksProps.isNotEmpty()) create("release") {
            storeFile = rootProject.file(ksProps.getProperty("storeFile"))
            storePassword = ksProps.getProperty("storePassword")
            keyAlias = ksProps.getProperty("keyAlias")
            keyPassword = ksProps.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (ksProps.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    // 게임 파일(train/web)을 앱 assets/www 로
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webassets"))
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}

val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../web")) { include("*.html", "*.js", "*.png", "*.json") }
    into(layout.buildDirectory.dir("webassets/www"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
