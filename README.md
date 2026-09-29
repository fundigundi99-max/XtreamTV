# XtreamTV

Xtream Codes API ile çalışan, TV kumandasıyla kullanılmak üzere tasarlanmış IPTV oynatıcı. Tek bir HTML5 uygulaması; aynı dosyalar Samsung (Tizen), LG (webOS) ve Android TV'de çalışır.

## Özellikler

- Sunucu adresi, kullanıcı adı ve şifre ile giriş (bilgiler cihazda hatırlanır)
- Canlı TV, Filmler, Diziler (sezon ve bölüm listesi)
- Kategoriler, "Tümü" ve "Favoriler" listeleri, listede arama
- Canlı kanalda şu anki ve sıradaki program (EPG)
- Kumandayla kanal değiştirme (yukarı/aşağı veya CH+/CH−)
- Film ve bölümlerde kaldığın yerden devam, bölüm bitince sonrakine geçiş
- Canlı yayın biçimi seçimi (HLS / MPEG-TS)
- Film ve dizi afişlerinde puan rozeti, puana göre filtreleme (5, 6, 7, 7.5, 8 ve üzeri) ve sıralama (en yüksek puan, en yeni eklenen, A-Z)
- İsteğe bağlı gerçek IMDb puanları (ücretsiz OMDb anahtarıyla)
- İzlerken açılan listeler paneli: yayını durdurmadan Canlı TV, Filmler ve Diziler'e göz at, kanal ya da film değiştir
- Ses kanalı seçimi ve Türkçe dublaj varsa otomatik seçim
- Dosyadaki altyazılar ve internetten Türkçe altyazı indirme (OpenSubtitles), zamanlama ve yazı boyutu ayarı

## İzlerken kumanda

| Tuş | Canlı yayında | Film ve dizide |
|---|---|---|
| OK | Kanal listesi paneli | Duraklat / devam |
| Yukarı / aşağı | Kanal değiştir | Alt çubuk: Listeler, Ses, Altyazı |
| Sol / sağ | Alt çubuk: Kanal listesi, Ses, Altyazı | 10 sn geri / ileri |
| Geri | Açık panel ya da menüyü kapatır, yoksa listeye döner | Aynı |

Panelde kırmızı tuş favoriye ekler. Altyazı menüsünde "Zamanlama" ve "Yazı boyutu" sol / sağ tuşlarıyla ayarlanır.

## Ses ve altyazı

Ayarlar → Ses ve altyazı bölümünden varsayılanları seç:

- **Ses dili:** "Türkçe varsa Türkçe" seçiliyse, dosyada Türkçe ses kanalı olduğunda otomatik açılır.
- **Altyazı:** "Kapalı", "Türkçe varsa aç" (dosyanın içindeki Türkçe altyazıyı açar) ya da "Türkçe, yoksa indir" (dosyada yoksa internetten indirir).

Ses ve altyazı ayarları birbirinden bağımsızdır; Türkçe ses ile Türkçe altyazı birlikte açık olabilir.

**Dosyanın içindeki ses ve altyazılar:** Bunların seçilebilmesi TV'nin, dosyadaki kanalları uygulamaya bildirmesine bağlıdır. Çoğu HLS ve MP4 yayında çalışır; bazı MKV dosyalarında TV ek ses ya da altyazı kanallarını göstermeyebilir. Bu durumda Ses menüsü bunu söyler. Türkçe dublajlı sürümler çoğu sağlayıcıda ayrı film olarak, adında "TR" ya da "Dublaj" geçen kategorilerde bulunur.

**İnternetten altyazı indirme:** opensubtitles.com'da ücretsiz hesap aç, profilindeki "API consumers" bölümünden yeni bir uygulama oluştur ve verilen API anahtarını Ayarlar → Altyazı indirme'ye yaz. Kullanıcı adı ve şifre isteğe bağlıdır ama girersen günlük indirme hakkın artar. Uygulama, sağlayıcının verdiği TMDB / IMDb kimliğiyle ve orijinal film adıyla arar; dizilerde sezon ve bölüm numarası da kullanılır. İndirilen altyazılar TV'de saklanır (son 12 içerik), aynı içeriği tekrar açınca indirme hakkı harcanmaz. Türkçe bulunamazsa menüden İngilizce aratabilirsin.

## Puanlar nereden geliyor?

Afişte iki tür rozet görürsün:

