# 전국 철도 경영 — 안드로이드 앱

`train/web`의 게임 파일을 그대로 앱 안에 넣고 WebView로 실행합니다. 게임을 고치면 다시 빌드만 하면 됩니다.

## 빌드
필요: JDK 17 이상, Android SDK(platform 35, build-tools 35), Gradle 8.9 이상
```
cd train/android
echo "sdk.dir=/경로/android-sdk" > local.properties
gradle assembleDebug      # 시험용: app/build/outputs/apk/debug/app-debug.apk
gradle assembleRelease    # 배포용: keystore.properties 가 있으면 서명됨
```
`keystore.properties`(저장소에 넣지 않음):
```
storeFile=/경로/korearail-release.jks
storePassword=...
keyAlias=korearail
keyPassword=...
```
업데이트를 기존 앱 위에 설치하려면 **같은 서명 키**로 빌드해야 합니다. 키가 바뀌면 앱을 지우고 다시 깔아야 하고, 그러면 진행 저장도 지워집니다.

## 앱 동작
- 게임은 `https://appassets.androidplatform.net/assets/www/index.html`로 열림(진행 저장이 되도록)
- 뒤로 가기: 열린 창·패널·선택을 먼저 닫고, 닫을 게 없으면 앱 종료
- 앱을 내리면 게임을 멈추고 저장
- 아이콘: `app/src/main/res/mipmap-*/ic_launcher.png` (`icon-512.png`는 큰 그림)
