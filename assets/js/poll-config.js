/* Canlı oylama ayarları (authoring/POLLS.md).
   mode:
     "firebase" : Firebase Realtime Database, sınıfta kullanılan biçim. Soruyu yalnızca eğitmen anahtarı
                  girilmiş tarayıcı sekmesi açar ve kapatır (slaytta Shift+K).
     "local"    : tools/poll_server.py ile aynı Wi-Fi üzerinde deneme. Slayt ve cevap sayfası bu sunucudan açılır.
                  Adrese ?oylama=yerel eklenince mode ne olursa olsun bu biçim kullanılır; poll_server.py
                  yazdırdığı adreslere bunu kendisi ekler.
   firebaseUrl: veritabanı adresi, sonunda eğik çizgi olmadan.
   answerBase: cevap sayfasının adresi, sonunda "oy/" ile. Boş kalırsa slaytın açıldığı adresten hesaplanır
     (site/slides/... sayfasının yanındaki site/oy/).
   publishedAnswerBase: deste bilgisayardaki bir dosyadan (file://) açıldığında QR kodunun gösterdiği adres.
     Hiçbir telefon file:// adresini açamaz; bu yüzden QR yayımlanmış sitedeki cevap sayfasını gösterir. */
window.POLL_CONFIG = {
  mode: "firebase",
  firebaseUrl: "https://ieee-hacettepe-python-course-default-rtdb.europe-west1.firebasedatabase.app",
  answerBase: "",
  publishedAnswerBase: "https://natozenbilek.github.io/ieee-hacettepe-python-course/oy/"
};
if (/[?&]oylama=yerel(&|$)/.test(location.search)) window.POLL_CONFIG.mode = "local";