- **★ 7.8** (koyu rozet): Xtream sunucusunun listeyle birlikte gönderdiği puan. Çoğu panel bunu TMDB'den çeker, IMDb puanına yakındır ama aynısı değildir. Anahtar gerekmez, tüm liste için anında vardır.
- **IMDb 7.8** (sarı rozet): OMDb üzerinden alınan gerçek IMDb puanı. Ayarlar → IMDb puanları bölümüne ücretsiz bir OMDb anahtarı yazınca çalışır. Anahtarı https://www.omdbapi.com/apikey.aspx adresinden e-postayla alırsın.

OMDb'nin ücretsiz anahtarı günde 1000 sorguyla sınırlı olduğu için uygulama tüm arşivi tek seferde taramaz. Filmler ve Diziler'de gezindikçe odaktaki içerik ve ardından gelen birkaç tanesi için puan alır, bunları cihazda saklar ve bir daha sormaz. Film adı sağlayıcıda Türkçe yazılmışsa, sunucudan orijinal adı ve varsa IMDb kimliğini alıp tekrar dener.

Puan filtresi ve sıralama, IMDb puanı alınmış içerikte onu, diğerlerinde sağlayıcı puanını kullanır. Puanı hiç olmayan içerikler, puan filtresi açıkken listede görünmez.

## Kumanda tuşları

| Tuş | Listede | Oynatırken |
|---|---|---|
| Yön tuşları | Gezinme | Canlı: kanal değiştir. Film: 10 sn ileri/geri |
| OK | Aç | Duraklat / devam |
| Kırmızı (klavyede F) | Favoriye ekle/çıkar | — |
| Başlığın yanındaki "Puan" ve sıralama düğmeleri | OK ile sıradaki seçeneğe geçer | — |
| CH+ / CH− | Sayfa kaydır | Kanal değiştir |
| ⏩ / ⏪ | — | 30 sn ileri/geri |
| Geri | Bir üst bölüme dön, en üstte iki kez basınca çık | Listeye dön |

## GitHub'dan otomatik güncelleme

Uygulama her açılışta en güncel halini GitHub'daki `fundigundi99-max/XtreamTV` deposundan alır (`ui.html`, `style.css`, `app.js`). Güncelleme için bu üç dosyayı depoda değiştirmek yeterli; TV'ye yeniden yüklemek gerekmez. Değişikliğin TV'ye ulaşması birkaç dakika sürebilir.

- GitHub'a ulaşılamazsa uygulama son indirilen kopyayla açılır, o da yoksa TV'ye yüklü kopyayla.
- GitHub'daki sürüm hatalıysa uygulama kendiliğinden TV'deki kopyaya döner.
- Hangi kopyanın çalıştığı Ayarlar → Hesap → Uygulama satırında yazar.
- Depo herkese açık olmalı. İçinde kişisel bilgi yoktur; giriş bilgileri ve anahtarlar yalnızca TV'de saklanır.

## Dosyalar

| Dosya | Görevi |
|---|---|
| `index.html`, `ui.html`, `style.css`, `app.js` | Uygulamanın kendisi (`ui.html`, `style.css`, `app.js` GitHub'dan da güncellenir) |
| `boot.js` | Açılışta GitHub'daki güncel sürümü yükler |
| `hls.min.js` | HLS yayınları için oynatıcı kütüphanesi (hls.js 1.7.3, internetten yüklenmez) |
| `config.xml`, `icon.png` | Samsung Tizen paket ayarları |
| `appinfo.json`, `icon80.png`, `icon130.png` | LG webOS paket ayarları |
| `icon512.png` | Android TV / genel simge |

---

## 1. Samsung Smart TV (Tizen, 2017 ve sonrası)

1. Bilgisayara **Tizen Studio**'yu kur. Package Manager'dan **TV Extensions** ve **Samsung Certificate Extension**'ı yükle.
2. TV'de geliştirici modunu aç: **Uygulamalar** ekranına gir, kumandada sırayla **1 2 3 4 5** tuşla. Açılan pencerede Developer Mode'u **On** yap, bilgisayarının yerel IP adresini yaz, TV'yi kapatıp aç.
3. Tizen Studio'da **Tools → Certificate Manager** ile bir **Samsung** sertifikası oluştur (Samsung hesabıyla giriş ister). TV'nin DUID'i sertifikaya eklenir.
4. **Tools → Device Manager** ile TV'nin IP adresini ekleyip bağlan.
5. Paketle ve yükle (komut satırından, Tizen Studio'nun `tools/ide/bin` klasörü PATH'te olmalı):

```bash
cd XtreamTV
tizen package -t wgt -s SERTIFIKA_PROFIL_ADI -- .
tizen install -n XtreamTV.wgt -t TV_CIHAZ_ADI
```

Alternatif: Tizen Studio'da **File → Import → Tizen → Tizen Project** ile klasörü içe aktar, sağ tıkla **Run As → Tizen Web Application**.

## 2. LG Smart TV (webOS)

1. TV'de LG Content Store'dan **Developer Mode** uygulamasını kur, LG geliştirici hesabınla giriş yap, **Dev Mode Status**'u aç ve TV'yi yeniden başlat. **Key Server**'ı da aç.
2. Bilgisayara **webOS TV CLI**'ı kur (`npm install -g @webos-tools/cli`).
3. TV'yi tanıt ve anahtarı al (passphrase Developer Mode uygulamasında yazar):

```bash
ares-setup-device            # "add" seç, TV'nin IP'si, port 9922, kullanıcı prisoner
ares-novacom --device TV_ADI --getkey
```

4. Paketle ve yükle:

```bash
ares-package XtreamTV
ares-install --device TV_ADI com.xtreamtv.player_1.2.0_all.ipk
ares-launch --device TV_ADI com.xtreamtv.player
```

Not: Developer Mode oturumu 1000 saatte bir sona erer. Developer Mode uygulamasından **Extend** ile süreyi uzatmazsan uygulama TV'den silinir.

## 3. Android TV / Google TV / TV Box (isteğe bağlı)

Android TV'de uygulamayı Capacitor ile APK'ya çevirmek gerekir. Bilgisayarda Node.js ve Android Studio kurulu olmalı.

```bash
mkdir xtreamtv-android && cd xtreamtv-android
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
mkdir www && cp ../XtreamTV/{index.html,style.css,app.js,hls.min.js} www/
npx cap init XtreamTV com.xtreamtv.player --web-dir=www
```

`capacitor.config.json` dosyasına şunları ekle (http sunuculara ve farklı alan adlarına erişim için gerekli):

```json
"server": { "androidScheme": "http", "cleartext": true },
"plugins": { "CapacitorHttp": { "enabled": true } }
```

```bash
npx cap add android
npx cap open android
```

Android Studio'da `AndroidManifest.xml` içindeki ana `<intent-filter>`'a TV başlatıcısında görünmesi için şu satırı ekle, `<application>` etiketine de `android:banner="@mipmap/ic_launcher"` yaz:

```xml
<category android:name="android.intent.category.LEANBACK_LAUNCHER" />
```

Sonra **Build → Build APK** ile APK üret ve TV'ye yükle (USB bellek ya da "Send Files to TV" ile).

---

## Bilgisayarda deneme

`index.html`'i tarayıcıda açabilirsin, ama çoğu Xtream sunucusu tarayıcıdan gelen istekleri (CORS) kabul etmez ve "Sunucuya ulaşılamadı" hatası alırsın. Bu TV'de olmaz; Tizen ve webOS uygulamalarında bu kısıtlama yoktur. Sadece bilgisayarda denemek için Chrome'u güvenlik kısıtlaması kapalı ayrı bir profille açabilirsin (günlük tarayıcı olarak kullanma):

```bash
chrome --disable-web-security --user-data-dir=/tmp/xtv-test
```

## Sorun giderme

- **Kanallar açılmıyor:** Ayarlar'dan canlı yayın biçimini değiştir (HLS ↔ MPEG-TS).
- **Film açılmıyor:** Dosya `.mkv` ise ve içinde TV'nin desteklemediği bir ses kodeği (örn. DTS) varsa TV oynatamaz. Bu sağlayıcı tarafındaki dosya biçimiyle ilgilidir.
- **Giriş hatası:** Sunucu adresini sağlayıcının verdiği şekliyle, portuyla birlikte yaz (örn. `http://sunucu.com:8080`). Sonunda `/` ya da `player_api.php` olsa da uygulama temizler.
- **Liste güncel değil:** Ayarlar → Listeleri yenile.
- **Hiç puan görünmüyor:** Bazı sağlayıcılar listeye puan eklemez. Bu durumda OMDb anahtarı ekleyerek IMDb puanlarını kullan.
- **Altyazı kayıyor:** İzlerken Altyazı menüsünde Zamanlama'yı sol / sağ ile 0,5 sn adımlarla ayarla ya da listeden sürüm adı dosyana daha yakın başka bir altyazı seç.
- **Altyazı indirme hakkı doldu:** OpenSubtitles günlük sınırı ertesi gün sıfırlanır. Hesap bilgilerini girmek sınırı yükseltir.
- **Bazı filmlerde IMDb puanı yok:** Başlık IMDb'deki adla eşleşmemiştir. Rozet sağlayıcı puanında kalır.

Uygulama yalnızca senin girdiğin sunucuya bağlanır; hiçbir içerik barındırmaz. Kendi yasal aboneliğinle kullan.
